// Pure default-project derivation for the CLI's `--project` flag: no env read, no I/O — the
// caller passes in whatever it read from process.env.GUIDEO_TARGET_URL, so this stays unit-testable
// without env mutation.
export function defaultProjectName(targetUrl: string | undefined): string {
  if (!targetUrl) return "default";
  let host: string;
  try {
    host = new URL(targetUrl).host;
  } catch {
    return "default";
  }
  const slug = host
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "default";
}
