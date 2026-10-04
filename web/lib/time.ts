/**
 * Vietnamese "N minutes/hours/days ago"; future timestamps clamp to "just now".
 * Pass `maxUnit: "hours"` where the data only spans 24h (Lambda health), and
 * a null `iso` yields "chưa có dữ liệu".
 */
export function relativeTime(
  iso: string | null,
  now: Date = new Date(),
  { maxUnit = "days" }: { maxUnit?: "hours" | "days" } = {},
): string {
  if (!iso) return "chưa có dữ liệu";
  const diffMs = now.getTime() - new Date(iso).getTime();
  const minutes = Math.max(0, Math.round(diffMs / 60000));
  if (minutes < 1) return "vừa xong";
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.round(minutes / 60);
  if (hours < 24 || maxUnit === "hours") return `${hours} giờ trước`;
  return `${Math.round(hours / 24)} ngày trước`;
}
