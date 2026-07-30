'use client';

import { useCallback, useEffect, useRef } from 'react';
import { buildRegionRecognitionPrompt, parseLocateModelResponse } from '../lib/image-region-selection.mjs';
import type { RegionCandidate, RegionSelection } from '../lib/image-region-selection.types';

export type RegionEvidence = { imageSrc?: string; evidenceImageSrc?: string; cropImageSrc?: string };

const isAbortError = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';
const recognitionErrorMessage = (value: unknown) => {
  const message = value instanceof Error ? value.message : String(value || '识别失败');
  const normalized = message.toLowerCase();
  return /(image input|image understanding|vision|multimodal|图片输入|图像输入)/.test(normalized)
    && /(not support|unsupported|does not support|不支持)/.test(normalized)
    ? '当前对话模型不支持图片理解，请切换模型'
    : message;
};

export function useImageRegionSelectionController({
  setRegions,
  providerId,
  model,
  buildEvidence,
  onResolved,
  onFailed,
}: {
  setRegions: React.Dispatch<React.SetStateAction<RegionSelection[]>>;
  providerId?: string;
  model?: string;
  buildEvidence: (region: RegionSelection, signal: AbortSignal) => Promise<RegionEvidence>;
  onResolved: (region: RegionSelection, previousRegionId: string, lowConfidence: boolean, evidence: RegionEvidence) => void;
  onFailed: (regionId: string, evidence: RegionEvidence) => void;
}) {
  const controllersRef = useRef<Map<string, AbortController>>(new Map());
  const revisionsRef = useRef<Map<string, number>>(new Map());

  const cancelRecognition = useCallback((regionId: string) => {
    controllersRef.current.get(regionId)?.abort();
    controllersRef.current.delete(regionId);
  }, []);

  const cancelAllRecognitions = useCallback(() => {
    controllersRef.current.forEach((controller) => controller.abort());
    controllersRef.current.clear();
    revisionsRef.current.clear();
  }, []);

  useEffect(() => cancelAllRecognitions, [cancelAllRecognitions]);

  const getRecognitionRevision = useCallback((regionId: string) => revisionsRef.current.get(regionId) || 0, []);

  const startRecognition = useCallback(async (region: RegionSelection) => {
    cancelRecognition(region.id);
    const controller = new AbortController();
    const revision = (revisionsRef.current.get(region.id) || region.recognitionRevision || 0) + 1;
    controllersRef.current.set(region.id, controller);
    revisionsRef.current.set(region.id, revision);
    const isCurrentRequest = () => (
      !controller.signal.aborted
      && controllersRef.current.get(region.id) === controller
      && revisionsRef.current.get(region.id) === revision
    );

    setRegions((previous) => previous.map((candidate) => candidate.id === region.id
      ? { ...candidate, status: 'recognizing', error: undefined, recognitionRevision: revision }
      : candidate));

    let evidence: RegionEvidence = {};
    try {
      const recognitionProviderId = providerId?.trim();
      const recognitionModel = model?.trim();
      if (!recognitionProviderId || !recognitionModel) {
        throw new Error('请先选择支持图片理解的对话模型');
      }
      try {
        evidence = await buildEvidence(region, controller.signal);
      } catch (error) {
        if (isAbortError(error)) return;
        // Coordinate grounding against the original image remains a valid fallback.
      }
      if (!isCurrentRequest()) return;

      const referenceImages = [evidence.imageSrc || region.imageSrc];
      const referenceLabels = ['original-image'];
      if (evidence.evidenceImageSrc) {
        referenceImages.push(evidence.evidenceImageSrc);
        referenceLabels.push('marked-location');
      }
      if (evidence.cropImageSrc) {
        referenceImages.push(evidence.cropImageSrc);
        referenceLabels.push('clean-region-crop');
      }
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intent: 'chat',
          stream: false,
          chatProviderId: recognitionProviderId,
          model: recognitionModel,
          messages: [{
            role: 'user',
            content: buildRegionRecognitionPrompt({
              mode: region.mode,
              point: region.point,
              box: region.box,
              hasMarkedImage: Boolean(evidence.evidenceImageSrc),
              hasCropImage: Boolean(evidence.cropImageSrc),
            }),
          }],
          reference_images: referenceImages,
          reference_labels: referenceLabels,
        }),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => null);
      if (!isCurrentRequest()) return;
      if (!response.ok) {
        throw new Error(payload?.error || '未能识别该区域');
      }
      const parsed = parseLocateModelResponse(payload);

      const nextRegion: RegionSelection = {
        ...region,
        candidates: parsed.candidates as RegionCandidate[],
        selectedCandidateId: parsed.selectedCandidateId,
        status: parsed.lowConfidence ? 'ambiguous' : 'ready',
        recognitionRevision: revision,
      };
      setRegions((previous) => previous.map((candidate) => candidate.id === region.id ? nextRegion : candidate));
      onResolved(nextRegion, region.id, parsed.lowConfidence, evidence);
    } catch (error) {
      if (isAbortError(error) || !isCurrentRequest()) return;
      setRegions((previous) => previous.map((candidate) => candidate.id === region.id
        ? {
            ...candidate,
            status: 'failed',
            recognitionRevision: revision,
            error: recognitionErrorMessage(error),
          }
        : candidate));
      onFailed(region.id, evidence);
    } finally {
      if (controllersRef.current.get(region.id) === controller) {
        controllersRef.current.delete(region.id);
      }
    }
  }, [buildEvidence, cancelRecognition, model, onFailed, onResolved, providerId, setRegions]);

  return {
    startRecognition,
    cancelRecognition,
    cancelAllRecognitions,
    getRecognitionRevision,
  };
}
