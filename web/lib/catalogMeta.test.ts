import { describe, expect, it } from "vitest";
import { CATALOG_META } from "./catalogMeta";

describe("CATALOG_META", () => {
  it("has an entry for all 5 curated tables", () => {
    expect(Object.keys(CATALOG_META).sort()).toEqual([
      "crypto_prices",
      "github_repos",
      "hackernews_stories",
      "news_articles",
      "weather_observations",
    ]);
  });

  it("marks only hackernews, news, and github as RAG-indexed", () => {
    expect(CATALOG_META.hackernews_stories.ragIndexed).toBe(true);
    expect(CATALOG_META.news_articles.ragIndexed).toBe(true);
    expect(CATALOG_META.github_repos.ragIndexed).toBe(true);
    expect(CATALOG_META.crypto_prices.ragIndexed).toBe(false);
    expect(CATALOG_META.weather_observations.ragIndexed).toBe(false);
  });

  it("gives every table the shared 10-minute cadence, except news_articles on its own slower 20-minute cadence", () => {
    for (const [id, meta] of Object.entries(CATALOG_META)) {
      expect(meta.cadence).toBe(id === "news_articles" ? "mỗi 20 phút" : "mỗi 10 phút");
    }
  });

  it("has a verified note on crypto_prices.price_usd about the float cast", () => {
    expect(CATALOG_META.crypto_prices.columnNotes?.price_usd).toMatch(/float/i);
  });
});
