import { describe, expect, it } from "vitest";
import {
  buildTopKeywordsQuery,
  buildCryptoMentionsQuery,
  buildGithubHnOverlapQuery,
  buildGithubLanguagesQuery,
  buildHnSpotlightQuery,
  buildWeatherSnapshotQuery,
} from "./insightsQueries";

const PARTS_TODAY = [{ year: "2026", month: "09", day: "20" }];
const PARTS_7D = [
  { year: "2026", month: "09", day: "20" },
  { year: "2026", month: "09", day: "19" },
];

describe("buildTopKeywordsQuery", () => {
  it("references both hackernews_stories and news_articles, capped at 6", () => {
    const sql = buildTopKeywordsQuery(PARTS_TODAY);
    expect(sql).toContain("hackernews_stories");
    expect(sql).toContain("news_articles");
    expect(sql).toContain("LIMIT 6");
  });

  it("references every day in a multi-day range", () => {
    const sql = buildTopKeywordsQuery(PARTS_7D);
    expect(sql).toContain("day='20'");
    expect(sql).toContain("day='19'");
  });
});

describe("buildCryptoMentionsQuery", () => {
  it("uses a window function to pick the latest row per coin, not a fictional mentions table", () => {
    const sql = buildCryptoMentionsQuery(PARTS_TODAY);
    expect(sql).toContain("ROW_NUMBER() OVER (PARTITION BY c.coin_id ORDER BY c.observed_at DESC)");
    expect(sql).toContain("POSITION(c.coin_id IN m.keywords)");
    expect(sql.toLowerCase()).not.toContain("join mentions");
  });
});

describe("buildGithubHnOverlapQuery", () => {
  it("groups by keyword with a distinct-repo count", () => {
    const sql = buildGithubHnOverlapQuery(PARTS_TODAY);
    expect(sql).toContain("COUNT(DISTINCT g.full_name) AS overlap_count");
    expect(sql).toContain("GROUP BY gk");
  });
});

describe("buildGithubLanguagesQuery", () => {
  it("groups by language, excludes blanks, capped at 6", () => {
    const sql = buildGithubLanguagesQuery(PARTS_TODAY);
    expect(sql).toContain("GROUP BY language");
    expect(sql).toContain("language <> ''");
    expect(sql).toContain("LIMIT 6");
  });

  it("references every day in a multi-day range", () => {
    const sql = buildGithubLanguagesQuery(PARTS_7D);
    expect(sql).toContain("day='20'");
    expect(sql).toContain("day='19'");
  });
});

describe("buildHnSpotlightQuery", () => {
  it("picks the single highest-scoring story and falls back to permalink when url is blank", () => {
    const sql = buildHnSpotlightQuery(PARTS_TODAY);
    expect(sql).toContain("ORDER BY score DESC");
    expect(sql).toContain("LIMIT 1");
    expect(sql).toContain("COALESCE(NULLIF(url, ''), permalink)");
  });
});

describe("buildWeatherSnapshotQuery", () => {
  it("takes a single TodayParts and ranks by latest observed_at per location", () => {
    const sql = buildWeatherSnapshotQuery(PARTS_TODAY[0]);
    expect(sql).toContain("ROW_NUMBER() OVER (PARTITION BY location ORDER BY observed_at DESC)");
    expect(sql).toContain("day='20'");
  });
});
