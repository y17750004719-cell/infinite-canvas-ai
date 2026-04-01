import { NextRequest, NextResponse } from "next/server";
import { cancelSkillJob, getSkillJob, toJobDetail } from "../../../../lib/skill-jobs";
import { createLogger, createRequestId, serializeError } from "../../../../lib/logger";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

const LOG_ALL_REQUESTS = process.env.LOG_ALL_REQUESTS !== "0";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const requestId = createRequestId("skill-job-detail");
  const logger = createLogger("api.skills.jobs.detail", {
    route: "/api/skills/jobs/[jobId]",
    requestId,
  });
  try {
    if (LOG_ALL_REQUESTS) {
      await logger.info("request.start", "Skill job detail request started", {
        method: "GET",
        url: request.url,
      });
    }
    const { jobId } = await params;
    const job = getSkillJob(jobId);

    if (!job) {
      await logger.warn("request.not_found", "Skill job detail request did not find a job", {
        method: "GET",
        status: 404,
        jobId,
      });
      return NextResponse.json({ error: "Job not found" }, { status: 404, headers: NO_STORE_HEADERS });
    }

    if (LOG_ALL_REQUESTS) {
      await logger.info("request.success", "Skill job detail returned", {
        method: "GET",
        status: 200,
        jobId,
        skillType: job.skillType,
        jobStatus: job.status,
      });
    }
    return NextResponse.json(toJobDetail(job), { headers: NO_STORE_HEADERS });
  } catch (error) {
    await logger.error("request.error", "Skill job detail query failed", {
      method: "GET",
      status: 500,
      error: serializeError(error),
    });
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
  const requestId = createRequestId("skill-job-cancel");
  const logger = createLogger("api.skills.jobs.cancel", {
    route: "/api/skills/jobs/[jobId]",
    requestId,
  });
  try {
    if (LOG_ALL_REQUESTS) {
      await logger.info("request.start", "Skill job cancel request started", {
        method: "DELETE",
        url: request.url,
      });
    }
    const { jobId } = await params;
    const cancelled = cancelSkillJob(jobId);

    if (!cancelled) {
      await logger.warn("request.not_found", "Skill job cancel request did not find a job", {
        method: "DELETE",
        status: 404,
        jobId,
      });
      return NextResponse.json({ error: "Job not found" }, { status: 404, headers: NO_STORE_HEADERS });
    }

    const job = getSkillJob(jobId);
    if (LOG_ALL_REQUESTS) {
      await logger.info("request.success", "Skill job cancelled", {
        method: "DELETE",
        status: 200,
        jobId,
        jobStatus: job?.status || "cancelled",
      });
    }
    return NextResponse.json({
      jobId,
      status: job?.status || "cancelled",
      message: "Job cancelled",
    }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    await logger.error("request.error", "Skill job cancel failed", {
      method: "DELETE",
      status: 500,
      error: serializeError(error),
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Cancel failed" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
