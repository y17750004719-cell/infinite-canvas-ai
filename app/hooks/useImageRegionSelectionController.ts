'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { RegionCandidate, RegionSelection } from '../lib/image-region-selection.types';

type RegionEvidence = { imageSrc?: string; evidenceImageSrc?: string; cropImageSrc?: string };

const isAbortError = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

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
  onResolved: (region: RegionSelection, previousRegionId: string, lowConfidence: boolean) => void;
  onFailed: (regionId: string) => void;
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

    try {
      let evidence: RegionEvidence = {};
      try {
        evidence = await buildEvidence(region, controller.signal);
      } catch (error) {
        if (isAbortError(error)) return;
        // Coordinate grounding against the original image remains a valid fallback.
      }
      if (!isCurrentRequest()) return;

      const response = await fetch('/api/image-tools/locate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          regionId: region.id,
          imageSrc: evidence.imageSrc || region.imageSrc,
          evidenceImageSrc: evidence.evidenceImageSrc || undefined,
          cropImageSrc: evidence.cropImageSrc || undefined,
          imageItemId: region.imageItemId,
          mode: region.mode,
          point: region.point,
          box: region.box,
          providerId: providerId || undefined,
          model: model || undefined,
        }),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => null);
      if (!isCurrentRequest()) return;
      if (!response.ok || !Array.isArray(payload?.candidates) || payload.candidates.length === 0) {
        throw new Error(payload?.error || '未能识别该区域');
      }

      const nextId = typeof payload.regionId === 'string' && payload.regionId.trim() ? payload.regionId : region.id;
      const nextRegion: RegionSelection = {
        ...region,
        id: nextId,
        candidates: payload.candidates as RegionCandidate[],
        selectedCandidateId: typeof payload.selectedCandidateId === 'string'
          ? payload.selectedCandidateId
          : payload.candidates[0].id,
        status: payload.lowConfidence ? 'ambiguous' : 'ready',
        recognitionRevision: revision,
      };
      setRegions((previous) => previous
        .filter((candidate) => candidate.id !== region.id && candidate.id !== nextId)
        .concat(nextRegion));
      onResolved(nextRegion, region.id, payload.lowConfidence === true);
    } catch (error) {
      if (isAbortError(error) || !isCurrentRequest()) return;
      setRegions((previous) => previous.map((candidate) => candidate.id === region.id
        ? {
            ...candidate,
            status: 'failed',
            recognitionRevision: revision,
            error: error instanceof Error ? error.message : '识别失败',
          }
        : candidate));
      onFailed(region.id);
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
