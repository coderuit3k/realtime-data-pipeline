export type SqlGuardResult = { ok: true } | { ok: false; reason: string };

const FORBIDDEN_KEYWORDS =
  /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|GRANT|REVOKE|TRUNCATE|MERGE|UNLOAD|VACUUM|CALL)\b/i;

export function validateReadOnlySelect(sql: string): SqlGuardResult {
  const trimmed = sql.trim();

  if (!trimmed) {
    return { ok: false, reason: "Câu lệnh SQL đang trống." };
  }
  if (!/^(SELECT|WITH)\b/i.test(trimmed)) {
    return { ok: false, reason: "Chỉ cho phép câu lệnh SELECT (có thể bắt đầu bằng WITH)." };
  }
  const withoutTrailingSemicolon = trimmed.replace(/;\s*$/, "");
  if (withoutTrailingSemicolon.includes(";")) {
    return { ok: false, reason: "Không được nối nhiều câu lệnh bằng dấu ';'." };
  }

  if (FORBIDDEN_KEYWORDS.test(trimmed)) {
    return { ok: false, reason: "Câu lệnh chứa từ khoá không được phép (chỉ đọc dữ liệu)." };
  }

  return { ok: true };
}
