'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeft, Edit3, Trash2, Sparkles, Image as ImageIcon, Type, Square, FolderOpen, ArrowRight } from 'lucide-react';
import {
  ProjectSession,
  CanvasItem,
  removeSession,
  loadSessions,
} from '../../lib/db';
import { getSessionConversationCount } from '../../lib/workspace-session-view.mjs';

export default function WorkspaceDetailPage() {
  const router = useRouter();
  const params = useParams();
  const [session, setSession] = useState<ProjectSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const sessionId = params?.id as string;

  useEffect(() => {
    if (!sessionId) return;
    
    loadSessions().then(sessions => {
      const found = sessions.find(s => s.id === sessionId);
      setSession(found || null);
      setLoading(false);
    });
  }, [sessionId]);

  const handleDelete = async () => {
    if (!session || !confirm('确定要删除这个画布吗？此操作不可恢复。')) return;
    
    setDeleting(true);
    setDeleteError(null);

    try {
      await removeSession(session.id);
      router.push('/workspaces');
    } catch (error) {
      console.error('Failed to delete workspace:', error);
      setDeleteError('删除画布失败，请重试。');
      setDeleting(false);
    }
  };

  const handleEdit = () => {
    router.push(`/?workspace=${sessionId}`);
  };

  const getItemIcon = (type: CanvasItem['type']) => {
    switch (type) {
      case 'image': return <ImageIcon size={14} />;
      case 'text': return <Type size={14} />;
      case 'frame': return <Square size={14} />;
      default: return <FolderOpen size={14} />;
    }
  };

  const getItemPreview = (item: CanvasItem) => {
    if (item.type === 'image' && item.src) {
      return (
        <img 
          src={item.src} 
          alt={item.id}
          className="w-full h-auto"
        />
      );
    }
    
    if (item.type === 'text' && item.text) {
      return (
        <div className="p-4 bg-white">
          <p className="text-sm text-gray-700 line-clamp-6">{item.text}</p>
        </div>
      );
    }

    if (item.type === 'frame') {
      return (
        <div 
          className="w-full h-full flex items-center justify-center"
          style={{ backgroundColor: item.fill || '#f3f4f6' }}
        >
          <span className="text-xs text-gray-400">Frame</span>
        </div>
      );
    }

    return (
      <div className="w-full h-full flex items-center justify-center bg-gray-100">
        <FolderOpen size={24} className="text-gray-300" />
      </div>
    );
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
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

  if (!session) {
    return (
      <div className="workspace-page-shell min-h-screen flex flex-col items-center justify-center">
        <div className="w-20 h-20 bg-gray-100 rounded-2xl flex items-center justify-center mb-4">
          <Sparkles size={32} className="text-gray-300" />
        </div>
        <h2 className="text-lg font-medium text-gray-600 mb-2">画布不存在</h2>
        <p className="text-sm text-gray-400 mb-6">该画布可能被已删除</p>
        <button
          onClick={() => router.push('/workspaces')}
          className="workspace-black-button"
        >
          <ArrowLeft size={18} />
          <span>返回画布列表</span>
        </button>
      </div>
    );
  }

  return (
    <div className="workspace-page-shell min-h-screen">
      {deleteError && (
        <div className="fixed inset-x-0 top-4 z-20 flex justify-center px-4">
          <div className="workspace-error-banner text-sm text-red-100">
            {deleteError}
          </div>
        </div>
      )}
      {/* Header */}
      <div className="workspace-header-bar sticky top-0 z-10">
        <div className="workspace-content-shell flex flex-wrap items-center justify-between gap-3 py-4">
          <div className="flex min-w-0 items-center gap-3 sm:gap-4">
            <button 
              onClick={() => router.push('/workspaces')}
              className="workspace-light-icon-button gap-2 px-2 text-gray-500 hover:text-gray-800"
              aria-label="返回画布列表"
            >
              <ArrowLeft size={20} />
              <span>返回列表</span>
            </button>
            <div className="w-px h-6 bg-gray-200" />
            <div className="min-w-0">
              <h1 className="truncate text-xl font-semibold text-gray-800">{session.name}</h1>
              <span className="text-sm text-gray-400">({session.items.length} 个元素)</span>
            </div>
          </div>
          
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleEdit}
              className="workspace-black-button"
              aria-label={`编辑 ${session.name}`}
            >
              <Edit3 size={18} />
              <span>编辑</span>
              <ArrowRight size={16} />
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="workspace-light-icon-button gap-2 px-4 py-2 text-red-500 hover:bg-red-50 disabled:opacity-50"
              aria-label={`删除 ${session.name}`}
            >
              <Trash2 size={18} />
              <span>{deleting ? '删除中...' : '删除'}</span>
            </button>
          </div>
        </div>
        
        {/* Meta Info */}
        <div className="workspace-content-shell flex flex-wrap items-center gap-3 pb-3 text-sm text-gray-400 sm:gap-6">
          <span>创建于: {formatDate(session.createdAt)}</span>
          <span>更新于: {formatDate(session.updatedAt)}</span>
          <span>{getSessionConversationCount(session)} 条对话</span>
        </div>
      </div>

      {/* Content */}
      <div className="workspace-content-shell py-8">
        {session.items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="w-20 h-20 bg-gray-100 rounded-2xl flex items-center justify-center mb-4">
              <Sparkles size={32} className="text-gray-300" />
            </div>
            <h2 className="text-lg font-medium text-gray-600 mb-2">画布为空</h2>
            <p className="text-sm text-gray-400 mb-6">这个画布还没有任何内容</p>
            <button
              onClick={handleEdit}
              className="workspace-black-button"
            >
              <Edit3 size={18} />
              <span>开始编辑</span>
            </button>
          </div>
        ) : (
          <div className="columns-1 sm:columns-2 lg:columns-3 xl:columns-4 gap-4 space-y-4">
            {session.items.map(item => (
              <div
                key={item.id}
                className="workspace-surface-card break-inside-avoid group cursor-pointer overflow-hidden rounded-2xl transition-all hover:shadow-md"
                onClick={handleEdit}
              >
                {/* Preview */}
                <div className="relative bg-gray-100 overflow-hidden">
                  <div className="relative">
                    {getItemPreview(item)}
                    
                    {/* Type Badge */}
                    <div className="absolute top-2 left-2 flex items-center gap-1 px-2 py-1 bg-white/90 rounded-md text-xs text-gray-600">
                      {getItemIcon(item.type)}
                      <span className="capitalize">{item.type}</span>
                    </div>
                  </div>
                  
                  {/* Hover Overlay */}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors" />
                </div>

                {/* Info */}
                <div className="p-3 flex items-center justify-between">
                  <span className="text-xs text-gray-400">
                    {item.width} × {item.height}
                  </span>
                  <span className="text-xs text-gray-400">
                    {Math.round(item.x)}, {Math.round(item.y)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
