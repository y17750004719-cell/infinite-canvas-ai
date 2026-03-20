'use client';

import React, { useState, useRef, useEffect, useCallback, memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { 
  MousePointer2, Type, Square, PenTool, Image as ImageIcon, 
  Eraser, Layers, Share2, History, Settings, Paperclip,
  Send, Sparkles, X, ChevronDown, Trash2, Edit3, ArrowLeft, FolderOpen, Plus, SlidersHorizontal, Copy, Check
} from 'lucide-react';
import { saveSessions, loadSessions, ProjectSession as DBSession } from './lib/db';
import { ASPECT_RATIOS } from './lib/api-client';

const DEBUG_CANVAS_CONNECTIONS = false;

const extractPlainText = (value: React.ReactNode): string =>
  React.Children.toArray(value)
    .map((child) => {
      if (typeof child === 'string' || typeof child === 'number') return String(child);
      if (React.isValidElement<{ children?: React.ReactNode }>(child)) {
        return extractPlainText(child.props.children);
      }
      return '';
    })
    .join('');

interface CanvasItem {
  id: string;
  type: 'image' | 'frame' | 'shape' | 'text';
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  src?: string;
  fill?: string;
  text?: string;
  visible: boolean;
  locked: boolean;
}

interface Connection {
  id: string;
  fromItemId: string;
  toItemId: string;
}

type ConnectionMode = 'idle' | 'armed' | 'dragging';

interface ConnectionSession {
  mode: 'dragging';
  fromItemId: string;
  pointerId: number | null;
  startPoint: { x: number; y: number } | null;
  point: { x: number; y: number } | null;
  snapTargetId: string | null;
  moved: boolean;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'skill';
  content: string;
  reasoningContent?: string;
  imageUrl?: string;
  taskKey?: string;
  taskStatus?: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  skill?: { id: string; label: string };
  referenceImages?: string[];
  model?: string;
  imageName?: string;
  skillChoice?: SkillChoicePayload;
  skillChoiceDismissed?: boolean;
  skillChoiceResolved?: boolean;
}

interface SkillChoiceOption {
  label: string;
  submitText: string;
}

interface SkillChoicePayload {
  id: string;
  title: string;
  message: string;
  options: SkillChoiceOption[];
}

interface AssistantTextSelectionSession {
  startedInAssistant: boolean;
  isPointerDown: boolean;
  hasSelection: boolean;
  suppressOutsideClickUntil: number;
}

interface ChatTopic {
  id: string;
  title: string;
  messages: ChatMessage[];
  activeSkill?: { id: string; label: string } | null;
  createdAt: number;
  updatedAt: number;
}

interface ProjectSession {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  items: CanvasItem[];
  messages: ChatMessage[];
  topics?: ChatTopic[];
  activeTopicId?: string;
  viewport: { x: number; y: number; scale: number };
}

type Tool = 'select' | 'text' | 'rectangle' | 'pen' | 'image' | 'eraser' | 'layers';
type GenerationMode = 'auto' | 'image' | 'chat';

const tools = [
  { id: 'select', icon: MousePointer2, label: '选择' },
  { id: 'text', icon: Type, label: '文字' },
  { id: 'rectangle', icon: Square, label: '矩形' },
  { id: 'pen', icon: PenTool, label: '画笔' },
  { id: 'image', icon: ImageIcon, label: '图片' },
  { id: 'eraser', icon: Eraser, label: '橡皮擦' },
  { id: 'layers', icon: Layers, label: '图层' },
];

const quickActions = [
  { id: 'logo', label: 'Logo 与品牌' },
  { id: 'social', label: '社交媒体' },
  { id: 'illustration', label: '插画与海报' },
  { id: 'packaging', label: '包装设计' },
  { id: 'brand', label: '品牌识别系统' },
];

type SkillSelectSource = 'center_quick_action' | 'bottom_skill_bar';

const SKILL_DEFAULT_PROMPTS: Record<string, string> = {
  brand: '请按品牌识别系统流程开始信息收集，先询问我行业、品牌名称、补充说明和 logo 参考图（可选）。',
  logo: '请按 Logo 与品牌流程开始信息收集，先询问我品牌名称、行业、风格偏好和使用场景，再给出 2-3 个方向供我确认。',
};

const SKILL_CHOICE_START = '<<skill_choice>>';
const SKILL_CHOICE_END = '<</skill_choice>>';
const NODE_CORNER_RADIUS = 24;
const CORNER_HANDLE_GAP = 10;
const CORNER_HANDLE_STROKE = 4;
const HANDLE_ARC_RADIUS = NODE_CORNER_RADIUS + CORNER_HANDLE_GAP;
const CORNER_HANDLE_PADDING = CORNER_HANDLE_STROKE / 2;
const CORNER_HANDLE_SIZE = HANDLE_ARC_RADIUS * 2 + CORNER_HANDLE_PADDING * 2;
const CORNER_HANDLE_CENTER = HANDLE_ARC_RADIUS + CORNER_HANDLE_PADDING;
const CORNER_HANDLE_OFFSET = -(CORNER_HANDLE_GAP + CORNER_HANDLE_PADDING);
const CORNER_HANDLE_HIT_SIZE = HANDLE_ARC_RADIUS + CORNER_HANDLE_PADDING * 2;
const CORNER_HANDLE_HIT_OFFSET = CORNER_HANDLE_OFFSET + (CORNER_HANDLE_SIZE - CORNER_HANDLE_HIT_SIZE) / 2;
const CORNER_HANDLE_VISUAL_OFFSET = -(CORNER_HANDLE_SIZE - CORNER_HANDLE_HIT_SIZE) / 2;
const PORT_ICON_SIZE = 46;
const PORT_ICON_RADIUS = PORT_ICON_SIZE / 2;
const PORT_OUTER_GAP = 26;
const PORT_PROXIMITY_SIZE = 84;
const DARK_THEME = {
  appBg: '#050608',
  panel: 'rgba(16, 18, 22, 0.88)',
  panelElevated: 'rgba(24, 27, 33, 0.96)',
  panelSoft: 'rgba(12, 14, 18, 0.76)',
  border: 'rgba(255, 255, 255, 0.09)',
  borderStrong: 'rgba(255, 255, 255, 0.16)',
  textPrimary: '#f5f7fb',
  textMuted: '#98a2b3',
  textSoft: '#6b7280',
  accent: '#d7dde8',
  accentSurface: 'rgba(255, 255, 255, 0.08)',
  accentSurfaceStrong: 'rgba(255, 255, 255, 0.12)',
  canvasDot: 'rgba(255,255,255,0.12)',
  canvasLine: 'rgba(229, 231, 235, 0.86)',
  portFill: '#090b0f',
  portStroke: 'rgba(229, 231, 235, 0.78)',
};

interface GalleryViewProps {
  sessions: ProjectSession[];
  onEnterEditor: (sessionId: string) => void;
  onCreateNew: () => void;
  onBack: () => void;
  onDeleteSession: (id: string, e: React.MouseEvent) => void;
  editingSessionId: string | null;
  editingName: string;
  onStartEdit: (sessionId: string, name: string, e: React.MouseEvent) => void;
  onEditNameChange: (value: string) => void;
  onEditNameSubmit: (sessionId: string, name: string) => void;
  onCancelEdit: () => void;
}

function GalleryView({
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
}: GalleryViewProps) {
  const getItemPreview = (item: CanvasItem) => {
    if (item.type === 'image' && item.src) {
      return (
        <img src={item.src} alt="" className="w-full h-auto" />
      );
    }
    if (item.type === 'text' && item.text) {
      return (
        <div className="p-3 bg-[#11141a]">
          <p className="text-xs text-zinc-300 line-clamp-4">{item.text}</p>
        </div>
      );
    }
    if (item.type === 'frame' || item.type === 'shape') {
      return (
        <div className="w-full h-full" style={{ backgroundColor: item.fill || '#e5e7eb' }} />
      );
    }
    return (
      <div className="w-full h-full flex items-center justify-center bg-[#0f1217]">
        <FolderOpen size={20} className="text-zinc-600" />
      </div>
    );
  };

  const getSessionPreview = (session: ProjectSession) => {
    const itemsWithImages = session.items?.filter(item => item.type === 'image' && item.src) || [];
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

  if (sessions.length === 0) {
    return (
      <div className="min-h-screen bg-[#050608] flex flex-col items-center justify-center text-zinc-100">
        <div className="w-20 h-20 rounded-2xl flex items-center justify-center mb-4 border border-white/10 bg-[rgba(18,20,24,0.92)] shadow-[0_20px_60px_rgba(0,0,0,0.35)]">
          <Sparkles size={32} className="text-zinc-500" />
        </div>
        <h2 className="text-lg font-medium text-zinc-100 mb-2">还没有画布</h2>
        <p className="text-sm text-zinc-500 mb-6">创建一个新画布开始你的创作之旅</p>
        <button
          onClick={onCreateNew}
          className="flex items-center gap-2 px-4 py-2 rounded-xl border border-white/10 bg-white text-black hover:bg-zinc-200 transition-colors shadow-[0_10px_30px_rgba(255,255,255,0.08)]"
        >
          <Plus size={18} />
          <span>创建第一个画布</span>
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050608] text-zinc-100">
      <div className="sticky top-0 z-10 border-b border-white/10 bg-[rgba(8,10,13,0.92)] backdrop-blur-xl">
        <div className="w-full pl-[34px] pr-0 py-4 flex items-center justify-start">
          <div className="flex items-center">
            <button 
              className="w-10 h-10 rounded-full border border-white/10 bg-[rgba(20,22,27,0.95)] flex items-center justify-center text-zinc-100 font-medium text-sm hover:bg-[rgba(32,35,42,0.95)] transition-colors shadow-[0_8px_24px_rgba(0,0,0,0.28)]"
              onClick={onBack}
            >
              L
            </button>
          </div>
        </div>
      </div>
      
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="columns-1 sm:columns-2 lg:columns-3 xl:columns-4 gap-4 space-y-4">
          {sessions.map(session => {
            const previewImage = getSessionPreview(session);
            
            return (
              <div
                key={session.id}
                className="break-inside-avoid group overflow-hidden rounded-[24px] border border-white/10 bg-[rgba(16,18,22,0.92)] shadow-[0_18px_50px_rgba(0,0,0,0.3)] transition-all cursor-pointer hover:border-white/15 hover:bg-[rgba(22,25,31,0.96)] hover:shadow-[0_28px_70px_rgba(0,0,0,0.38)]"
                onClick={() => {
                  if (editingSessionId === session.id) return;
                  onEnterEditor(session.id);
                }}
              >
                <div className="relative aspect-[4/3] overflow-hidden bg-[#0d1015]">
                  {previewImage ? (
                    <img src={previewImage} alt={session.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Sparkles size={32} className="text-zinc-700" />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/10 group-hover:bg-black/0 transition-colors" />
                  
                  {/* Delete Button */}
                  <button
                    onClick={(e) => onDeleteSession(session.id, e)}
                    className="absolute top-2 right-2 z-20 rounded-full border border-white/10 bg-[rgba(18,20,24,0.95)] p-1.5 text-zinc-400 opacity-0 shadow-[0_10px_30px_rgba(0,0,0,0.35)] transition-all group-hover:opacity-100 hover:bg-[rgba(28,31,38,0.98)] hover:text-red-400"
                    title="删除画布"
                  >
                    <X size={14} />
                  </button>
                </div>
                <div className="p-4">
                  {editingSessionId === session.id ? (
                    <input
                      autoFocus
                      value={editingName}
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
                      <h3 className="font-medium text-zinc-100 truncate">{session.name}</h3>
                      <button
                        onClick={(e) => onStartEdit(session.id, session.name, e)}
                        className="p-1.5 rounded-lg hover:bg-white/10 transition-colors opacity-0 group-hover:opacity-100"
                        title="重命名"
                      >
                        <Edit3 size={14} className="text-zinc-500" />
                      </button>
                    </div>
                  )}
                  <div className="flex items-center justify-between mt-2">
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

const MarkdownMessage = memo(function MarkdownMessage({
  content,
  onPointerDown,
  onMouseDown,
  onClick,
}: {
  content: string;
  onPointerDown?: React.PointerEventHandler<HTMLElement>;
  onMouseDown?: React.MouseEventHandler<HTMLElement>;
  onClick?: React.MouseEventHandler<HTMLElement>;
}) {
  const [copiedCodeBlockId, setCopiedCodeBlockId] = useState<string | null>(null);
  const copiedCodeBlockTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCopyCodeBlock = useCallback(async (blockId: string, text: string) => {
    const textToCopy = text.trim();
    if (!textToCopy) return;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(textToCopy);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = textToCopy;
        textarea.setAttribute('readonly', 'true');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }

      setCopiedCodeBlockId(blockId);
      if (copiedCodeBlockTimeoutRef.current) {
        clearTimeout(copiedCodeBlockTimeoutRef.current);
      }
      copiedCodeBlockTimeoutRef.current = setTimeout(() => {
        setCopiedCodeBlockId((prev) => (prev === blockId ? null : prev));
      }, 1400);
    } catch (error) {
      console.error('Copy code block failed:', error);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (copiedCodeBlockTimeoutRef.current) {
        clearTimeout(copiedCodeBlockTimeoutRef.current);
      }
    };
  }, []);

  const selectableStyle: React.CSSProperties = {
    userSelect: 'text',
    WebkitUserSelect: 'text',
  };

  const getSelectableProps = <T extends HTMLElement>(
    className: string,
    extraProps: React.HTMLAttributes<T> = {}
  ): React.HTMLAttributes<T> & { 'data-assistant-selectable': 'true' } => ({
    ...extraProps,
    'data-assistant-selectable': 'true',
    className: `assistant-selectable-node pointer-events-auto ${className}`.trim(),
    style: {
      ...selectableStyle,
      ...(extraProps.style || {}),
    },
    onPointerDown: onPointerDown as React.PointerEventHandler<T> | undefined,
    onMouseDown: onMouseDown as React.MouseEventHandler<T> | undefined,
    onClick: onClick as React.MouseEventHandler<T> | undefined,
  });

  return (
    <div
      data-assistant-selectable="true"
      className="assistant-selectable relative z-[1] pointer-events-auto"
      onPointerDown={onPointerDown}
      onMouseDown={onMouseDown}
      onClick={onClick}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 {...getSelectableProps<HTMLHeadingElement>('mb-3 mt-7 text-[1.55rem] font-semibold leading-[1.22] tracking-[-0.03em] text-zinc-50 first:mt-0')}>{children}</h1>,
          h2: ({ children }) => <h2 {...getSelectableProps<HTMLHeadingElement>('mb-3 mt-7 text-[1.34rem] font-semibold leading-[1.24] tracking-[-0.02em] text-zinc-100 first:mt-0')}>{children}</h2>,
          h3: ({ children }) => <h3 {...getSelectableProps<HTMLHeadingElement>('mb-2.5 mt-6 text-[1.15rem] font-semibold leading-[1.3] text-zinc-100 first:mt-0')}>{children}</h3>,
          h4: ({ children }) => <h4 {...getSelectableProps<HTMLHeadingElement>('mb-2 mt-5 text-[1rem] font-semibold leading-[1.35] text-zinc-200 first:mt-0')}>{children}</h4>,
          p: ({ children }) => <p {...getSelectableProps<HTMLParagraphElement>('mt-5 text-sm leading-[1.72] text-zinc-200 first:mt-0')}>{children}</p>,
          strong: ({ children }) => <strong {...getSelectableProps<HTMLElement>('font-semibold text-zinc-50')}>{children}</strong>,
          em: ({ children }) => <em {...getSelectableProps<HTMLElement>('italic text-zinc-100')}>{children}</em>,
          ul: ({ children }) => <ul {...getSelectableProps<HTMLUListElement>('mt-5 list-disc space-y-1.5 pl-5 text-sm leading-[1.7] text-zinc-200 first:mt-0')}>{children}</ul>,
          ol: ({ children }) => <ol {...getSelectableProps<HTMLOListElement>('mt-5 list-decimal space-y-1.5 pl-5 text-sm leading-[1.7] text-zinc-200 first:mt-0')}>{children}</ol>,
          li: ({ children }) => <li {...getSelectableProps<HTMLLIElement>('pl-1 marker:text-zinc-500')}>{children}</li>,
          blockquote: ({ children }) => <blockquote {...getSelectableProps<HTMLQuoteElement>('mt-5 border-l border-[#343b45] pl-4 text-sm leading-[1.7] text-zinc-300 first:mt-0')}>{children}</blockquote>,
          hr: () => <hr className="my-5 border-0 border-t border-[#2b313a]" />,
          code(props) {
            const { children, node, className, ...rest } = props as React.HTMLAttributes<HTMLElement> & {
              node?: { position?: { start?: { line?: number }; end?: { line?: number } } };
              className?: string;
            };
            const isBlockCode =
              typeof node?.position?.start?.line === 'number' &&
              typeof node?.position?.end?.line === 'number' &&
              node.position.start.line !== node.position.end.line;

            if (!isBlockCode) {
              return (
                <code
                  {...rest}
                  className={undefined}
                  {...getSelectableProps<HTMLElement>('rounded-md border border-[#2b313a] bg-[#13181f] px-1.5 py-0.5 text-[0.9em] text-zinc-100', rest)}
                >
                  {children}
                </code>
              );
            }

            return (
              <code
                {...rest}
                className={className}
                {...getSelectableProps<HTMLElement>('block overflow-x-auto rounded-[14px] border border-[#2b313a] bg-[#10151b] px-3 py-1.5 pr-16 text-[13px] leading-[1.5] text-zinc-200', rest)}
              >
                {children}
              </code>
            );
          },
          pre: ({ children }) => {
            const codeText = extractPlainText(children);
            const codeBlockId = `code-${content}-${codeText}`.slice(0, 120);
            const isCopied = copiedCodeBlockId === codeBlockId;

            return (
              <div className="group relative mt-4 first:mt-0">
                <button
                  type="button"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                  }}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleCopyCodeBlock(codeBlockId, codeText);
                  }}
                  className="absolute right-3 top-1/2 z-[2] inline-flex h-7 -translate-y-1/2 items-center gap-1 rounded-lg border border-white/10 bg-[rgba(19,24,31,0.94)] px-2 text-[11px] text-zinc-300 opacity-70 shadow-[0_10px_22px_rgba(0,0,0,0.22)] transition-all duration-200 hover:border-white/15 hover:bg-[rgba(28,33,41,0.96)] hover:text-zinc-100 hover:opacity-100 group-hover:opacity-100"
                  aria-label="复制代码块"
                  title="复制代码块"
                >
                  {isCopied ? (
                    <>
                      <Check size={12} />
                      <span>已复制</span>
                    </>
                  ) : (
                    <>
                      <Copy size={12} />
                      <span>复制</span>
                    </>
                  )}
                </button>
                <pre {...getSelectableProps<HTMLPreElement>('overflow-x-auto first:mt-0')}>{children}</pre>
              </div>
            );
          },
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              {...getSelectableProps<HTMLAnchorElement>('text-zinc-100 underline decoration-zinc-500 underline-offset-4 hover:text-white')}
            >
              {children}
            </a>
          ),
          table: ({ children }) => <div {...getSelectableProps<HTMLDivElement>('mt-5 overflow-x-auto first:mt-0')}><table {...getSelectableProps<HTMLTableElement>('min-w-full border-collapse text-left text-[13px] text-zinc-200')}>{children}</table></div>,
          thead: ({ children }) => <thead {...getSelectableProps<HTMLTableSectionElement>('border-b border-[#343b45] text-zinc-100')}>{children}</thead>,
          tbody: ({ children }) => <tbody {...getSelectableProps<HTMLTableSectionElement>('')}>{children}</tbody>,
          tr: ({ children }) => <tr {...getSelectableProps<HTMLTableRowElement>('border-b border-[#252b34] last:border-b-0')}>{children}</tr>,
          th: ({ children }) => <th {...getSelectableProps<HTMLTableCellElement>('px-3 py-2 font-medium')}>{children}</th>,
          td: ({ children }) => <td {...getSelectableProps<HTMLTableCellElement>('px-3 py-2 text-zinc-300')}>{children}</td>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});

function ConnectionPortIcon({
  className = '',
  glyphSize = 14,
}: {
  className?: string;
  glyphSize?: number;
}) {
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full border border-white/40 bg-[rgba(15,17,21,0.92)] shadow-[0_8px_18px_rgba(0,0,0,0.28)] ${className}`.trim()}
    >
      <svg
        viewBox="0 0 24 24"
        style={{ width: glyphSize, height: glyphSize }}
        aria-hidden="true"
      >
        <path
          d="M12 6.2v11.6M6.2 12h11.6"
          fill="none"
          stroke="rgba(229,231,235,0.92)"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}

export default function AIWorkspace() {
  const [viewMode, setViewMode] = useState<'gallery' | 'editor'>('gallery');
  const [tool, setTool] = useState<Tool>('select');
  const [items, setItems] = useState<CanvasItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [hoveredCanvasItemId, setHoveredCanvasItemId] = useState<string | null>(null);
  const [hoveredInputPortItemId, setHoveredInputPortItemId] = useState<string | null>(null);
  const [hoveredOutputPortItemId, setHoveredOutputPortItemId] = useState<string | null>(null);
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>('idle');
  const [connectionFromItemId, setConnectionFromItemId] = useState<string | null>(null);
  const [connectionPoint, setConnectionPoint] = useState<{ x: number; y: number } | null>(null);
  const [connectionPointerId, setConnectionPointerId] = useState<number | null>(null);
  const [viewport, setViewport] = useState({ x: 0, y: 0, scale: 1 });
  const [isDragging, setIsDragging] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [isCornerResizing, setIsCornerResizing] = useState(false);
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [isMarqueeSelecting, setIsMarqueeSelecting] = useState(false);
  const [marqueeRect, setMarqueeRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [selectedConnectionIds, setSelectedConnectionIds] = useState<string[]>([]);
  const [connectionSnapTargetId, setConnectionSnapTargetId] = useState<string | null>(null);
  const dragStart = useRef({ x: 0, y: 0 });
  const panStartOffset = useRef({ x: 0, y: 0 });
  const marqueeStartRef = useRef<{ x: number; y: number } | null>(null);
  const draggingItemIdsRef = useRef<string[]>([]);
  const cornerResizeStart = useRef<{
    mouseX: number;
    mouseY: number;
    width: number;
    height: number;
    itemId: string;
  } | null>(null);
  const marqueeToggleModeRef = useRef(false);
  const connectionDragMovedRef = useRef(false);
  const connectionSessionRef = useRef<ConnectionSession | null>(null);
  const detachConnectionWindowListenersRef = useRef<(() => void) | null>(null);
  
  const [chatInput, setChatInput] = useState('');
  const [chatInputRows, setChatInputRows] = useState(1);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [hasStartedChat, setHasStartedChat] = useState(false);
  const [showAvatarMenu, setShowAvatarMenu] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeSkill, setActiveSkill] = useState<{ id: string; label: string } | null>(null);
  const [generationMode, setGenerationMode] = useState<GenerationMode>('auto');
  const [showGenerationModeMenu, setShowGenerationModeMenu] = useState(false);
  const [showSkillsMenu, setShowSkillsMenu] = useState(false);
  const [showAspectRatioMenu, setShowAspectRatioMenu] = useState(false);
  const [imageAspectRatio, setImageAspectRatio] = useState('auto');
  const [hideWelcomeByCenterSkillPick, setHideWelcomeByCenterSkillPick] = useState(false);
  const [referenceImages, setReferenceImages] = useState<string[]>([]);
  const [chatReferenceImages, setChatReferenceImages] = useState<string[]>([]);
  const [draggingImageIndex, setDraggingImageIndex] = useState<number | null>(null);
  const [dragOverImageIndex, setDragOverImageIndex] = useState<number | null>(null);
  const [imageCount, setImageCount] = useState(0);
  
  // 项目管理状态
  const [sessions, setSessions] = useState<ProjectSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string>('');
  const [showProjectMenu, setShowProjectMenu] = useState(false);
  const [showHistoryPanel, setShowHistoryPanel] = useState(false);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  
  const [activeSkillJobId, setActiveSkillJobId] = useState<string | null>(null);
  const [activeSkillJobType, setActiveSkillJobType] = useState<'logo' | 'brand' | null>(null);
  const [activeSkillJobStatus, setActiveSkillJobStatus] = useState<{
    completed: number;
    failed: number;
    total: number;
    items: Array<{ component: string; name: string; status: string; localUrl?: string; error?: string }>;
  } | null>(null);
  
  const projectMenuRef = useRef<HTMLDivElement>(null);
  const generationModeMenuRef = useRef<HTMLDivElement>(null);
  const skillsMenuRef = useRef<HTMLDivElement>(null);
  const aspectRatioMenuRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatFileInputRef = useRef<HTMLInputElement>(null);
  const chatInputEditorRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const generateAbortRef = useRef<AbortController | null>(null);
  const processedSkillJobUrlsRef = useRef<Set<string>>(new Set());
  const processedSkillChoiceIdsRef = useRef<Set<string>>(new Set());
  const streamQueueRef = useRef('');
  const streamTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamMessageIdRef = useRef<string | null>(null);
  const pendingAssistantMessageIdRef = useRef<string | null>(null);
  const assistantTextSelectionRef = useRef<AssistantTextSelectionSession>({
    startedInAssistant: false,
    isPointerDown: false,
    hasSelection: false,
    suppressOutsideClickUntil: 0,
  });
  const [pendingSkillChoice, setPendingSkillChoice] = useState<SkillChoicePayload | null>(null);
  const [showSkillChoiceModal, setShowSkillChoiceModal] = useState(false);
  const [chatInputFocused, setChatInputFocused] = useState(false);
  const [chatInputHeight, setChatInputHeight] = useState(24);
  const [copiedAssistantMessageId, setCopiedAssistantMessageId] = useState<string | null>(null);
  const SKILL_TOKEN_SELECTOR = '[data-skill-token="true"]';
  const copiedAssistantMessageTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const getAssistantSelectableHost = (node: Node | null): HTMLElement | null => {
    if (!node) return null;
    if (node instanceof HTMLElement) {
      return node.closest('[data-assistant-selectable="true"]');
    }
    return node.parentElement?.closest('[data-assistant-selectable="true"]') ?? null;
  };

  const isNodeInsideAssistantSelectable = (node: Node | null) => {
    const selectableHost = getAssistantSelectableHost(node);
    if (!selectableHost || !chatContainerRef.current) return false;
    return chatContainerRef.current.contains(selectableHost);
  };

  const hasActiveAssistantTextSelection = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return false;
    return (
      isNodeInsideAssistantSelectable(selection.anchorNode) ||
      isNodeInsideAssistantSelectable(selection.focusNode)
    );
  }, []);

  const markAssistantSelectionIntent = useCallback(() => {
    assistantTextSelectionRef.current.startedInAssistant = true;
    assistantTextSelectionRef.current.suppressOutsideClickUntil = Date.now() + 300;
  }, []);

  const handleAssistantSelectablePointerDown = useCallback((e: React.PointerEvent<HTMLElement>) => {
    assistantTextSelectionRef.current.isPointerDown = true;
    markAssistantSelectionIntent();
    e.stopPropagation();
  }, [markAssistantSelectionIntent]);

  const handleAssistantSelectableMouseDown = useCallback((e: React.MouseEvent<HTMLElement>) => {
    assistantTextSelectionRef.current.isPointerDown = true;
    markAssistantSelectionIntent();
    e.stopPropagation();
  }, [markAssistantSelectionIntent]);

  const handleAssistantSelectableClick = useCallback((e: React.MouseEvent<HTMLElement>) => {
    if (hasActiveAssistantTextSelection()) {
      markAssistantSelectionIntent();
    }
    e.stopPropagation();
  }, [hasActiveAssistantTextSelection, markAssistantSelectionIntent]);

  const handleCopyAssistantMessage = useCallback(async (messageId: string, content: string) => {
    const textToCopy = content.trim();
    if (!textToCopy) return;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(textToCopy);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = textToCopy;
        textarea.setAttribute('readonly', 'true');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }

      setCopiedAssistantMessageId(messageId);
      if (copiedAssistantMessageTimeoutRef.current) {
        clearTimeout(copiedAssistantMessageTimeoutRef.current);
      }
      copiedAssistantMessageTimeoutRef.current = setTimeout(() => {
        setCopiedAssistantMessageId((prev) => (prev === messageId ? null : prev));
      }, 1400);
    } catch (error) {
      console.error('Copy assistant message failed:', error);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (copiedAssistantMessageTimeoutRef.current) {
        clearTimeout(copiedAssistantMessageTimeoutRef.current);
      }
    };
  }, []);

  const syncEditorHeight = () => {
    const editor = chatInputEditorRef.current;
    if (!editor) return;
    editor.style.height = "auto";
    const next = Math.min(editor.scrollHeight || 24, 240);
    editor.style.height = `${next}px`;
    setChatInputHeight(next);
  };

  const extractEditorPlainText = (root: HTMLElement): string => {
    const cloned = root.cloneNode(true) as HTMLElement;
    cloned.querySelectorAll(SKILL_TOKEN_SELECTOR).forEach((node) => node.remove());
    return (cloned.innerText || "").replace(/\u00A0/g, " ");
  };

  const moveCaretToEditorEnd = () => {
    const editor = chatInputEditorRef.current;
    if (!editor) return;
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  };

  const syncEditorTextFromState = (value: string, moveCaretToEnd = false) => {
    const editor = chatInputEditorRef.current;
    if (!editor) return;

    const currentPlain = extractEditorPlainText(editor);
    const currentTokenLabel = editor.querySelector(SKILL_TOKEN_SELECTOR)?.getAttribute("data-skill-label") || "";
    const targetTokenLabel = activeSkill?.label || "";

    const shouldRebuild = currentPlain !== value || currentTokenLabel !== targetTokenLabel;
    if (shouldRebuild) {
      editor.innerHTML = "";

      if (activeSkill) {
        const token = document.createElement("span");
        token.setAttribute("data-skill-token", "true");
        token.setAttribute("data-skill-label", activeSkill.label);
        token.setAttribute("contenteditable", "false");
        token.className = "inline-flex items-center gap-1 px-2 h-5 leading-5 rounded-full bg-violet-100 text-violet-700 text-sm font-medium align-middle mr-1";
        token.textContent = `✧ ${activeSkill.label}`;
        editor.appendChild(token);
      }

      editor.appendChild(document.createTextNode(value));
      if (moveCaretToEnd) {
        moveCaretToEditorEnd();
      }
    }

    syncEditorHeight();
  };

  const isCaretAtEditorStart = (): boolean => {
    const editor = chatInputEditorRef.current;
    if (!editor) return false;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return false;
    const range = selection.getRangeAt(0);
    if (!range.collapsed) return false;
    if (!editor.contains(range.startContainer)) return false;

    const prefixRange = range.cloneRange();
    prefixRange.selectNodeContents(editor);
    prefixRange.setEnd(range.startContainer, range.startOffset);
    const fragment = prefixRange.cloneContents();
    const wrapper = document.createElement("div");
    wrapper.appendChild(fragment);
    wrapper.querySelectorAll(SKILL_TOKEN_SELECTOR).forEach((node) => node.remove());
    return (wrapper.textContent || "").replace(/\u00A0/g, "").length === 0;
  };

  const parseSkillChoicePayload = (raw: string): SkillChoicePayload | null => {
    try {
      const parsed = JSON.parse(raw) as {
        id?: unknown;
        title?: unknown;
        message?: unknown;
        options?: Array<{ label?: unknown; submitText?: unknown }>;
      };
      if (typeof parsed.id !== 'string' || !parsed.id.trim()) return null;
      if (typeof parsed.title !== 'string' || !parsed.title.trim()) return null;
      if (typeof parsed.message !== 'string') return null;
      if (!Array.isArray(parsed.options) || parsed.options.length < 2 || parsed.options.length > 3) return null;

      const options: SkillChoiceOption[] = parsed.options
        .filter((item) => typeof item?.label === 'string' && typeof item?.submitText === 'string')
        .map((item) => ({ label: (item.label as string).trim(), submitText: (item.submitText as string).trim() }))
        .filter((item) => item.label.length > 0 && item.submitText.length > 0);

      if (options.length < 2 || options.length > 3) return null;

      return {
        id: parsed.id.trim(),
        title: parsed.title.trim(),
        message: parsed.message.trim(),
        options,
      };
    } catch {
      return null;
    }
  };

  const extractSkillChoiceFromContent = (
    content: string
  ): { cleanContent: string; choice: SkillChoicePayload | null } => {
    const start = content.indexOf(SKILL_CHOICE_START);
    const end = content.indexOf(SKILL_CHOICE_END);
    if (start === -1 || end === -1 || end <= start) {
      return { cleanContent: content, choice: null };
    }

    const jsonStart = start + SKILL_CHOICE_START.length;
    const rawJson = content.slice(jsonStart, end).trim();
    const parsedChoice = parseSkillChoicePayload(rawJson);
    if (!parsedChoice) {
      return { cleanContent: content, choice: null };
    }

    const cleanContent = `${content.slice(0, start)}${content.slice(end + SKILL_CHOICE_END.length)}`.trim();
    return { cleanContent, choice: parsedChoice };
  };

  const processAssistantContentWithChoice = (
    content: string,
    skillId: string | null | undefined
  ): { content: string; skillChoice?: SkillChoicePayload } => {
    if (skillId !== 'brand') {
      return { content };
    }

    const extracted = extractSkillChoiceFromContent(content);
    if (!extracted.choice) {
      return { content: extracted.cleanContent };
    }

    if (processedSkillChoiceIdsRef.current.has(extracted.choice.id)) {
      return { content: extracted.cleanContent };
    }

    return { content: extracted.cleanContent, skillChoice: extracted.choice };
  };

  useEffect(() => {
    if (!pendingSkillChoice) return;
    const stillPending = chatMessages.some((msg) =>
      msg.skillChoice?.id === pendingSkillChoice.id && !msg.skillChoiceResolved
    );
    if (!stillPending) {
      setPendingSkillChoice(null);
      setShowSkillChoiceModal(false);
    }
  }, [chatMessages, pendingSkillChoice]);

  const stopStreamTypewriter = () => {
    if (streamTimerRef.current) {
      clearInterval(streamTimerRef.current);
      streamTimerRef.current = null;
    }
    streamQueueRef.current = '';
    streamMessageIdRef.current = null;
  };

  const ensureStreamTypewriterRunning = () => {
    if (streamTimerRef.current) return;

    streamTimerRef.current = setInterval(() => {
      const messageId = streamMessageIdRef.current;
      if (!messageId) return;
      if (!streamQueueRef.current) return;

      const nextChunk = streamQueueRef.current.slice(0, 2);
      streamQueueRef.current = streamQueueRef.current.slice(2);

      setChatMessages((prev) => prev.map((msg) => {
        if (msg.id !== messageId) return msg;
        return {
          ...msg,
          content: `${msg.content}${nextChunk}`,
        };
      }));
    }, 30);
  };

  const enqueueStreamDelta = (messageId: string, delta: string) => {
    streamMessageIdRef.current = messageId;
    streamQueueRef.current += delta;
    ensureStreamTypewriterRunning();
  };

  const flushStreamQueueNow = (messageId?: string | null) => {
    const targetMessageId = messageId || streamMessageIdRef.current;
    const remaining = streamQueueRef.current;
    if (!targetMessageId || !remaining) return;

    streamQueueRef.current = '';
    setChatMessages((prev) => prev.map((msg) => {
      if (msg.id !== targetMessageId) return msg;
      return {
        ...msg,
        content: `${msg.content}${remaining}`,
      };
    }));
  };

  const waitForStreamFlush = async () => {
    const maxWaitMs = 12000;
    const start = Date.now();
    while (streamQueueRef.current.length > 0) {
      if (Date.now() - start >= maxWaitMs) {
        flushStreamQueueNow();
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
  };

  const updateActiveStreamMessageStatus = (
    status: 'failed' | 'cancelled' | undefined,
    fallbackContent?: string
  ) => {
    const messageId = streamMessageIdRef.current;
    if (!messageId) return;

    flushStreamQueueNow(messageId);

    setChatMessages((prev) => prev.map((msg) => {
      if (msg.id !== messageId) return msg;
      return {
        ...msg,
        taskStatus: status,
        content: msg.content || fallbackContent || msg.content,
      };
    }));
  };

  const updatePendingAssistantMessage = (
    updater: (msg: ChatMessage) => ChatMessage
  ) => {
    const messageId = pendingAssistantMessageIdRef.current;
    if (!messageId) return;
    setChatMessages((prev) => prev.map((msg) => {
      if (msg.id !== messageId) return msg;
      return updater(msg);
    }));
  };

  const readAsDataURL = (file: File) => {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (event) => resolve(event.target?.result as string);
      reader.onerror = () => reject(new Error(`读取文件失败: ${file.name}`));
      reader.readAsDataURL(file);
    });
  };

  const addImageToCanvas = async (imageData: string, fileName: string, orderOffset: number = 0) => {
    const response = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageData,
        fileName,
      }),
    });

    if (!response.ok) {
      throw new Error(`Upload failed: ${response.status}`);
    }

    const data = await response.json();
    const imageUrl = data.url;

    await new Promise<void>((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const aspectRatio = img.width / img.height;
        const width = 300;
        const height = 300 / aspectRatio;

        const newItem: CanvasItem = {
          id: `item-${Date.now()}-${Math.random()}`,
          type: 'image',
          x: (-viewport.x / viewport.scale) + 100 + orderOffset * 24,
          y: (-viewport.y / viewport.scale) + 100 + orderOffset * 24,
          width,
          height,
          rotation: 0,
          src: imageUrl,
          visible: true,
          locked: false,
        };
        setItems(prev => [...prev, newItem]);
        resolve();
      };
      img.onerror = () => reject(new Error('图片加载失败'));
      img.src = imageUrl;
    });
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const list = Array.from(files);
    for (let i = 0; i < list.length; i++) {
      const file = list[i];
      try {
        const base64Data = await readAsDataURL(file);
        await addImageToCanvas(base64Data, file.name, i);
      } catch (error) {
        console.error('Upload failed:', error);
      }
    }

    e.target.value = '';
  };

  const handleCanvasPaste = async (e: React.ClipboardEvent<HTMLDivElement>) => {
    const items = Array.from(e.clipboardData.items || []);
    const imageFiles = items
      .filter((item) => item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);

    if (imageFiles.length === 0) {
      return;
    }

    e.preventDefault();

    for (let i = 0; i < imageFiles.length; i++) {
      const file = imageFiles[i];
      try {
        const base64Data = await readAsDataURL(file);
        const fallbackName = file.name || `pasted-${Date.now()}-${i + 1}.png`;
        await addImageToCanvas(base64Data, fallbackName, i);
      } catch (error) {
        console.error('Canvas paste upload failed:', error);
      }
    }
  };

  const handleChatImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const currentCount = chatReferenceImages.length;
    const remainingSlots = 14 - currentCount;
    
    if (remainingSlots <= 0) {
      alert('最多只能上传14张参考图');
      return;
    }

    const filesToProcess = Array.from(files).slice(0, remainingSlots);

    try {
      const uploadedImages = await Promise.all(filesToProcess.map((file) => readAsDataURL(file)));
      setChatReferenceImages(prev => [...prev, ...uploadedImages]);
    } catch (error) {
      console.error('Chat reference upload failed:', error);
    }
    
    e.target.value = '';
  };

  const handleChatPaste = async (e: React.ClipboardEvent<HTMLDivElement>) => {
    const items = Array.from(e.clipboardData.items || []);
    const imageFiles = items
      .filter((item) => item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);

    if (imageFiles.length === 0) {
      const text = e.clipboardData.getData('text/plain');
      if (!text) return;
      e.preventDefault();
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        range.deleteContents();
        const node = document.createTextNode(text);
        range.insertNode(node);
        range.setStartAfter(node);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
      } else {
        document.execCommand('insertText', false, text);
      }
      const editorText = chatInputEditorRef.current ? extractEditorPlainText(chatInputEditorRef.current) : '';
      setChatInput(editorText);
      syncEditorHeight();
      return;
    }

    e.preventDefault();

    const currentCount = chatReferenceImages.length;
    const remainingSlots = 14 - currentCount;

    if (remainingSlots <= 0) {
      alert('最多只能上传14张参考图');
      return;
    }

    const filesToProcess = imageFiles.slice(0, remainingSlots);

    const readAsDataURL = (file: File) => {
      return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (event) => resolve(event.target?.result as string);
        reader.onerror = () => reject(new Error(`读取文件失败: ${file.name}`));
        reader.readAsDataURL(file);
      });
    };

    try {
      const uploadedImages = await Promise.all(filesToProcess.map((file) => readAsDataURL(file)));
      setChatReferenceImages(prev => [...prev, ...uploadedImages]);
    } catch (error) {
      console.error('Chat paste image upload failed:', error);
    }
  };

  const handleChatEditorInput = () => {
    const editorText = chatInputEditorRef.current ? extractEditorPlainText(chatInputEditorRef.current) : '';
    setChatInput(editorText);
    syncEditorHeight();
  };

  const handleChatEditorKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if ((e.key === 'Backspace' || e.key === 'Delete') && activeSkill && isCaretAtEditorStart()) {
      e.preventDefault();
      setActiveSkillForCurrentTopic(null);
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      if (isGenerating) {
        void handleCancelGenerate();
      } else {
        void handleGenerate();
      }
    }
  };

  const removeChatImage = (index: number) => {
    setChatReferenceImages(prev => prev.filter((_, i) => i !== index));
  };

  const reorderChatImages = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    setChatReferenceImages((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  };

  const handleReferenceDragStart = (index: number) => {
    setDraggingImageIndex(index);
  };

  const handleReferenceDragOver = (e: React.DragEvent<HTMLDivElement>, index: number) => {
    e.preventDefault();
    if (dragOverImageIndex !== index) {
      setDragOverImageIndex(index);
    }
  };

  const handleReferenceDrop = (e: React.DragEvent<HTMLDivElement>, index: number) => {
    e.preventDefault();
    if (draggingImageIndex !== null) {
      reorderChatImages(draggingImageIndex, index);
    }
    setDraggingImageIndex(null);
    setDragOverImageIndex(null);
  };

  const handleReferenceDragEnd = () => {
    setDraggingImageIndex(null);
    setDragOverImageIndex(null);
  };

  const addShape = (shapeType: 'rectangle' | 'circle') => {
    const newItem: CanvasItem = {
      id: `shape-${Date.now()}`,
      type: 'shape',
      x: (-viewport.x / viewport.scale) + 100,
      y: (-viewport.y / viewport.scale) + 100,
      width: 100,
      height: 100,
      rotation: 0,
      fill: '#3b82f6',
      visible: true,
      locked: false,
    };
    setItems(prev => [...prev, newItem]);
  };

  const addText = () => {
    const newItem: CanvasItem = {
      id: `text-${Date.now()}`,
      type: 'text',
      x: (-viewport.x / viewport.scale) + 100,
      y: (-viewport.y / viewport.scale) + 100,
      width: 200,
      height: 40,
      rotation: 0,
      text: '双击编辑文本',
      visible: true,
      locked: false,
    };
    setItems(prev => [...prev, newItem]);
  };

  const getPortCanvasPoint = (item: CanvasItem, side: 'left' | 'right') => ({
    x:
      side === 'left'
        ? item.x - PORT_ICON_RADIUS - PORT_OUTER_GAP
        : item.x + item.width + PORT_ICON_RADIUS + PORT_OUTER_GAP,
    y: item.y + item.height / 2,
  });

  const toCanvasScreenPoint = (point: { x: number; y: number }) => ({
    x: point.x * viewport.scale + viewport.x,
    y: point.y * viewport.scale + viewport.y,
  });

  const buildConnectionPath = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const dx = Math.max(64, Math.abs(to.x - from.x) * 0.42);
    const c1x = from.x + dx;
    const c2x = to.x - dx;
    return `M ${from.x} ${from.y} C ${c1x} ${from.y}, ${c2x} ${to.y}, ${to.x} ${to.y}`;
  };

  const getPreviewRenderPoints = () => {
    const session = connectionSessionRef.current;
    if (!session || session.mode !== 'dragging' || !session.point) {
      return { from: null, to: null };
    }

    const fromItem = items.find((item) => item.id === session.fromItemId);
    if (!fromItem) {
      return { from: null, to: null };
    }

    return {
      from: toCanvasScreenPoint(getPortCanvasPoint(fromItem, 'right')),
      to: session.point,
    };
  };

  const getPortOverlayPoint = (item: CanvasItem, side: 'left' | 'right') =>
    toCanvasScreenPoint(getPortCanvasPoint(item, side));

  const beginConnectionDragFromItem = (
    item: CanvasItem,
    pointerId: number,
    source: 'bridge' | 'button'
  ) => {
    setSelectedConnectionIds([]);
    const wasHoveredOutput = hoveredOutputPortItemId === item.id;
    const isHoveredCanvasItem = hoveredCanvasItemId === item.id;
    const isConnectionSource = connectionSessionRef.current?.fromItemId === item.id;
    const isNearPort = hoveredInputPortItemId === item.id || wasHoveredOutput;
    const showOutputPort = isHoveredCanvasItem || isNearPort || isConnectionSource;

    debugCanvasConnection('begin-connection-drag', {
      source,
      itemId: item.id,
      pointerId,
      hoveredOutputPortItemId,
      hoveredInputPortItemId,
      hoveredCanvasItemId,
      connectionMode,
      showOutputPort,
    });

    setHoveredOutputPortItemId((prev) => (prev === item.id ? null : prev));
    connectionDragMovedRef.current = false;

    let capturedPointerId: number | null = null;
    if (canvasRef.current) {
      try {
        canvasRef.current.setPointerCapture(pointerId);
        capturedPointerId = pointerId;
      } catch {}
    }

    const portPoint = getPortOverlayPoint(item, 'right');
    startDraggingConnection(item.id, portPoint, capturedPointerId);
  };

  const toggleSelectionId = (ids: string[], id: string) =>
    ids.includes(id) ? ids.filter((entry) => entry !== id) : [...ids, id];

  const getPrimarySelectedId = (ids: string[]) => ids[0] || null;

  const cubicBezierPoint = (
    p0: { x: number; y: number },
    p1: { x: number; y: number },
    p2: { x: number; y: number },
    p3: { x: number; y: number },
    t: number
  ) => {
    const mt = 1 - t;
    const mt2 = mt * mt;
    const t2 = t * t;
    return {
      x: mt2 * mt * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t2 * t * p3.x,
      y: mt2 * mt * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t2 * t * p3.y,
    };
  };

  const getConnectionControlPoints = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const dx = Math.max(40, Math.abs(to.x - from.x) * 0.35);
    return {
      c1: { x: from.x + dx, y: from.y },
      c2: { x: to.x - dx, y: to.y },
    };
  };

  const getConnectionHitIdsForMarquee = (rect: { x: number; y: number; width: number; height: number }) => {
    const rectLeft = rect.x;
    const rectRight = rect.x + rect.width;
    const rectTop = rect.y;
    const rectBottom = rect.y + rect.height;
    const HIT_PADDING = 8;
    const SAMPLE_COUNT = 24;

    return connections
      .filter((connection) => {
        const fromItem = items.find((item) => item.id === connection.fromItemId);
        const toItem = items.find((item) => item.id === connection.toItemId);
        if (!fromItem || !toItem) return false;

        const from = toCanvasScreenPoint(getPortCanvasPoint(fromItem, 'right'));
        const to = toCanvasScreenPoint(getPortCanvasPoint(toItem, 'left'));
        const { c1, c2 } = getConnectionControlPoints(from, to);

        const minX = Math.min(from.x, c1.x, c2.x, to.x) - HIT_PADDING;
        const maxX = Math.max(from.x, c1.x, c2.x, to.x) + HIT_PADDING;
        const minY = Math.min(from.y, c1.y, c2.y, to.y) - HIT_PADDING;
        const maxY = Math.max(from.y, c1.y, c2.y, to.y) + HIT_PADDING;

        const intersectsBoundingBox = !(
          maxX < rectLeft ||
          minX > rectRight ||
          maxY < rectTop ||
          minY > rectBottom
        );

        if (!intersectsBoundingBox) return false;

        for (let step = 0; step <= SAMPLE_COUNT; step += 1) {
          const point = cubicBezierPoint(from, c1, c2, to, step / SAMPLE_COUNT);
          if (
            point.x >= rectLeft &&
            point.x <= rectRight &&
            point.y >= rectTop &&
            point.y <= rectBottom
          ) {
            return true;
          }
        }

        return false;
      })
      .map((connection) => connection.id);
  };

  const findNearestInputPort = (x: number, y: number, fromItemId: string): { targetId: string; x: number; y: number } | null => {
    const SNAP_DISTANCE = 18;
    let nearest: { targetId: string; x: number; y: number; distance: number } | null = null;

    for (const item of items) {
      if (item.id === fromItemId) continue;
      const port = toCanvasScreenPoint(getPortCanvasPoint(item, 'left'));
      const distance = Math.hypot(port.x - x, port.y - y);
      if (distance > SNAP_DISTANCE) continue;
      if (!nearest || distance < nearest.distance) {
        nearest = { targetId: item.id, x: port.x, y: port.y, distance };
      }
    }

    if (!nearest) return null;
    return { targetId: nearest.targetId, x: nearest.x, y: nearest.y };
  };

  const deleteItem = (id: string) => {
    setItems(prev => prev.filter(item => item.id !== id));
    setConnections(prev => prev.filter((connection) => connection.fromItemId !== id && connection.toItemId !== id));
    if (selectedId === id) setSelectedId(null);
    setSelectedIds(prev => prev.filter(selected => selected !== id));
  };

  const deleteConnection = (connectionId: string) => {
    setConnections((prev) => prev.filter((connection) => connection.id !== connectionId));
    setSelectedConnectionIds((prev) => prev.filter((id) => id !== connectionId));
  };

  const syncConnectionState = (session: ConnectionSession | null) => {
    if (!session) {
      setConnectionMode('idle');
      setConnectionFromItemId(null);
      setConnectionPoint(null);
      setConnectionPointerId(null);
      setConnectionSnapTargetId(null);
      return;
    }

    setConnectionMode(session.mode);
    setConnectionFromItemId(session.fromItemId);
    setConnectionPoint(session.point);
    setConnectionPointerId(session.pointerId);
    setConnectionSnapTargetId(session.snapTargetId);
  };

  const getCanvasRelativePoint = (clientX: number, clientY: number) => {
    const canvasRect = canvasRef.current?.getBoundingClientRect();
    if (!canvasRect) return null;
    return {
      x: clientX - canvasRect.left,
      y: clientY - canvasRect.top,
    };
  };

  const detachConnectionWindowListeners = () => {
    if (detachConnectionWindowListenersRef.current) {
      detachConnectionWindowListenersRef.current();
      detachConnectionWindowListenersRef.current = null;
    }
  };

  const debugCanvasConnection = (event: string, payload?: Record<string, unknown>) => {
    if (!DEBUG_CANVAS_CONNECTIONS) return;
    console.debug('[canvas-conn]', event, payload || {});
  };

  const attachConnectionWindowListeners = () => {
    detachConnectionWindowListeners();
    debugCanvasConnection('attach-window-listeners');

    const handleWindowPointerMove = (e: PointerEvent) => {
      const session = connectionSessionRef.current;
      if (!session) return;
      if (session.pointerId !== null && e.pointerId !== session.pointerId) return;

      const point = getCanvasRelativePoint(e.clientX, e.clientY);
      if (!point) return;

      debugCanvasConnection('window-pointermove', {
        fromItemId: session.fromItemId,
        x: point.x,
        y: point.y,
      });
      updateConnectionPreview(point.x, point.y);
    };

    const handleWindowPointerEnd = (e: PointerEvent) => {
      const session = connectionSessionRef.current;
      if (!session) return;
      if (session.pointerId !== null && e.pointerId !== session.pointerId) return;
      debugCanvasConnection('window-pointerend', {
        fromItemId: session.fromItemId,
        snapTargetId: session.snapTargetId,
        pointerId: e.pointerId,
      });
      finalizeConnectionInteraction();
    };

    window.addEventListener('pointermove', handleWindowPointerMove);
    window.addEventListener('pointerup', handleWindowPointerEnd);
    window.addEventListener('pointercancel', handleWindowPointerEnd);

    detachConnectionWindowListenersRef.current = () => {
      window.removeEventListener('pointermove', handleWindowPointerMove);
      window.removeEventListener('pointerup', handleWindowPointerEnd);
      window.removeEventListener('pointercancel', handleWindowPointerEnd);
    };
  };

  const resetConnectionInteraction = () => {
    const session = connectionSessionRef.current;
    debugCanvasConnection('reset-start', {
      fromItemId: session?.fromItemId ?? null,
      mode: session?.mode ?? null,
      pointerId: session?.pointerId ?? null,
      snapTargetId: session?.snapTargetId ?? null,
      moved: session?.moved ?? null,
      point: session?.point ?? null,
    });
    if (canvasRef.current && session?.pointerId !== null && canvasRef.current.hasPointerCapture(session.pointerId)) {
      canvasRef.current.releasePointerCapture(session.pointerId);
    }
    detachConnectionWindowListeners();
    connectionSessionRef.current = null;
    syncConnectionState(null);
    connectionDragMovedRef.current = false;
    debugCanvasConnection('reset');
  };

  const startDraggingConnection = (itemId: string, point: { x: number; y: number }, pointerId?: number | null) => {
    const initialPoint = { x: point.x + 12, y: point.y };
    connectionSessionRef.current = {
      mode: 'dragging',
      fromItemId: itemId,
      pointerId: pointerId ?? null,
      startPoint: point,
      point: initialPoint,
      snapTargetId: null,
      moved: false,
    };
    syncConnectionState(connectionSessionRef.current);
    setIsDragging(false);
    setIsMarqueeSelecting(false);
    setMarqueeRect(null);
    marqueeStartRef.current = null;
    setSelectedConnectionIds([]);
    connectionDragMovedRef.current = false;
    debugCanvasConnection('start-dragging-connection', {
      itemId,
      pointerId: pointerId ?? null,
      startPoint: point,
      initialPoint,
      connectionModeBeforeSync: connectionMode,
      hoveredOutputPortItemId,
    });
    attachConnectionWindowListeners();
    debugCanvasConnection('port-pointerdown', {
      fromItemId: itemId,
      x: point.x,
      y: point.y,
      pointerId: pointerId ?? null,
    });
  };

  const updateConnectionPreview = (rawX: number, rawY: number) => {
    const session = connectionSessionRef.current;
    if (!session) return;
    const startPoint = session.startPoint;
    const movedDistance = startPoint ? Math.hypot(rawX - startPoint.x, rawY - startPoint.y) : 0;
    const hasMoved = movedDistance >= 3;
    connectionDragMovedRef.current = hasMoved;
    const nearest = findNearestInputPort(rawX, rawY, session.fromItemId);
    session.point = nearest ? { x: nearest.x, y: nearest.y } : { x: rawX, y: rawY };
    session.snapTargetId = nearest?.targetId || null;
    session.moved = hasMoved;
    syncConnectionState(session);
    debugCanvasConnection('session-point-updated', {
      fromItemId: session.fromItemId,
      x: session.point.x,
      y: session.point.y,
      snapTargetId: session.snapTargetId,
      moved: hasMoved,
    });
  };

  const finalizeConnectionInteraction = () => {
    const session = connectionSessionRef.current;
    debugCanvasConnection('finalize-connection-interaction', {
      fromItemId: session?.fromItemId ?? null,
      snapTargetId: session?.snapTargetId ?? null,
      moved: session?.moved ?? null,
      point: session?.point ?? null,
    });
    if (session && session.mode === 'dragging' && session.fromItemId && session.snapTargetId && session.fromItemId !== session.snapTargetId) {
      setConnections((prev) => {
        const exists = prev.some(
          (connection) =>
            connection.fromItemId === session.fromItemId &&
            connection.toItemId === session.snapTargetId
        );
        if (exists) return prev;
        return [
          ...prev,
          {
            id: `conn-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            fromItemId: session.fromItemId,
            toItemId: session.snapTargetId,
          },
        ];
      });
    }
    resetConnectionInteraction();
  };

  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    debugCanvasConnection('canvas-pointerdown', {
      button: e.button,
      pointerId: e.pointerId,
      dataset: {
        canvas: target.dataset.canvas ?? null,
        port: target.dataset.port ?? null,
        portBridge: target.dataset.portBridge ?? null,
        itemId: target.dataset.itemId ?? null,
        cornerResize: target.dataset.cornerResize ?? null,
      },
      connectionMode,
      activeFromItemId: connectionSessionRef.current?.fromItemId ?? null,
    });

    if (e.button === 0) {
      e.preventDefault();
    }

    if (connectionSessionRef.current && target.dataset.canvas === 'true') {
      resetConnectionInteraction();
      return;
    }

    if (e.button === 0 && isSpacePressed) {
      e.preventDefault();
      setIsPanning(true);
      panStartOffset.current = { x: viewport.x, y: viewport.y };
      dragStart.current = { x: e.clientX, y: e.clientY };
      return;
    }

    if (e.button === 1) {
      e.preventDefault();
      setIsPanning(true);
      panStartOffset.current = { x: viewport.x, y: viewport.y };
      dragStart.current = { x: e.clientX, y: e.clientY };
      return;
    }

    if (e.button === 0 && target.dataset.canvas === 'true') {
      const canvasRect = canvasRef.current?.getBoundingClientRect();
      if (!canvasRect) return;
      const startX = e.clientX - canvasRect.left;
      const startY = e.clientY - canvasRect.top;

      marqueeToggleModeRef.current = e.shiftKey;
      if (!e.shiftKey) {
        setSelectedConnectionIds([]);
        setSelectedId(null);
        setSelectedIds([]);
      }
      setIsMarqueeSelecting(true);
      marqueeStartRef.current = { x: startX, y: startY };
      setMarqueeRect({ x: startX, y: startY, width: 0, height: 0 });
    }
  };

  const handleCanvasPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isCornerResizing && selectedId && cornerResizeStart.current) {
      const { mouseX, mouseY, width, height, itemId } = cornerResizeStart.current;
      if (itemId !== selectedId) {
        return;
      }
      const deltaX = (e.clientX - mouseX) / viewport.scale;
      const deltaY = (e.clientY - mouseY) / viewport.scale;
      const minSize = 40;
      const aspect = width / height;
      const proposedWidth = width + deltaX;
      const proposedHeight = height + deltaY;
      const scaleX = proposedWidth / width;
      const scaleY = proposedHeight / height;
      const scale = Math.abs(scaleX - 1) >= Math.abs(scaleY - 1) ? scaleX : scaleY;
      const nextScale = Number.isFinite(scale) ? scale : 1;
      const newWidth = Math.max(minSize, width * nextScale);
      const newHeight = Math.max(minSize, Math.max(height * nextScale, newWidth / aspect));

      setItems((prev) =>
        prev.map((item) =>
          item.id === selectedId ? { ...item, width: newWidth, height: newHeight } : item
        )
      );
      return;
    }

    if (isPanning) {
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;
      setViewport(prev => ({
        ...prev,
        x: panStartOffset.current.x + dx,
        y: panStartOffset.current.y + dy,
      }));
      return;
    }

    if (isMarqueeSelecting && marqueeStartRef.current && canvasRef.current) {
      const canvasRect = canvasRef.current.getBoundingClientRect();
      const currentX = e.clientX - canvasRect.left;
      const currentY = e.clientY - canvasRect.top;
      const startX = marqueeStartRef.current.x;
      const startY = marqueeStartRef.current.y;

      setMarqueeRect({
        x: Math.min(startX, currentX),
        y: Math.min(startY, currentY),
        width: Math.abs(currentX - startX),
        height: Math.abs(currentY - startY),
      });
      return;
    }

    if (isDragging && selectedId) {
      const dx = (e.clientX - dragStart.current.x) / viewport.scale;
      const dy = (e.clientY - dragStart.current.y) / viewport.scale;
      setItems(prev => prev.map(item =>
        draggingItemIdsRef.current.includes(item.id)
          ? { ...item, x: item.x + dx, y: item.y + dy }
          : item
      ));
      dragStart.current = { x: e.clientX, y: e.clientY };
    }
  };

  const handleCanvasPointerUp = (e?: React.PointerEvent<HTMLDivElement>) => {
    debugCanvasConnection('canvas-pointerup', {
      button: e?.button ?? null,
      pointerId: e?.pointerId ?? null,
      connectionMode,
      activeFromItemId: connectionSessionRef.current?.fromItemId ?? null,
      marqueeSelecting: isMarqueeSelecting,
      dragging: isDragging,
      panning: isPanning,
    });
    if (isMarqueeSelecting && marqueeRect) {
      const rectInCanvas = {
        left: (marqueeRect.x - viewport.x) / viewport.scale,
        right: (marqueeRect.x + marqueeRect.width - viewport.x) / viewport.scale,
        top: (marqueeRect.y - viewport.y) / viewport.scale,
        bottom: (marqueeRect.y + marqueeRect.height - viewport.y) / viewport.scale,
      };

      const hitIds = items
        .filter((item) => {
          const itemLeft = item.x;
          const itemRight = item.x + item.width;
          const itemTop = item.y;
          const itemBottom = item.y + item.height;

          return !(
            itemRight < rectInCanvas.left ||
            itemLeft > rectInCanvas.right ||
            itemBottom < rectInCanvas.top ||
            itemTop > rectInCanvas.bottom
          );
        })
        .map((item) => item.id);
      const hitConnectionIds = getConnectionHitIdsForMarquee(marqueeRect);

      if (marqueeToggleModeRef.current) {
        setSelectedIds((prev) => {
          const next = hitIds.reduce((ids, id) => toggleSelectionId(ids, id), prev);
          setSelectedId(getPrimarySelectedId(next));
          return next;
        });
        setSelectedConnectionIds((prev) =>
          hitConnectionIds.reduce((ids, id) => toggleSelectionId(ids, id), prev)
        );
      } else {
        setSelectedIds(hitIds);
        setSelectedId(getPrimarySelectedId(hitIds));
        setSelectedConnectionIds(hitConnectionIds);
      }
    }

    setIsDragging(false);
    setIsPanning(false);
    setIsCornerResizing(false);
    setIsMarqueeSelecting(false);
    setMarqueeRect(null);
    marqueeStartRef.current = null;
    marqueeToggleModeRef.current = false;
    draggingItemIdsRef.current = [];
    cornerResizeStart.current = null;
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const pointerX = e.clientX - rect.left;
    const pointerY = e.clientY - rect.top;
    
    const oldScale = viewport.scale;
    const mousePointTo = {
      x: (pointerX - viewport.x) / oldScale,
      y: (pointerY - viewport.y) / oldScale,
    };
    
    const direction = e.deltaY > 0 ? -1 : 1;
    const scaleBy = 1.1;
    const newScale = direction > 0 ? oldScale * scaleBy : oldScale / scaleBy;
    const clampedScale = Math.min(Math.max(newScale, 0.1), 10);
    
    const newX = pointerX - mousePointTo.x * clampedScale;
    const newY = pointerY - mousePointTo.y * clampedScale;
    
    setViewport(prev => ({
      ...prev,
      scale: clampedScale,
      x: newX,
      y: newY,
    }));
  };

  useEffect(() => {
    const validIds = new Set(items.map((item) => item.id));
    setConnections((prev) =>
      prev.filter((connection) => validIds.has(connection.fromItemId) && validIds.has(connection.toItemId))
    );
    setSelectedConnectionIds((prev) =>
      prev.filter((id) =>
        connections.some(
          (connection) =>
            connection.id === id &&
            validIds.has(connection.fromItemId) &&
            validIds.has(connection.toItemId)
        )
      )
    );
    setConnectionSnapTargetId((prev) => (prev && validIds.has(prev) ? prev : null));
    if (connectionSessionRef.current?.fromItemId && !validIds.has(connectionSessionRef.current.fromItemId)) {
      resetConnectionInteraction();
    }
  }, [items, connectionPointerId, connections]);

  const handleCancelGenerate = async () => {
    updateActiveStreamMessageStatus('cancelled', '任务已终止');
    updatePendingAssistantMessage((msg) => ({
      ...msg,
      taskStatus: 'cancelled',
      content: '任务已终止',
    }));
    stopStreamTypewriter();

    if (activeSkillJobId) {
      try {
        await fetch(`/api/skills/jobs/${activeSkillJobId}`, { method: 'DELETE' });
      } catch (error) {
        console.error('Cancel skill job failed:', error);
      }

      const skillPrefix = `${activeSkillJobType || 'logo'}:`;
      setChatMessages(prev => prev.map((msg) => {
        if (msg.taskKey?.startsWith(skillPrefix) && msg.taskStatus !== 'completed') {
          return {
            ...msg,
            taskStatus: 'cancelled',
            content: msg.imageName ? `${msg.imageName} 已终止` : '任务已终止',
          };
        }
        return msg;
      }));

      setActiveSkillJobId(null);
      setActiveSkillJobType(null);
      setIsGenerating(false);
      pendingAssistantMessageIdRef.current = null;
      return;
    }

    if (generateAbortRef.current) {
      generateAbortRef.current.abort();
      generateAbortRef.current = null;
    }

    setIsGenerating(false);
    pendingAssistantMessageIdRef.current = null;
  };

  const extractMaterialRequests = (input: string): string[] => {
    const normalized = input.toLowerCase();
    const materialMatchers: Array<{ key: string; patterns: string[] }> = [
      { key: 'tshirt', patterns: ['t恤', 't-shirt', 'tshirt'] },
      { key: 'hoodie', patterns: ['卫衣', 'hoodie'] },
      { key: 'cap', patterns: ['帽子', '棒球帽', 'cap'] },
      { key: 'socks', patterns: ['袜子', 'socks'] },
      { key: 'tote_bag', patterns: ['帆布袋', 'tote', '包袋'] },
      { key: 'notebook', patterns: ['笔记本', 'notebook'] },
      { key: 'phone_case', patterns: ['手机壳', 'phone case'] },
      { key: 'mug', patterns: ['杯子', '马克杯', 'mug'] },
      { key: 'sticker_pack', patterns: ['贴纸', 'sticker'] },
      { key: 'lanyard', patterns: ['挂绳', 'lanyard'] },
      { key: 'keychain', patterns: ['钥匙扣', 'keychain'] },
      { key: 'mouse_pad', patterns: ['鼠标垫', 'mouse pad'] },
      { key: 'water_bottle', patterns: ['水壶', '水杯', 'bottle'] },
      { key: 'signage', patterns: ['导视', '标识牌', 'signage'] },
      { key: 'packaging_box', patterns: ['包装盒', 'box packaging', 'box'] },
    ];

    return materialMatchers
      .filter((item) => item.patterns.some((pattern) => normalized.includes(pattern)))
      .map((item) => item.key);
  };

  const extractUploadedLogoReferences = (): string[] => {
    const logoKeywordPattern = /(logo|标志|商标)/i;

    const byKeyword = [...chatMessages]
      .reverse()
      .find((msg) => msg.role === 'user' && msg.referenceImages?.length && logoKeywordPattern.test(msg.content || ''))
      ?.referenceImages || [];

    if (byKeyword.length > 0) {
      return [...byKeyword];
    }

    const latestUserImages = [...chatMessages]
      .reverse()
      .find((msg) => msg.role === 'user' && msg.referenceImages?.length)
      ?.referenceImages || [];

    return [...latestUserImages];
  };

  const findLatestMatch = (messages: ChatMessage[], pattern: RegExp): string | null => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const content = messages[i]?.content || '';
      const match = content.match(pattern);
      if (match?.[1]) {
        return match[1].trim();
      }
    }
    return null;
  };

  const resolveBrandIdentity = (currentInput: string): { brandName: string; industry: string } => {
    const brandInInput = currentInput.match(/(?:品牌名称?|品牌|名称)[:：]?\s*([^\n，,。；;]+)/i)?.[1]?.trim();
    const industryInInput = currentInput.match(/(?:行业|类型)[:：]?\s*([^\n，,。；;]+)/i)?.[1]?.trim();

    const brandFromUserHistory = findLatestMatch(chatMessages.filter((m) => m.role === 'user'), /(?:品牌名称?|品牌|名称)[:：]?\s*([^\n，,。；;]+)/i);
    const industryFromUserHistory = findLatestMatch(chatMessages.filter((m) => m.role === 'user'), /(?:行业|类型)[:：]?\s*([^\n，,。；;]+)/i);

    const brandFromAssistant = findLatestMatch(chatMessages.filter((m) => m.role === 'assistant'), /品牌名称[：:]\s*([^\n，,。；;]+)/i);
    const industryFromAssistant = findLatestMatch(chatMessages.filter((m) => m.role === 'assistant'), /行业[：:]\s*([^\n，,。；;]+)/i);

    return {
      brandName: brandInInput || brandFromUserHistory || brandFromAssistant || 'MyBrand',
      industry: industryInInput || industryFromUserHistory || industryFromAssistant || '消费品',
    };
  };

  const isNoiseAssistantMessage = (msg: ChatMessage): boolean => {
    const content = msg.content || '';
    if (!content.trim()) return true;
    if (msg.taskKey) return true;
    if (/^🎯|^🧩|^✅|^⚠️|^❌|^⏹️/.test(content)) return true;
    if (content.includes('已提交') || content.includes('生成中') || content.includes('生成失败') || content.includes('已终止')) return true;
    if (content.includes('"action"') || content.includes('"action_input"') || content.includes('"thought"')) return true;
    return false;
  };

  const extractStructuredBrandContext = (): { brandBrief: string; viGuide: string } => {
    const cleanAssistantMessages = chatMessages
      .filter((msg) => msg.role === 'assistant' && !isNoiseAssistantMessage(msg))
      .map((msg) => msg.content.trim())
      .filter(Boolean);

    const briefKeywords = ['行业心智解析', '品牌名语义解码', '品牌内核推演', '差异化定位'];
    const viKeywords = ['标志设计', '标准字体', '品牌色彩系统', '标识系统扩展'];

    let brandBrief = '';
    let viGuide = '';

    for (let i = cleanAssistantMessages.length - 1; i >= 0; i -= 1) {
      const content = cleanAssistantMessages[i];
      const briefHitCount = briefKeywords.filter((k) => content.includes(k)).length;
      const viHitCount = viKeywords.filter((k) => content.includes(k)).length;

      if (!brandBrief && briefHitCount >= 2) {
        brandBrief = content;
      }
      if (!viGuide && viHitCount >= 2) {
        viGuide = content;
      }
      if (brandBrief && viGuide) break;
    }

    if (!brandBrief && cleanAssistantMessages.length > 0) {
      brandBrief = cleanAssistantMessages[cleanAssistantMessages.length - 1];
    }
    if (!viGuide && cleanAssistantMessages.length > 1) {
      viGuide = cleanAssistantMessages[cleanAssistantMessages.length - 2];
    }

    return { brandBrief, viGuide };
  };

  const handleGenerate = async (options?: { input?: string; skill?: { id: string; label: string } | null }) => {
    const currentChatInput = options?.input ?? chatInput;
    if (!currentChatInput.trim()) return;

    const currentReferenceImages = [...chatReferenceImages];
    const currentSkill = options?.skill ?? activeSkill;
    const currentViewport = { ...viewport };
    const currentImageCount = imageCount;
    const uploadedLogoRefs = extractUploadedLogoReferences();
    const existingBrandLogoUrl = [...chatMessages]
      .reverse()
      .find((msg) => msg.imageUrl && msg.imageName === 'brand-logo')
      ?.imageUrl;
    const mergedBrandLogoReferences = Array.from(
      new Set([
        ...currentReferenceImages,
        ...uploadedLogoRefs,
        ...(existingBrandLogoUrl ? [existingBrandLogoUrl] : []),
      ])
    );
    
    if (isGenerating || activeSkillJobId) {
      const errorMessage: ChatMessage = {
        id: `msg-${Date.now()}-error`,
        role: 'assistant',
        content: '当前有任务正在执行，可点击发送按钮终止任务',
      };
      setChatMessages(prev => [...prev, errorMessage]);
      return;
    }
    
    const confirmPatterns = ['确认出图', '开始出图', '生成全部'];
    const normalizedInput = currentChatInput.trim().toLowerCase();
    const brandMaterialRequests = currentSkill?.id === 'brand' ? extractMaterialRequests(currentChatInput) : [];
    const isLogoConfirm =
      currentSkill?.id === 'logo' &&
      confirmPatterns.some((pattern) => normalizedInput.includes(pattern.toLowerCase()));
    const isBrandGenerate =
      currentSkill?.id === 'brand' &&
      (
        confirmPatterns.some((pattern) => normalizedInput.includes(pattern.toLowerCase())) ||
        brandMaterialRequests.length > 0
      );
    
    if (isLogoConfirm) {
      let brandName = 'MyBrand';
      let industry = '咖啡';
      
      const brandMatch = currentChatInput.match(/(?:品牌名称?|品牌|名称)[:：]?\s*(\S+)/i);
      if (brandMatch) brandName = brandMatch[1];
      
      const industryMatch = currentChatInput.match(/(?:行业|类型)[:：]?\s*(\S+)/i);
      if (industryMatch) industry = industryMatch[1];
      
      const brandNameInHistory = chatMessages.find(m => 
        m.role === 'assistant' && m.content && /品牌名称/i.test(m.content)
      );
      if (brandNameInHistory?.content) {
        const extractedBrand = brandNameInHistory.content.match(/品牌名称[：:]\s*(\S+)/);
        if (extractedBrand) brandName = extractedBrand[1];
      }
      
      const userMessageId = `msg-${Date.now()}`;
      const assistantPlaceholderId = `msg-${Date.now()}-assistant-pending`;
      pendingAssistantMessageIdRef.current = assistantPlaceholderId;
      setChatMessages(prev => [...prev, {
        id: userMessageId,
        role: 'user',
        content: currentChatInput,
        referenceImages: currentReferenceImages.length > 0 ? currentReferenceImages : undefined,
        skill: currentSkill,
      }, {
        id: assistantPlaceholderId,
        role: 'assistant',
        content: '...',
        taskStatus: 'running',
      }]);
      setChatInput('');
      setIsGenerating(true);
      setHasStartedChat(true);
      setChatReferenceImages([]);
      
      try {
        const response = await fetch('/api/skills/jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            skillType: 'logo',
            payload: { brandName, industry },
          }),
        });
        
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || 'Failed to create logo job');
        }
        
        const data = await response.json();
        processedSkillJobUrlsRef.current = new Set();
        setActiveSkillJobId(data.jobId);
        setActiveSkillJobType('logo');
        setActiveSkillJobStatus({
          completed: 0,
          failed: 0,
          total: data.total,
          items: data.items,
        });

        const placeholders: ChatMessage[] = (data.items || []).map((item: { key?: string; component?: string; name: string }) => {
          const itemKey = item.key || item.component || `item-${Math.random().toString(36).slice(2, 6)}`;
          const messageId = `msg-${Date.now()}-logo-${itemKey}-${Math.random().toString(36).slice(2, 6)}`;
          return {
            id: messageId,
            role: 'assistant',
            content: `${item.name} 生成中...`,
            imageName: item.name,
            model: 'gemini-3.1-flash-image-preview',
            taskKey: `logo:${itemKey}`,
            taskStatus: 'running',
          };
        });
        
        updatePendingAssistantMessage((msg) => ({
          ...msg,
          content: `🎨 已提交 ${data.total} 个 VI 素材到供应商（${industry} - ${brandName}），正在并发生成...`,
          taskStatus: 'running',
        }));
        setChatMessages(prev => [...prev, ...placeholders]);
      } catch (error) {
        updatePendingAssistantMessage((msg) => ({
          ...msg,
          content: `创建任务失败: ${error instanceof Error ? error.message : '未知错误'}`,
          taskStatus: 'failed',
        }));
        setIsGenerating(false);
        pendingAssistantMessageIdRef.current = null;
      }
      return;
    }

    if (isBrandGenerate) {
      const { brandName, industry } = resolveBrandIdentity(currentChatInput);
      const { brandBrief, viGuide } = extractStructuredBrandContext();

      const logoHint =
        mergedBrandLogoReferences.length > 0
          ? 'Follow the provided logo silhouette, line rhythm, and contrast hierarchy.'
          : 'No explicit logo uploaded. Keep a strong central logo-like motif consistent with the brand tone.';

      if (mergedBrandLogoReferences.length === 0) {
        const missingLogoMessage: ChatMessage = {
          id: `msg-${Date.now()}-brand-logo-required`,
          role: 'assistant',
          content: '请先上传一个 logo 参考图，再生成品牌物料。',
        };
        setChatMessages(prev => [...prev, missingLogoMessage]);
        return;
      }

      const userMessageId = `msg-${Date.now()}`;
      const assistantPlaceholderId = `msg-${Date.now()}-assistant-pending`;
      pendingAssistantMessageIdRef.current = assistantPlaceholderId;
      setChatMessages(prev => [...prev, {
        id: userMessageId,
        role: 'user',
        content: currentChatInput,
        referenceImages: currentReferenceImages.length > 0 ? currentReferenceImages : undefined,
        skill: currentSkill,
      }, {
        id: assistantPlaceholderId,
        role: 'assistant',
        content: '...',
        taskStatus: 'running',
      }]);
      setChatInput('');
      setIsGenerating(true);
      setHasStartedChat(true);
      setChatReferenceImages([]);

      try {
        const response = await fetch('/api/skills/jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            skillType: 'brand',
            payload: {
              brandName,
              industry,
              userRequirement: currentChatInput,
              materialRequests: brandMaterialRequests,
              logoReferenceImages: mergedBrandLogoReferences,
              brandBrief,
              viGuide,
              logoReferenceHint: logoHint,
            },
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || 'Failed to create brand job');
        }

        const data = await response.json();
        processedSkillJobUrlsRef.current = new Set();
        setActiveSkillJobId(data.jobId);
        setActiveSkillJobType('brand');
        setActiveSkillJobStatus({
          completed: 0,
          failed: 0,
          total: data.total,
          items: data.items,
        });

        const placeholders: ChatMessage[] = (data.items || []).map((item: { key?: string; component?: string; name: string }) => {
          const itemKey = item.key || item.component || `item-${Math.random().toString(36).slice(2, 6)}`;
          return {
            id: `msg-${Date.now()}-brand-${itemKey}-${Math.random().toString(36).slice(2, 6)}`,
            role: 'assistant',
            content: `${item.name} 生成中...`,
            imageName: item.name,
            model: 'gemini-3.1-flash-image-preview',
            taskKey: `brand:${itemKey}`,
            taskStatus: 'running',
          };
        });

        const isSpecificMaterial = brandMaterialRequests.length > 0;
        updatePendingAssistantMessage((msg) => ({
          ...msg,
          content: isSpecificMaterial
            ? `🎯 已提交 ${data.total} 个指定品牌物料任务（${industry} - ${brandName}），正在异步生成...`
            : `🧩 已提交品牌九宫格物料任务（${industry} - ${brandName}），正在异步生成...`,
          taskStatus: 'running',
        }));
        setChatMessages(prev => [...prev, ...placeholders]);
      } catch (error) {
        updatePendingAssistantMessage((msg) => ({
          ...msg,
          content: `创建任务失败: ${error instanceof Error ? error.message : '未知错误'}`,
          taskStatus: 'failed',
        }));
        setIsGenerating(false);
        pendingAssistantMessageIdRef.current = null;
      }
      return;
    }
    
    const userMessage: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: currentChatInput,
      referenceImages: currentReferenceImages.length > 0 ? currentReferenceImages : undefined,
      skill: currentSkill || undefined,
    };
    const assistantPlaceholderId = `msg-${Date.now()}-assistant-pending`;
    
    const messagesForAPI = chatMessages
      .filter(msg => msg.role === 'user' || msg.role === 'assistant')
      .map(msg => ({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.content || msg.imageUrl || ''
      }));
    messagesForAPI.push({ role: 'user', content: currentChatInput });
    
    pendingAssistantMessageIdRef.current = assistantPlaceholderId;
    setChatMessages(prev => [...prev, userMessage, {
      id: assistantPlaceholderId,
      role: 'assistant',
      content: '...',
      taskStatus: 'running',
    }]);
    setChatInput('');
    setIsGenerating(true);
    setHasStartedChat(true);
    setChatReferenceImages([]);

    try {
      const isBrandBootstrapPrompt =
        currentSkill?.id === 'brand' &&
        currentChatInput.includes('请按品牌识别系统流程开始信息收集');

      if (
        currentSkill?.id === 'brand' &&
        !isBrandBootstrapPrompt &&
        mergedBrandLogoReferences.length === 0
      ) {
        const brandMatch = currentChatInput.match(/(?:品牌名称?|品牌|名称)[:：]?\s*(\S+)/i);
        const industryMatch = currentChatInput.match(/(?:行业|类型)[:：]?\s*(\S+)/i);
        const brandName = brandMatch?.[1] || 'MyBrand';
        const industry = industryMatch?.[1] || '消费品';

        const logoPrompt = `${brandName} ${industry} 品牌logo设计，简洁现代，高识别度，矢量风格，白底，适合数字媒体与印刷`; 
        const bootstrapMessageId = `msg-${Date.now()}-brand-logo-bootstrap`;

        setChatMessages(prev => [...prev, {
          id: bootstrapMessageId,
          role: 'assistant',
          content: '品牌识别系统：未检测到 logo，正在为你生成基础 logo... ',
          taskStatus: 'running',
          model: 'gemini-3.1-flash-image-preview',
        }]);

        try {
          const logoResponse = await fetch('/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              messages: [{ role: 'user', content: logoPrompt }],
              size: '1024x1024',
              intent: 'image',
            }),
          });

          if (!logoResponse.ok) {
            const errorText = await logoResponse.text();
            throw new Error(errorText || `API Error: ${logoResponse.status}`);
          }

          const logoResult = await logoResponse.json();
          const logoData = logoResult?.result;
          const logoUrl = logoData?.localUrl || logoData?.data?.[0]?.url;
          if (!logoUrl) {
            throw new Error('未返回可用 logo 图片');
          }

          setImageCount((prev) => prev + 1);

          setChatMessages(prev => prev.flatMap((msg) => {
            if (msg.id !== bootstrapMessageId) return [msg];
            return [
              {
                ...msg,
                taskStatus: 'completed',
                content: `已生成基础 logo（${industry} - ${brandName}）`,
              },
              {
                id: `msg-${Date.now()}-brand-logo`,
                role: 'assistant',
                content: '',
                imageUrl: logoUrl,
                model: 'gemini-3.1-flash-image-preview',
                imageName: 'brand-logo',
              },
            ];
          }));

          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => {
            const aspectRatio = img.width / img.height;
            const width = 320;
            const height = 320 / aspectRatio;
            const newItem: CanvasItem = {
              id: `generated-${Date.now()}-brand-logo`,
              type: 'image',
              x: (-currentViewport.x / currentViewport.scale) + 120,
              y: (-currentViewport.y / currentViewport.scale) + 120,
              width,
              height,
              rotation: 0,
              src: logoUrl,
              visible: true,
              locked: false,
            };
            setItems(prev => [...prev, newItem]);
          };
          img.src = logoUrl;
        } catch (bootstrapError) {
          setChatMessages(prev => prev.map((msg) => {
            if (msg.id !== bootstrapMessageId) return msg;
            return {
              ...msg,
              taskStatus: 'failed',
              content: `基础 logo 生成失败: ${bootstrapError instanceof Error ? bootstrapError.message : '未知错误'}`,
            };
          }));
        }
      }

      const requestBody: Record<string, unknown> = {
        messages: messagesForAPI,
        intent: generationMode,
      };
      if (generationMode === 'image' && imageAspectRatio !== 'auto') {
        requestBody.aspect_ratio = imageAspectRatio;
      }

      if (currentSkill?.id === 'brand') {
        requestBody.intent = 'chat';
      }
      const shouldRequestStream = generationMode !== 'image' && currentReferenceImages.length === 0;
      if (shouldRequestStream) {
        requestBody.stream = true;
      }
      
      const referencesForRequest = currentSkill?.id === 'brand' ? mergedBrandLogoReferences : currentReferenceImages;
      if (referencesForRequest.length > 0) {
        requestBody.reference_images = referencesForRequest;
        requestBody.reference_labels = referencesForRequest.map((_, index) => `image${index + 1}`);
      }
      
      if (currentSkill) {
        requestBody.skill = currentSkill.id;
      }
      
      const controller = new AbortController();
      generateAbortRef.current = controller;

      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = `API Error: ${response.status} ${response.statusText}`;
        try {
          const errorData = JSON.parse(errorText) as { error?: string };
          if (errorData.error) {
            errorMessage = errorData.error;
          }
        } catch {
          if (errorText) {
            errorMessage = errorText;
          }
        }
        throw new Error(errorMessage);
      }

      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/x-ndjson') && response.body) {
        const assistantId = pendingAssistantMessageIdRef.current || `msg-${Date.now()}-assistant-stream`;
        stopStreamTypewriter();
        streamMessageIdRef.current = assistantId;
        updatePendingAssistantMessage((msg) => ({
          ...msg,
          content: '',
          model: 'gemini-3.1-flash-lite-preview-thinking-medium',
          taskStatus: 'running',
        }));

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        let doneReceived = false;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            let event: {
              type?: string;
              content?: string;
              channel?: 'content' | 'reasoning';
              model?: string;
              error?: string;
            };
            try {
              event = JSON.parse(trimmed) as {
                type?: string;
                content?: string;
                channel?: 'content' | 'reasoning';
                model?: string;
                error?: string;
              };
            } catch {
              continue;
            }

            if (event.type === 'start' && event.model) {
              setChatMessages(prev => prev.map((msg) => {
                if (msg.id !== assistantId) return msg;
                return { ...msg, model: event.model };
              }));
              continue;
            }

            if (event.type === 'delta' && event.content) {
              const channel = event.channel || 'content';
              if (channel === 'reasoning') {
                setChatMessages(prev => prev.map((msg) => {
                  if (msg.id !== assistantId) return msg;
                  return {
                    ...msg,
                    reasoningContent: `${msg.reasoningContent || ''}${event.content || ''}`,
                  };
                }));
              } else {
                enqueueStreamDelta(assistantId, event.content);
              }
              continue;
            }

            if (event.type === 'error') {
              throw new Error(event.error || '流式响应失败');
            }

            if (event.type === 'done') {
              doneReceived = true;
            }
          }
        }

        if (buffer.trim()) {
          try {
            const event = JSON.parse(buffer.trim()) as {
              type?: string;
              content?: string;
              channel?: 'content' | 'reasoning';
              error?: string;
            };
            if (event.type === 'delta' && event.content) {
              const channel = event.channel || 'content';
              if (channel === 'reasoning') {
                setChatMessages(prev => prev.map((msg) => {
                  if (msg.id !== assistantId) return msg;
                  return {
                    ...msg,
                    reasoningContent: `${msg.reasoningContent || ''}${event.content || ''}`,
                  };
                }));
              } else {
                enqueueStreamDelta(assistantId, event.content);
              }
            }
            if (event.type === 'error') {
              throw new Error(event.error || '流式响应失败');
            }
            if (event.type === 'done') {
              doneReceived = true;
            }
          } catch {
            // ignore malformed trailing chunk
          }
        }

        if (doneReceived) {
          await waitForStreamFlush();
        }

        flushStreamQueueNow(assistantId);

        let extractedChoice: SkillChoicePayload | null = null;
        setChatMessages(prev => prev.map((msg) => {
          if (msg.id !== assistantId) return msg;
          const processed = processAssistantContentWithChoice(msg.content, currentSkill?.id);
          extractedChoice = processed.skillChoice || null;
          return {
            ...msg,
            content: processed.content,
            taskStatus: undefined,
            skillChoice: processed.skillChoice,
            skillChoiceDismissed: false,
            skillChoiceResolved: false,
          };
        }));

        if (extractedChoice) {
          setPendingSkillChoice(extractedChoice);
          setShowSkillChoiceModal(true);
        }

        stopStreamTypewriter();

        return;
      }
      
      const result = await response.json();
      
      if (result.status === 'completed') {
        const data = result.result;
        
        if (data.type === 'chat') {
          const processed = processAssistantContentWithChoice(data.content, currentSkill?.id);
          updatePendingAssistantMessage((msg) => ({
            ...msg,
            content: processed.content,
            reasoningContent: data.reasoningContent,
            model: data.model,
            taskStatus: undefined,
            skillChoice: processed.skillChoice,
            skillChoiceDismissed: false,
            skillChoiceResolved: false,
          }));
          if (processed.skillChoice) {
            setPendingSkillChoice(processed.skillChoice);
            setShowSkillChoiceModal(true);
          }
        } else if (data.data && data.data.length > 0) {
          const imageUrl = data.localUrl || data.data[0].url;
          const newImageCount = currentImageCount + 1;
          setImageCount(newImageCount);
          
          updatePendingAssistantMessage((msg) => ({
            ...msg,
            content: '',
            imageUrl,
            model: data.model,
            imageName: `image ${newImageCount}`,
            taskStatus: undefined,
          }));
          
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => {
            const aspectRatio = img.width / img.height;
            let width = 400;
            let height = 400 / aspectRatio;
            
            const newItem: CanvasItem = {
              id: `generated-${Date.now()}`,
              type: 'image',
              x: (-currentViewport.x / currentViewport.scale) + 100,
              y: (-currentViewport.y / currentViewport.scale) + 100,
              width,
              height,
              rotation: 0,
              src: imageUrl,
              visible: true,
              locked: false,
            };
            setItems(prev => [...prev, newItem]);
            
            setTimeout(() => {
              chatContainerRef.current?.scrollTo({
                top: chatContainerRef.current.scrollHeight,
                behavior: 'smooth'
              });
            }, 100);
          };
          img.src = imageUrl;
        } else {
          updatePendingAssistantMessage((msg) => ({
            ...msg,
            content: '未收到有效响应，请重试',
            taskStatus: 'failed',
          }));
        }
        
      } else if (result.status === 'error') {
        updatePendingAssistantMessage((msg) => ({
          ...msg,
          content: result.error || '生成失败',
          taskStatus: 'failed',
        }));
      }
      
    } catch (error) {
      console.error('Generation failed:', error);

      if (error instanceof Error && error.name === 'AbortError') {
        updateActiveStreamMessageStatus('cancelled', '任务已终止');
        updatePendingAssistantMessage((msg) => ({
          ...msg,
          taskStatus: 'cancelled',
          content: '任务已终止',
        }));
        return;
      }

      updateActiveStreamMessageStatus('failed', '生成失败，请重试');
      updatePendingAssistantMessage((msg) => ({
        ...msg,
        taskStatus: 'failed',
        content: `生成失败: ${error instanceof Error ? error.message : '未知错误'}`,
      }));
    } finally {
      stopStreamTypewriter();
      generateAbortRef.current = null;
      setIsGenerating(false);
      if (!activeSkillJobId) {
        pendingAssistantMessageIdRef.current = null;
      }
    }
  };

  const openSkillChoiceModal = (choice: SkillChoicePayload) => {
    setPendingSkillChoice(choice);
    setShowSkillChoiceModal(true);
    setChatMessages((prev) => prev.map((msg) => {
      if (msg.skillChoice?.id !== choice.id) return msg;
      return { ...msg, skillChoiceDismissed: false };
    }));
  };

  const handleCloseSkillChoiceModal = () => {
    if (pendingSkillChoice) {
      setChatMessages((prev) => prev.map((msg) => {
        if (msg.skillChoice?.id !== pendingSkillChoice.id) return msg;
        return { ...msg, skillChoiceDismissed: true };
      }));
      const waitMessage: ChatMessage = {
        id: `msg-${Date.now()}-skill-choice-wait`,
        role: 'assistant',
        content: '已暂停，等待你的选择。你可以点击“重新选择”继续流程。',
      };
      setChatMessages((prev) => [...prev, waitMessage]);
    }
    setShowSkillChoiceModal(false);
  };

  const handleSubmitSkillChoice = (choice: SkillChoicePayload, option: SkillChoiceOption) => {
    processedSkillChoiceIdsRef.current.add(choice.id);
    setPendingSkillChoice(null);
    setShowSkillChoiceModal(false);
    setChatMessages((prev) => prev.map((msg) => {
      if (msg.skillChoice?.id !== choice.id) return msg;
      return {
        ...msg,
        skillChoiceResolved: true,
      };
    }));
    void handleGenerate({
      input: option.submitText,
      skill: activeSkill || { id: 'brand', label: '品牌识别系统' },
    });
  };

  const handleQuickSkillSelect = (
    action: { id: string; label: string },
    source: SkillSelectSource
  ) => {
    const selectedSkill = { id: action.id, label: action.label };
    setActiveSkillForCurrentTopic(selectedSkill);
    if (source === 'center_quick_action') {
      setHideWelcomeByCenterSkillPick(true);
    }

    if (source === 'center_quick_action' && !chatInput.trim()) {
      const prompt = SKILL_DEFAULT_PROMPTS[action.id];
      if (prompt) {
        setChatInput(prompt);
      }
    }
  };

  // 项目管理函数
  const getCurrentSession = () => sessions.find(s => s.id === currentSessionId);
  
  const currentProjectName = getCurrentSession()?.name || '新画布';

  // 对话项目管理函数
  const getCurrentTopic = () => {
    const session = getCurrentSession();
    if (!session || !session.topics) return null;
    return session.topics.find(t => t.id === session.activeTopicId) || null;
  };

  const inferTopicSkill = (topic: ChatTopic | null): { id: string; label: string } | null => {
    if (!topic) return null;
    if (topic.activeSkill) return topic.activeSkill;

    const messageWithSkill = [...topic.messages].reverse().find((m) => m.skill);
    return messageWithSkill?.skill || null;
  };

  const setActiveSkillForCurrentTopic = (skill: { id: string; label: string } | null) => {
    setActiveSkill(skill);
    if (!skill && chatMessages.length === 0) {
      setHideWelcomeByCenterSkillPick(false);
    }
    if (!currentSessionId) return;

    setSessions((prev) => prev.map((session) => {
      if (session.id !== currentSessionId || !session.topics || !session.activeTopicId) return session;
      return {
        ...session,
        updatedAt: Date.now(),
        topics: session.topics.map((topic) =>
          topic.id === session.activeTopicId ? { ...topic, activeSkill: skill } : topic
        ),
      };
    }));
  };

  const createNewTopic = () => {
    if (!currentSessionId) return;
    
    const newTopic: ChatTopic = {
      id: `topic-${Date.now()}`,
      title: '新对话',
      messages: [],
      activeSkill: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    
    setSessions(prev => prev.map(s => {
      if (s.id === currentSessionId) {
        const topics = s.topics || [];
        return {
          ...s,
          topics: [newTopic, ...topics],
          activeTopicId: newTopic.id,
          updatedAt: Date.now()
        };
      }
      return s;
    }));
    
    setChatMessages([]);
    setActiveSkill(null);
    setHideWelcomeByCenterSkillPick(false);
    setImageCount(0);
    setShowHistoryPanel(false);
  };

  const switchTopic = (topicId: string) => {
    const session = getCurrentSession();
    if (!session || !session.topics) return;
    
    const topic = session.topics.find(t => t.id === topicId);
    if (!topic) return;
    
    setSessions(prev => prev.map(s => {
      if (s.id === currentSessionId) {
        return { ...s, activeTopicId: topicId };
      }
      return s;
    }));
    
    setChatMessages(topic.messages);
    setActiveSkill(inferTopicSkill(topic));
    if (topic.messages.length === 0) {
      setHideWelcomeByCenterSkillPick(false);
    }
    setImageCount(topic.messages.filter(m => m.imageName).length);
    setShowHistoryPanel(false);
  };

  const deleteTopic = (topicId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('确定要删除这个对话吗？')) return;
    
    setSessions(prev => prev.map(s => {
      if (s.id === currentSessionId && s.topics) {
        const newTopics = s.topics.filter(t => t.id !== topicId);
        let nextActiveId = s.activeTopicId;
        
        if (s.activeTopicId === topicId) {
          nextActiveId = newTopics.length > 0 ? newTopics[0].id : '';
        }
        
        return {
          ...s,
          topics: newTopics,
          activeTopicId: nextActiveId
        };
      }
      return s;
    }));
    
    // 如果删除的是当前活跃的对话，需要刷新聊天框
    const session = getCurrentSession();
    if (session && session.activeTopicId === topicId) {
      const newTopics = (session.topics || []).filter(t => t.id !== topicId);
      if (newTopics.length > 0) {
        setChatMessages(newTopics[0].messages);
        setActiveSkill(inferTopicSkill(newTopics[0]));
        if (newTopics[0].messages.length === 0) {
          setHideWelcomeByCenterSkillPick(false);
        }
      } else {
        setChatMessages([]);
        setActiveSkill(null);
        setHideWelcomeByCenterSkillPick(false);
      }
    }
  };

  const saveCurrentSession = () => {
    if (!currentSessionId) return;
    setSessions(prev => prev.map(s => {
      if (s.id === currentSessionId) {
        // 更新当前活跃的 Topic
        let topics = s.topics || [];
        const activeId = s.activeTopicId;
        
        if (activeId) {
          topics = topics.map(t => {
            if (t.id === activeId) {
              // 自动命名：如果是新对话且有了第一条消息
              let title = t.title;
              if ((title === '新对话' || !title) && chatMessages.length > 0) {
                title = chatMessages[0].content.substring(0, 20) || '对话项目';
              }
              return {
                ...t,
                title,
                messages: chatMessages,
                activeSkill: activeSkill || null,
                updatedAt: Date.now()
              };
            }
            return t;
          });
        }

        return {
          ...s,
          updatedAt: Date.now(),
          items,
          messages: chatMessages, // 兼容旧版
          topics,
          activeTopicId: activeId,
          viewport,
        };
      }
      return s;
    }));
  };

  const loadSession = (sessionId: string) => {
    const session = sessions.find(s => s.id === sessionId);
    if (!session) return;
    
    // 数据迁移逻辑：如果 session 有旧消息但没有 topics，创建一个新的 topic
    let finalTopics = session.topics || [];
    let finalActiveId = session.activeTopicId || '';
    
    if (finalTopics.length === 0 && session.messages && session.messages.length > 0) {
      const initialTopic: ChatTopic = {
        id: `topic-initial-${Date.now()}`,
        title: session.messages[0].content.substring(0, 20) || '初始对话',
        messages: session.messages,
        activeSkill: null,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt
      };
      finalTopics = [initialTopic];
      finalActiveId = initialTopic.id;
    } else if (finalTopics.length === 0) {
      // 没有任何消息的空画布
      const emptyTopic: ChatTopic = {
        id: `topic-empty-${Date.now()}`,
        title: '新对话',
        messages: [],
        activeSkill: null,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      finalTopics = [emptyTopic];
      finalActiveId = emptyTopic.id;
    }
    
    setItems(session.items || []);
    // 加载当前活跃对话的消息
    const activeTopic = finalTopics.find(t => t.id === finalActiveId) || finalTopics[0];
    setChatMessages(activeTopic ? activeTopic.messages : []);
    setActiveSkill(inferTopicSkill(activeTopic || null));
    if (!activeTopic || activeTopic.messages.length === 0) {
      setHideWelcomeByCenterSkillPick(false);
    }
    
    setViewport(session.viewport || { x: 0, y: 0, scale: 1 });
    setCurrentSessionId(sessionId);
    setImageCount(activeTopic ? activeTopic.messages.filter(m => m.imageName).length : 0);
    setShowProjectMenu(false);
    setShowHistoryPanel(false);
  };

  const createNewProject = () => {
    const newTopic: ChatTopic = {
      id: `topic-${Date.now()}`,
      title: '新对话',
      messages: [],
      activeSkill: null,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    
    const newSession: ProjectSession = {
      id: `session-${Date.now()}`,
      name: `新画布 ${sessions.length + 1}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      items: [],
      messages: [],
      topics: [newTopic],
      activeTopicId: newTopic.id,
      viewport: { x: 0, y: 0, scale: 1 },
    };
    
    setSessions(prev => [newSession, ...prev]);
    setCurrentSessionId(newSession.id);
    setItems([]);
    setChatMessages([]);
    setActiveSkill(null);
    setHideWelcomeByCenterSkillPick(false);
    setViewport({ x: 0, y: 0, scale: 1 });
    setImageCount(0);
    setShowProjectMenu(false);
    setShowHistoryPanel(false);
  };

  const renameSession = (sessionId: string, newName: string) => {
    const trimmedName = newName.trim();
    if (!trimmedName) {
      setEditingSessionId(null);
      return;
    }
    setSessions(prev => prev.map(s => 
      s.id === sessionId ? { ...s, name: trimmedName, updatedAt: Date.now() } : s
    ));
    setEditingSessionId(null);
  };

  const deleteSession = (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('确定要删除这个画布吗？')) return;
    
    const newSessions = sessions.filter(s => s.id !== sessionId);
    setSessions(newSessions);
    
    // 如果有删除数据库的函数可以调用，例如 deleteSessionFromDB
    // 这里确保数据持久化
    import('./lib/db').then(db => {
      db.deleteSessionFromDB(sessionId).catch(console.error);
    });
    
    if (sessionId === currentSessionId) {
      if (newSessions.length > 0) {
        loadSession(newSessions[0].id);
      } else {
        createNewProject();
      }
    }
  };

  // 初始化：加载或创建项目
  useEffect(() => {
    const initProject = async () => {
      const savedSessions = await loadSessions();
      
      if (savedSessions && savedSessions.length > 0) {
        setSessions(savedSessions);
        
        const urlParams = new URLSearchParams(window.location.search);
        const workspaceId = urlParams.get('workspace');
        
        if (!workspaceId) {
          setViewMode('gallery');
          return;
        }
        
        setViewMode('editor');
        const targetSession = savedSessions.find(s => s.id === workspaceId) || savedSessions[0];
        const targetTopics = targetSession.topics || [];
        const targetActiveTopic = targetTopics.find((t) => t.id === targetSession.activeTopicId) || targetTopics[0] || null;
        
        setCurrentSessionId(targetSession.id);
        setItems(targetSession.items || []);
        setChatMessages(targetActiveTopic ? targetActiveTopic.messages : (targetSession.messages || []));
        setActiveSkill(inferTopicSkill(targetActiveTopic));
        if (!targetActiveTopic || targetActiveTopic.messages.length === 0) {
          setHideWelcomeByCenterSkillPick(false);
        }
        setViewport(targetSession.viewport || { x: 0, y: 0, scale: 1 });
        setImageCount((targetActiveTopic ? targetActiveTopic.messages : (targetSession.messages || [])).filter((m: ChatMessage) => m.imageName).length || 0);
      } else {
        createNewProject();
      }
    };
    
    initProject();
  }, []);

  // 自动保存到 IndexedDB
  useEffect(() => {
    if (sessions.length > 0 && currentSessionId) {
      saveSessions(sessions).catch(err => {
        console.error('Failed to save sessions:', err);
      });
    }
  }, [sessions, currentSessionId]);

  // 监听状态变化并保存当前会话
  useEffect(() => {
    if (currentSessionId) {
      saveCurrentSession();
    }
  }, [items, chatMessages, viewport, imageCount, activeSkill]);

  const enterEditor = (sessionId: string) => {
    const session = sessions.find(s => s.id === sessionId);
    if (session) {
      const targetTopics = session.topics || [];
      const targetActiveTopic = targetTopics.find((t) => t.id === session.activeTopicId) || targetTopics[0] || null;

      setCurrentSessionId(sessionId);
      setItems(session.items || []);
      setChatMessages(targetActiveTopic ? targetActiveTopic.messages : (session.messages || []));
      setActiveSkill(inferTopicSkill(targetActiveTopic));
      if (!targetActiveTopic || targetActiveTopic.messages.length === 0) {
        setHideWelcomeByCenterSkillPick(false);
      }
      setViewport(session.viewport || { x: 0, y: 0, scale: 1 });
      setImageCount((targetActiveTopic ? targetActiveTopic.messages : (session.messages || [])).filter((m: ChatMessage) => m.imageName).length || 0);
      setViewMode('editor');
      window.history.pushState({}, '', `/?workspace=${sessionId}`);
    }
  };

  const handleToolClick = (toolId: string) => {
    if (toolId === 'image') {
      fileInputRef.current?.click();
    } else if (toolId === 'text') {
      addText();
    } else if (toolId === 'rectangle') {
      addShape('rectangle');
    } else {
      setTool(toolId as Tool);
    }
  };

  useEffect(() => {
    return () => {
      detachConnectionWindowListeners();
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.code === 'Space') {
        e.preventDefault();
        setIsSpacePressed(true);
        return;
      }

      if (e.key === 'Escape') {
        if (connectionSessionRef.current) {
          resetConnectionInteraction();
          return;
        }
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedIds.length > 0 || selectedConnectionIds.length > 0) {
          const idsToDelete = [...selectedIds];
          const connectionIdsToDelete = new Set(selectedConnectionIds);
          setItems(prev => prev.filter(item => !idsToDelete.includes(item.id)));
          setConnections((prev) =>
            prev.filter(
              (connection) =>
                !connectionIdsToDelete.has(connection.id) &&
                !idsToDelete.includes(connection.fromItemId) &&
                !idsToDelete.includes(connection.toItemId)
            )
          );
          setSelectedIds([]);
          setSelectedId(null);
          setSelectedConnectionIds([]);
          return;
        }

        if (selectedId) deleteItem(selectedId);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        setIsSpacePressed(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [selectedId, selectedIds, connectionPointerId, selectedConnectionIds]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (editingSessionId) return;
      const now = Date.now();
      const selectionSession = assistantTextSelectionRef.current;
      const targetNode = e.target as Node | null;
      if (
        now < selectionSession.suppressOutsideClickUntil ||
        (isNodeInsideAssistantSelectable(targetNode) &&
          (selectionSession.startedInAssistant || hasActiveAssistantTextSelection()))
      ) {
        return;
      }
      if (projectMenuRef.current && !projectMenuRef.current.contains(e.target as Node)) {
        setShowProjectMenu(false);
      }
      if (generationModeMenuRef.current && !generationModeMenuRef.current.contains(e.target as Node)) {
        setShowGenerationModeMenu(false);
      }
      if (skillsMenuRef.current && !skillsMenuRef.current.contains(e.target as Node)) {
        setShowSkillsMenu(false);
      }
      if (aspectRatioMenuRef.current && !aspectRatioMenuRef.current.contains(e.target as Node)) {
        setShowAspectRatioMenu(false);
      }
      setShowAvatarMenu(false);
      setShowHistoryPanel(false);
    };
    if (showAvatarMenu || showProjectMenu || showHistoryPanel || showGenerationModeMenu || showSkillsMenu || showAspectRatioMenu) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [showAvatarMenu, showProjectMenu, showHistoryPanel, showGenerationModeMenu, showSkillsMenu, showAspectRatioMenu, editingSessionId]);

  useEffect(() => {
    const handleSelectionChange = () => {
      const hasSelection = hasActiveAssistantTextSelection();
      assistantTextSelectionRef.current.hasSelection = hasSelection;

      if (hasSelection) {
        assistantTextSelectionRef.current.startedInAssistant = true;
        assistantTextSelectionRef.current.suppressOutsideClickUntil = Date.now() + 250;
        return;
      }

      assistantTextSelectionRef.current.startedInAssistant = false;
      assistantTextSelectionRef.current.suppressOutsideClickUntil = 0;
    };

    const handlePointerEnd = () => {
      assistantTextSelectionRef.current.isPointerDown = false;
      if (hasActiveAssistantTextSelection()) {
        assistantTextSelectionRef.current.hasSelection = true;
        assistantTextSelectionRef.current.startedInAssistant = true;
        assistantTextSelectionRef.current.suppressOutsideClickUntil = Date.now() + 300;
        return;
      }

      assistantTextSelectionRef.current.hasSelection = false;
      assistantTextSelectionRef.current.startedInAssistant = false;
      assistantTextSelectionRef.current.suppressOutsideClickUntil = 0;
    };

    document.addEventListener('selectionchange', handleSelectionChange);
    window.addEventListener('pointerup', handlePointerEnd);
    window.addEventListener('pointercancel', handlePointerEnd);

    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange);
      window.removeEventListener('pointerup', handlePointerEnd);
      window.removeEventListener('pointercancel', handlePointerEnd);
    };
  }, []);

  useEffect(() => {
    const container = chatContainerRef.current;
    if (container) {
      setTimeout(() => {
        container.scrollTo({
          top: container.scrollHeight,
          behavior: 'smooth'
        });
      }, 150);
    }
  }, [chatMessages]);

  useEffect(() => {
    syncEditorTextFromState(chatInput);
  }, [chatInput]);

  useEffect(() => {
    syncEditorTextFromState(chatInput, true);
  }, [activeSkill?.id]);

  useEffect(() => {
    if (!activeSkillJobId) return;

    let stopped = false;
    let pollCount = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const pollOnce = async () => {
      if (stopped) return;

      try {
        const response = await fetch(`/api/skills/jobs?jobId=${activeSkillJobId}&t=${Date.now()}`, {
          cache: 'no-store',
        });
        if (!response.ok) {
          if (response.status === 404) {
            stopped = true;
            const errorPayload = await response.json().catch(() => ({}));
            const reason = typeof errorPayload?.error === 'string' ? errorPayload.error : '任务不存在';
            updatePendingAssistantMessage((msg) => ({
              ...msg,
              content: `⚠️ 任务状态丢失（${reason}），请重新发起一次出图。`,
              taskStatus: 'failed',
            }));
            setActiveSkillJobId(null);
            setActiveSkillJobType(null);
            setIsGenerating(false);
            pendingAssistantMessageIdRef.current = null;
            return;
          }
          const nextDelay = pollCount < 10 ? 2000 : 5000;
          pollCount += 1;
          timer = setTimeout(pollOnce, nextDelay);
          return;
        }
        
        const data = await response.json();
        setActiveSkillJobStatus({
          completed: data.completed,
          failed: data.failed,
          total: data.total,
          items: data.items,
        });

        const skillPrefix = `${activeSkillJobType || 'logo'}:`;
        const skillLabel = activeSkillJobType === 'brand' ? '品牌物料' : 'VI 素材';

        setChatMessages((prev) => prev.map((msg) => {
          if (!msg.taskKey?.startsWith(skillPrefix)) return msg;
          const key = msg.taskKey.replace(skillPrefix, '');
          const item = data.items.find((entry: { key?: string; component?: string }) => (entry.key || entry.component) === key);
          if (!item) return msg;

          if (item.status === 'completed' && item.localUrl) {
            return {
              ...msg,
              content: '',
              imageUrl: item.localUrl,
              taskStatus: 'completed',
              model: 'gemini-3.1-flash-image-preview',
            };
          }

          if (item.status === 'failed') {
            return {
              ...msg,
              content: `${item.name} 生成失败${item.error ? `: ${item.error}` : ''}`,
              taskStatus: 'failed',
            };
          }

          if (item.status === 'cancelled') {
            return {
              ...msg,
              content: `${item.name} 已终止`,
              taskStatus: 'cancelled',
            };
          }

          return {
            ...msg,
            content: `${item.name} 生成中...`,
            taskStatus: item.status === 'queued' ? 'queued' : 'running',
          };
        }));

        const completedItems = data.items.filter(
          (item: { key?: string; component?: string; status: string; localUrl?: string }) => item.status === 'completed' && item.localUrl
        );

        completedItems.forEach((item: { key?: string; component?: string; localUrl: string }) => {
          const itemKey = item.key || item.component || 'logo-item';
          if (processedSkillJobUrlsRef.current.has(item.localUrl)) return;
          processedSkillJobUrlsRef.current.add(item.localUrl);

          setImageCount((prev) => prev + 1);

          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => {
            const aspectRatio = img.width / img.height;
            const width = 300;
            const height = 300 / aspectRatio;
            const offset = processedSkillJobUrlsRef.current.size * 30;

            const newItem: CanvasItem = {
              id: `generated-${Date.now()}-${itemKey}`,
              type: 'image',
              x: (-viewport.x / viewport.scale) + 100 + offset,
              y: (-viewport.y / viewport.scale) + 100 + offset,
              width,
              height,
              rotation: 0,
              src: item.localUrl,
              visible: true,
              locked: false,
            };
            setItems(prev => [...prev, newItem]);
          };
          img.src = item.localUrl;
        });
        
        if (data.status === 'completed' || data.status === 'failed' || data.status === 'partial' || data.status === 'cancelled') {
          stopped = true;
          
          let summaryText = '';
          if (data.status === 'completed') {
            summaryText = `✅ 全部 ${data.total} 个${skillLabel}已生成完成！`;
          } else if (data.status === 'partial') {
            summaryText = `⚠️ 已完成 ${data.completed} 个，失败 ${data.failed} 个`;
          } else if (data.status === 'cancelled') {
            summaryText = `⏹️ 任务已终止，已完成 ${data.completed} 个`;
          } else {
            summaryText = `❌ 生成失败，请重试`;
          }
          
          updatePendingAssistantMessage((msg) => ({
            ...msg,
            content: summaryText,
            taskStatus: data.status === 'failed' ? 'failed' : data.status === 'cancelled' ? 'cancelled' : 'completed',
          }));
          setActiveSkillJobId(null);
          setActiveSkillJobType(null);
          setIsGenerating(false);
          pendingAssistantMessageIdRef.current = null;
          return;
        }
        const nextDelay = pollCount < 10 ? 2000 : 5000;
        pollCount += 1;
        timer = setTimeout(pollOnce, nextDelay);
      } catch (error) {
        console.error('Skill job polling error:', error);
        const nextDelay = pollCount < 10 ? 2000 : 5000;
        pollCount += 1;
        timer = setTimeout(pollOnce, nextDelay);
      }
    };

    pollOnce();

    return () => {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [activeSkillJobId, activeSkillJobType]);

  if (viewMode === 'gallery') {
    return <GalleryView 
      sessions={sessions} 
      onEnterEditor={enterEditor} 
      onCreateNew={() => createNewProject()} 
      onBack={() => {}} 
      onDeleteSession={(id, e) => deleteSession(id, e)}
      editingSessionId={editingSessionId}
      editingName={editingName}
      onStartEdit={(sessionId, name, e) => {
        e.stopPropagation();
        setEditingSessionId(sessionId);
        setEditingName(name);
      }}
      onEditNameChange={(value) => setEditingName(value)}
      onEditNameSubmit={(sessionId, name) => renameSession(sessionId, name)}
      onCancelEdit={() => {
        setEditingSessionId(null);
        setEditingName('');
      }}
    />;
  }

  return (
    <div className="relative isolate flex h-screen w-full overflow-hidden bg-[#050608] text-zinc-100">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleFileUpload}
      />

      {/* Floating Toolbar - Left Side */}
      <div className="absolute left-4 top-1/2 z-[120] -translate-y-1/2">
        <div className="flex flex-col gap-1 rounded-[24px] border border-white/10 bg-[rgba(16,18,22,0.86)] p-2 shadow-[0_24px_60px_rgba(0,0,0,0.38)] backdrop-blur-xl">
          {tools.map((t) => (
            <button
              key={t.id}
              onClick={() => handleToolClick(t.id)}
              className={`flex h-12 w-12 items-center justify-center rounded-xl transition-all ${
                tool === t.id 
                  ? 'bg-[rgba(255,255,255,0.12)] text-zinc-50 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]' 
                  : 'text-zinc-500 hover:bg-white/8 hover:text-zinc-200'
              }`}
              title={t.label}
            >
              <t.icon size={20} />
            </button>
          ))}
        </div>
      </div>

      {/* Canvas Avatar & Project Menu - Top Left */}
      <div className="absolute left-[34px] top-4 z-[120] flex items-center gap-2">
        <div className="relative">
          <button 
            className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-[rgba(18,20,24,0.94)] text-sm font-medium text-zinc-100 shadow-[0_12px_28px_rgba(0,0,0,0.28)] transition-colors hover:bg-[rgba(30,33,40,0.96)]"
            onClick={(e) => { 
              e.stopPropagation(); 
              setViewMode('gallery');
              window.history.pushState({}, '', '/');
            }}
          >
            L
          </button>
          {showAvatarMenu && (
            <div className="absolute left-0 top-12 z-[130] w-48 rounded-2xl border border-white/10 bg-[rgba(18,20,24,0.98)] py-2 shadow-[0_24px_70px_rgba(0,0,0,0.45)] backdrop-blur-xl">
              <button className="w-full px-4 py-2 text-left text-sm text-zinc-300 hover:bg-white/8">个人资料</button>
              <button className="w-full px-4 py-2 text-left text-sm text-zinc-300 hover:bg-white/8">设置</button>
              <hr className="my-2 border-white/8" />
              <button className="w-full px-4 py-2 text-left text-sm text-zinc-300 hover:bg-white/8">退出登录</button>
            </div>
          )}
        </div>

        {/* Project Name Dropdown */}
        <div className="relative" ref={projectMenuRef}>
          <button 
            onClick={(e) => { e.stopPropagation(); setShowProjectMenu(!showProjectMenu); }}
            className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-[rgba(18,20,24,0.94)] px-3 py-2 text-zinc-100 shadow-[0_12px_30px_rgba(0,0,0,0.25)] transition-colors hover:bg-[rgba(31,34,41,0.98)]"
          >
            <span className="max-w-[120px] truncate text-sm font-medium text-zinc-100">{currentProjectName}</span>
            <ChevronDown size={14} className="flex-shrink-0 text-zinc-500" />
          </button>

          {showProjectMenu && (
            <div className="absolute left-0 top-12 z-[130] w-64 overflow-hidden rounded-2xl border border-white/10 bg-[rgba(18,20,24,0.98)] shadow-[0_30px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl">
              <div className="p-2">
                <button 
                  onClick={(e) => { e.stopPropagation(); createNewProject(); }}
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-zinc-200 transition-colors hover:bg-white/8"
                >
                  <span className="text-lg">+</span>
                  <span>新建画布</span>
                </button>
              </div>
              <div className="panel-scrollbar max-h-64 overflow-y-auto border-t border-white/8">
                {sessions.map(session => (
                  <div 
                    key={session.id}
                    onClick={(e) => { e.stopPropagation(); loadSession(session.id); }}
                    className={`group relative flex cursor-pointer items-center gap-2 px-4 py-3 transition-colors hover:bg-white/6 ${
                      session.id === currentSessionId ? 'bg-white/8' : ''
                    }`}
                  >
                    {editingSessionId === session.id ? (
                      <input
                        autoFocus
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onBlur={() => renameSession(session.id, editingName)}
                        onKeyDown={(e) => { if (e.key === 'Enter') renameSession(session.id, editingName); }}
                        onClick={(e) => e.stopPropagation()}
                        className="flex-1 rounded-lg border border-white/10 bg-[rgba(10,12,16,0.92)] px-2 py-1 text-sm text-zinc-100 focus:outline-none focus:border-white/20"
                      />
                    ) : (
                      <>
                        <div className="flex-1 min-w-0">
                          <div className="truncate text-sm font-medium text-zinc-100">{session.name}</div>
                          <div className="text-xs text-zinc-500">
                            {session.messages.length} 条对话 · {new Date(session.updatedAt).toLocaleDateString()}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => { e.stopPropagation(); setEditingSessionId(session.id); setEditingName(session.name); }}
                          className="rounded-lg p-1.5 transition-colors hover:bg-white/10"
                          title="重命名"
                        >
                          <Edit3 size={12} className="text-zinc-500" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteSession(session.id, e); }}
                          className="p-1.5 hover:bg-red-50 rounded-lg transition-colors"
                          title="删除"
                        >
                          <Trash2 size={12} className="text-red-500" />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
            </div>
          )}
        </div>
      </div>

      {/* Main Canvas Area */}
      <div 
        ref={canvasRef}
        data-canvas="true"
        tabIndex={0}
        className={`relative z-0 shrink-0 overflow-hidden select-none ${isSpacePressed ? (isPanning ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-default'}`}
        style={{ 
          width: sidebarCollapsed ? '100%' : 'calc(100% - 500px)',
          backgroundColor: DARK_THEME.appBg,
          backgroundImage: `radial-gradient(${DARK_THEME.canvasDot} 0.9px, transparent 0.9px)`,
          backgroundSize: `${20 * viewport.scale}px ${20 * viewport.scale}px`,
          backgroundPosition: `${viewport.x}px ${viewport.y}px`,
        }}
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handleCanvasPointerMove}
        onPointerUp={handleCanvasPointerUp}
        onPointerCancel={handleCanvasPointerUp}
        onWheel={handleWheel}
        onPaste={handleCanvasPaste}
      >
        {(() => {
          const { from, to } = getPreviewRenderPoints();
          const canvasRect = canvasRef.current?.getBoundingClientRect();
          const svgWidth = canvasRect?.width ?? 0;
          const svgHeight = canvasRect?.height ?? 0;
          const scaledPortIconSize = Math.min(Math.max(PORT_ICON_SIZE * viewport.scale, 28), 76);
          const scaledPortProximitySize = Math.min(Math.max(PORT_PROXIMITY_SIZE * viewport.scale, 56), 81);
          const scaledPortGlyphSize = Math.min(Math.max(scaledPortIconSize * 0.3, 10), 30);
          const showConnectionTestLine = DEBUG_CANVAS_CONNECTIONS && !from;
          return (
            <>
        <svg
          className="pointer-events-none absolute inset-0 z-[80] h-full w-full overflow-hidden"
          width={svgWidth}
          height={svgHeight}
          viewBox={`0 0 ${Math.max(svgWidth, 1)} ${Math.max(svgHeight, 1)}`}
          preserveAspectRatio="none"
        >
          {connections.map((connection) => {
            const fromItem = items.find((item) => item.id === connection.fromItemId);
            const toItem = items.find((item) => item.id === connection.toItemId);
            if (!fromItem || !toItem) return null;
            const connectionFrom = toCanvasScreenPoint(getPortCanvasPoint(fromItem, 'right'));
            const connectionTo = toCanvasScreenPoint(getPortCanvasPoint(toItem, 'left'));
            const isSelectedConnection = selectedConnectionIds.includes(connection.id);
            return (
              <g key={connection.id}>
                <path
                  d={buildConnectionPath(connectionFrom, connectionTo)}
                  fill="none"
                  stroke="transparent"
                  strokeWidth="20"
                  strokeLinecap="round"
                  className="pointer-events-auto cursor-pointer"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (connectionSessionRef.current) {
                      resetConnectionInteraction();
                    }
                    if (e.shiftKey) {
                      setSelectedConnectionIds((prev) => toggleSelectionId(prev, connection.id));
                      return;
                    }
                    setSelectedConnectionIds([connection.id]);
                    setSelectedId(null);
                    setSelectedIds([]);
                  }}
                />
                <path
                  d={buildConnectionPath(connectionFrom, connectionTo)}
                  fill="none"
                  stroke={DARK_THEME.canvasLine}
                  strokeOpacity={isSelectedConnection ? 0.98 : 0.9}
                  strokeWidth={isSelectedConnection ? 5 : 4}
                  strokeLinecap="round"
                  pointerEvents="none"
                />
              </g>
            );
          })}
          {showConnectionTestLine && (
            <line
              x1={40}
              y1={40}
              x2={220}
              y2={120}
              stroke="#2563eb"
              strokeWidth={3}
              strokeOpacity={1}
              strokeLinecap="round"
            />
          )}
          {from && to && (
            <path
              d={buildConnectionPath(from, to)}
              fill="none"
              stroke={DARK_THEME.canvasLine}
              strokeOpacity="0.9"
              strokeWidth="4"
              strokeLinecap="round"
              pointerEvents="none"
            />
          )}
        </svg>
        <div className="absolute inset-0 z-[90] pointer-events-none">
          {items.map((item) => {
            const isHoveredItem = hoveredCanvasItemId === item.id;
            const isHoveredInputPort = hoveredInputPortItemId === item.id;
            const isHoveredOutputPort = hoveredOutputPortItemId === item.id;
            const isConnectionSource = connectionSessionRef.current?.fromItemId === item.id;
            const isNearPort = isHoveredInputPort || isHoveredOutputPort;
            const showOutputPort =
              isHoveredItem || isNearPort || isConnectionSource;
            const showInputPort =
              isHoveredItem || isNearPort || (connectionMode === 'dragging' && connectionSnapTargetId === item.id);
            const inputPoint = getPortOverlayPoint(item, 'left');
            const outputPoint = getPortOverlayPoint(item, 'right');

            return (
              <React.Fragment key={`port-overlay-${item.id}`}>
                <div
                  data-port-bridge="in"
                  data-item-id={item.id}
                  onPointerEnter={() => {
                    setHoveredInputPortItemId(item.id);
                  }}
                  onPointerLeave={() => {
                    if (connectionMode === 'dragging' && connectionSnapTargetId === item.id) return;
                    setHoveredInputPortItemId((prev) => (prev === item.id ? null : prev));
                  }}
                  className="absolute -translate-x-1/2 -translate-y-1/2 bg-transparent pointer-events-auto"
                  style={{
                    left: inputPoint.x,
                    top: inputPoint.y,
                    width: scaledPortProximitySize,
                    height: scaledPortProximitySize,
                  }}
                />
                <div
                  data-port="in"
                  data-item-id={item.id}
                  className={`absolute -translate-x-1/2 -translate-y-1/2 pointer-events-none transition-opacity duration-150 ${
                    showInputPort ? 'opacity-100' : 'opacity-0'
                  }`}
                  style={{
                    left: inputPoint.x,
                    top: inputPoint.y,
                    width: scaledPortIconSize,
                    height: scaledPortIconSize,
                  }}
                >
                  <ConnectionPortIcon className="h-full w-full" glyphSize={scaledPortGlyphSize} />
                </div>
                <div
                  data-port-bridge="out"
                  data-item-id={item.id}
                  onPointerEnter={() => {
                    setHoveredOutputPortItemId(item.id);
                  }}
                  onPointerLeave={() => {
                    if (connectionSessionRef.current?.fromItemId === item.id) return;
                    setHoveredOutputPortItemId((prev) => (prev === item.id ? null : prev));
                  }}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    e.preventDefault();
                    e.stopPropagation();
                    debugCanvasConnection('out-bridge-pointerdown', {
                      itemId: item.id,
                      pointerId: e.pointerId,
                      connectionMode,
                      hoveredOutputPortItemId,
                      showOutputPort,
                    });
                    beginConnectionDragFromItem(item, e.pointerId, 'bridge');
                  }}
                  className="absolute -translate-x-1/2 -translate-y-1/2 bg-transparent pointer-events-auto"
                  style={{
                    left: outputPoint.x,
                    top: outputPoint.y,
                    width: scaledPortProximitySize,
                    height: scaledPortProximitySize,
                  }}
                />
                <button
                  type="button"
                  data-port="out"
                  data-item-id={item.id}
                  onPointerEnter={() => {
                    setHoveredOutputPortItemId(item.id);
                  }}
                  onPointerLeave={() => {
                    if (connectionSessionRef.current?.fromItemId === item.id) return;
                    setHoveredOutputPortItemId((prev) => (prev === item.id ? null : prev));
                  }}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    e.preventDefault();
                    e.stopPropagation();
                    debugCanvasConnection('out-button-pointerdown', {
                      itemId: item.id,
                      pointerId: e.pointerId,
                      connectionMode,
                      hoveredOutputPortItemId,
                      showOutputPort,
                    });
                    beginConnectionDragFromItem(item, e.pointerId, 'button');
                  }}
                  className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-transparent transition-opacity duration-150 ${
                    showOutputPort ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
                  }`}
                  style={{
                    left: outputPoint.x,
                    top: outputPoint.y,
                    width: scaledPortIconSize,
                    height: scaledPortIconSize,
                  }}
                  aria-label="开始连线"
                >
                  <ConnectionPortIcon className="h-full w-full" glyphSize={scaledPortGlyphSize} />
                </button>
              </React.Fragment>
            );
          })}
        </div>
            </>
          );
        })()}

        {/* Canvas Content */}
        <div
          className="absolute z-[2]"
          style={{
            transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
            transformOrigin: '0 0',
          }}
        >
          {items.map(item => (
              (() => {
                const isItemSelected = selectedIds.includes(item.id) || selectedId === item.id;
                const isHoveredItem = hoveredCanvasItemId === item.id;
                const isHoveredOutputPort = hoveredOutputPortItemId === item.id;
                const isConnectionSource = connectionSessionRef.current?.fromItemId === item.id;
                const hasOutgoingConnection = connections.some((connection) => connection.fromItemId === item.id);
                const hasIncomingConnection = connections.some((connection) => connection.toItemId === item.id);
                const showOutputPort =
                  isHoveredItem || isHoveredOutputPort || isConnectionSource || hasOutgoingConnection;
                const showCornerResizeHandle = isHoveredItem;
                return (
              <div
                key={item.id}
                className={`absolute group cursor-move ${!item.visible ? 'opacity-30' : ''}`}
                style={{
                  left: item.x,
                  top: item.y,
                  width: item.width,
                  height: item.height,
                  transform: `rotate(${item.rotation}deg)`,
                }}
              onMouseEnter={() => {
                setHoveredCanvasItemId(item.id);
              }}
              onMouseLeave={() => {
                if (connectionSessionRef.current?.fromItemId === item.id) return;
                setHoveredCanvasItemId((prev) => (prev === item.id ? null : prev));
              }}
              onClick={(e) => {
                e.stopPropagation();
                if (e.shiftKey) {
                  setSelectedIds((prev) => {
                    const next = toggleSelectionId(prev, item.id);
                    setSelectedId(getPrimarySelectedId(next));
                    return next;
                  });
                  return;
                }

                setSelectedConnectionIds([]);
                setSelectedId(item.id);
                setSelectedIds([item.id]);
              }}
              onPointerDown={(e) => {
                const target = e.target as HTMLElement;
                if (target.dataset.cornerResize) return;
                if (target.dataset.port) return;
                if (isSpacePressed) return;
                if (e.shiftKey) return;
                e.preventDefault();
                e.stopPropagation();
                setSelectedConnectionIds([]);
                setIsDragging(true);
                const draggingIds = selectedIds.includes(item.id) ? selectedIds : [item.id];
                draggingItemIdsRef.current = draggingIds;
                setSelectedId(item.id);
                setSelectedIds(draggingIds);
                dragStart.current = { x: e.clientX, y: e.clientY };
              }}
            >
              {item.type === 'image' && item.src && (
                <img
                  src={item.src}
                  alt=""
                  className="w-full h-full object-cover pointer-events-none"
                  style={{ borderRadius: `${NODE_CORNER_RADIUS}px` }}
                  draggable={false}
                />
              )}
              {item.type === 'shape' && <div className="w-full h-full rounded" style={{ backgroundColor: item.fill }} />}
              {item.type === 'text' && <div className="w-full h-full flex items-center justify-center text-sm text-zinc-100">{item.text}</div>}
              {(isItemSelected || isHoveredItem) && (
                <div
                  className="absolute inset-[-2px] z-10 border border-dashed border-white/45 pointer-events-none"
                  style={{ borderRadius: `${NODE_CORNER_RADIUS}px` }}
                />
              )}
              {showCornerResizeHandle && (
                <button
                  data-corner-resize="true"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setSelectedId(item.id);
                    setSelectedIds([item.id]);
                    setIsCornerResizing(true);
                    cornerResizeStart.current = {
                      mouseX: e.clientX,
                      mouseY: e.clientY,
                      width: item.width,
                      height: item.height,
                      itemId: item.id,
                    };
                  }}
                  className="absolute bg-transparent cursor-nwse-resize flex items-center justify-center overflow-visible"
                  style={{
                    width: `${CORNER_HANDLE_HIT_SIZE}px`,
                    height: `${CORNER_HANDLE_HIT_SIZE}px`,
                    right: `${CORNER_HANDLE_HIT_OFFSET}px`,
                    bottom: `${CORNER_HANDLE_HIT_OFFSET}px`,
                  }}
                  aria-label="缩放"
                >
                  <svg
                    viewBox={`0 0 ${CORNER_HANDLE_SIZE} ${CORNER_HANDLE_SIZE}`}
                    className="pointer-events-none absolute"
                    style={{
                      width: `${CORNER_HANDLE_SIZE}px`,
                      height: `${CORNER_HANDLE_SIZE}px`,
                      left: `${CORNER_HANDLE_VISUAL_OFFSET}px`,
                      top: `${CORNER_HANDLE_VISUAL_OFFSET}px`,
                    }}
                  >
                    <path
                      d={`M ${CORNER_HANDLE_CENTER + HANDLE_ARC_RADIUS} ${CORNER_HANDLE_CENTER} A ${HANDLE_ARC_RADIUS} ${HANDLE_ARC_RADIUS} 0 0 1 ${CORNER_HANDLE_CENTER} ${CORNER_HANDLE_CENTER + HANDLE_ARC_RADIUS}`}
                      fill="none"
                      stroke="rgba(226,232,240,0.8)"
                      strokeWidth={CORNER_HANDLE_STROKE}
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              )}
            </div>
                );
              })()
          ))}
        </div>
        {isMarqueeSelecting && marqueeRect && (
          <div
            className="absolute pointer-events-none border border-dashed border-white/35 bg-white/5"
            style={{
              left: marqueeRect.x,
              top: marqueeRect.y,
              width: marqueeRect.width,
              height: marqueeRect.height,
            }}
          />
        )}
      </div>

      {/* Zoom Controller - Outside Canvas */}
      <div className="absolute left-[340px] bottom-4 z-50 flex items-center gap-2 rounded-xl border border-white/10 bg-[rgba(16,18,22,0.88)] p-1.5 shadow-[0_18px_50px_rgba(0,0,0,0.35)] backdrop-blur-xl">
        <button 
          className="rounded-md p-1.5 text-zinc-400 hover:bg-white/8 hover:text-zinc-100"
          onClick={() => setViewport(prev => ({ ...prev, scale: Math.max(0.1, prev.scale - 0.1) }))}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
        <span className="min-w-[3rem] text-center text-xs font-medium text-zinc-300">
          {Math.round(viewport.scale * 100)}%
        </span>
        <button 
          className="rounded-md p-1.5 text-zinc-400 hover:bg-white/8 hover:text-zinc-100"
          onClick={() => setViewport(prev => ({ ...prev, scale: Math.min(10, prev.scale + 0.1) }))}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>

      {/* Right Chat Panel */}
      {sidebarCollapsed ? (
        <div className="absolute right-4 top-4 z-[140] isolate flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-[rgba(16,18,22,0.92)] shadow-[0_18px_40px_rgba(0,0,0,0.32)] transition-all duration-300">
          <button 
            className="p-1 text-zinc-200 transition-colors hover:text-white"
            onClick={() => setSidebarCollapsed(false)}
            title="展开对话"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
        </div>
      ) : (
        <div className="absolute right-4 top-4 bottom-4 z-[140] isolate flex w-[480px] flex-col overflow-hidden rounded-[28px] border border-white/10 bg-[rgba(12,14,18,0.9)] shadow-[0_28px_80px_rgba(0,0,0,0.42)] backdrop-blur-xl transition-all duration-300">
          {/* Header */}
          <div className="flex flex-shrink-0 items-center justify-between border-b border-white/8 px-6 py-4">
            <div className="flex items-center gap-3">
              <h1 className="text-base font-medium text-zinc-100">{currentProjectName}</h1>
            </div>
            <div className="flex items-center gap-1">
              <button className="rounded-lg p-2 transition-colors hover:bg-white/8" title="分享">
                <Share2 size={18} className="text-zinc-500" />
              </button>
              <div className="relative">
                <button 
                  className={`rounded-lg p-2 transition-colors ${showHistoryPanel ? 'bg-white/10' : 'hover:bg-white/8'}`} 
                  title="历史"
                  onClick={() => setShowHistoryPanel(!showHistoryPanel)}
                >
                  <History size={18} className={showHistoryPanel ? "text-zinc-100" : "text-zinc-500"} />
                </button>
              </div>
              <button className="rounded-lg p-2 transition-colors hover:bg-white/8" title="设置">
                <Settings size={18} className="text-zinc-500" />
              </button>
              <button 
                className="rounded-lg p-2 transition-colors hover:bg-white/8" 
                title="收缩"
                onClick={() => setSidebarCollapsed(true)}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-zinc-500">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            </div>
          </div>

          {/* History Panel */}
          {showHistoryPanel && (
            <div className="border-b border-white/8 bg-white/[0.03]">
              <div className="p-3">
                <button 
                  onClick={(e) => { e.stopPropagation(); createNewTopic(); }}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white px-3 py-2 text-black transition-colors hover:bg-zinc-200"
                >
                  <span className="text-lg">+</span>
                  <span className="text-sm font-medium">新建对话</span>
                </button>
              </div>
              <div className="panel-scrollbar max-h-48 overflow-y-auto pb-2">
                {(getCurrentSession()?.topics || []).map(topic => (
                  <div 
                    key={topic.id}
                    onClick={(e) => { e.stopPropagation(); switchTopic(topic.id); }}
                    className={`group flex cursor-pointer items-center gap-2 px-4 py-3 transition-colors hover:bg-white/6 ${
                      topic.id === (getCurrentSession()?.activeTopicId) ? 'border-l-2 border-zinc-200 bg-white/8' : ''
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="truncate text-sm font-medium text-zinc-100">{topic.title || '无标题对话'}</div>
                      <div className="text-xs text-zinc-500">
                        {topic.messages.length} 条消息 · {new Date(topic.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => deleteTopic(topic.id, e)}
                        className="rounded-lg p-1.5 transition-colors hover:bg-red-500/10"
                        title="删除对话"
                      >
                        <Trash2 size={12} className="text-red-500" />
                      </button>
                    </div>
                  </div>
                ))}
                {(getCurrentSession()?.topics || []).length === 0 && (
                  <div className="px-4 py-6 text-center text-xs text-zinc-500">
                    暂无历史对话
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Main Content - Welcome Text Only */}
          {chatMessages.length === 0 && (
            <div className="flex-1 px-6 py-8 flex items-center justify-center">
              {!hideWelcomeByCenterSkillPick && (
                <div>
                  <div className="text-center mb-8">
                    <h2 className="mb-2 text-xl font-medium text-zinc-100">你好，我是 Levert Skills</h2>
                    <p className="text-sm text-zinc-500">描述你的设计需求，我来帮你实现</p>
                  </div>
                  <div className="flex justify-center">
                    <div className="flex flex-col gap-1.5">
                      <div className="flex gap-1.5 justify-center">
                        {quickActions.slice(0, 3).map((action) => (
                          <button
                            key={action.id}
                            onClick={() => handleQuickSkillSelect(action, 'center_quick_action')}
                            className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2 py-1.5 text-zinc-300 shadow-[0_12px_24px_rgba(0,0,0,0.18)] transition-colors hover:bg-white/8"
                          >
                            <Sparkles size={10} className="text-zinc-300" />
                            <span className="text-xs font-medium whitespace-nowrap">{action.label}</span>
                          </button>
                        ))}
                      </div>
                      <div className="flex gap-1.5 justify-center">
                        {quickActions.slice(3, 5).map((action) => (
                          <button
                            key={action.id}
                            onClick={() => handleQuickSkillSelect(action, 'center_quick_action')}
                            className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2 py-1.5 text-zinc-300 shadow-[0_12px_24px_rgba(0,0,0,0.18)] transition-colors hover:bg-white/8"
                          >
                            <Sparkles size={10} className="text-zinc-300" />
                            <span className="text-xs font-medium whitespace-nowrap">{action.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Chat Messages */}
          {chatMessages.length > 0 && (
            <div ref={chatContainerRef} className="panel-scrollbar flex-1 overflow-y-auto px-6 py-4">
              <div className="space-y-4">
                {chatMessages.map((msg) => (
                <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {msg.role === 'user' ? (
                    <div className="flex flex-col items-end max-w-[90%]">
                      {msg.skill && (
                        <div className="mb-[10px] flex w-fit items-center gap-0.5 rounded-md border border-[#262b33] bg-[#181c22] px-1 py-0.5 shadow-[0_10px_20px_rgba(0,0,0,0.18)]">
                          <Sparkles size={8} className="text-zinc-300 flex-shrink-0" />
                          <span className="text-[10px] font-bold leading-none text-zinc-300">{msg.skill.label}</span>
                        </div>
                      )}
                      {msg.referenceImages && msg.referenceImages.length > 0 && (
                        <div className="w-full flex justify-end mb-2">
                          <div className="flex flex-wrap justify-end gap-2">
                            {msg.referenceImages.map((img, index) => (
                              <div key={`${msg.id}-ref-${index}`} className="relative">
                                <img
                                  src={img}
                                  alt={`参考图 image${index + 1}`}
                                  className="h-16 w-16 rounded-md border border-[#262b33] object-cover"
                                />
                                <span className="absolute left-0 top-0 px-1 py-0.5 rounded-br-md rounded-tl-md bg-black/75 text-white text-[9px] leading-none">
                                  {`image${index + 1}`}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      <div
                        className="panel-scrollbar overflow-y-auto rounded-[22px] border border-[#353b45] bg-[#1a1f26] p-4 text-zinc-100 shadow-[0_18px_40px_rgba(0,0,0,0.22)]"
                        style={{ maxHeight: '240px' }}
                      >
                        <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                      </div>
                    </div>
                  ) : msg.role === 'skill' ? (
                    <div className="group relative flex max-w-[90%] items-center gap-2 rounded-2xl border border-[#2a3038] bg-[#171b21] p-3 shadow-[0_18px_40px_rgba(0,0,0,0.18)]">
                      <Sparkles size={14} className="text-zinc-100 flex-shrink-0" />
                      <span className="text-sm font-medium text-zinc-100">{msg.skill?.label}</span>
                      <button
                        onClick={() => {
                          const nextMessages = chatMessages.filter((m) => m.id !== msg.id);
                          setChatMessages(nextMessages);
                          if (nextMessages.length === 0) {
                            setHideWelcomeByCenterSkillPick(false);
                          }
                          setActiveSkillForCurrentTopic(null);
                        }}
                        className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full border border-[#2a3038] bg-[#171b21] text-xs text-zinc-100 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-[#212730]"
                      >
                        ×
                      </button>
                    </div>
                  ) : (
                    <div className="group relative max-w-[90%] rounded-[22px] border border-[#2b313a] bg-[#151a20] px-3.5 py-3 shadow-[0_18px_40px_rgba(0,0,0,0.2)]">
                      {msg.content && !(msg.content === '...' && msg.taskStatus === 'running') && (
                        <button
                          type="button"
                          onPointerDown={(e) => {
                            e.stopPropagation();
                          }}
                          onMouseDown={(e) => {
                            e.stopPropagation();
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleCopyAssistantMessage(msg.id, msg.content);
                          }}
                          className="absolute right-3 top-3 z-[2] inline-flex h-7 items-center gap-1 rounded-lg border border-white/10 bg-[rgba(19,24,31,0.92)] px-2 text-[11px] text-zinc-300 opacity-0 shadow-[0_10px_22px_rgba(0,0,0,0.22)] transition-all duration-200 hover:border-white/15 hover:bg-[rgba(28,33,41,0.96)] hover:text-zinc-100 group-hover:opacity-100"
                          aria-label="复制正文"
                          title="复制正文"
                        >
                          {copiedAssistantMessageId === msg.id ? (
                            <>
                              <Check size={12} />
                              <span>已复制</span>
                            </>
                          ) : (
                            <>
                              <Copy size={12} />
                              <span>复制</span>
                            </>
                          )}
                        </button>
                      )}
                      {msg.taskStatus && (
                        <div className="mb-1.5">
                          {msg.taskStatus === 'queued' && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-[#1d2229] px-2 py-0.5 text-[11px] text-zinc-300">排队中</span>
                          )}
                          {msg.taskStatus === 'completed' && !msg.imageUrl && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/12 px-2 py-0.5 text-[11px] text-emerald-300">已完成</span>
                          )}
                          {msg.taskStatus === 'failed' && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-red-500/12 px-2 py-0.5 text-[11px] text-red-300">失败</span>
                          )}
                          {msg.taskStatus === 'cancelled' && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-[#1d2229] px-2 py-0.5 text-[11px] text-zinc-300">已终止</span>
                          )}
                        </div>
                      )}
                      {msg.reasoningContent && (
                        <details className="mb-1.5 text-[11px] text-zinc-500">
                          <summary className="cursor-pointer select-none">模型推理</summary>
                          <div
                            data-assistant-selectable="true"
                            className="assistant-selectable relative z-[1] mt-0.5 pointer-events-auto"
                            onPointerDown={handleAssistantSelectablePointerDown}
                            onMouseDown={handleAssistantSelectableMouseDown}
                            onClick={handleAssistantSelectableClick}
                          >
                            <p className="whitespace-pre-wrap">{msg.reasoningContent}</p>
                          </div>
                        </details>
                      )}
                      {msg.content === '...' && msg.taskStatus === 'running' ? (
                        <p className="text-sm whitespace-pre-wrap inline-flex items-center gap-1" aria-label="加载中">
                          <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-bounce [animation-delay:0ms]" />
                          <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-bounce [animation-delay:150ms]" />
                          <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-bounce [animation-delay:300ms]" />
                        </p>
                      ) : (
                        msg.content && (
                          <div className="pr-14">
                            <MarkdownMessage
                              content={msg.content}
                              onPointerDown={handleAssistantSelectablePointerDown}
                              onMouseDown={handleAssistantSelectableMouseDown}
                              onClick={handleAssistantSelectableClick}
                            />
                          </div>
                        )
                      )}
                      {msg.skillChoice && !msg.skillChoiceResolved && (
                        <div className="mt-2.5">
                          <button
                            onClick={() => openSkillChoiceModal(msg.skillChoice as SkillChoicePayload)}
                            className="inline-flex items-center rounded-full border border-[#2a3038] px-3 py-1 text-xs text-zinc-300 hover:bg-[#1f242c]"
                          >
                            重新选择
                          </button>
                        </div>
                      )}
                      {msg.imageName && <div className="mb-1.5 text-sm font-medium text-zinc-200">{msg.imageName}</div>}
                      {msg.imageUrl && <img src={msg.imageUrl} alt="Generated" className="rounded-lg w-full" />}
                      {msg.model && <div className="mt-1.5 text-xs text-zinc-500">模型: {msg.model}</div>}
                    </div>
                  )}
                </div>
                ))}
              </div>
            </div>
          )}

          {showSkillChoiceModal && pendingSkillChoice && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/30 px-4">
              <div className="w-full max-w-md rounded-[24px] border border-[#2a3038] bg-[#171b21] p-5 shadow-[0_28px_80px_rgba(0,0,0,0.4)]">
                <div className="mb-1 text-base font-semibold text-zinc-100">{pendingSkillChoice.title}</div>
                {pendingSkillChoice.message && (
                  <p className="mb-4 whitespace-pre-wrap text-sm text-zinc-400">{pendingSkillChoice.message}</p>
                )}
                <div className="space-y-2">
                  {pendingSkillChoice.options.map((option, index) => (
                    <button
                      key={`${pendingSkillChoice.id}-option-${index}`}
                      onClick={() => handleSubmitSkillChoice(pendingSkillChoice, option)}
                      className="w-full rounded-xl border border-[#2a3038] px-3 py-2 text-left text-sm text-zinc-200 hover:bg-[#1f242c]"
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <div className="mt-4 flex justify-end">
                  <button
                    onClick={handleCloseSkillChoiceModal}
                    className="rounded-lg border border-[#2a3038] px-3 py-1.5 text-xs text-zinc-400 hover:bg-[#1f242c]"
                  >
                    稍后再选
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Reference Images */}
          {chatReferenceImages.length > 0 && (
            <div className="flex-shrink-0 border-t border-white/8 px-4 py-2">
              <div className="flex flex-wrap gap-2">
                {chatReferenceImages.map((img, index) => (
                  <div
                    key={index}
                    draggable
                    onDragStart={() => handleReferenceDragStart(index)}
                    onDragOver={(e) => handleReferenceDragOver(e, index)}
                    onDrop={(e) => handleReferenceDrop(e, index)}
                    onDragEnd={handleReferenceDragEnd}
                    className={`relative group cursor-move transition-all ${draggingImageIndex === index ? 'opacity-50' : ''} ${dragOverImageIndex === index ? 'rounded-md ring-1 ring-zinc-100' : ''}`}
                  >
                    <img src={img} alt={`参考图 ${index + 1}`} className="h-14 w-14 rounded-md border border-white/10 object-cover" />
                    <span className="absolute left-0 top-0 px-1 py-0.5 rounded-br-md rounded-tl-md bg-black/75 text-white text-[9px] leading-none">
                      {`image${index + 1}`}
                    </span>
                    <button onClick={() => removeChatImage(index)} className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">×</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Input Bar */}
          <div className="p-4 flex-shrink-0">
            <input ref={chatFileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleChatImageUpload} />
            <div className="flex flex-col rounded-[24px] border border-[#303640] bg-[#151a20] shadow-[0_18px_40px_rgba(0,0,0,0.22)]">
              <div
                className="px-4 py-3"
                onClick={() => chatInputEditorRef.current?.focus()}
              >
                <div className="relative min-w-[120px]">
                  <div
                    ref={chatInputEditorRef}
                    contentEditable
                    suppressContentEditableWarning
                    onInput={handleChatEditorInput}
                    onPaste={handleChatPaste}
                    onKeyDown={handleChatEditorKeyDown}
                    onFocus={() => setChatInputFocused(true)}
                    onBlur={() => setChatInputFocused(false)}
                    className="panel-scrollbar w-full overflow-y-auto bg-transparent text-sm leading-5 text-zinc-100 outline-none whitespace-pre-wrap break-words"
                    style={{ minHeight: '24px', maxHeight: '240px', height: `${chatInputHeight}px` }}
                  />
                  {!chatInput.trim() && !activeSkill && !chatInputFocused && (
                    <span className="pointer-events-none absolute left-0 top-0 text-sm leading-5 text-zinc-500">
                      请输入你的设计需求
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-between rounded-b-[24px] border-t border-[#2a3038] px-4 py-2">
                <div className="flex items-center gap-2">
                  <button className="text-zinc-500 transition-colors hover:text-zinc-100" onClick={() => chatFileInputRef.current?.click()} title="上传参考图">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
                  </button>
                  <div className="relative" ref={skillsMenuRef}>
                    {showSkillsMenu && (
                      <div className="absolute bottom-full left-0 z-20 mb-2 min-w-[180px] rounded-2xl border border-[#2a3038] bg-[#171b21] p-1 shadow-[0_20px_60px_rgba(0,0,0,0.42)]">
                        {quickActions.map((action) => {
                          const isActive = activeSkill?.id === action.id;
                          return (
                            <button
                              key={action.id}
                              onClick={() => {
                                handleQuickSkillSelect(action, 'bottom_skill_bar');
                                setShowSkillsMenu(false);
                                setTimeout(() => {
                                  chatInputEditorRef.current?.focus();
                                  moveCaretToEditorEnd();
                                }, 0);
                              }}
                              className={`flex w-full items-center justify-between gap-2 rounded-xl px-3 py-1.5 text-xs transition-colors ${
                                isActive ? 'bg-[#1f242c] text-zinc-100' : 'text-zinc-300 hover:bg-[#1f242c]'
                              }`}
                            >
                              <span className="flex items-center gap-1.5">
                                <Sparkles size={11} />
                                <span>{action.label}</span>
                              </span>
                              {isActive && <span className="text-[10px] text-zinc-500">✓</span>}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowSkillsMenu((prev) => !prev);
                      }}
                      disabled={isGenerating}
                      className="flex items-center gap-1 rounded-full border border-[#2a3038] bg-[#181d24] px-2 py-1 text-xs font-medium text-zinc-300 transition-colors hover:bg-[#212730] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Sparkles size={12} />
                      <span>Skills</span>
                    </button>
                  </div>
                  <div className="relative" ref={generationModeMenuRef}>
                    {showGenerationModeMenu && (
                      <div className="absolute bottom-full left-0 z-20 mb-2 min-w-[80px] rounded-2xl border border-[#2a3038] bg-[#171b21] p-1 shadow-[0_20px_60px_rgba(0,0,0,0.42)]">
                        {[
                          { id: 'auto' as const, label: '自定义' },
                          { id: 'image' as const, label: '生图' },
                          { id: 'chat' as const, label: '对话' },
                        ].map((option) => (
                          <button
                            key={option.id}
                            onClick={() => {
                              setGenerationMode(option.id);
                              setShowGenerationModeMenu(false);
                              if (option.id !== 'image') {
                                setShowAspectRatioMenu(false);
                              }
                            }}
                            className={`w-full rounded-xl px-3 py-1.5 text-left text-xs transition-colors ${generationMode === option.id ? 'bg-[#1f242c] text-zinc-100' : 'text-zinc-300 hover:bg-[#1f242c]'}`}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowGenerationModeMenu((prev) => !prev);
                      }}
                      disabled={isGenerating}
                      className="flex items-center gap-1 rounded-full border border-[#2a3038] bg-[#181d24] px-2 py-1 text-xs font-medium text-zinc-300 transition-colors hover:bg-[#212730] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <SlidersHorizontal size={12} />
                      <span>{generationMode === 'auto' ? '自定义' : generationMode === 'image' ? '生图' : '对话'}</span>
                    </button>
                  </div>
                  {generationMode === 'image' && (
                    <div className="relative" ref={aspectRatioMenuRef}>
                      {showAspectRatioMenu && (
                        <div className="absolute bottom-full left-0 z-20 mb-2 min-w-[180px] rounded-2xl border border-[#2a3038] bg-[#171b21] p-1 shadow-[0_20px_60px_rgba(0,0,0,0.42)]">
                          {ASPECT_RATIOS.map((option) => (
                            <button
                              key={option.id}
                              onClick={() => {
                                setImageAspectRatio(option.id);
                                setShowAspectRatioMenu(false);
                              }}
                              className={`w-full rounded-xl px-3 py-1.5 text-left text-xs transition-colors ${
                                imageAspectRatio === option.id ? 'bg-[#1f242c] text-zinc-100' : 'text-zinc-300 hover:bg-[#1f242c]'
                              }`}
                            >
                              {option.name}
                            </button>
                          ))}
                        </div>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowAspectRatioMenu((prev) => !prev);
                        }}
                        disabled={isGenerating}
                        className="flex items-center gap-1 rounded-full border border-[#2a3038] bg-[#181d24] px-2 py-1 text-xs font-medium text-zinc-300 transition-colors hover:bg-[#212730] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <span>
                          {ASPECT_RATIOS.find((item) => item.id === imageAspectRatio)?.name || imageAspectRatio}
                        </span>
                      </button>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={isGenerating ? handleCancelGenerate : () => { void handleGenerate(); }}
                    disabled={!isGenerating && !chatInput.trim()}
                    title={isGenerating ? '终止任务' : '发送'}
                    className="ml-1 rounded-xl border border-[#2a3038] bg-[#f1f5f9] p-1.5 text-black transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isGenerating ? (
                      <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="9" opacity="0.25" />
                        <path d="M21 12a9 9 0 0 1-9 9" />
                      </svg>
                    ) : (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      <style jsx global>{`
        .panel-scrollbar {
          scrollbar-width: thin;
          scrollbar-color: rgba(161, 161, 170, 0.34) rgba(255, 255, 255, 0.04);
        }

        [data-assistant-selectable],
        [data-assistant-selectable] *,
        .assistant-selectable,
        .assistant-selectable *,
        .assistant-selectable-node,
        .assistant-selectable-node * {
          user-select: text !important;
          -webkit-user-select: text !important;
          cursor: text;
        }

        [data-assistant-selectable]::selection,
        [data-assistant-selectable] *::selection,
        .assistant-selectable::selection,
        .assistant-selectable *::selection,
        .assistant-selectable-node::selection,
        .assistant-selectable-node *::selection {
          background: rgba(148, 163, 184, 0.38);
          color: #f8fafc;
        }

        [data-assistant-selectable]::-moz-selection,
        [data-assistant-selectable] *::-moz-selection,
        .assistant-selectable::-moz-selection,
        .assistant-selectable *::-moz-selection,
        .assistant-selectable-node::-moz-selection,
        .assistant-selectable-node *::-moz-selection {
          background: rgba(148, 163, 184, 0.38);
          color: #f8fafc;
        }

        .assistant-selectable button,
        .assistant-selectable summary,
        .assistant-selectable [role='button'],
        [data-assistant-selectable] button,
        [data-assistant-selectable] summary,
        [data-assistant-selectable] [role='button'] {
          user-select: none !important;
          -webkit-user-select: none !important;
        }

        .panel-scrollbar::-webkit-scrollbar {
          width: 10px;
          height: 10px;
        }

        .panel-scrollbar::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.04);
          border-radius: 9999px;
        }

        .panel-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(161, 161, 170, 0.34);
          border: 2px solid rgba(0, 0, 0, 0);
          background-clip: padding-box;
          border-radius: 9999px;
        }

        .panel-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(212, 212, 216, 0.46);
          border: 2px solid rgba(0, 0, 0, 0);
          background-clip: padding-box;
        }
      `}</style>
    </div>
  );
}
