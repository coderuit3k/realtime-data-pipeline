// web/app/api/cicd/route.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/github", () => ({
  getLatestWorkflowRun: vi.fn(),
  getRunJobs: vi.fn(),
  getRecentRuns: vi.fn(),
}));

import { getLatestWorkflowRun, getRunJobs, getRecentRuns } from "@/lib/github";
import { GET } from "./route";

const mockedLatest = vi.mocked(getLatestWorkflowRun);
const mockedJobs = vi.mocked(getRunJobs);
const mockedRecent = vi.mocked(getRecentRuns);

function run(overrides: Partial<{ id: number; htmlUrl: string }> = {}) {
  return {
    id: overrides.id ?? 1,
    status: "completed",
    conclusion: "success",
    displayTitle: "some commit",
    headSha: "abcdef1234567890",
    headBranch: "main",
    runStartedAt: "2026-09-20T10:00:00Z",
    updatedAt: "2026-09-20T10:02:00Z",
    htmlUrl: overrides.htmlUrl ?? "https://github.com/x/y/actions/runs/1",
  };
}

beforeEach(() => {
  mockedLatest.mockReset();
  mockedJobs.mockReset();
  mockedRecent.mockReset();
});

describe("GET /api/cicd", () => {
  it("builds all-success stages when every job succeeded", async () => {
    mockedLatest.mockImplementation((file) =>
      Promise.resolve(file === "ci.yml" ? run({ id: 10 }) : run({ id: 20 }))
    );
    mockedJobs.mockImplementation((id) =>
      Promise.resolve(
        id === 10
          ? [{ name: "lint-and-test", status: "completed", conclusion: "success" }]
          : [
              { name: "plan", status: "completed", conclusion: "success" },
              { name: "apply", status: "completed", conclusion: "success" },
            ]
      )
    );
    mockedRecent.mockResolvedValue([run({ id: 20 })]);

    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.stages).toEqual([
      { name: "Lint & Test", status: "success", detail: "" },
      { name: "Terraform Plan", status: "success", detail: "auto" },
      { name: "Chờ phê duyệt", status: "success", detail: "environment: production" },
      { name: "Terraform Apply", status: "success", detail: "-auto-approve tfplan" },
    ]);
    expect(body.recentRuns).toHaveLength(1);
    expect(body.recentRuns[0].sha).toBe("abcdef1"); // first 7 chars
    expect(body.latestDeployRunUrl).toBe("https://github.com/x/y/actions/runs/1");
  });

  it("shows the live gate case: apply job status 'waiting'", async () => {
    mockedLatest.mockImplementation((file) =>
      Promise.resolve(file === "ci.yml" ? run({ id: 10 }) : run({ id: 20 }))
    );
    mockedJobs.mockImplementation((id) =>
      Promise.resolve(
        id === 10
          ? [{ name: "lint-and-test", status: "completed", conclusion: "success" }]
          : [
              { name: "plan", status: "completed", conclusion: "success" },
              { name: "apply", status: "waiting", conclusion: null },
            ]
      )
    );
    mockedRecent.mockResolvedValue([]);

    const response = await GET();
    const body = await response.json();
    expect(body.stages[2]).toEqual({ name: "Chờ phê duyệt", status: "waiting", detail: "environment: production" });
    expect(body.stages[3]).toEqual({ name: "Terraform Apply", status: "pending", detail: "-auto-approve tfplan" });
  });

  it("shows apply as skipped (not approved) when plan failed", async () => {
    mockedLatest.mockImplementation((file) =>
      Promise.resolve(file === "ci.yml" ? run({ id: 10 }) : run({ id: 20 }))
    );
    mockedJobs.mockImplementation((id) =>
      Promise.resolve(
        id === 10
          ? [{ name: "lint-and-test", status: "completed", conclusion: "success" }]
          : [
              { name: "plan", status: "completed", conclusion: "failure" },
              { name: "apply", status: "completed", conclusion: "skipped" },
            ]
      )
    );
    mockedRecent.mockResolvedValue([]);

    const response = await GET();
    const body = await response.json();
    expect(body.stages[1]).toEqual({ name: "Terraform Plan", status: "failure", detail: "auto" });
    expect(body.stages[2]).toEqual({ name: "Chờ phê duyệt", status: "pending", detail: "environment: production" });
    expect(body.stages[3]).toEqual({ name: "Terraform Apply", status: "skipped", detail: "-auto-approve tfplan" });
  });

  it("shows a cancelled apply without claiming the gate was approved", async () => {
    mockedLatest.mockImplementation((file) =>
      Promise.resolve(file === "ci.yml" ? run({ id: 10 }) : run({ id: 20 }))
    );
    mockedJobs.mockImplementation((id) =>
      Promise.resolve(
        id === 10
          ? [{ name: "lint-and-test", status: "completed", conclusion: "success" }]
          : [
              { name: "plan", status: "completed", conclusion: "success" },
              { name: "apply", status: "completed", conclusion: "cancelled" },
            ]
      )
    );
    mockedRecent.mockResolvedValue([]);

    const response = await GET();
    const body = await response.json();
    expect(body.stages[2]).toEqual({ name: "Chờ phê duyệt", status: "cancelled", detail: "environment: production" });
    expect(body.stages[3]).toEqual({ name: "Terraform Apply", status: "cancelled", detail: "-auto-approve tfplan" });
  });

  it("returns 500 with a safe message when the GitHub API fails", async () => {
    mockedLatest.mockRejectedValue(new Error("GitHub API request failed: 401 Unauthorized"));
    const response = await GET();
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("Không tải được CI/CD, thử lại sau.");
  });
});
