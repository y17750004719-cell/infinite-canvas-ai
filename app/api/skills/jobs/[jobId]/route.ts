import { NextRequest, NextResponse } from "next/server";
import { cancelSkillJob, getSkillJob, toJobDetail } from "../../../../lib/skill-jobs";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

const LOG_ALL_REQUESTS = process.env.LOG_ALL_REQUESTS !== "0";
const log = (...args: unknown[]) => {
  if (LOG_ALL_REQUESTS) {
    console.log(`[${new Date().toISOString()}]`, ...args);
  }
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    log("[API][REQ]", { route: "/api/skills/jobs/[jobId]", method: "GET", url: request.url });
    const { jobId } = await params;
    const job = getSkillJob(jobId);

    if (!job) {
      log("[API][RES]", { route: "/api/skills/jobs/[jobId]", method: "GET", status: 404, jobId });
      return NextResponse.json({ error: "Job not found" }, { status: 404, headers: NO_STORE_HEADERS });
    }

    log("[API][RES]", { route: "/api/skills/jobs/[jobId]", method: "GET", status: 200, jobId, skillType: job.skillType, jobStatus: job.status });
    return NextResponse.json(toJobDetail(job), { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error("Skill job query error:", error);
    log("[API][RES]", { route: "/api/skills/jobs/[jobId]", method: "GET", status: 500, error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Query failed" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    log("[API][REQ]", { route: "/api/skills/jobs/[jobId]", method: "DELETE", url: request.url });
    const { jobId } = await params;
    const cancelled = cancelSkillJob(jobId);

    if (!cancelled) {
      log("[API][RES]", { route: "/api/skills/jobs/[jobId]", method: "DELETE", status: 404, jobId });
      return NextResponse.json({ error: "Job not found" }, { status: 404, headers: NO_STORE_HEADERS });
    }

    const job = getSkillJob(jobId);
    log("[API][RES]", { route: "/api/skills/jobs/[jobId]", method: "DELETE", status: 200, jobId, jobStatus: job?.status || "cancelled" });
    return NextResponse.json({
      jobId,
      status: job?.status || "cancelled",
      message: "Job cancelled",
    }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error("Skill job cancel error:", error);
    log("[API][RES]", { route: "/api/skills/jobs/[jobId]", method: "DELETE", status: 500, error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Cancel failed" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
