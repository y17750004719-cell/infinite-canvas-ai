'use client';

import React, { memo } from 'react';
import { RefreshCw, Trash2 } from 'lucide-react';
import type { CanvasItem } from '../../lib/canvas-types';
import { imageNormalizedToItemLocal } from '../../lib/image-region-selection.mjs';
import type { RegionSelection } from '../../lib/image-region-selection.types';

type RegionImageContent = {
  x: number;
  y: number;
  width: number;
  height: number;
  naturalWidth: number;
  naturalHeight: number;
  fit: 'contain' | 'cover';
};

export const CanvasRegionSelectionsLayer = memo(function CanvasRegionSelectionsLayer({
  items,
  regions,
  activeRegionId,
  getImageContent,
  onRegionClick,
  getItemTargetRef,
}: {
  items: CanvasItem[];
  regions: RegionSelection[];
  activeRegionId: string | null;
  getImageContent: (item: CanvasItem) => RegionImageContent;
  onRegionClick: (regionId: string) => void;
  getItemTargetRef: (itemId: string, role: string) => (element: HTMLElement | null) => void;
}) {
  const itemById = new Map(items.map((item) => [item.id, item]));
  return (
    <div className="pointer-events-none absolute z-[6]">
      {regions.map((region, index) => {
        const item = itemById.get(region.imageItemId);
        if (!item || item.type !== 'image' || !item.visible) return null;
        const content = getImageContent(item);
        const point = imageNormalizedToItemLocal({
          point: region.point,
          content,
          naturalWidth: content.naturalWidth,
          naturalHeight: content.naturalHeight,
          fit: content.fit,
        });
        if (!point) return null;
        const boxStart = region.box ? imageNormalizedToItemLocal({
          point: { x: region.box.x, y: region.box.y },
          content,
          naturalWidth: content.naturalWidth,
          naturalHeight: content.naturalHeight,
          fit: content.fit,
        }) : null;
        const boxEnd = region.box ? imageNormalizedToItemLocal({
          point: { x: region.box.x + region.box.width, y: region.box.y + region.box.height },
          content,
          naturalWidth: content.naturalWidth,
          naturalHeight: content.naturalHeight,
          fit: content.fit,
        }) : null;
        const candidate = region.candidates.find((entry) => entry.id === region.selectedCandidateId)
          || region.candidates[0];
        const regionLabel = region.customLabel || candidate?.label;
        const isDraftRegion = region.id === '__region-draft__';
        return (
          <div
            key={region.id}
            ref={getItemTargetRef(item.id, `region-${region.id}`)}
            data-canvas-region-item-id={item.id}
            data-region-draft={isDraftRegion ? 'true' : undefined}
            className="pointer-events-none absolute"
            style={{
              left: item.x,
              top: item.y,
              width: item.width,
              height: item.height,
              transform: `rotate(${item.rotation}deg)`,
            }}
          >
            {boxStart && boxEnd && (
              <div
                data-region-draft-box={isDraftRegion ? 'true' : undefined}
                className={`absolute border-2 ${activeRegionId === region.id ? 'border-blue-400' : 'border-blue-500/75'} bg-blue-500/10`}
                style={isDraftRegion ? {
                  left: 0,
                  top: 0,
                  width: 1,
                  height: 1,
                  borderRadius: 6,
                  transformOrigin: '0 0',
                  willChange: 'transform',
                  opacity: 0,
                } : {
                  left: Math.min(boxStart.x, boxEnd.x),
                  top: Math.min(boxStart.y, boxEnd.y),
                  width: Math.abs(boxEnd.x - boxStart.x),
                  height: Math.abs(boxEnd.y - boxStart.y),
                  borderRadius: 6,
                }}
              />
            )}
            <button
              type="button"
              data-region-marker="true"
              data-gsap-no-interaction="true"
              data-region-draft-marker={isDraftRegion ? 'true' : undefined}
              className={`pointer-events-auto absolute flex h-6 min-w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-blue-500 px-1 text-[10px] font-bold text-white ${region.status === 'recognizing' && !isDraftRegion ? 'gsap-pulse opacity-70' : ''}`}
              style={isDraftRegion ? {
                left: 0,
                top: 0,
                willChange: 'transform',
                opacity: 0,
              } : { left: point.x, top: point.y }}
              title={regionLabel || region.error || '定位对象'}
              aria-label={`定位对象 ${regionLabel || index + 1}`}
              aria-busy={region.status === 'recognizing'}
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onRegionClick(region.id);
              }}
            >
              {index + 1}
            </button>
          </div>
        );
      })}
    </div>
  );
});

