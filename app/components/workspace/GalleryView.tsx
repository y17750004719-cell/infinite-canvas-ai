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
      <div className="workspace-gallery-shell min-h-screen flex flex-col items-center justify-center text-zinc-100">
        <div className="workspace-empty-icon mb-4">
          <Sparkles size={32} className="text-zinc-500" />
        </div>
        <h2 className="text-lg font-medium text-zinc-100 mb-2">还没有画布</h2>
        <p className="text-sm text-zinc-500 mb-6">创建一个新画布开始你的创作之旅</p>
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
    <div className="workspace-gallery-shell min-h-screen text-zinc-100">
      <div className="workspace-gallery-header sticky top-0 z-10">
        <div className="flex w-full items-center justify-start py-4 pl-4 pr-4 sm:pl-[34px] sm:pr-0">
          <div className="flex items-center">
            <button
              className="workspace-dark-icon-button h-10 w-10 rounded-full text-sm font-medium"
              onClick={onBack}
              aria-label="返回画廊"
            >
              L
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
                <div className="relative aspect-[4/3] overflow-hidden bg-[#0d1015]">
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
                      <Sparkles size={32} className="text-zinc-700" />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/10 group-hover:bg-black/0 transition-colors" />

                  <button
                    onClick={(e) => onDeleteSession(session.id, e)}
                    disabled={isSessionMutationPending}
                    className="workspace-dark-icon-button absolute right-2 top-2 z-20 h-11 w-11 rounded-full text-zinc-400 opacity-100 hover:text-red-400 sm:opacity-0 sm:group-hover:opacity-100"
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
                      className="w-full rounded-lg border border-white/10 bg-[rgba(10,12,16,0.92)] px-2 py-1 text-sm text-zinc-100 focus:outline-none focus:border-white/20"
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
                      <h3 className="truncate font-medium text-zinc-100">{session.name}</h3>
                      <button
                        onClick={(e) => onStartEdit(session.id, session.name, e)}
                        disabled={isSessionMutationPending}
                        className="inline-flex h-11 w-11 items-center justify-center rounded-lg transition-colors opacity-100 hover:bg-white/10 sm:opacity-0 sm:group-hover:opacity-100"
                        title="重命名"
                        aria-label={`重命名 ${session.name}`}
                      >
                        <Edit3 size={14} className="text-zinc-500" />
                      </button>
                    </div>
                  )}
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-xs text-zinc-500">{session.items.length} 个元素</span>
                    <span className="text-xs text-zinc-500">{formatDate(session.updatedAt)}</span>
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
