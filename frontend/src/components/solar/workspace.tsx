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
  historyStorageKey,
  mergeHistory,
  type Preferences,
  type Inspection,
  type Mode,
} from "@/lib/solar/domain";
import {
  health,
  importHistory,
  inspectionHistory,
  normalizeApiUrl,
  validateInspection,
} from "@/lib/solar/api";
import { getBuildApiUrl } from "@/lib/solar/runtime-config";
type HealthState = {
  state: "checking" | "online" | "offline";
  reachable: boolean;
  models: boolean;
  modelStates: Partial<Record<Mode, boolean>>;
  latency: number | null;
  lastSuccess: string | null;
  error: string | null;
  errors: number;
};
type Workspace = {
  preferences: Preferences;
  updatePreferences: (p: Partial<Preferences>) => void;
  history: Inspection[];
  addInspection: (r: Inspection, apiUrl?: string) => void;
  clearHistory: () => void;
  legacyHistory: Inspection[];
  importLegacyHistory: () => Promise<void>;
  healthState: HealthState;
  checkHealth: () => Promise<void>;
  ready: boolean;
  storageError: string | null;
  historyError: string | null;
  recordError: () => void;
};
const Context = createContext<Workspace | null>(null);
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  // The first render must match SSR. Runtime and saved choices are applied after hydration.
  const [preferences, setPreferences] = useState<Preferences>(() => ({
    ...defaultPreferences,
    apiUrl: getBuildApiUrl(),
  }));
  const [history, setHistory] = useState<Inspection[]>([]);
  const [historyUrl, setHistoryUrl] = useState("");
  const [legacyHistory, setLegacyHistory] = useState<Inspection[]>([]);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const historyRef = useRef({ url: historyUrl, records: history });
  // Never overwrite unreadable cache bytes while recovering usable server data.
  const unreadableCaches = useRef(new Set<string>());
  const healthRequest = useRef(0);
  const activeUrl = useRef(preferences.apiUrl);
  activeUrl.current = preferences.apiUrl;
  historyRef.current = { url: historyUrl, records: history };
  function readCache(key: string): Inspection[] {
    const value: unknown = JSON.parse(localStorage.getItem(key) || "[]");
    if (!Array.isArray(value)) throw new Error("Invalid browser history cache.");
    return value.map(validateInspection);
  }
  const [healthState, setHealth] = useState<HealthState>({
    state: "checking",
    reachable: false,
    models: false,
    modelStates: {},
    latency: null,
    lastSuccess: null,
    error: null,
    errors: 0,
  });
  useEffect(() => {
    const next = { ...defaultPreferences };
    try {
      const p = JSON.parse(localStorage.getItem("solarvision-preferences") || "null");
      if (p && typeof p.apiUrl === "string") next.apiUrl = normalizeApiUrl(p.apiUrl);
      if (p?.theme === "dark" || p?.theme === "light") next.theme = p.theme;
      if (["panels", "defects", "classify"].includes(p?.mode)) next.mode = p.mode;
      if (typeof p?.threshold === "number" && p.threshold >= 0 && p.threshold <= 1)
        next.threshold = p.threshold;
    } catch {
      setStorageError(
        "Saved preferences could not be read. Runtime connection defaults are being used.",
      );
    }
    setPreferences(next);
    let cached: Inspection[] = [];
    const key = historyStorageKey(next.apiUrl);
    try {
      cached = readCache(key);
    } catch {
      unreadableCaches.current.add(key);
      setStorageError(
        "The cache for this API is invalid and has been preserved unchanged. Server records remain available; new browser data cannot be cached until this cache is explicitly cleared.",
      );
    }
    setHistory(cached);
    setHistoryUrl(next.apiUrl);
    historyRef.current = { url: next.apiUrl, records: cached };
    try {
      setLegacyHistory(readCache("solarvision-history"));
    } catch {
      setStorageError(
        "Legacy browser data could not be read and is preserved unchanged. The current API history remains available.",
      );
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
    if (
      ready &&
      historyUrl === preferences.apiUrl &&
      !unreadableCaches.current.has(historyStorageKey(historyUrl))
    )
      try {
        localStorage.setItem(historyStorageKey(historyUrl), JSON.stringify(history));
      } catch {
        setStorageError("History could not be saved. Export it before closing this page.");
      }
  }, [history, historyUrl, preferences.apiUrl, ready]);
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
        modelStates: result.models ?? {},
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
        modelStates: {},
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
        if (!active || activeUrl.current !== url) return;
        const local = historyRef.current.url === url ? historyRef.current.records : [];
        setHistory((current) =>
          activeUrl.current === url ? mergeHistory(current, server) : current,
        );
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
  function addInspection(record: Inspection, url = preferences.apiUrl) {
    if (url === activeUrl.current) setHistory((old) => mergeHistory([record], old));
    else {
      try {
        const key = historyStorageKey(url);
        localStorage.setItem(key, JSON.stringify(mergeHistory([record], readCache(key))));
      } catch {
        setStorageError(
          "An inspection for the previous API could not be cached. Export its JSON report.",
        );
      }
    }
  }
  function updatePreferences(change: Partial<Preferences>) {
    if (change.apiUrl !== undefined) {
      const url = normalizeApiUrl(change.apiUrl);
      if (url !== activeUrl.current) {
        let cached: Inspection[] = [];
        try {
          cached = readCache(historyStorageKey(url));
        } catch {
          unreadableCaches.current.add(historyStorageKey(url));
          setStorageError(
            "The cache for this API is invalid and has been preserved unchanged. Server records remain available; new browser data cannot be cached until this cache is explicitly cleared.",
          );
        }
        activeUrl.current = url;
        historyRef.current = { url, records: cached };
        setHistory(cached);
        setHistoryUrl(url);
        setHistoryError(null);
      }
      change = { ...change, apiUrl: url };
    }
    setPreferences((old) => ({ ...old, ...change }));
  }
  async function importLegacyHistory() {
    const url = preferences.apiUrl;
    await importHistory(url, legacyHistory);
    if (activeUrl.current === url) setHistory((old) => mergeHistory(legacyHistory, old));
    else {
      const key = historyStorageKey(url);
      localStorage.setItem(key, JSON.stringify(mergeHistory(legacyHistory, readCache(key))));
    }
  }
  return (
    <Context.Provider
      value={{
        preferences,
        updatePreferences,
        history: historyUrl === preferences.apiUrl ? history : [],
        addInspection,
        clearHistory: () => {
          unreadableCaches.current.delete(historyStorageKey(preferences.apiUrl));
          setHistory([]);
        },
        legacyHistory,
        importLegacyHistory,
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
