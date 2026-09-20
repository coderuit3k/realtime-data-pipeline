import { describe, expect, it, vi, beforeEach } from "vitest";
import { getLatestWorkflowRun, getRunJobs, getRecentRuns } from "./github";

const REAL_RUN = {
  id: 35519882317,
  status: "completed",
  conclusion: "success",
  display_title: "Give news_ingestion its own slower EventBridge schedule",
  head_sha: "d74bf016d26a78dc9f6d5f8f6704471479413909",
  head_branch: "main",
  run_started_at: "2026-09-20T15:32:08Z",
  updated_at: "2026-09-20T15:34:23Z",
  html_url: "https://github.com/coderuit3k/realtime-data-pipeline/actions/runs/35519882317",
};

beforeEach(() => {
  process.env.GITHUB_READ_TOKEN = "test-token";
  vi.restoreAllMocks();
});

describe("getLatestWorkflowRun", () => {
  it("maps the real GitHub run shape into GithubRun", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ workflow_runs: [REAL_RUN] }),
      })
    );

    const run = await getLatestWorkflowRun("deploy.yml");

    expect(run).toEqual({
      id: 35519882317,
      status: "completed",
      conclusion: "success",
      displayTitle: "Give news_ingestion its own slower EventBridge schedule",
      headSha: "d74bf016d26a78dc9f6d5f8f6704471479413909",
      headBranch: "main",
      runStartedAt: "2026-09-20T15:32:08Z",
      updatedAt: "2026-09-20T15:34:23Z",
      htmlUrl: "https://github.com/coderuit3k/realtime-data-pipeline/actions/runs/35519882317",
    });

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe(
      "https://api.github.com/repos/coderuit3k/realtime-data-pipeline/actions/workflows/deploy.yml/runs?branch=main&per_page=1"
    );
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer test-token",
      Accept: "application/vnd.github+json",
    });
  });

  it("returns null when there are no runs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ workflow_runs: [] }) })
    );

    const run = await getLatestWorkflowRun("deploy.yml");
    expect(run).toBeNull();
  });

  it("throws a clear error on a non-2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401, statusText: "Unauthorized" }));

    await expect(getLatestWorkflowRun("deploy.yml")).rejects.toThrow(
      "GitHub API request failed: 401 Unauthorized"
    );
  });
});

describe("getRunJobs", () => {
  it("maps the real jobs shape, using the literal job name strings", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            jobs: [
              { id: 106102022556, name: "plan", status: "completed", conclusion: "success" },
              { id: 106102127573, name: "apply", status: "waiting", conclusion: null },
            ],
          }),
      })
    );

    const jobs = await getRunJobs(35519882317);

    expect(jobs).toEqual([
      { name: "plan", status: "completed", conclusion: "success" },
      { name: "apply", status: "waiting", conclusion: null },
    ]);
    const [url] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe(
      "https://api.github.com/repos/coderuit3k/realtime-data-pipeline/actions/runs/35519882317/jobs"
    );
  });
});

describe("getRecentRuns", () => {
  it("requests the given limit and maps every run", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ workflow_runs: [REAL_RUN, REAL_RUN] }) })
    );

    const runs = await getRecentRuns("deploy.yml", 5);

    expect(runs).toHaveLength(2);
    expect(runs[0].displayTitle).toBe(REAL_RUN.display_title);
    const [url] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe(
      "https://api.github.com/repos/coderuit3k/realtime-data-pipeline/actions/workflows/deploy.yml/runs?branch=main&per_page=5"
    );
  });
});
