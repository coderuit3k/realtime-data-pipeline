import { describe, expect, it } from "vitest";
import { validateReadOnlySelect } from "./sqlGuard";

describe("validateReadOnlySelect", () => {
  it("accepts a plain SELECT", () => {
    expect(validateReadOnlySelect("SELECT * FROM crypto_prices")).toEqual({ ok: true });
  });

  it("accepts a WITH ... SELECT (CTE)", () => {
    expect(validateReadOnlySelect("WITH x AS (SELECT 1) SELECT * FROM x")).toEqual({ ok: true });
  });

  it("accepts leading whitespace and lowercase select", () => {
    expect(validateReadOnlySelect("  select 1")).toEqual({ ok: true });
  });

  it("rejects an empty string", () => {
    const result = validateReadOnlySelect("   ");
    expect(result.ok).toBe(false);
  });

  it("rejects a statement that doesn't start with SELECT or WITH", () => {
    const result = validateReadOnlySelect("EXPLAIN SELECT * FROM crypto_prices");
    expect(result).toEqual({ ok: false, reason: "Chỉ cho phép câu lệnh SELECT (có thể bắt đầu bằng WITH)." });
  });

  it.each([
    "INSERT INTO crypto_prices VALUES (1)",
    "UPDATE crypto_prices SET price_usd=1",
    "DELETE FROM crypto_prices",
    "DROP TABLE crypto_prices",
    "ALTER TABLE crypto_prices ADD COLUMN x int",
    "CREATE TABLE x AS SELECT * FROM crypto_prices",
    "GRANT SELECT ON crypto_prices TO someone",
    "REVOKE SELECT ON crypto_prices FROM someone",
    "TRUNCATE TABLE crypto_prices",
    "MERGE INTO crypto_prices USING x ON true WHEN MATCHED THEN DELETE",
    "UNLOAD (SELECT 1) TO 's3://bucket/' WITH (format='JSON')",
    "VACUUM crypto_prices",
    "CALL some_procedure()",
  ])("rejects a forbidden statement: %s", (sql) => {
    const result = validateReadOnlySelect(sql);
    expect(result.ok).toBe(false);
  });

  it("rejects a forbidden keyword smuggled inside a CTE under a legitimate WITH/SELECT prefix", () => {
    const result = validateReadOnlySelect(
      "WITH x AS (INSERT INTO crypto_prices VALUES (1)) SELECT * FROM x"
    );
    expect(result).toEqual({ ok: false, reason: "Câu lệnh chứa từ khoá không được phép (chỉ đọc dữ liệu)." });
  });

  it("rejects a SELECT followed by a second statement", () => {
    const result = validateReadOnlySelect("SELECT 1; DROP TABLE crypto_prices");
    expect(result).toEqual({ ok: false, reason: "Không được nối nhiều câu lệnh bằng dấu ';'." });
  });

  it("allows a single trailing semicolon", () => {
    expect(validateReadOnlySelect("SELECT 1;")).toEqual({ ok: true });
  });

  it("does not false-positive on a forbidden word appearing inside a string literal's substring of a column name", () => {
    // 'created_at' contains no forbidden keyword as a whole word; this guards
    // against a naive substring match (not a word-boundary match) rejecting
    // legitimate queries.
    expect(validateReadOnlySelect("SELECT created_at FROM hackernews_stories")).toEqual({ ok: true });
  });
});
