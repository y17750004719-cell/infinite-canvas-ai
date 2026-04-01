import { NextRequest, NextResponse } from "next/server";
import { createLogger, createRequestId } from "../../../../lib/logger";
import { isLocalLogAccessAllowed } from "../../../../lib/local-logs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toExtra(body: Record<string, unknown>) {
  return body.extra && typeof body.extra === "object" && !Array.isArray(body.extra)
    ? body.extra as Record<string, unknown>
    : null;
}

export async function POST(request: NextRequest) {
  if (!isLocalLogAccessAllowed()) {
    return NextResponse.json({ error: "Local log ingestion is only available in development" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.message !== "string" || !body.message.trim()) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  if (typeof body.pageUrl !== "string" || !body.pageUrl.trim()) {
    return NextResponse.json({ error: "pageUrl is required" }, { status: 400 });
  }

  if (typeof body.userAgent !== "string" || !body.userAgent.trim()) {
    return NextResponse.json({ error: "userAgent is required" }, { status: 400 });
  }

  const logger = createLogger("api.debug.logs.client", {
    source: "client",
    route: "/api/debug/logs/client",
    requestId: createRequestId("client-log"),
    pageUrl: body.pageUrl.trim(),
  });

  await logger.error("client.error", `Client error reported: ${body.message.trim()}`, {
    type: typeof body.type === "string" && body.type.trim() ? body.type.trim() : "unknown",
    stack: typeof body.stack === "string" ? body.stack : null,
    userAgent: body.userAgent.trim(),
    workspaceId: typeof body.workspaceId === "string" && body.workspaceId.trim() ? body.workspaceId.trim() : null,
    extra: toExtra(body),
  });

  return new NextResponse(null, { status: 204 });
}
