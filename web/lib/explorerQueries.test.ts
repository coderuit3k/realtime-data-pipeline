import { describe, expect, it } from "vitest";
import { buildSampleQueryGroups } from "./explorerQueries";
import { buildSourceVolumeQuery } from "./athena";

const PARTS = { year: "2026", month: "09", day: "20" };

describe("buildSampleQueryGroups", () => {
  const groups = buildSampleQueryGroups(PARTS);

  it("has the original 3 groups from the mockup plus the Xếp hạng group, in order", () => {
    expect(groups.map((g) => g.label)).toEqual([
      "Tương quan",
      "Xu hướng từ khoá",
      "Khối lượng & mới nhất",
      "Xếp hạng",
    ]);
  });

  it("has exactly 11 sample queries total across all groups", () => {
    const total = groups.reduce((sum, g) => sum + g.queries.length, 0);
    expect(total).toBe(11);
  });

  it("every query's SQL references the given partition date", () => {
    for (const group of groups) {
      for (const query of group.queries) {
        expect(query.sql).toContain("year='2026'");
        expect(query.sql).toContain("month='09'");
        expect(query.sql).toContain("day='20'");
      }
    }
  });

  it("the volume-by-source query reuses buildSourceVolumeQuery verbatim, not a duplicate copy", () => {
    const volumeQuery = groups
      .flatMap((g) => g.queries)
      .find((q) => q.id === "volume-by-source");
    expect(volumeQuery?.sql).toBe(buildSourceVolumeQuery(PARTS));
  });

  it("the crypto-mentions query correlates via a keyword substring match, not a mentions table", () => {
    const query = groups.flatMap((g) => g.queries).find((q) => q.id === "crypto-mentions");
    expect(query?.sql).toContain("POSITION(c.coin_id IN mentions.keywords)");
    expect(query?.sql.toLowerCase()).not.toContain("join mentions");
  });

  it("every query id is unique", () => {
    const ids = groups.flatMap((g) => g.queries).map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("the github-stars-ranking query dedupes by repo_id (latest ingest) before ranking by stars", () => {
    const query = groups.flatMap((g) => g.queries).find((q) => q.id === "github-stars-ranking");
    expect(query?.sql).toContain("ROW_NUMBER() OVER (PARTITION BY repo_id ORDER BY ingested_at DESC)");
    expect(query?.sql).toContain("ORDER BY stars DESC");
  });

  it("the crypto-market-cap-ranking query dedupes by coin_id (latest observed_at)", () => {
    const query = groups.flatMap((g) => g.queries).find((q) => q.id === "crypto-market-cap-ranking");
    expect(query?.sql).toContain("ROW_NUMBER() OVER (PARTITION BY coin_id ORDER BY observed_at DESC)");
    expect(query?.sql).toContain("volume_24h_usd");
  });

  it("the hn-most-controversial query filters near-zero-score noise and ranks by comments-per-score", () => {
    const query = groups.flatMap((g) => g.queries).find((q) => q.id === "hn-most-controversial");
    expect(query?.sql).toContain("score >= 10");
    expect(query?.sql).toContain("CAST(num_comments AS DOUBLE) / score AS comments_per_score");
  });
});
