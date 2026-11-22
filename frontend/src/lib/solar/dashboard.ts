import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { normalizeApiUrl } from "@/lib/solar/api";
import { useWorkspace } from "@/components/solar/workspace";

const numberMap = z.record(z.number().finite());
const status = z.enum(["available", "unavailable", "not_configured"]);
const metadataSource = z.enum(["runtime", "snapshot", "unavailable"]);
const evaluationSchema = z.object({
  id: z.string(),
  name: z.string(),
  task: z.enum(["classification", "detection"]),
  status,
  source: z.string(),
  recorded_at: z.string().nullable(),
  metrics: numberMap,
  explanation: z.string().nullable(),
  metadata_source: metadataSource.optional(),
});
export const dashboardSchema = z.object({
  generated_at: z.string(),
  metadata: z
    .object({
      mode: z.enum(["runtime", "snapshot", "mixed", "unavailable"]),
      snapshot: z.object({
        status: z.enum(["valid", "invalid", "absent"]),
        generated_at: z.string().nullable(),
        age_seconds: z.number().nullable(),
        freshness: z.string(),
        payload_sha256: z.string().nullable(),
        sources: z.array(
          z.object({ path: z.string(), sha256: z.string(), runtime_state: z.string() }),
        ),
        explanation: z.string(),
      }),
    })
    .optional(),
  evaluations: z.array(evaluationSchema),
  datasets: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      path: z.string(),
      dvc_file: z.string(),
      status,
      version: z.string().nullable(),
      size_bytes: z.number().nullable(),
      file_count: z.number().nullable(),
      local_available: z.boolean(),
      statistics_metadata_source: metadataSource.optional(),
      split_metadata_source: metadataSource.optional(),
      statistics: z.object({
        images: z.number().optional(),
        total_files: z.number().optional(),
        corrupted_count: z.number().optional(),
      }),
      statistics_source: z.string().nullable(),
      split_summary: z
        .record(
          z.object({
            images: z.number(),
            groups: z.number().optional(),
            classes: numberMap.optional(),
          }),
        )
        .nullable(),
      explanation: z.string().nullable(),
      metadata_source: metadataSource.optional(),
    }),
  ),
  mlops: z.object({
    dvc: z.object({
      status,
      tracked_datasets: z.number(),
      remote_configured: z.boolean(),
      remote_names: z.array(z.string()).optional(),
      remote_accessible: z.boolean().nullable().optional(),
      artifacts_synchronized: z.boolean().nullable().optional(),
      configuration_source: metadataSource.optional(),
      metadata_source: metadataSource.optional(),
      explanation: z.string().nullable(),
    }),
    mlflow: z.object({
      status,
      source: z.string(),
      metadata_source: metadataSource.optional(),
      experiments: z.array(z.object({ id: z.string(), name: z.string() })),
      runs: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          experiment_id: z.string(),
          status: z.string(),
          start_time: z.number().nullable(),
          end_time: z.number().nullable(),
          metrics: numberMap,
        }),
      ),
      registry: z.array(
        z.object({
          name: z.string(),
          version: z.number(),
          stage: z.string(),
          status: z.string(),
          run_id: z.string().nullable(),
        }),
      ),
      explanation: z.string().nullable(),
    }),
    checkpoints: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        path: z.string(),
        available: z.boolean(),
        size_bytes: z.number().nullable(),
        modified_at: z.string().nullable(),
        dvc_version: z.string().nullable(),
        deployed: z.boolean(),
      }),
    ),
    training_runs: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        source: z.string(),
        epochs: z.number(),
        last_metrics: numberMap,
        recorded_at: z.string(),
        metadata_source: metadataSource.optional(),
      }),
    ),
    ci: z.object({
      configured: z.boolean(),
      source: z.string(),
      explanation: z.string(),
      execution_status: z.literal("not_checked").optional(),
      metadata_source: metadataSource.optional(),
    }),
  }),
});
export const monitoringSchema = z.object({
  generated_at: z.string(),
  uptime_seconds: z.number(),
  requests: z.object({
    total: z.number(),
    errors: z.number(),
    server_errors: z.number(),
    inference_requests: z.number(),
    inference_errors: z.number(),
    average_latency_ms: z.number().nullable(),
    uptime_availability_percent: z.number().nullable(),
    requests_per_minute: z.number(),
    endpoints: z.array(
      z.object({
        method: z.string(),
        path: z.string(),
        total: z.number(),
        errors: z.number(),
        average_latency_ms: z.number(),
      }),
    ),
    recent: z.array(
      z.object({
        at: z.string(),
        method: z.string(),
        path: z.string(),
        status_code: z.number(),
        duration_ms: z.number(),
      }),
    ),
  }),
  hardware: z.object({
    cpu_percent: z.number().nullable(),
    ram: z
      .object({ total_bytes: z.number(), used_bytes: z.number(), percent: z.number() })
      .nullable(),
    gpus: z.array(
      z.object({
        name: z.string(),
        memory_used_bytes: z.number(),
        memory_total_bytes: z.number(),
        utilization_percent: z.number().nullable(),
      }),
    ),
    explanation: z.string().nullable(),
  }),
});
export type Evaluation = z.infer<typeof evaluationSchema>;
export type Dashboard = z.infer<typeof dashboardSchema>;
export type Monitoring = z.infer<typeof monitoringSchema>;

export async function readDashboard<T>(
  baseUrl: string,
  path: string,
  schema: z.ZodType<T>,
  signal?: AbortSignal,
): Promise<T> {
  const timeout = AbortSignal.timeout(15000);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  timeout.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  try {
    const response = await fetch(`${normalizeApiUrl(baseUrl)}${path}`, {
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`The API returned HTTP ${response.status} for ${path}.`);
    const parsed = schema.safeParse(await response.json());
    if (!parsed.success)
      throw new Error(`The ${path} response does not match the dashboard API contract.`);
    return parsed.data;
  } catch (error) {
    if (controller.signal.aborted)
      throw new Error("The dashboard request was interrupted or timed out.");
    if (error instanceof TypeError)
      throw new Error(
        "Cannot reach the dashboard API. Check the saved API URL and service connection in Settings.",
      );
    throw error;
  } finally {
    signal?.removeEventListener("abort", abort);
    timeout.removeEventListener("abort", abort);
  }
}
export function useDashboard() {
  const { preferences, ready } = useWorkspace();
  return useQuery({
    queryKey: ["solarvision-dashboard", preferences.apiUrl],
    queryFn: ({ signal }) =>
      readDashboard(preferences.apiUrl, "/dashboard", dashboardSchema, signal),
    enabled: ready,
    retry: false,
    refetchInterval: 60000,
  });
}
export function useMonitoring() {
  const { preferences, ready } = useWorkspace();
  return useQuery({
    queryKey: ["solarvision-monitoring", preferences.apiUrl],
    queryFn: ({ signal }) =>
      readDashboard(preferences.apiUrl, "/monitoring", monitoringSchema, signal),
    enabled: ready,
    retry: false,
    refetchInterval: 15000,
  });
}
export function percentage(value: number | undefined | null): string {
  return value === undefined || value === null ? "Unavailable" : `${(value * 100).toFixed(2)}%`;
}
export function bytes(value: number | null): string {
  if (value === null) return "Unavailable";
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KiB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MiB`;
  return `${(value / 1024 ** 3).toFixed(2)} GiB`;
}
export function statusLabel(value: string): string {
  return value === "available"
    ? "Available"
    : value === "not_configured"
      ? "Not configured"
      : "Unavailable";
}
