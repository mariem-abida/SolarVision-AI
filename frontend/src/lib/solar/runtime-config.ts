/** Public browser configuration only. Never place credentials in these values. */
export type PublicRuntimeConfig = { apiBaseUrl?: string; error?: string };

declare global {
  interface Window {
    __SOLARVISION_CONFIG__?: PublicRuntimeConfig;
  }
}

export function publicApiUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return undefined;
    return url.toString().replace(/\/+$/, "");
  } catch {
    return undefined;
  }
}

export function getDefaultApiUrl(): string {
  const runtime =
    typeof window === "undefined" ? undefined : window.__SOLARVISION_CONFIG__?.apiBaseUrl;
  return publicApiUrl(runtime) || getBuildApiUrl();
}

/** A stable initial SSR/client value; runtime and saved preferences apply after hydration. */
export function getBuildApiUrl(): string {
  return publicApiUrl(import.meta.env["VITE_API_BASE_URL"]) || "http://127.0.0.1:8000";
}
