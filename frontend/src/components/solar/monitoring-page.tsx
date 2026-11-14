import {
  RefreshCw,
  Activity,
  Cpu,
  Timer,
  TriangleAlert,
  Gauge,
  MemoryStick,
  Server,
} from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { Button } from "@/components/ui/button";
import { bytes, useMonitoring } from "@/lib/solar/dashboard";
import { useWorkspace } from "./workspace";
import { Badge, EmptyState, MetricCard, PageIntro, SectionHeading } from "./common";
export function MonitoringPage() {
  const { healthState: health, checkHealth, preferences } = useWorkspace();
  const { data, error, isPending, isFetching, refetch } = useMonitoring();
  const requests = data?.requests;
  const hardware = data?.hardware;
  const recent =
    requests?.recent.map((request, index) => ({
      ...request,
      index,
      time: new Date(request.at).toLocaleTimeString(),
    })) || [];
  return (
    <>
      <PageIntro
        eyebrow="HEALTH & OBSERVABILITY"
        title="System Monitoring"
        description="API health, measured request traffic, and available hardware telemetry."
        action={
          <Button
            variant="outline"
            disabled={isFetching || health.state === "checking"}
            onClick={() => {
              void checkHealth();
              void refetch();
            }}
          >
            <RefreshCw className={isFetching || health.state === "checking" ? "spinner" : ""} />
            Refresh monitoring
          </Button>
        }
      />
      <div className="notice">
        <Server size={16} />
        <span>
          FastAPI endpoint: <strong>{preferences.apiUrl}/health</strong>
          <br />
          Last successful health check:{" "}
          {health.lastSuccess
            ? new Date(health.lastSuccess).toLocaleString()
            : "No successful check yet"}
          <br />
          Telemetry refreshes every 15 seconds. Counters cover this API process since startup and
          include health and dashboard requests.
        </span>
      </div>
      <div className="monitoring-stats">
        <MetricCard
          title="API Status"
          value={
            health.state === "online"
              ? "Online"
              : health.state === "checking"
                ? "Checking"
                : health.reachable
                  ? "Reachable"
                  : "Offline"
          }
          detail="GET /health"
          icon={Activity}
          tone={health.state === "online" ? "green" : "amber"}
        />
        <MetricCard
          title="Model Loading"
          value={
            health.state === "online" || health.reachable
              ? health.models
                ? "Loaded"
                : "Unavailable"
              : "Not verified"
          }
          detail="Reported by the inference service"
          icon={Cpu}
        />
        <MetricCard
          title="Health Latency"
          value={health.latency === null ? "Unavailable" : `${health.latency} ms`}
          detail="Browser round trip for the latest health check"
          icon={Timer}
        />
        <MetricCard
          title="API Request Errors"
          value={requests?.errors ?? "Unavailable"}
          detail="HTTP errors since API process startup"
          icon={TriangleAlert}
          tone="amber"
        />
      </div>
      {health.error && (
        <div role="alert" className="error-banner">
          {health.error}
        </div>
      )}
      {error && (
        <div role="alert" className="error-banner">
          {error.message}
          {data && " Last retrieved telemetry remains visible; it may be stale."}
        </div>
      )}
      {isPending && (
        <p role="status" className="text-note">
          Loading API telemetry…
        </p>
      )}
      {data && (
        <>
          <SectionHeading
            title="Request telemetry"
            subtitle={`API process uptime: ${(data.uptime_seconds / 60).toFixed(1)} minutes · Collected: ${new Date(data.generated_at).toLocaleString()}`}
          />
          <div className="monitoring-stats">
            <MetricCard
              title="Total Requests"
              value={requests?.total ?? 0}
              detail="Completed requests in this process"
              icon={Activity}
            />
            <MetricCard
              title="Mean API Latency"
              value={
                requests?.average_latency_ms == null
                  ? "Unavailable"
                  : `${requests.average_latency_ms.toFixed(1)} ms`
              }
              detail="Server processing time for completed requests"
              icon={Timer}
            />
            <MetricCard
              title="Request Success Rate"
              value={
                requests?.uptime_availability_percent == null
                  ? "Unavailable"
                  : `${requests.uptime_availability_percent.toFixed(2)}%`
              }
              detail="HTTP success rate; external uptime is not measured"
              icon={Gauge}
            />
            <MetricCard
              title="Requests / Minute"
              value={requests?.requests_per_minute.toFixed(1) ?? "Unavailable"}
              detail="Measured by the API request collector"
              icon={Activity}
            />
          </div>
          <div className="chart-frame mb-6">
            {recent.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={recent} margin={{ top: 20, right: 20, bottom: 0, left: 5 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="time" tickLine={false} axisLine={false} />
                  <YAxis unit=" ms" tickLine={false} axisLine={false} />
                  <Tooltip formatter={(value) => `${Number(value).toFixed(1)} ms`} />
                  <Line
                    name="Server processing time"
                    dataKey="duration_ms"
                    stroke="var(--primary)"
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState
                icon={Activity}
                title="No completed requests recorded"
                description="Request latency appears as the API receives traffic."
              />
            )}
          </div>
          <div className="table-wrap mb-6">
            <table className="data-table">
              <thead>
                <tr>
                  <th>ENDPOINT</th>
                  <th>REQUESTS</th>
                  <th>ERRORS</th>
                  <th>MEAN SERVER LATENCY</th>
                </tr>
              </thead>
              <tbody>
                {requests?.endpoints.map((endpoint) => (
                  <tr key={`${endpoint.method}-${endpoint.path}`}>
                    <td>
                      {endpoint.method} {endpoint.path}
                    </td>
                    <td>{endpoint.total}</td>
                    <td>{endpoint.errors}</td>
                    <td>{endpoint.average_latency_ms.toFixed(1)} ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-note mb-6">
            Inference requests: {requests?.inference_requests} · Inference errors:{" "}
            {requests?.inference_errors} · Server errors (5xx): {requests?.server_errors}. Failed
            browser connections cannot be counted by the server.
          </p>
        </>
      )}
      <SectionHeading
        title="Infrastructure telemetry"
        subtitle="Read from the backend host when reliable collectors are available"
      />
      <div className="integration-grid">
        <article className="metadata-card">
          <div className="integration-head">
            <Cpu size={22} />
            <Badge tone={hardware?.cpu_percent == null ? "muted" : "green"}>
              {hardware?.cpu_percent == null ? "Unavailable" : "Available"}
            </Badge>
          </div>
          <h3>CPU usage</h3>
          <p>
            {hardware?.cpu_percent == null
              ? "CPU usage is not available."
              : `${hardware.cpu_percent.toFixed(1)}% host CPU usage`}
          </p>
        </article>
        <article className="metadata-card">
          <div className="integration-head">
            <MemoryStick size={22} />
            <Badge tone={hardware?.ram ? "green" : "muted"}>
              {hardware?.ram ? "Available" : "Unavailable"}
            </Badge>
          </div>
          <h3>Memory usage</h3>
          <p>
            {hardware?.ram
              ? `${bytes(hardware.ram.used_bytes)} / ${bytes(hardware.ram.total_bytes)} · ${hardware.ram.percent.toFixed(1)}%`
              : "Host memory usage is not available."}
          </p>
        </article>
        {hardware?.gpus.length ? (
          hardware.gpus.map((gpu, index) => (
            <article className="metadata-card" key={`${gpu.name}-${index}`}>
              <div className="integration-head">
                <Gauge size={22} />
                <Badge tone="green">Available</Badge>
              </div>
              <h3>{gpu.name}</h3>
              <p>
                Memory: {bytes(gpu.memory_used_bytes)} / {bytes(gpu.memory_total_bytes)}
                <br />
                GPU utilization:{" "}
                {gpu.utilization_percent === null
                  ? "Unavailable"
                  : `${gpu.utilization_percent.toFixed(1)}%`}
              </p>
            </article>
          ))
        ) : (
          <article className="metadata-card">
            <div className="integration-head">
              <Gauge size={22} />
              <Badge>Unavailable</Badge>
            </div>
            <h3>GPU telemetry</h3>
            <p>No readable GPU collector was returned by the API.</p>
          </article>
        )}
      </div>
      {hardware?.explanation && (
        <div className="notice mt-6">
          <Server size={16} />
          <span>{hardware.explanation}</span>
        </div>
      )}
    </>
  );
}
