'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, Edit3, ArrowLeft, Sparkles, FolderOpen } from 'lucide-react';
import { loadSessions, deleteSessionFromDB, ProjectSession } from '../lib/db';

export default function WorkspacesPage() {
  const router = useRouter();
  const [sessions, setSessions] = useState<ProjectSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  useEffect(() => {
    loadSessions().then(data => {
      setSessions(data);
      setLoading(false);
    });
  }, []);

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('确定要删除这个画布吗？')) return;
    
    await deleteSessionFromDB(id);
    setSessions(prev => prev.filter(s => s.id !== id));
  };

  const handleRename = (session: ProjectSession, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(session.id);
    setEditingName(session.name);
  };

  const handleRenameSubmit = () => {
    if (!editingId || !editingName.trim()) {
      setEditingId(null);
      return;
    }
    
    setSessions(prev => prev.map(s => 
      s.id === editingId ? { ...s, name: editingName.trim(), updatedAt: Date.now() } : s
    ));
    setEditingId(null);
  };

  const handleCreateNew = () => {
    const newSession: ProjectSession = {
      id: `session-${Date.now()}`,
      name: `新画布 ${sessions.length + 1}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      items: [],
      messages: [],
      viewport: { x: 0, y: 0, scale: 1 },
    };
    
    setSessions(prev => [newSession, ...prev]);
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
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="flex items-center gap-2 text-gray-400">
          <Sparkles className="w-5 h-5 animate-pulse" />
          <span>加载中...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => router.push('/')}
              className="flex items-center gap-2 text-gray-500 hover:text-gray-800 transition-colors"
            >
              <ArrowLeft size={20} />
              <span>返回工作区</span>
            </button>
            <div className="w-px h-6 bg-gray-200" />
            <h1 className="text-xl font-semibold text-gray-800">我的画布</h1>
            <span className="text-sm text-gray-400">({sessions.length})</span>
          </div>
          
          <button
            onClick={handleCreateNew}
            className="flex items-center gap-2 px-4 py-2 bg-black text-white rounded-lg hover:bg-gray-800 transition-colors"
          >
            <Plus size={18} />
            <span>新建画布</span>
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        {sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="w-20 h-20 bg-gray-100 rounded-2xl flex items-center justify-center mb-4">
              <Sparkles size={32} className="text-gray-300" />
            </div>
            <h2 className="text-lg font-medium text-gray-600 mb-2">还没有画布</h2>
            <p className="text-sm text-gray-400 mb-6">创建一个新画布开始你的创作之旅</p>
            <button
              onClick={handleCreateNew}
              className="flex items-center gap-2 px-4 py-2 bg-black text-white rounded-lg hover:bg-gray-800 transition-colors"
            >
              <Plus size={18} />
              <span>创建第一个画布</span>
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
                  className="break-inside-avoid group bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-all cursor-pointer border border-gray-100"
                >
                  {/* Preview Area */}
                  <div className="relative aspect-[4/3] bg-gray-100 overflow-hidden">
                    {previewImage ? (
                      <img 
                        src={previewImage} 
                        alt={session.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Sparkles size={32} className="text-gray-200" />
                      </div>
                    )}
                    
                    {/* Hover Overlay */}
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
                    
                    {/* Action Buttons */}
                    <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => { e.stopPropagation(); router.push(`/workspaces/${session.id}`); }}
                        className="p-2 bg-white/90 rounded-lg hover:bg-white transition-colors"
                        title="查看内容"
                      >
                        <FolderOpen size={14} className="text-gray-600" />
                      </button>
                      <button
                        onClick={(e) => handleRename(session, e)}
                        className="p-2 bg-white/90 rounded-lg hover:bg-white transition-colors"
                        title="重命名"
                      >
                        <Edit3 size={14} className="text-gray-600" />
                      </button>
                      <button
                        onClick={(e) => handleDelete(session.id, e)}
                        className="p-2 bg-white/90 rounded-lg hover:bg-red-50 transition-colors"
                        title="删除"
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
                        className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:border-black"
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
