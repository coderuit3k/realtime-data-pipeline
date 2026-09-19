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
