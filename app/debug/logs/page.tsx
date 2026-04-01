import { getCurrentStartupSession, isLocalLogAccessAllowed, readLogEntries, type LocalLogEntry } from "../../lib/local-logs";

type SearchParams = Record<string, string | string[] | undefined>;

function firstValue(value?: string | string[]): string {
  if (Array.isArray(value)) {
    return value[0] || "";
  }
  return value || "";
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("zh-CN");
}

function renderDetails(entry: LocalLogEntry): string {
  if (!entry.details) {
    return "";
  }
  return JSON.stringify(entry.details, null, 2);
}

export default async function DebugLogsPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  if (!isLocalLogAccessAllowed()) {
    return (
      <main className="min-h-screen bg-neutral-950 px-6 py-10 text-neutral-100">
        <div className="mx-auto max-w-3xl rounded-3xl border border-neutral-800 bg-neutral-900/70 p-8 shadow-2xl shadow-black/30">
          <h1 className="text-2xl font-semibold">本地日志</h1>
          <p className="mt-3 text-sm text-neutral-300">日志查看仅在本地开发环境开放</p>
        </div>
      </main>
    );
  }

  const startupSession = getCurrentStartupSession();
  const level = firstValue(searchParams?.level);
  const source = firstValue(searchParams?.source);
  const q = firstValue(searchParams?.q);
  const currentLogFile = `logs/${startupSession.date}/${startupSession.startupId}.app.log`;

  const entries = await readLogEntries({
    startupId: startupSession.startupId,
    level: level || undefined,
    source: source || undefined,
    q: q || undefined,
    limit: 200,
  });

  return (
    <main className="min-h-screen bg-[#0b1020] px-4 py-8 text-white sm:px-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <section className="overflow-hidden rounded-[28px] border border-white/10 bg-white/5 shadow-[0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur">
          <div className="border-b border-white/10 px-6 py-5">
            <p className="text-xs uppercase tracking-[0.35em] text-cyan-300/80">Local Debug Logs</p>
            <h1 className="mt-3 text-3xl font-semibold">项目本地错误日志</h1>
            <p className="mt-2 max-w-2xl text-sm text-white/65">
              当前页面只展示本次服务启动写入的日志，避免和上一次启动的错误混在一起。
            </p>
          </div>

          <div className="grid gap-3 border-b border-white/10 px-6 py-5 md:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
              <p className="text-[11px] uppercase tracking-[0.25em] text-cyan-300/80">Current Startup</p>
              <p className="mt-2 break-all text-sm text-white">{startupSession.startupId}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
              <p className="text-[11px] uppercase tracking-[0.25em] text-cyan-300/80">Started At</p>
              <p className="mt-2 text-sm text-white">{formatTimestamp(startupSession.startedAt)}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
              <p className="text-[11px] uppercase tracking-[0.25em] text-cyan-300/80">Current File</p>
              <p className="mt-2 break-all text-sm text-white">{currentLogFile}</p>
            </div>
          </div>

          <form className="grid gap-3 px-6 py-5 md:grid-cols-[160px_160px_1fr_auto]">
            <select
              name="level"
              defaultValue={level}
              className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400"
            >
              <option value="">全部级别</option>
              <option value="info">info</option>
              <option value="warn">warn</option>
              <option value="error">error</option>
            </select>
            <select
              name="source"
              defaultValue={source}
              className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400"
            >
              <option value="">全部来源</option>
              <option value="server">server</option>
              <option value="client">client</option>
            </select>
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="搜索 message / scope / details"
              className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none transition placeholder:text-white/35 focus:border-cyan-400"
            />
            <button
              type="submit"
              className="rounded-2xl bg-cyan-400 px-5 py-3 text-sm font-medium text-slate-950 transition hover:bg-cyan-300"
            >
              筛选
            </button>
          </form>
        </section>

        <section className="rounded-[28px] border border-white/10 bg-white/5 p-6 shadow-[0_20px_60px_rgba(0,0,0,0.25)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-medium">结果</h2>
              <p className="mt-1 text-sm text-white/55">{entries.length} 条日志</p>
            </div>
            <p className="max-w-xl text-right text-xs text-white/45">
              旧启动日志请到项目根目录的 `logs/{startupSession.date}/` 手动查看；当前页只展示本次启动对应的文件。
            </p>
          </div>

          <div className="mt-6 space-y-4">
            {entries.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-white/10 bg-black/10 px-6 py-12 text-center text-sm text-white/55">
                当前筛选条件下还没有日志。
              </div>
            ) : (
              entries.map((entry, index) => (
                <article
                  key={`${entry.timestamp}-${entry.requestId || entry.scope}-${index}`}
                  className="overflow-hidden rounded-3xl border border-white/10 bg-black/20"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 px-5 py-4">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-white/55">
                        <span className="rounded-full border border-white/10 px-2 py-1 uppercase tracking-[0.2em]">{entry.level}</span>
                        <span className="rounded-full border border-white/10 px-2 py-1 uppercase tracking-[0.2em]">{entry.source}</span>
                        <span>{formatTimestamp(entry.timestamp)}</span>
                      </div>
                      <h3 className="text-base font-medium">{entry.message}</h3>
                      <p className="text-sm text-white/55">
                        scope: {entry.scope} · event: {entry.event}
                      </p>
                    </div>
                    <div className="space-y-1 text-right text-xs text-white/45">
                      {entry.startupId ? <p>startupId: {entry.startupId}</p> : null}
                      {entry.route ? <p>route: {entry.route}</p> : null}
                      {entry.pageUrl ? <p className="max-w-[320px] break-all">page: {entry.pageUrl}</p> : null}
                      {entry.requestId ? <p>requestId: {entry.requestId}</p> : null}
                    </div>
                  </div>

                  {entry.details ? (
                    <pre className="overflow-x-auto px-5 py-4 text-xs leading-6 text-cyan-100/90">
                      {renderDetails(entry)}
                    </pre>
                  ) : null}
                </article>
              ))
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
