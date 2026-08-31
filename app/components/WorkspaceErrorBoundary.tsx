'use client';

import React from 'react';

type Props = { children: React.ReactNode };
type State = { error: Error | null };

export default class WorkspaceErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[workspace-render-error]', {
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack,
      buildVersion: process.env.NEXT_PUBLIC_BUILD_VERSION || 'unknown',
    });
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--workspace-bg)] px-6 text-[var(--workspace-text-primary)]">
        <section className="max-w-md text-center">
          <h1 className="text-lg font-semibold">页面需要刷新</h1>
          <p className="mt-2 text-sm text-[var(--workspace-text-muted)]">
            当前页面加载了旧版本资源，请刷新后继续当前任务。
          </p>
          <button
            type="button"
            className="mt-5 rounded-md border border-[var(--workspace-border)] px-4 py-2 text-sm"
            onClick={() => window.location.reload()}
          >
            刷新页面
          </button>
        </section>
      </main>
    );
  }
}
