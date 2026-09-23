export type SourceVolume = { source: string; records: number };
export type ActivityItem = { source: string; label: string; ingestedAt: string };

export type DashboardResponse = {
  recordsToday: number;
  sourceVolumes: SourceVolume[];
  sourcesHealthy: number;
  sourcesTotal: number;
  alarmsBreaching: number;
  alarmsTotal: number;
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
  costBreakdown: CostBreakdownEntry[];
  recentLogs: LogEntry[];
};

export type GithubRun = {
  id: number;
  status: string;
  conclusion: string | null;
  displayTitle: string;
  headSha: string;
  headBranch: string;
  runStartedAt: string | null;
  updatedAt: string;
  htmlUrl: string;
};

export type GithubJob = { name: string; status: string; conclusion: string | null };

export type GithubCommit = {
  sha: string;
  message: string;
  authorName: string;
  date: string;
  htmlUrl: string;
};

export type CommitsResponse = { commits: GithubCommit[] };

export type PipelineStage = {
  name: string;
  status: "success" | "failure" | "waiting" | "in_progress" | "pending" | "cancelled" | "skipped";
  detail: string;
};

export type CicdRun = {
  title: string;
  sha: string;
  branch: string;
  conclusion: string | null;
  durationMs: number | null;
  htmlUrl: string;
};

export type CicdResponse = {
  stages: PipelineStage[];
  recentRuns: CicdRun[];
  latestDeployRunUrl: string | null;
};

export type WeatherLocation = {
  location: string;
  latitude: number;
  longitude: number;
  temperatureC: number;
  humidityPct: number;
  precipitationMm: number;
  windSpeedKmh: number;
  observedAt: string;
};

export type WeatherResponse = { locations: WeatherLocation[] };

export type WeatherHistoryPoint = { hourBucket: string; avgTemperatureC: number };

export type WeatherHistoryResponse = { location: string; points: WeatherHistoryPoint[] };

export type ScheduleStatus = { scheduleExpression: string; enabled: boolean };

export type SecretStatus = { name: string; configured: boolean };

export type SettingsResponse = {
  sharedSchedule: ScheduleStatus;
  newsSchedule: ScheduleStatus;
  secrets: SecretStatus[];
};

export type HealthResponse = {
  sourcesHealthy: number;
  sourcesTotal: number;
  region: string;
  environment: string;
};

export type CostResponse = {
  monthToDateCostUsd: number;
};
