export type ErrorSurface =
  "root" | "auth" | "workbench" | "capture" | "library" | "team" | "settings" | "unknown";

export type RecoveryAction = "retry" | "reload" | "navigate_home" | "none";

const SAFE_IDENTIFIER = /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/;
const SAFE_DIGEST = /^[A-Za-z0-9._:-]{1,128}$/;

function safeErrorType(error: Error): string {
  return SAFE_IDENTIFIER.test(error.name) ? error.name : "Error";
}

function safeDigest(error: Error & { digest?: string }): string | undefined {
  return typeof error.digest === "string" && SAFE_DIGEST.test(error.digest)
    ? error.digest
    : undefined;
}

export async function reportClientError(
  error: Error & { digest?: string },
  surface: ErrorSurface,
  recoveryAction: RecoveryAction = "none",
): Promise<void> {
  const payload = {
    surface,
    error_type: safeErrorType(error),
    digest: safeDigest(error),
    recovery_action: recoveryAction,
  };

  try {
    await fetch("/api/client-errors", {
      method: "POST",
      credentials: "same-origin",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    // Error reporting is best-effort and must never block recovery controls.
  }
}
