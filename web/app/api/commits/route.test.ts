import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/github", () => ({ getRecentCommits: vi.fn() }));

import { getRecentCommits } from "@/lib/github";
import { GET } from "./route";

const mockedGetRecentCommits = vi.mocked(getRecentCommits);

beforeEach(() => {
  mockedGetRecentCommits.mockReset();
});

describe("GET /api/commits", () => {
  it("returns the 5 most recent real commits with a short Cache-Control", async () => {
    const commits = [
      {
        sha: "d566a7154738a4ae790b89ed0bea0265cdfebcd9",
        message: "feat: restyle web app to Terminal Obsidian design system",
        authorName: "coderuit3k",
        date: "2026-09-23T03:08:05Z",
        htmlUrl:
          "https://github.com/coderuit3k/realtime-data-pipeline/commit/d566a7154738a4ae790b89ed0bea0265cdfebcd9",
      },
    ];
    mockedGetRecentCommits.mockResolvedValue(commits);

    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("public, s-maxage=60, stale-while-revalidate=120");
    const body = await response.json();
    expect(body).toEqual({ commits });
    expect(mockedGetRecentCommits).toHaveBeenCalledWith(5);
  });

  it("returns 500 with a safe message when the GitHub API fails", async () => {
    mockedGetRecentCommits.mockRejectedValue(new Error("boom"));
    const response = await GET();
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("Không tải được commit, thử lại sau.");
  });
});
