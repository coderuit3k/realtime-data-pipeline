import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { buildCatalogWorkbook } from "./excelExport";

describe("buildCatalogWorkbook", () => {
  it("writes a header row and data rows for one sheet", async () => {
    const buffer = await buildCatalogWorkbook([
      {
        name: "hackernews_stories",
        columns: ["story_id", "title"],
        rows: [
          ["1", "Hello"],
          ["2", "World"],
        ],
      },
    ]);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.getWorksheet("hackernews_stories");

    expect(sheet).toBeDefined();
    expect(sheet!.rowCount).toBe(3);
    expect(sheet!.getRow(1).values).toEqual([undefined, "story_id", "title"]);
    expect(sheet!.getRow(2).values).toEqual([undefined, "1", "Hello"]);
    expect(sheet!.getRow(3).values).toEqual([undefined, "2", "World"]);
  });

  it("writes multiple sheets in the given order", async () => {
    const buffer = await buildCatalogWorkbook([
      { name: "a_table", columns: ["x"], rows: [["1"]] },
      { name: "b_table", columns: ["y"], rows: [["2"]] },
    ]);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    expect(workbook.worksheets.map((w) => w.name)).toEqual(["a_table", "b_table"]);
  });

  it("writes a header-only sheet when a table has zero rows", async () => {
    const buffer = await buildCatalogWorkbook([{ name: "empty_table", columns: ["x", "y"], rows: [] }]);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.getWorksheet("empty_table")!;

    expect(sheet.rowCount).toBe(1);
    expect(sheet.getRow(1).values).toEqual([undefined, "x", "y"]);
  });
});
