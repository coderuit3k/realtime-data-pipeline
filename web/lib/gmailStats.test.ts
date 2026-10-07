import { describe, expect, it } from "vitest";
import { fetchGmailStats, parseGmailStats, GMAIL_STATS_KEY } from "./gmailStats";

const VALID = {
  generatedAt: "2026-10-06T09:30:00+00:00",
  windowDays: 14,
  totals: { emails: 14, needsReply: 3, urgent: 1, withDeadline: 1, unclassified: 5 },
  byCategory: { newsletter: 3, notification: 0, personal: 4, recruiting: 2, other: 0 },
  perDay: [{ date: "2026-10-05", total: 9 }, { date: "2026-10-06", total: 5 }],
};

describe("parseGmailStats", () => {
  it("returns the stats when the shape is right", () => {
    expect(parseGmailStats(VALID)).toEqual(VALID);
  });

  it("copies only the whitelisted fields, so extra data never reaches the browser", () => {
    const parsed = parseGmailStats({
      ...VALID,
      subject: "SECRET",
      totals: { ...VALID.totals, sender: "a@b.c" },
      perDay: [{ date: "2026-10-06", total: 5, company: "Acme" }],
    });

    expect(JSON.stringify(parsed)).not.toContain("SECRET");
    expect(JSON.stringify(parsed)).not.toContain("a@b.c");
    expect(JSON.stringify(parsed)).not.toContain("Acme");
  });

  it.each([
    ["null", null],
    ["a string", "x"],
    ["missing totals", { ...VALID, totals: undefined }],
    ["a text count", { ...VALID, totals: { ...VALID.totals, emails: "14" } }],
    ["a missing category", { ...VALID, byCategory: { newsletter: 1 } }],
    ["a non-array perDay", { ...VALID, perDay: {} }],
    ["a bad perDay entry", { ...VALID, perDay: [{ date: 5, total: 1 }] }],
    ["a missing timestamp", { ...VALID, generatedAt: undefined }],
  ])("returns null for %s", (_name, value) => {
    expect(parseGmailStats(value)).toBeNull();
  });
});

type S3Like = Parameters<typeof fetchGmailStats>[0];

function clientReturning(result: unknown) {
  const sent: unknown[] = [];
  const client = {
    sent,
    send: async (command: unknown) => {
      sent.push(command);
      if (result instanceof Error) throw result;
      return result;
    },
  };
  // The fake only implements send(); S3Client's overloaded signature needs a cast for tsc.
  return client as typeof client & S3Like;
}

const body = (text: string) => ({ Body: { transformToString: async () => text } });

describe("fetchGmailStats", () => {
  it("reads the stats object from the curated bucket", async () => {
    const client = clientReturning(body(JSON.stringify(VALID)));

    const stats = await fetchGmailStats(client, "curated-bucket");

    expect(stats).toEqual(VALID);
    const input = (client.sent[0] as { input: { Bucket: string; Key: string } }).input;
    expect(input).toEqual({ Bucket: "curated-bucket", Key: GMAIL_STATS_KEY });
    expect(GMAIL_STATS_KEY).toBe("gmail_stats/latest.json");
  });

  it("returns null when the object does not exist yet", async () => {
    const missing = Object.assign(new Error("nope"), { name: "NoSuchKey" });

    expect(await fetchGmailStats(clientReturning(missing), "b")).toBeNull();
  });

  it("returns null when the file is not valid JSON", async () => {
    expect(await fetchGmailStats(clientReturning(body("{not json")), "b")).toBeNull();
  });

  it("returns null when the body is empty", async () => {
    expect(await fetchGmailStats(clientReturning({}), "b")).toBeNull();
  });

  it("rethrows other S3 errors", async () => {
    const denied = Object.assign(new Error("denied"), { name: "AccessDenied" });

    await expect(fetchGmailStats(clientReturning(denied), "b")).rejects.toThrow("denied");
  });
});
