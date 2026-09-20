export type SourceVolume = { source: string; records: number };
export type ActivityItem = { source: string; label: string; ingestedAt: string };

export type DashboardResponse = {
  recordsToday: number;
  sourceVolumes: SourceVolume[];
  sourcesHealthy: number;
  sourcesTotal: number;
  alarmsBreaching: number;
  alarmsTotal: number;
  costEstimateUsd: number;
  recentActivity: ActivityItem[];
};

export type CatalogColumn = { name: string; type: string; note?: string };

export type CatalogTable = {
  name: string;
  columns: CatalogColumn[];
  location: string;
  ragIndexed: boolean;
  sourceApi: string;
  ingestionLambda: string;
  cadence: string;
};

export type CatalogTableMeta = {
  ragIndexed: boolean;
  sourceApi: string;
  ingestionLambda: string;
  cadence: string;
  columnNotes?: Record<string, string>;
};

export type SampleQuery = { id: string; label: string; sql: string };
export type SampleQueryGroup = { label: string; queries: SampleQuery[] };
