import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildGeminiNoImageErrorMessage,
  classifyGeminiImagePayload,
  extractGeminiImageOutputs,
  summarizeGeminiImagePayload,
} from './gemini-image-response.mjs';

const IMAGE_PART = {
  inlineData: {
    mimeType: 'image/png',
    data: 'ZmFrZS1pbWFnZQ==',
  },
};
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00]);
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const WEBP_BYTES = Buffer.from([
  0x52, 0x49, 0x46, 0x46,
  0x00, 0x00, 0x00, 0x00,
  0x57, 0x45, 0x42, 0x50,
]);

test('extractGeminiImageOutputs returns data urls from inlineData parts', () => {
  assert.deepEqual(
    extractGeminiImageOutputs({
      candidates: [
        {
          content: {
            parts: [IMAGE_PART],
          },
        },
      ],
    }),
    [
      {
        url: 'data:image/png;base64,ZmFrZS1pbWFnZQ==',
      },
    ]
  );
});

test('extractGeminiImageOutputs preserves snake_case inlineData mime_type', () => {
  const base64 = JPEG_BYTES.toString('base64');

  assert.deepEqual(
    extractGeminiImageOutputs({
      candidates: [
        {
          content: {
            parts: [
              {
                inlineData: {
                  mime_type: 'image/jpeg',
                  data: base64,
                },
              },
            ],
          },
        },
      ],
    }),
    [
      {
        url: `data:image/jpeg;base64,${base64}`,
      },
    ]
  );
});

test('extractGeminiImageOutputs accepts snake_case inline_data parts', () => {
  const base64 = JPEG_BYTES.toString('base64');

  assert.deepEqual(
    extractGeminiImageOutputs({
      candidates: [
        {
          content: {
            parts: [
              {
                inline_data: {
                  mime_type: 'image/jpeg',
                  data: base64,
                },
              },
            ],
          },
        },
      ],
    }),
    [
      {
        url: `data:image/jpeg;base64,${base64}`,
      },
    ]
  );
});

test('extractGeminiImageOutputs infers image mime type from base64 signature', () => {
  assert.deepEqual(
    extractGeminiImageOutputs({
      candidates: [
        {
          content: {
            parts: [
              { inlineData: { data: WEBP_BYTES.toString('base64') } },
              { inlineData: { data: JPEG_BYTES.toString('base64') } },
              { inlineData: { data: PNG_BYTES.toString('base64') } },
            ],
          },
        },
      ],
    }).map((entry) => entry.url.split(';', 1)[0]),
    ['data:image/webp', 'data:image/jpeg', 'data:image/png']
  );
});

test('classifyGeminiImagePayload returns prompt_blocked when promptFeedback has a block reason', () => {
  const summary = summarizeGeminiImagePayload({
    promptFeedback: {
      blockReason: 'PROHIBITED_CONTENT',
    },
  });

  assert.equal(summary.promptBlockReason, 'PROHIBITED_CONTENT');
  assert.equal(classifyGeminiImagePayload(summary), 'prompt_blocked');
  assert.equal(
    buildGeminiNoImageErrorMessage(classifyGeminiImagePayload(summary)),
    'Gemini official image blocked by prompt feedback'
  );
});

test('classifyGeminiImagePayload returns finish_reason_no_image for NO_IMAGE candidates', () => {
  const summary = summarizeGeminiImagePayload({
    candidates: [
      {
        finishReason: 'NO_IMAGE',
        content: {
          parts: [],
        },
      },
    ],
  });

  assert.deepEqual(summary.finishReasons, ['NO_IMAGE']);
  assert.equal(classifyGeminiImagePayload(summary), 'finish_reason_no_image');
  assert.equal(
    buildGeminiNoImageErrorMessage(classifyGeminiImagePayload(summary)),
    'Gemini official image finished without image output'
  );
});

test('classifyGeminiImagePayload returns image_safety_blocked for image safety finish reasons', () => {
  const summary = summarizeGeminiImagePayload({
    candidates: [
      {
        finishReason: 'IMAGE_SAFETY',
        content: {
          parts: [],
        },
      },
    ],
  });

  assert.equal(classifyGeminiImagePayload(summary), 'image_safety_blocked');
  assert.equal(
    buildGeminiNoImageErrorMessage(classifyGeminiImagePayload(summary)),
    'Gemini official image blocked by image safety policy'
  );
});

test('classifyGeminiImagePayload returns candidate_text_only when only text parts are present', () => {
  const summary = summarizeGeminiImagePayload({
    candidates: [
      {
        content: {
          parts: [{ text: 'Image generation skipped for policy reasons.' }],
        },
      },
    ],
  });

  assert.equal(summary.hasText, true);
  assert.equal(summary.textPreview, 'Image generation skipped for policy reasons.');
  assert.equal(classifyGeminiImagePayload(summary), 'candidate_text_only');
  assert.equal(
    buildGeminiNoImageErrorMessage(classifyGeminiImagePayload(summary)),
    'Gemini official image returned text instead of image'
  );
});

test('classifyGeminiImagePayload returns empty_candidates when no candidates exist', () => {
  const summary = summarizeGeminiImagePayload({});

  assert.equal(summary.candidateCount, 0);
  assert.equal(classifyGeminiImagePayload(summary), 'empty_candidates');
  assert.equal(
    buildGeminiNoImageErrorMessage(classifyGeminiImagePayload(summary)),
    'Gemini official image returned empty candidates'
  );
});

test('classifyGeminiImagePayload returns unsupported_payload_shape for 200 OK payloads without image or text parts', () => {
  const summary = summarizeGeminiImagePayload({
    candidates: [
      {
        content: {
          parts: [{ functionCall: { name: 'noop' } }],
        },
      },
    ],
  });

  assert.deepEqual(summary.partTypes, ['functionCall']);
  assert.equal(classifyGeminiImagePayload(summary), 'unsupported_payload_shape');
  assert.equal(
    buildGeminiNoImageErrorMessage(classifyGeminiImagePayload(summary)),
    'Gemini official image returned an unsupported payload shape'
  );
});
