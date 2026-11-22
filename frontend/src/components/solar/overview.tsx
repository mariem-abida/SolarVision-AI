import { Link } from "@tanstack/react-router";
import {
  ArrowUpRight,
  CalendarDays,
  ScanLine,
  TriangleAlert,
  Timer,
  Layers,
  ChartNoAxesCombined,
  Donut,
  ShieldCheck,
  Cpu,
  Crosshair,
  Activity,
  Circle,
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import solarFarm from "@/assets/solar-farm.jpg";
import { percentage, useDashboard } from "@/lib/solar/dashboard";
import { useWorkspace } from "./workspace";
import { Badge, EmptyState, MetricCard, NewInspectionButton, SectionHeading } from "./common";
import { HistoryTable } from "./history-table";
import type { Mode } from "@/lib/solar/domain";
export function Overview() {
  const { history, healthState, ready } = useWorkspace();
  const modelLoaded = (mode: Mode) =>
    healthState.reachable && (healthState.modelStates?.[mode] ?? healthState.models);
  const { data, error } = useDashboard();
  const panels = history
    .filter((r) => r.mode === "panels")
    .reduce((sum, r) => sum + (r.result.count || 0), 0);
  const defects = history
    .filter((r) => r.mode === "defects")
    .reduce((sum, r) => sum + (r.result.count || 0), 0);
  const inferenceTimes = history.flatMap((record) =>
    record.result.inference_ms === undefined ? [] : [record.result.inference_ms],
  );
  const avg = inferenceTimes.length
    ? `${(inferenceTimes.reduce((sum, time) => sum + time, 0) / inferenceTimes.length).toFixed(1)} ms`
    : "—";
  const activity = Object.entries(
    history.reduce<Record<string, number>>((a, r) => {
      const date = new Date(r.date);
      if (Number.isNaN(date.getTime())) return a;
      const key = date.toISOString().slice(0, 10);
      a[key] = (a[key] || 0) + 1;
      return a;
    }, {}),
  )
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));
  const distribution = history
    .filter((r) => r.mode === "classify")
    .reduce<Record<string, number>>((a, r) => {
      const key = r.result.predicted_class || "Unknown";
      a[key] = (a[key] || 0) + 1;
      return a;
    }, {});
  const pieData = Object.entries(distribution).map(([name, value]) => ({ name, value }));
  return (
    <>
      <div className="overview-intro">
        <div>
          <h1>Overview</h1>
          <p>A clearer view of your solar inspection operations.</p>
        </div>
        <span className="date-label">
          <CalendarDays size={13} />
          {ready
            ? new Date().toLocaleDateString("en-US", {
                month: "long",
                day: "numeric",
                year: "numeric",
              })
            : "Local workspace"}
        </span>
      </div>
      <section className="dashboard-hero">
        <img
          className="hero-image"
          src={solarFarm}
          alt="Drone view of solar panels across a green countryside solar farm"
          width={1536}
          height={1024}
        />
        <div className="hero-copy">
          <span className="hero-eyebrow">
            <ScanLine size={11} /> COMPUTER VISION × SOLAR INTELLIGENCE
          </span>
          <h2>SolarVision AI</h2>
          <p>
            Transforming Drone Imagery into
            <br />
            Actionable Solar Intelligence.
          </p>
          <div className="hero-bottom">
            <NewInspectionButton />
            <span>
              <ShieldCheck size={12} /> Built for precision. Powered by AI.
            </span>
          </div>
        </div>
        <span className="hero-caption">
          <Crosshair size={12} /> A new perspective on solar health
        </span>
      </section>
      <div className="metrics-grid">
        <MetricCard
          title="Total Inspections"
          value={history.length}
          detail="Saved inspection history"
          icon={ScanLine}
        />
        <MetricCard
          title="Panels Detected"
          value={panels.toLocaleString()}
          detail="Across completed inspections"
          icon={Layers}
          tone="green"
        />
        <MetricCard
          title="Defects Detected"
          value={defects.toLocaleString()}
          detail="Potential anomalies identified"
          icon={TriangleAlert}
          tone="amber"
        />
        <MetricCard
          title="Avg. Inference Time"
          value={avg}
          detail="Server model time · Available records"
          icon={Timer}
        />
      </div>
      <div className="dashboard-columns">
        <section className="chart-section">
          <SectionHeading
            title="Inspection Activity"
            subtitle="Completed inspections over time"
            action={<Badge>All time</Badge>}
          />
          <div className="chart-frame">
            {activity.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={activity} margin={{ top: 25, right: 22, bottom: 10, left: -15 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="date" tickLine={false} axisLine={false} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
                  <Tooltip />
                  <Area
                    dataKey="count"
                    name="Inspections"
                    stroke="var(--primary)"
                    fill="var(--primary)"
                    fillOpacity={0.1}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <>
                <div className="chart-grid" />
                <EmptyState
                  icon={ChartNoAxesCombined}
                  title="Your activity starts here"
                  description="Run an inspection to see your analysis trends."
                />
              </>
            )}
          </div>
        </section>
        <section className="chart-section">
          <SectionHeading
            title="Thermal Class Distribution"
            subtitle="From completed thermal classifications"
          />
          <div className="chart-frame">
            {pieData.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    innerRadius={48}
                    outerRadius={72}
                    dataKey="value"
                    nameKey="name"
                  >
                    {pieData.map((d, i) => (
                      <Cell key={d.name} fill={i % 2 ? "var(--success)" : "var(--primary)"} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState
                icon={Donut}
                title="No classifications to display"
                description="Class distribution appears after thermal analysis."
              />
            )}
          </div>
        </section>
      </div>
      <section className="content-section">
        <SectionHeading
          title="Recent Inspections"
          subtitle="Your latest saved image analyses"
          action={
            <Link to="/history">
              View all
              <ArrowUpRight size={13} />
            </Link>
          }
        />
        <HistoryTable records={history.slice(0, 4)} />
      </section>
      {error && (
        <div className="error-banner" role="alert">
          Model evaluation metadata unavailable: {error.message}
          {data && " Last retrieved evaluations remain visible."}
        </div>
      )}
      <section>
        <SectionHeading
          title="Your AI Models"
          subtitle="Historical evaluation reports · Loading status from the running API"
          action={
            <Link to="/models">
              Model performance
              <ArrowUpRight size={13} />
            </Link>
          }
        />
        <div className="models-grid">
          {[
            {
              id: "panels",
              mode: "panels" as const,
              title: "Solar Panel Detection",
              task: "YOLO11n · Object detection",
              key: "map50",
              label: "mAP@50",
              icon: Layers,
              tone: "cyan",
            },
            {
              id: "defects",
              mode: "defects" as const,
              title: "Defect Detection",
              task: "YOLO11n · Object detection",
              key: "map50",
              label: "mAP@50",
              icon: Crosshair,
              tone: "amber",
            },
            {
              id: "resnet18",
              mode: "classify" as const,
              title: "Thermal Classification",
              task: "ResNet18 · 10 classes",
              key: "accuracy",
              label: "Test accuracy",
              icon: Cpu,
              tone: "green",
            },
          ].map((m) => (
            <div className="model-card" key={m.id}>
              <div className="model-card-top">
                <div className={`model-symbol ${m.tone}`}>
                  <m.icon size={17} />
                </div>
                <div>
                  <h3>{m.title}</h3>
                  <p>{m.task}</p>
                </div>
                <Badge tone={modelLoaded(m.mode) ? "green" : "muted"}>
                  {modelLoaded(m.mode)
                    ? "Loaded"
                    : healthState.reachable && healthState.modelStates?.[m.mode] === false
                      ? "Unavailable"
                      : "Not verified"}
                </Badge>
              </div>
              <div className="model-card-metric">
                <strong>
                  {percentage(data?.evaluations.find((e) => e.id === m.id)?.metrics[m.key])}
                </strong>
                <span>{m.label} · Historical test</span>
              </div>
            </div>
          ))}
        </div>
      </section>
      <div className="health-strip">
        <span>
          <Activity size={13} /> System health <i className={`status-dot ${healthState.state}`} />
          {healthState.state === "online"
            ? "Connected"
            : healthState.state === "checking"
              ? "Checking"
              : healthState.reachable
                ? "API reachable"
                : "Not connected"}
        </span>
        <span>
          <Cpu size={12} /> Models{" "}
          {healthState.models ? "loaded" : healthState.reachable ? "unavailable" : "not verified"}
        </span>
        <span>
          <Circle size={11} /> Local workspace
        </span>
        <Link to="/monitoring">
          View monitoring
          <ArrowUpRight size={12} />
        </Link>
      </div>
    </>
  );
}
