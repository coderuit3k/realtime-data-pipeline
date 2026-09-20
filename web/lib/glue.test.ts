import { describe, expect, it, vi } from "vitest";
import { listCuratedTables } from "./glue";

describe("listCuratedTables", () => {
  it("maps Glue's Table[] shape into CatalogTable rows", async () => {
    const send = vi.fn().mockResolvedValue({
      TableList: [
        {
          Name: "crypto_prices",
          StorageDescriptor: {
            Location: "s3://real-bucket/curated/source=crypto/",
            Columns: [
              { Name: "price_id", Type: "string" },
              { Name: "price_usd", Type: "double" },
            ],
          },
        },
      ],
    });
    const client = { send } as unknown as import("@aws-sdk/client-glue").GlueClient;

    const tables = await listCuratedTables(client, "curated_db");

    expect(tables).toEqual([
      {
        name: "crypto_prices",
        location: "s3://real-bucket/curated/source=crypto/",
        columns: [
          { name: "price_id", type: "string" },
          { name: "price_usd", type: "double" },
        ],
      },
    ]);
  });

  it("falls back to empty location and columns when StorageDescriptor is missing", async () => {
    const send = vi.fn().mockResolvedValue({
      TableList: [{ Name: "weird_table" }],
    });
    const client = { send } as unknown as import("@aws-sdk/client-glue").GlueClient;

    const tables = await listCuratedTables(client, "curated_db");

    expect(tables).toEqual([{ name: "weird_table", location: "", columns: [] }]);
  });

  it("returns an empty array when TableList is absent", async () => {
    const send = vi.fn().mockResolvedValue({});
    const client = { send } as unknown as import("@aws-sdk/client-glue").GlueClient;

    const tables = await listCuratedTables(client, "curated_db");

    expect(tables).toEqual([]);
  });
});
