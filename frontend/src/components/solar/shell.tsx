import { useState, type ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  ScanLine,
  History,
  ChartNoAxesCombined,
  Database,
  Workflow,
  Activity,
  Settings2,
  Sun,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  ChevronDown,
  ArrowUpRight,
  Cpu,
  Zap,
  Hexagon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "./workspace";
export const navigation = [
  { to: "/", label: "Overview", icon: LayoutDashboard },
  { to: "/inspection", label: "AI Inspection", icon: ScanLine },
  { to: "/history", label: "Inspection History", icon: History },
  { to: "/models", label: "Model Performance", icon: ChartNoAxesCombined },
  { to: "/datasets", label: "Dataset Explorer", icon: Database },
  { to: "/mlops", label: "MLOps Center", icon: Workflow },
  { to: "/monitoring", label: "System Monitoring", icon: Activity },
  { to: "/settings", label: "Settings", icon: Settings2 },
] as const;
export function Shell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { preferences, updatePreferences, healthState, storageError } = useWorkspace();
  const current = navigation.find((n) => n.to === pathname);
  return (
    <div className={`app-shell ${collapsed ? "is-collapsed" : ""}`}>
      <aside className="app-sidebar">
        <Link to="/" className="brand">
          <div className="brand-mark">
            <ScanLine size={24} />
            <Zap size={11} className="brand-bolt" />
          </div>
          <div className="brand-words">
            SolarVision <span>AI</span>
            <small>INTELLIGENT INSPECTION</small>
          </div>
        </Link>
        <div className="workspace-label">
          <Hexagon size={15} />
          <span>Engineering workspace</span>
          <ChevronDown size={14} />
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          {navigation.map((n, i) => (
            <div key={n.to}>
              {i === 6 && <div className="nav-label system-label">SYSTEM</div>}
              <Link
                to={n.to}
                title={collapsed ? n.label : undefined}
                className={`nav-item ${pathname === n.to ? "active" : ""}`}
              >
                <n.icon size={19} strokeWidth={1.7} />
                <span>{n.label}</span>
                {n.to === "/inspection" && <span className="nav-ai">AI</span>}
              </Link>
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="engine-status">
            <Cpu size={19} />
            <div>
              <strong>Inference engine</strong>
              <span>
                <i className={`status-dot ${healthState.state}`} />
                {healthState.state === "online"
                  ? "API connected"
                  : healthState.state === "checking"
                    ? "Checking connection"
                    : healthState.reachable
                      ? "API reachable"
                      : "API not connected"}
              </span>
            </div>
          </div>
          <div className="sidebar-foot">
            <span>SolarVision AI</span>
            <span>v1.0.0</span>
          </div>
        </div>
      </aside>
      <div className="app-main">
        <header className="topbar">
          <div className="header-left">
            <Button
              variant="ghost"
              size="icon"
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              onClick={() => setCollapsed(!collapsed)}
            >
              {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
            </Button>
            <span className="breadcrumb-root">Workspace</span>
            <span className="breadcrumb-slash">/</span>
            <strong>{current?.label || "Overview"}</strong>
          </div>
          <div className="header-right">
            <span className={`connection-pill ${healthState.state}`}>
              <i className={`status-dot ${healthState.state}`} />
              {healthState.state === "online"
                ? "Backend online"
                : healthState.state === "checking"
                  ? "Connecting"
                  : healthState.reachable
                    ? "Models unavailable"
                    : "Backend offline"}
            </span>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Switch to ${preferences.theme === "dark" ? "light" : "dark"} mode`}
              onClick={() =>
                updatePreferences({ theme: preferences.theme === "dark" ? "light" : "dark" })
              }
            >
              {preferences.theme === "dark" ? <Sun /> : <Moon />}
            </Button>
            <div className="header-divider" />
            <div className="avatar">LW</div>
            <span className="workspace-name">
              Local workspace<small>Personal project</small>
            </span>
          </div>
        </header>
        <main className="page-content">
          {storageError && (
            <div role="alert" className="error-banner">
              {storageError}
            </div>
          )}
          {children}
        </main>
        <footer className="app-footer">
          <span>
            <span className="footer-dot" /> SolarVision AI{" "}
            <span className="footer-separator">/</span> Computer vision. Clearer decisions.
          </span>
          <Link to="/models">
            Model evaluation <ArrowUpRight size={12} />
          </Link>
        </footer>
      </div>
    </div>
  );
}
