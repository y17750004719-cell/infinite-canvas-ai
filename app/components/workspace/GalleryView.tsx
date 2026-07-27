'use client';

import React from 'react';
import Image from 'next/image';
import { Edit3, Plus, Sparkles, X } from 'lucide-react';

import type { ProjectSession } from '../../lib/db';

type PendingSessionActionState = {
  type: 'create' | 'delete';
  sessionId?: string;
} | null;

interface GalleryViewProps {
  sessions: ProjectSession[];
  onEnterEditor: (sessionId: string) => void;
  onCreateNew: () => void | Promise<void>;
  onBack: () => void;
  onDeleteSession: (id: string, e: React.MouseEvent) => void | Promise<void>;
  editingSessionId: string | null;
  editingName: string;
  onStartEdit: (sessionId: string, name: string, e: React.MouseEvent) => void;
  onEditNameChange: (value: string) => void;
  onEditNameSubmit: (sessionId: string, name: string) => void | Promise<void>;
  onCancelEdit: () => void;
  pendingSessionAction: PendingSessionActionState;
}

const getSessionPreview = (session: ProjectSession) => {
  const itemsWithImages = session.items?.filter((item) => item.type === 'image' && item.src) || [];
  if (itemsWithImages.length > 0) {
    return itemsWithImages[0].src;
  }
  return null;
};

const formatDate = (timestamp: number) => {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 1) return '刚刚';
  if (diffMins < 60) return `${diffMins} 分钟前`;
  if (diffHours < 24) return `${diffHours} 小时前`;
  if (diffDays < 7) return `${diffDays} 天前`;
  return date.toLocaleDateString();
};

export function GalleryView({
  sessions,
  onEnterEditor,
  onCreateNew,
  onBack,
  onDeleteSession,
  editingSessionId,
  editingName,
  onStartEdit,
  onEditNameChange,
  onEditNameSubmit,
  onCancelEdit,
  pendingSessionAction,
}: GalleryViewProps) {
  const isSessionMutationPending = pendingSessionAction !== null;
  const isCreatingSession = pendingSessionAction?.type === 'create';

  if (sessions.length === 0) {
    return (
      <div className="workspace-gallery-shell workspace-text-primary min-h-screen flex flex-col items-center justify-center">
        <div className="workspace-empty-icon mb-4">
          <Sparkles size={32} className="workspace-text-muted" />
        </div>
        <h2 className="workspace-text-primary text-lg font-medium mb-2">还没有画布</h2>
        <p className="workspace-text-muted text-sm mb-6">创建一个新画布开始你的创作之旅</p>
        <button
          onClick={onCreateNew}
          disabled={isSessionMutationPending}
          className="workspace-primary-button"
        >
          <Plus size={18} />
          <span>{isCreatingSession ? '创建中...' : '创建第一个画布'}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="workspace-gallery-shell workspace-text-primary min-h-screen">
      <div className="workspace-gallery-header sticky top-0 z-10">
        <div className="flex w-full items-center justify-start py-4 pl-4 pr-4 sm:pl-[34px] sm:pr-0">
          <div className="flex items-center">
            <button
              className="workspace-dark-icon-button h-10 w-10 overflow-hidden rounded-full text-sm font-medium"
              onClick={onBack}
              aria-label="返回画廊"
            >
              <Image src="/z-flow-logo.svg" alt="" width={40} height={40} />
            </button>
          </div>
        </div>
      </div>

      <div className="workspace-content-shell py-8">
        <div className="columns-1 sm:columns-2 lg:columns-3 xl:columns-4 gap-4 space-y-4">
          {sessions.map((session) => {
            const previewImage = getSessionPreview(session);

            return (
              <div
                key={session.id}
                className="workspace-gallery-card break-inside-avoid group cursor-pointer overflow-hidden"
                onClick={() => {
                  if (editingSessionId === session.id || isSessionMutationPending) return;
                  onEnterEditor(session.id);
                }}
              >
                <div className="workspace-preview-tile relative aspect-[4/3] overflow-hidden">
                  {previewImage ? (
                    <Image
                      src={previewImage}
                      alt={session.name}
                      fill
                      unoptimized
                      sizes="(max-width: 640px) 100vw, (max-width: 1280px) 50vw, 25vw"
                      className="object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <Sparkles size={32} className="workspace-text-soft" />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/10" data-gsap-hover-reveal="true" data-gsap-invert-reveal="true" />

                  <button
                    onClick={(e) => onDeleteSession(session.id, e)}
                    disabled={isSessionMutationPending}
                    className="workspace-dark-icon-button workspace-text-muted absolute right-2 top-2 z-20 h-11 w-11 rounded-full opacity-100 hover:text-red-400 sm:opacity-0"
                    data-gsap-hover-reveal="true"
                    data-gsap-mobile-visible="true"
                    title="删除画布"
                    aria-label={`删除 ${session.name}`}
                  >
                    <X size={14} />
                  </button>
                </div>
                <div className="p-4">
                  {editingSessionId === session.id ? (
                    <input
                      autoFocus
                      value={editingName}
                      disabled={isSessionMutationPending}
                      onChange={(e) => onEditNameChange(e.target.value)}
                      onBlur={() => onEditNameSubmit(session.id, editingName)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') onEditNameSubmit(session.id, editingName);
                        if (e.key === 'Escape') {
                          e.preventDefault();
                          onCancelEdit();
                        }
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="w-full rounded-lg border border-[var(--workspace-border)] bg-[var(--workspace-surface-elevated)] px-2 py-1 text-sm text-[var(--workspace-text-primary)] focus:outline-none focus:border-[var(--workspace-border-strong)]"
                    />
                  ) : (
                    <div
                      className="flex items-center justify-between gap-2"
                      onClick={(e) => e.stopPropagation()}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        onStartEdit(session.id, session.name, e);
                      }}
                    >
                      <h3 className="workspace-text-primary truncate font-medium">{session.name}</h3>
                      <button
                        onClick={(e) => onStartEdit(session.id, session.name, e)}
                        disabled={isSessionMutationPending}
                        className="inline-flex h-11 w-11 items-center justify-center rounded-lg opacity-100 hover:bg-[var(--workspace-control-hover)] sm:opacity-0"
                        data-gsap-hover-reveal="true"
                        data-gsap-mobile-visible="true"
                        title="重命名"
                        aria-label={`重命名 ${session.name}`}
                      >
                          <Edit3 size={14} className="workspace-text-muted" />
                      </button>
                    </div>
                  )}
                  <div className="mt-2 flex items-center justify-between">
                    <span className="workspace-text-muted text-xs">{session.items.length} 个元素</span>
                    <span className="workspace-text-muted text-xs">{formatDate(session.updatedAt)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function SessionActionErrorBanner({ message }: { message: string }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-[220] flex justify-center px-4">
      <div className="workspace-error-banner">
        {message}
      </div>
    </div>
  );
}
