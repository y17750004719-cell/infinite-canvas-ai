import { NextRequest, NextResponse } from "next/server";
import { createSkillJob, getSkillJob, listSkillJobs, toJobDetail, toJobSummary } from "../../../lib/skill-jobs";

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

export async function POST(request: NextRequest) {
  try {
    log("[API][REQ]", { route: "/api/skills/jobs", method: "POST", url: request.url });
    const body = await request.json();
    const { skillType, payload } = body as {
      skillType?: string;
      payload?: Record<string, unknown>;
    };

    if (!skillType) {
      log("[API][RES]", { route: "/api/skills/jobs", method: "POST", status: 400, reason: "skillType is required" });
      return NextResponse.json({ error: "skillType is required" }, { status: 400, headers: NO_STORE_HEADERS });
    }

    const job = createSkillJob(skillType, payload || {});
    log("[API][RES]", {
      route: "/api/skills/jobs",
      method: "POST",
      status: 200,
      skillType,
      jobId: job.id,
      totalItems: job.items.length,
    });
    return NextResponse.json({
      ...toJobSummary(job),
      items: job.items.map((item) => ({
        key: item.key,
        name: item.name,
        status: item.status,
      })),
    }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error("Skill job creation error:", error);
    log("[API][RES]", { route: "/api/skills/jobs", method: "POST", status: 500, error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Job creation failed" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}

export async function GET(request: NextRequest) {
  log("[API][REQ]", { route: "/api/skills/jobs", method: "GET", url: request.url });
  const jobId = request.nextUrl.searchParams.get("jobId") || undefined;
  if (jobId) {
    const job = getSkillJob(jobId);
    if (!job) {
      log("[API][RES]", { route: "/api/skills/jobs", method: "GET", status: 404, jobId });
      return NextResponse.json({ error: "Job not found" }, { status: 404, headers: NO_STORE_HEADERS });
    }
    const completedWithUrl = job.items.filter((item) => item.status === "completed" && !!item.localUrl).length;
    log("[API][RES]", {
      route: "/api/skills/jobs",
      method: "GET",
      status: 200,
      jobId,
      skillType: job.skillType,
      jobStatus: job.status,
      completed: job.items.filter((item) => item.status === "completed").length,
      completedWithUrl,
      total: job.items.length,
    });
    return NextResponse.json(toJobDetail(job), { headers: NO_STORE_HEADERS });
  }

  const skillType = request.nextUrl.searchParams.get("skillType") || undefined;
  const jobs = listSkillJobs(skillType).map((job) => toJobSummary(job));
  log("[API][RES]", { route: "/api/skills/jobs", method: "GET", status: 200, skillType: skillType || null, count: jobs.length });
  return NextResponse.json({ jobs }, { headers: NO_STORE_HEADERS });
}
