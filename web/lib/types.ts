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

export type ExplorerQueryResult = {
  columns: string[];
  rows: (string | null)[][];
  scannedBytes: number;
  elapsedMs: number;
  hasMoreRows: boolean;
};

export type TopKeyword = { keyword: string; mentions: number };
export type CryptoMention = { coinId: string; priceUsd: number; change24hPct: number; mentionCount: number };
export type GithubHnOverlap = { keyword: string; overlapCount: number };
export type WeatherSnapshot = { location: string; temperatureC: number; humidityPct: number };

export type InsightsResponse = {
  range: "today" | "7d";
  topKeywords: TopKeyword[];
  cryptoMentions: CryptoMention[];
  githubHnOverlap: GithubHnOverlap[];
  weatherSnapshot: WeatherSnapshot[];
};

export type LambdaHealthRow = {
  functionLabel: string;
  status: "ok" | "error" | "idle";
  lastInvocationAt: string | null;
  errors24h: number;
  avgDurationMs: number | null;
};

export type LogEntry = { timestamp: string; message: string; source: string };

export type CostBreakdownEntry = { category: string; monthlyUsd: number };

export type OpsResponse = {
  lambdaHealth: LambdaHealthRow[];
  schedule: { scheduleExpression: string; enabled: boolean };
  alarmsBreaching: number;
  alarmsTotal: number;
  costEstimateUsd: number;
  costBreakdown: CostBreakdownEntry[];
  recentLogs: LogEntry[];
};
