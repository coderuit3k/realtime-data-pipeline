import { GetTablesCommand, type GlueClient } from "@aws-sdk/client-glue";
import type { CatalogColumn } from "./types";

type BareTable = { name: string; columns: CatalogColumn[]; location: string };

export async function listCuratedTables(client: GlueClient, database: string): Promise<BareTable[]> {
  const response = await client.send(new GetTablesCommand({ DatabaseName: database }));
  return (response.TableList ?? []).map((table) => ({
    name: table.Name ?? "",
    location: table.StorageDescriptor?.Location ?? "",
    columns: [
      ...(table.StorageDescriptor?.Columns ?? []),
      ...(table.PartitionKeys ?? []),
    ].map((col) => ({
      name: col.Name ?? "",
      type: col.Type ?? "",
      note: col.Comment || undefined,
    })),
  }));
}
