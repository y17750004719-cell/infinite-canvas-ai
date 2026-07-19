import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { chat } from '../../../lib/api-client';
import { readProviderRegistry } from '../../../lib/provider-config.mjs';
import { resolveProviderModelSelection } from '../../../lib/provider-model-selection.mjs';
import {
  normalizeRegionBox,
  normalizeRegionPoint,
  parseLocateModelResponse,
} from '../../../lib/image-region-selection.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_LOCATE_MODEL = 'gemini-3.1-flash-lite-preview-thinking-medium';
const MAX_LOCATE_DATA_URL_CHARS = 17_000_000;

const isAllowedLocateImageSource = (value: string) => (
  value.startsWith('/') || /^data:image\/[a-z0-9.+-]+;base64,/i.test(value)
);

const isLocateImageSourceTooLong = (value: string) => (
  value.startsWith('data:image/') ? value.length > MAX_LOCATE_DATA_URL_CHARS : value.length > 4096
);

const locateTool = {
  type: 'function' as const,
  function: {
    name: 'report_image_region_candidates',
    description: 'Return candidate identities for the object indicated by the marker or normalized region.',
    parameters: {
      type: 'object',
      required: ['candidates', 'selectedCandidateId', 'lowConfidence'],
      properties: {
        candidates: {
          type: 'array',
          minItems: 1,
          maxItems: 5,
          items: {
            type: 'object',
            required: ['id', 'label', 'aliases', 'confidence'],
            properties: {
              id: { type: 'string' },
              label: { type: 'string' },
              aliases: { type: 'array', items: { type: 'string' } },
              confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
              description: { type: 'string' },
              box: {
                type: 'object',
                required: ['x', 'y', 'width', 'height'],
                properties: {
                  x: { type: 'number', minimum: 0, maximum: 1 },
                  y: { type: 'number', minimum: 0, maximum: 1 },
                  width: { type: 'number', minimum: 0, maximum: 1 },
                  height: { type: 'number', minimum: 0, maximum: 1 },
                },
              },
            },
          },
        },
        selectedCandidateId: { type: 'string' },
        lowConfidence: { type: 'boolean' },
      },
    },
  },
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const imageSrc = typeof body?.imageSrc === 'string' ? body.imageSrc.trim() : '';
    const evidenceImageSrc = typeof body?.evidenceImageSrc === 'string' ? body.evidenceImageSrc.trim() : '';
    const cropImageSrc = typeof body?.cropImageSrc === 'string' ? body.cropImageSrc.trim() : '';
    const requestedRegionId = typeof body?.regionId === 'string' ? body.regionId.trim() : '';
    const imageItemId = typeof body?.imageItemId === 'string' ? body.imageItemId.trim() : '';
    const point = normalizeRegionPoint(body?.point);
    const box = normalizeRegionBox(body?.box);
    const mode = body?.mode === 'box' && box ? 'box' : 'point';
    if (!imageSrc || !imageItemId || !point) {
      return NextResponse.json({ error: 'imageSrc, imageItemId and a normalized point are required' }, { status: 400 });
    }
    const imageSources = [imageSrc, evidenceImageSrc, cropImageSrc].filter(Boolean);
    if (imageSources.some((source) => !isAllowedLocateImageSource(source))) {
      return NextResponse.json({ error: 'Only local or embedded image sources are supported for object recognition' }, { status: 400 });
    }
    if (imageSources.some(isLocateImageSourceTooLong) || requestedRegionId.length > 160) {
      return NextResponse.json({ error: 'Image source is too long' }, { status: 400 });
    }

    const providers = await readProviderRegistry();
    const selection = resolveProviderModelSelection({
      providers,
      purpose: 'chat',
      requestedProviderId: typeof body?.providerId === 'string' ? body.providerId : undefined,
      requestedModel: typeof body?.model === 'string' ? body.model : DEFAULT_LOCATE_MODEL,
    });
    if (!selection.model) {
      return NextResponse.json({ error: 'No enabled visual chat model is configured' }, { status: 400 });
    }

    const location = mode === 'box'
      ? `Normalized selection box: ${JSON.stringify(box)}. Its center point is ${JSON.stringify(point)}.`
      : `Normalized target point: ${JSON.stringify(point)}.`;
    const messages = [
      {
        role: 'system' as const,
        content: [
          'Identify the visible object or person indicated by the supplied marker or normalized coordinates.',
          'Return 2 to 5 concise candidate labels, ordered from most specific and likely to more general alternatives.',
          'Distinguish repeated subjects using visible attributes and relative position, such as left/right or clothing.',
          'Candidate labels must describe what is visibly present, not the requested future edit.',
          'Use normalized 0..1 coordinates for an optional approximate bounding box.',
          'Call report_image_region_candidates exactly once.',
        ].join('\n'),
      },
      {
        role: 'user' as const,
        content: [
          { type: 'text' as const, text: `${location}\nThe first image is the original. ${evidenceImageSrc ? 'The second image contains the target marker.' : ''} ${cropImageSrc ? 'The final image is a clean local crop around the target and should be used to resolve fine-grained identity.' : ''}` },
          { type: 'image_url' as const, image_url: { url: imageSrc } },
          ...(evidenceImageSrc
            ? [{ type: 'image_url' as const, image_url: { url: evidenceImageSrc } }]
            : []),
          ...(cropImageSrc
            ? [{ type: 'image_url' as const, image_url: { url: cropImageSrc } }]
            : []),
        ],
      },
    ];
    const response = await chat({
      providerId: selection.providerId || undefined,
      model: selection.model,
      messages,
      tools: [locateTool],
      toolChoice: { type: 'function', function: { name: locateTool.function.name } },
      signal: AbortSignal.timeout(60_000),
    });
    const parsed = parseLocateModelResponse(response);
    return NextResponse.json({
      regionId: requestedRegionId || randomUUID(),
      ...parsed,
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Object recognition failed',
    }, { status: 502 });
  }
}
