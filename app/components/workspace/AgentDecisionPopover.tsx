'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Pencil, Send, X } from 'lucide-react';

export type AgentDecisionOption = {
  id: string;
  label: string;
  description?: string;
  recommended?: boolean;
  disabled?: boolean;
};

type AgentDecisionPopoverProps = {
  title: string;
  options: AgentDecisionOption[];
  onSelect: (optionId: string) => void;
  onClose: () => void;
  skipLabel?: string;
  onSkip?: () => void;
  custom?: {
    label: string;
    placeholder: string;
    value: string;
    onChange: (value: string) => void;
    onSubmit: () => void;
  };
};

export function AgentDecisionPopover({
  title,
  options,
  onSelect,
  onClose,
  skipLabel,
  onSkip,
  custom,
}: AgentDecisionPopoverProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const customInputRef = useRef<HTMLTextAreaElement>(null);
  const [customOpen, setCustomOpen] = useState(Boolean(custom?.value));

  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!customOpen) return;
    customInputRef.current?.focus();
  }, [customOpen]);

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label={title}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
      className="agent-decision-popover workspace-popover-panel absolute bottom-full left-4 right-4 z-[70] mb-2 overflow-hidden rounded-[18px] outline-none"
    >
      <div className="flex items-start justify-between gap-4 px-4 pb-2 pt-4">
        <div className="min-w-0 text-[13px] font-medium leading-5 text-[var(--workspace-text-primary)]">
          {title}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="workspace-chat-icon-control -mr-1 -mt-1 inline-flex h-7 w-7 flex-none items-center justify-center rounded-lg"
          aria-label="关闭选择框"
        >
          <X size={14} />
        </button>
      </div>

      <div className="panel-scrollbar max-h-[min(52vh,420px)] overflow-y-auto px-2 pb-2">
        {options.map((option, index) => (
          <button
            key={option.id}
            type="button"
            disabled={option.disabled}
            onClick={() => onSelect(option.id)}
            className={`agent-decision-option group flex w-full items-center gap-2.5 rounded-[14px] px-2.5 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              option.recommended ? 'is-recommended' : ''
            }`}
          >
            <span className="agent-decision-index inline-flex h-6 w-6 flex-none items-center justify-center rounded-full text-[11px] tabular-nums">
              {index + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate text-[12px] font-medium text-[var(--workspace-text-primary)]">
                  {option.label}
                </span>
                {option.recommended && (
                  <span className="agent-decision-recommended flex-none rounded-md px-1.5 py-0.5 text-[9px] font-medium">
                    推荐
                  </span>
                )}
              </span>
              {option.description && (
                <span className="workspace-text-muted mt-0.5 block truncate text-[11px] leading-4">
                  {option.description}
                </span>
              )}
            </span>
            <ArrowRight
              size={14}
              className="workspace-text-soft flex-none transition-transform duration-150 group-hover:translate-x-0.5"
              aria-hidden="true"
            />
          </button>
        ))}

        {custom && (
          customOpen ? (
            <div className="agent-decision-custom mt-1 rounded-[14px] px-2.5 py-2">
              <div className="flex items-end gap-2">
                <textarea
                  ref={customInputRef}
                  value={custom.value}
                  onChange={(event) => custom.onChange(event.target.value)}
                  onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && custom.value.trim()) {
                      event.preventDefault();
                      custom.onSubmit();
                    }
                  }}
                  rows={2}
                  placeholder={custom.placeholder}
                  className="panel-scrollbar min-h-12 flex-1 resize-none bg-transparent text-[12px] leading-5 outline-none placeholder:text-[var(--workspace-text-soft)]"
                />
                <button
                  type="button"
                  disabled={!custom.value.trim()}
                  onClick={custom.onSubmit}
                  className="agent-decision-send inline-flex h-8 w-8 flex-none items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-30"
                  aria-label="提交自定义回答"
                >
                  <Send size={13} />
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setCustomOpen(true)}
              className="agent-decision-option flex w-full items-center gap-2.5 rounded-[14px] px-2.5 py-2 text-left transition-colors"
            >
              <span className="agent-decision-index inline-flex h-6 w-6 flex-none items-center justify-center rounded-full">
                <Pencil size={11} />
              </span>
              <span className="text-[12px] text-[var(--workspace-text-muted)]">{custom.label}</span>
            </button>
          )
        )}
      </div>

      {skipLabel && onSkip && (
        <div className="flex justify-end px-3 pb-3 pt-0.5">
          <button
            type="button"
            onClick={onSkip}
            className="workspace-text-muted rounded-lg px-2 py-1 text-[11px] font-medium transition-colors hover:bg-[var(--workspace-control-hover)] hover:text-[var(--workspace-text-primary)]"
          >
            {skipLabel}
          </button>
        </div>
      )}
    </div>
  );
}
