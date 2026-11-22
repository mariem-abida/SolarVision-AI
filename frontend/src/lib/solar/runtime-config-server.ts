import { publicApiUrl, type PublicRuntimeConfig } from "./runtime-config";

/** Served at request time, so promoting an image does not bake in a host port. */
export function runtimeConfigResponse(value: unknown): Response {
  const configured = typeof value === "string" && value.trim() !== "";
  const apiBaseUrl = publicApiUrl(value);
  const invalid = configured && !apiBaseUrl;
  const config: PublicRuntimeConfig = invalid
    ? { error: "Invalid public API URL configuration. Check the frontend server environment." }
    : apiBaseUrl
      ? { apiBaseUrl }
      : {};
  const body = `window.__SOLARVISION_CONFIG__ = ${JSON.stringify(config).replace(/</g, "\\u003c")};\n`;
  return new Response(body, {
    status: invalid ? 503 : 200,
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
