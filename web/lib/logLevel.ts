export type LogLevel = "ERROR" | "WARN" | "INFO";

/** CloudWatch lines carry no structured level, so infer it from the text; WARNING folds into WARN. */
export function detectLogLevel(message: string): LogLevel {
  const match = message.match(/\b(ERROR|WARN(?:ING)?|INFO)\b/);
  if (!match) return "INFO";
  return match[1] === "WARNING" ? "WARN" : (match[1] as LogLevel);
}

export function logLevelColor(level: LogLevel): string {
  if (level === "ERROR") return "text-error";
  if (level === "WARN") return "text-warning";
  return "text-accent";
}
