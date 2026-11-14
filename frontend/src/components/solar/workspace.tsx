import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  defaultPreferences,
  mergeHistory,
  type Preferences,
  type Inspection,
} from "@/lib/solar/domain";
import { health, importHistory, inspectionHistory } from "@/lib/solar/api";
type HealthState = {
  state: "checking" | "online" | "offline";
  reachable: boolean;
  models: boolean;
  latency: number | null;
  lastSuccess: string | null;
  error: string | null;
  errors: number;
};
type Workspace = {
  preferences: Preferences;
  updatePreferences: (p: Partial<Preferences>) => void;
  history: Inspection[];
  addInspection: (r: Inspection) => void;
  clearHistory: () => void;
  healthState: HealthState;
  checkHealth: () => Promise<void>;
  ready: boolean;
  storageError: string | null;
  historyError: string | null;
  recordError: () => void;
};
const Context = createContext<Workspace | null>(null);
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState(defaultPreferences);
  const [history, setHistory] = useState<Inspection[]>([]);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const historyRef = useRef(history);
  const healthRequest = useRef(0);
  const activeUrl = useRef(preferences.apiUrl);
  activeUrl.current = preferences.apiUrl;
  historyRef.current = history;
  const [healthState, setHealth] = useState<HealthState>({
    state: "checking",
    reachable: false,
    models: false,
    latency: null,
    lastSuccess: null,
    error: null,
    errors: 0,
  });
  useEffect(() => {
    try {
      const p = JSON.parse(localStorage.getItem("solarvision-preferences") || "null");
      const h = JSON.parse(localStorage.getItem("solarvision-history") || "[]");
      if (p && typeof p.apiUrl === "string") setPreferences({ ...defaultPreferences, ...p });
      if (Array.isArray(h)) setHistory(h);
    } catch {
      setStorageError("Local browser data could not be read.");
    }
    setReady(true);
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", preferences.theme === "dark");
  }, [preferences.theme]);
  useEffect(() => {
    if (ready)
      try {
        localStorage.setItem("solarvision-preferences", JSON.stringify(preferences));
      } catch {
        setStorageError("Preferences could not be saved in this browser.");
      }
  }, [preferences, ready]);
  useEffect(() => {
    if (ready)
      try {
        localStorage.setItem("solarvision-history", JSON.stringify(history));
      } catch {
        setStorageError("History could not be saved. Export it before closing this page.");
      }
  }, [history, ready]);
  const checkHealth = useCallback(async () => {
    const requestId = ++healthRequest.current;
    const url = preferences.apiUrl;
    setHealth((h) => ({ ...h, state: "checking" }));
    const start = performance.now();
    try {
      const result = await health(url);
      if (requestId !== healthRequest.current || activeUrl.current !== url) return;
      const online = result.status === "healthy" && result.models_loaded;
      setHealth((h) => ({
        ...h,
        state: online ? "online" : "offline",
        reachable: true,
        models: result.models_loaded,
        latency: Math.round(performance.now() - start),
        lastSuccess: online ? new Date().toISOString() : h.lastSuccess,
        error: online
          ? null
          : result.explanation || "The service is responding but its models are unavailable.",
      }));
    } catch (e) {
      if (requestId !== healthRequest.current || activeUrl.current !== url) return;
      setHealth((h) => ({
        ...h,
        state: "offline",
        reachable: false,
        models: false,
        latency: null,
        error: e instanceof Error ? e.message : "Connection failed.",
        errors: h.errors + 1,
      }));
    }
  }, [preferences.apiUrl]);
  useEffect(() => {
    if (!ready) return;
    void checkHealth();
    const timer = setInterval(() => void checkHealth(), 60000);
    return () => clearInterval(timer);
  }, [ready, checkHealth]);
  useEffect(() => {
    if (!ready) return;
    let active = true;
    const url = preferences.apiUrl;
    async function synchronize() {
      try {
        const server = await inspectionHistory(url);
        if (!active) return;
        const local = historyRef.current;
        setHistory((current) => mergeHistory(current, server));
        const ids = new Set(server.map((record) => record.id));
        await importHistory(
          url,
          local.filter((record) => !ids.has(record.id)),
        );
        if (active) setHistoryError(null);
      } catch (error) {
        if (active)
          setHistoryError(
            error instanceof Error
              ? error.message
              : "Server history unavailable. Local records are preserved.",
          );
      }
    }
    void synchronize();
    const timer = setInterval(() => void synchronize(), 60000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [ready, preferences.apiUrl]);
  return (
    <Context.Provider
      value={{
        preferences,
        updatePreferences: (p) => setPreferences((old) => ({ ...old, ...p })),
        history,
        addInspection: (r) => setHistory((old) => mergeHistory([r], old)),
        clearHistory: () => setHistory([]),
        healthState,
        checkHealth,
        ready,
        storageError,
        historyError,
        recordError: () => setHealth((h) => ({ ...h, errors: h.errors + 1 })),
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useWorkspace() {
  const value = useContext(Context);
  if (!value) throw new Error("Workspace provider is required.");
  return value;
}
