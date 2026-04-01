import { NextRequest, NextResponse } from "next/server";
import { createSkillJob, getSkillJob, listSkillJobs, toJobDetail, toJobSummary } from "../../../lib/skill-jobs";
import { createLogger, createRequestId, serializeError } from "../../../lib/logger";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

const LOG_ALL_REQUESTS = process.env.LOG_ALL_REQUESTS !== "0";

export async function POST(request: NextRequest) {
  const requestId = createRequestId("skill-job-create");
  const logger = createLogger("api.skills.jobs", {
    route: "/api/skills/jobs",
    requestId,
  });
  try {
    if (LOG_ALL_REQUESTS) {
      await logger.info("request.start", "Skill job create request started", {
        method: "POST",
        url: request.url,
      });
    }
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      await logger.warn("request.invalid_json", "Skill job create request received invalid JSON body", {
        method: "POST",
        status: 400,
        reason: "invalid_json",
      });
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400, headers: NO_STORE_HEADERS });
    }
    const { skillType, payload } = body as {
      skillType?: string;
      payload?: Record<string, unknown>;
    };

    if (!skillType) {
      await logger.warn("request.invalid_input", "Skill job create request is missing skillType", {
        method: "POST",
        status: 400,
        reason: "skillType is required",
      });
      return NextResponse.json({ error: "skillType is required" }, { status: 400, headers: NO_STORE_HEADERS });
    }

    const job = createSkillJob(skillType, payload || {});
    if (LOG_ALL_REQUESTS) {
      await logger.info("request.success", "Skill job created", {
        method: "POST",
        status: 200,
        skillType,
        jobId: job.id,
        totalItems: job.items.length,
      });
    }
    return NextResponse.json({
      ...toJobSummary(job),
      items: job.items.map((item) => ({
        key: item.key,
        name: item.name,
        status: item.status,
      })),
    }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    await logger.error("request.error", "Skill job creation failed", {
      method: "POST",
      status: 500,
      error: serializeError(error),
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Job creation failed" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}

export async function GET(request: NextRequest) {
  const requestId = createRequestId("skill-job-list");
  const logger = createLogger("api.skills.jobs", {
    route: "/api/skills/jobs",
    requestId,
  });
  if (LOG_ALL_REQUESTS) {
    await logger.info("request.start", "Skill job query request started", {
      method: "GET",
      url: request.url,
    });
  }
  const jobId = request.nextUrl.searchParams.get("jobId") || undefined;
  if (jobId) {
    const job = getSkillJob(jobId);
    if (!job) {
      await logger.warn("request.not_found", "Skill job was not found", {
        method: "GET",
        status: 404,
        jobId,
      });
      return NextResponse.json({ error: "Job not found" }, { status: 404, headers: NO_STORE_HEADERS });
    }
    const completedWithUrl = job.items.filter((item) => item.status === "completed" && !!item.localUrl).length;
    if (LOG_ALL_REQUESTS) {
      await logger.info("request.success", "Skill job detail returned", {
        method: "GET",
        status: 200,
        jobId,
        skillType: job.skillType,
        jobStatus: job.status,
        completed: job.items.filter((item) => item.status === "completed").length,
        completedWithUrl,
        total: job.items.length,
      });
    }
    return NextResponse.json(toJobDetail(job), { headers: NO_STORE_HEADERS });
  }

  const skillType = request.nextUrl.searchParams.get("skillType") || undefined;
  const jobs = listSkillJobs(skillType).map((job) => toJobSummary(job));
  if (LOG_ALL_REQUESTS) {
    await logger.info("request.success", "Skill job list returned", {
      method: "GET",
      status: 200,
      skillType: skillType || null,
      count: jobs.length,
    });
  }
  return NextResponse.json({ jobs }, { headers: NO_STORE_HEADERS });
}
