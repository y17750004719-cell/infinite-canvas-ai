'use client';

import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, Edit3, ArrowLeft, Sparkles, FolderOpen } from 'lucide-react';
import {
  createEmptySession,
  deleteSessionFromList,
  loadSessions,
  ProjectSession,
  removeSession,
  renameSessionInList,
  upsertSession,
  upsertSessionInList,
} from '../lib/db';

export default function WorkspacesPage() {
  const router = useRouter();
  const [sessions, setSessions] = useState<ProjectSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [pendingAction, setPendingAction] = useState<{ type: 'create' | 'delete' | 'rename'; sessionId?: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    loadSessions().then(data => {
      setSessions(data);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!actionError) return;
    const timeoutId = window.setTimeout(() => setActionError(null), 3200);
    return () => window.clearTimeout(timeoutId);
  }, [actionError]);

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (pendingAction) return;
    if (!confirm('确定要删除这个画布吗？')) return;

    const previousSessions = sessions;
    const nextSessions = deleteSessionFromList({
      sessions,
      sessionId: id,
    }).sessions;

    setActionError(null);
    setPendingAction({ type: 'delete', sessionId: id });
    setSessions(nextSessions);

    try {
      await removeSession(id);
    } catch (error) {
      console.error('Failed to delete workspace:', error);
      setSessions(previousSessions);
      setActionError('删除画布失败，请重试。');
      setPendingAction(null);
      return;
    }

    setPendingAction(null);
  };

  const handleRename = (session: ProjectSession, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(session.id);
    setEditingName(session.name);
  };

  const handleRenameSubmit = async () => {
    if (pendingAction) return;
    if (!editingId || !editingName.trim()) {
      setEditingId(null);
      return;
    }

    const previousSessions = sessions;
    const nextSessions = renameSessionInList(sessions, editingId, editingName.trim(), Date.now());
    const updatedSession = nextSessions.find((session) => session.id === editingId);
    if (!updatedSession) return;

    setActionError(null);
    setPendingAction({ type: 'rename', sessionId: editingId });
    setSessions(nextSessions);
    setEditingId(null);

    try {
      await upsertSession(updatedSession);
    } catch (error) {
      console.error('Failed to rename workspace:', error);
      setSessions(previousSessions);
      setActionError('重命名画布失败，请重试。');
      setPendingAction(null);
      return;
    }

    setPendingAction(null);
  };

  const handleCreateNew = async () => {
    if (pendingAction) return;

    const newSession = createEmptySession({
      existingCount: sessions.length,
      now: Date.now(),
    });
    const previousSessions = sessions;
    const nextSessions = upsertSessionInList(sessions, newSession);

    setActionError(null);
    setPendingAction({ type: 'create', sessionId: newSession.id });
    setSessions(nextSessions);

    try {
      await upsertSession(newSession);
    } catch (error) {
      console.error('Failed to create workspace:', error);
      setSessions(previousSessions);
      setActionError('新建画布失败，请重试。');
      setPendingAction(null);
      return;
    }

    setPendingAction(null);
    router.push(`/?workspace=${newSession.id}`);
  };

  const handleOpen = (sessionId: string) => {
    router.push(`/?workspace=${sessionId}`);
  };

  const getPreviewImage = (session: ProjectSession): string | null => {
    const firstImage = session.items?.find(item => item.type === 'image' && item.src);
    return firstImage?.src || null;
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

  if (loading) {
    return (
      <div className="workspace-page-shell min-h-screen flex items-center justify-center">
        <div className="flex items-center gap-2 text-gray-400">
          <Sparkles className="w-5 h-5 animate-pulse" />
          <span>加载中...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="workspace-page-shell min-h-screen">
      {actionError && (
        <div className="fixed inset-x-0 top-4 z-20 flex justify-center px-4">
          <div className="workspace-error-banner text-sm text-red-100">
            {actionError}
          </div>
        </div>
      )}
      {/* Header */}
      <div className="workspace-header-bar sticky top-0 z-10">
        <div className="workspace-content-shell flex flex-wrap items-center justify-between gap-3 py-4">
          <div className="flex min-w-0 items-center gap-3 sm:gap-4">
            <button 
              onClick={() => router.push('/')}
              className="workspace-light-icon-button gap-2 px-2 text-gray-500 hover:text-gray-800"
              aria-label="返回编辑器"
            >
              <ArrowLeft size={20} />
              <span>返回工作区</span>
            </button>
            <div className="w-px h-6 bg-gray-200" />
            <div className="min-w-0">
              <h1 className="text-xl font-semibold text-gray-800">我的画布</h1>
              <span className="text-sm text-gray-400">({sessions.length})</span>
            </div>
          </div>
          
          <button
            onClick={handleCreateNew}
            disabled={pendingAction !== null}
            className="workspace-black-button"
          >
            <Plus size={18} />
            <span>{pendingAction?.type === 'create' ? '新建中...' : '新建画布'}</span>
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="workspace-content-shell py-8">
        {sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="w-20 h-20 bg-gray-100 rounded-2xl flex items-center justify-center mb-4">
              <Sparkles size={32} className="text-gray-300" />
            </div>
            <h2 className="text-lg font-medium text-gray-600 mb-2">还没有画布</h2>
            <p className="text-sm text-gray-400 mb-6">创建一个新画布开始你的创作之旅</p>
            <button
              onClick={handleCreateNew}
              disabled={pendingAction !== null}
              className="workspace-black-button"
            >
              <Plus size={18} />
              <span>{pendingAction?.type === 'create' ? '创建中...' : '创建第一个画布'}</span>
            </button>
          </div>
        ) : (
          <div className="columns-1 sm:columns-2 lg:columns-3 xl:columns-4 gap-4 space-y-4">
            {sessions.map(session => {
              const previewImage = getPreviewImage(session);
              
              return (
                <div
                  key={session.id}
                  onClick={() => handleOpen(session.id)}
                  className="workspace-surface-card break-inside-avoid group cursor-pointer overflow-hidden rounded-2xl transition-all"
                >
                  {/* Preview Area */}
                  <div className="relative aspect-[4/3] bg-gray-100 overflow-hidden">
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
                      <div className="w-full h-full flex items-center justify-center">
                        <Sparkles size={32} className="text-gray-200" />
                      </div>
                    )}
                    
                    {/* Hover Overlay */}
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
                    
                    {/* Action Buttons */}
                    <div className="absolute top-2 right-2 flex gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                      <button
                        onClick={(e) => { e.stopPropagation(); router.push(`/workspaces/${session.id}`); }}
                        className="workspace-light-icon-button h-11 w-11 bg-white/90 hover:bg-white"
                        title="查看内容"
                        aria-label={`查看 ${session.name} 的详情`}
                      >
                        <FolderOpen size={14} className="text-gray-600" />
                      </button>
                      <button
                        onClick={(e) => handleRename(session, e)}
                        disabled={pendingAction !== null}
                        className="workspace-light-icon-button h-11 w-11 bg-white/90 hover:bg-white"
                        title="重命名"
                        aria-label={`重命名 ${session.name}`}
                      >
                        <Edit3 size={14} className="text-gray-600" />
                      </button>
                      <button
                        onClick={(e) => handleDelete(session.id, e)}
                        disabled={pendingAction !== null}
                        className="workspace-light-icon-button h-11 w-11 bg-white/90 hover:bg-red-50"
                        title="删除"
                        aria-label={`删除 ${session.name}`}
                      >
                        <Trash2 size={14} className="text-red-500" />
                      </button>
                    </div>
                  </div>

                  {/* Info Area */}
                  <div className="p-4">
                    {editingId === session.id ? (
                      <input
                        autoFocus
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onBlur={handleRenameSubmit}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleRenameSubmit();
                          if (e.key === 'Escape') setEditingId(null);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="w-full rounded border border-gray-300 px-2 py-2 text-sm focus:border-black focus:outline-none"
                      />
                    ) : (
                      <>
                        <h3 className="font-medium text-gray-800 truncate">{session.name}</h3>
                        <div className="flex items-center justify-between mt-2">
                          <span className="text-xs text-gray-400">
                            {session.messages.length} 条对话
                          </span>
                          <span className="text-xs text-gray-400">
                            {formatDate(session.updatedAt)}
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