export function ImageRegionCandidatePopover({
  region,
  customLabelDraft,
  onCustomLabelDraftChange,
  onSelectCandidate,
  onUseCustomLabel,
  onRefineRegion,
  onDeleteRegion,
}: {
  region: RegionSelection | null;
  customLabelDraft: string;
  onCustomLabelDraftChange: (value: string) => void;
  onSelectCandidate: (regionId: string, candidateId: string) => void;
  onUseCustomLabel: (regionId: string, candidateId: string | undefined, label: string) => void;
  onRefineRegion: (regionId: string) => void;
  onDeleteRegion: (regionId: string) => void;
}) {
  if (!region) return null;

  return (
    <div
      className="workspace-menu-panel absolute bottom-[148px] left-4 z-40 w-[260px] rounded-2xl p-2"
      onPointerDown={(event) => event.stopPropagation()}
      role="listbox"
      aria-label="对象识别候选"
    >
      <div className="flex items-center justify-between gap-2 px-2 pb-1">
        <div className="workspace-text-muted min-w-0 truncate text-[11px]">
          {region.status === 'failed'
            ? (region.error || '识别失败，可手动输入对象名称')
            : region.status === 'ambiguous' ? '请选择更准确的对象' : '识别候选'}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            className="workspace-control-chip inline-flex h-6 w-6 items-center justify-center rounded-md"
            aria-label="重新框选"
            title="重新框选"
            onClick={() => onRefineRegion(region.id)}
          >
            <RefreshCw size={12} />
          </button>
          <button
            type="button"
            className="workspace-control-chip inline-flex h-6 w-6 items-center justify-center rounded-md text-red-500"
            aria-label="删除定位对象"
            title="删除定位对象"
            onClick={() => onDeleteRegion(region.id)}
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>
      {region.candidates.map((candidate) => (
        <button
          key={candidate.id}
          type="button"
          role="option"
          aria-selected={candidate.id === region.selectedCandidateId}
          className={`workspace-menu-item flex w-full items-center justify-between rounded-xl px-2.5 py-2 text-left text-xs ${candidate.id === region.selectedCandidateId ? 'is-selected' : ''}`}
          onClick={() => onSelectCandidate(region.id, candidate.id)}
        >
          <span className="min-w-0 truncate font-medium">{candidate.label}</span>
          <span className="workspace-text-muted ml-2 shrink-0 text-[10px]">{candidate.confidence}</span>
        </button>
      ))}
      <div className="mt-1 flex items-center gap-1 border-t border-[var(--workspace-border)] pt-2">
        <input
          value={customLabelDraft}
          onChange={(event) => onCustomLabelDraftChange(event.target.value)}
          placeholder="自定义名称"
          aria-label="自定义名称"
          className="min-w-0 flex-1 rounded-lg border border-[var(--workspace-border)] bg-transparent px-2 py-1.5 text-xs outline-none"
        />
        <button
          type="button"
          className="workspace-control-chip rounded-lg px-2 py-1.5 text-[11px]"
          onClick={() => onUseCustomLabel(region.id, region.selectedCandidateId, customLabelDraft)}
        >
          使用
        </button>
      </div>
    </div>
  );
}
