import { NextResponse } from "next/server";
import { getLatestWorkflowRun, getRunJobs, getRecentRuns } from "@/lib/github";
import type { CicdResponse, PipelineStage, GithubJob, GithubRun } from "@/lib/types";

export const maxDuration = 60;

function jobStatus(job: GithubJob | undefined): PipelineStage["status"] {
  if (!job) return "pending";
  if (job.status === "completed") {
    if (job.conclusion === "success") return "success";
    if (job.conclusion === "cancelled") return "cancelled";
    if (job.conclusion === "skipped") return "skipped";
    return "failure";
  }
  if (job.status === "waiting") return "waiting";
  if (job.status === "in_progress") return "in_progress";
  return "pending";
}

function buildStages(
  lintJob: GithubJob | undefined,
  planJob: GithubJob | undefined,
  applyJob: GithubJob | undefined
): PipelineStage[] {
  let approvalStatus: PipelineStage["status"];
  let applyStatus: PipelineStage["status"];

  if (!applyJob || applyJob.status === "queued" || applyJob.status === "requested") {
    approvalStatus = "pending";
    applyStatus = "pending";
  } else if (applyJob.status === "waiting") {
    approvalStatus = "waiting";
    applyStatus = "pending";
  } else if (applyJob.status === "completed" && applyJob.conclusion === "skipped") {
    // apply's `needs: plan` dependency failed, so apply never ran and the
    // approval gate was never reached -- not the same as "passed"
    approvalStatus = "pending";
    applyStatus = "skipped";
  } else if (applyJob.status === "completed" && applyJob.conclusion === "cancelled") {
    // cancelled while waiting on the gate or while applying -- GitHub's
    // API gives no way to tell which, so never claim the gate passed
    approvalStatus = "cancelled";
    applyStatus = "cancelled";
  } else {
    approvalStatus = "success";
    applyStatus = jobStatus(applyJob);
  }

  return [
    { name: "Lint & Test", status: jobStatus(lintJob), detail: "" },
    { name: "Terraform Plan", status: jobStatus(planJob), detail: "auto" },
    { name: "Chờ phê duyệt", status: approvalStatus, detail: "environment: production" },
    { name: "Terraform Apply", status: applyStatus, detail: "-auto-approve tfplan" },
  ];
}

function toDurationMs(run: GithubRun): number | null {
  if (!run.runStartedAt) return null;
  return new Date(run.updatedAt).getTime() - new Date(run.runStartedAt).getTime();
}

export async function GET() {
  try {
    const [ciRun, deployRun] = await Promise.all([
      getLatestWorkflowRun("ci.yml"),
      getLatestWorkflowRun("deploy.yml"),
    ]);

    const [ciJobs, deployJobs, recentDeployRuns] = await Promise.all([
      ciRun ? getRunJobs(ciRun.id) : Promise.resolve([]),
      deployRun ? getRunJobs(deployRun.id) : Promise.resolve([]),
      getRecentRuns("deploy.yml", 5),
    ]);

    const lintJob = ciJobs.find((j) => j.name === "lint-and-test");
    const planJob = deployJobs.find((j) => j.name === "plan");
    const applyJob = deployJobs.find((j) => j.name === "apply");

    const response: CicdResponse = {
      stages: buildStages(lintJob, planJob, applyJob),
      recentRuns: recentDeployRuns.map((r) => ({
        title: r.displayTitle,
        sha: r.headSha.slice(0, 7),
        branch: r.headBranch,
        conclusion: r.conclusion,
        durationMs: toDurationMs(r),
        htmlUrl: r.htmlUrl,
      })),
      latestDeployRunUrl: deployRun?.htmlUrl ?? null,
    };

    return NextResponse.json(response, {
      headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" },
    });
  } catch (error) {
    console.error("CI/CD API failed", error);
    return NextResponse.json({ error: "Không tải được CI/CD, thử lại sau." }, { status: 500 });
  }
}
