import { requiredEnv } from "./aws";
import type { GithubRun, GithubJob, GithubCommit } from "./types";

const GITHUB_OWNER = "coderuit3k";
const GITHUB_REPO = "realtime-data-pipeline";
const GITHUB_API_BASE = "https://api.github.com";

type RawRun = {
  id: number;
  status: string;
  conclusion: string | null;
  display_title: string;
  head_sha: string;
  head_branch: string;
  run_started_at: string | null;
  updated_at: string;
  html_url: string;
};

type RawCommit = {
  sha: string;
  commit: { author: { name: string; date: string } | null; message: string };
  html_url: string;
};

async function githubRequest<T>(path: string): Promise<T> {
  const token = requiredEnv("GITHUB_READ_TOKEN");
  const response = await fetch(`${GITHUB_API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "realtime-data-pipeline-web",
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub API request failed: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

function mapRun(run: RawRun): GithubRun {
  return {
    id: run.id,
    status: run.status,
    conclusion: run.conclusion,
    displayTitle: run.display_title,
    headSha: run.head_sha,
    headBranch: run.head_branch,
    runStartedAt: run.run_started_at,
    updatedAt: run.updated_at,
    htmlUrl: run.html_url,
  };
}

function mapCommit(raw: RawCommit): GithubCommit {
  return {
    sha: raw.sha,
    message: raw.commit.message.split("\n")[0],
    authorName: raw.commit.author?.name ?? "unknown",
    date: raw.commit.author?.date ?? "",
    htmlUrl: raw.html_url,
  };
}

export async function getLatestWorkflowRun(workflowFile: string): Promise<GithubRun | null> {
  const data = await githubRequest<{ workflow_runs: RawRun[] }>(
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${workflowFile}/runs?branch=main&per_page=1`
  );
  const run = data.workflow_runs[0];
  return run ? mapRun(run) : null;
}

export async function getRunJobs(runId: number): Promise<GithubJob[]> {
  const data = await githubRequest<{ jobs: { name: string; status: string; conclusion: string | null }[] }>(
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/runs/${runId}/jobs`
  );
  return data.jobs.map((j) => ({ name: j.name, status: j.status, conclusion: j.conclusion }));
}

export async function getRecentRuns(workflowFile: string, limit: number): Promise<GithubRun[]> {
  const data = await githubRequest<{ workflow_runs: RawRun[] }>(
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${workflowFile}/runs?branch=main&per_page=${limit}`
  );
  return data.workflow_runs.map(mapRun);
}

export async function getRecentCommits(limit: number): Promise<GithubCommit[]> {
  const data = await githubRequest<RawCommit[]>(
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/commits?per_page=${limit}`
  );
  return data.map(mapCommit);
}
