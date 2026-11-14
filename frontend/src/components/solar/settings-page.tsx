import { useEffect, useRef, useState } from "react";
import { Save, RefreshCw, Download, Trash2, Sun, Moon, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { health, normalizeApiUrl } from "@/lib/solar/api";
import { downloadJson, modes, type Mode } from "@/lib/solar/domain";
import { useWorkspace } from "./workspace";
import { PageIntro } from "./common";

type ConnectionTest = {
  state: "testing" | "success" | "warning" | "error";
  url: string;
  message: string;
  latency?: number;
};
const invalidUrlMessage =
  "Enter a valid HTTP or HTTPS API URL without credentials, query parameters, or a fragment.";
export function SettingsPage() {
  const { preferences, updatePreferences, history, clearHistory, healthState, historyError } =
    useWorkspace();
  const [url, setUrl] = useState(preferences.apiUrl);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<ConnectionTest | null>(null);
  const [confirm, setConfirm] = useState(false);
  const testRequest = useRef(0);
  useEffect(() => {
    setUrl(preferences.apiUrl);
    setTest(null);
    testRequest.current += 1;
  }, [preferences.apiUrl]);
  useEffect(
    () => () => {
      testRequest.current += 1;
    },
    [],
  );
  function save() {
    try {
      const normalized = normalizeApiUrl(url);
      updatePreferences({ apiUrl: normalized });
      setUrl(normalized);
      setMessage("API URL saved. The workspace connection status below uses this address.");
      setError(null);
    } catch {
      setError(invalidUrlMessage);
      setMessage(null);
    }
  }
  async function testConnection() {
    const requestId = ++testRequest.current;
    let target: string;
    try {
      target = normalizeApiUrl(url);
    } catch {
      setError(invalidUrlMessage);
      setTest(null);
      return;
    }
    setError(null);
    setMessage(null);
    setTest({ state: "testing", url: target, message: "Testing connection…" });
    const start = performance.now();
    try {
      const response = await health(target);
      if (requestId !== testRequest.current) return;
      const latency = Math.round(performance.now() - start);
      const available = response.status === "healthy" && response.models_loaded;
      setTest({
        state: available ? "success" : "warning",
        url: target,
        latency,
        message: available
          ? "Connected. API healthy; models loaded."
          : `API reachable. Status: ${response.status}; models ${response.models_loaded ? "loaded" : "unavailable"}.${response.explanation ? ` ${response.explanation}` : ""}`,
      });
    } catch (failure) {
      if (requestId !== testRequest.current) return;
      setTest({
        state: "error",
        url: target,
        message: failure instanceof Error ? failure.message : "Connection failed.",
      });
    }
  }
  function changeUrl(value: string) {
    testRequest.current += 1;
    setUrl(value);
    setTest(null);
    setMessage(null);
    setError(null);
  }
  return (
    <>
      <PageIntro
        eyebrow="WORKSPACE PREFERENCES"
        title="Settings"
        description="Configure your API connection and personalize this local workspace."
      />
      <div className="settings-layout">
        <section className="settings-section">
          <h2>API connection</h2>
          <p className="text-note">Connect to your existing Python FastAPI service.</p>
          <div className="field">
            <label htmlFor="api-url">API Base URL</label>
            <input
              id="api-url"
              value={url}
              onChange={(event) => changeUrl(event.target.value)}
              placeholder="http://127.0.0.1:8000"
            />
            <small>
              The local address refers to the device running your browser. Your server must allow
              this website through CORS; HTTPS-hosted pages may need an HTTPS-accessible API. Test
              connection checks the entered address before saving.
            </small>
          </div>
          <div className="inline-actions">
            <Button onClick={save}>
              <Save />
              Save connection
            </Button>
            <Button
              variant="outline"
              onClick={() => void testConnection()}
              disabled={test?.state === "testing"}
            >
              <RefreshCw className={test?.state === "testing" ? "spinner" : ""} />
              Test connection
            </Button>
          </div>
          {message && (
            <p role="status" className="success-message">
              {message}
            </p>
          )}
          {error && (
            <p className="error-banner" role="alert">
              {error}
            </p>
          )}
          {test && (
            <div
              role={test.state === "error" ? "alert" : "status"}
              className={
                test.state === "success"
                  ? "success-message"
                  : test.state === "error"
                    ? "error-banner"
                    : "notice mt-4"
              }
            >
              <div>
                <strong>{test.message}</strong>
                <br />
                Tested URL: {test.url}
                {test.latency !== undefined && <> · Response latency: {test.latency} ms</>}
              </div>
            </div>
          )}
          <p className="text-note mt-4">
            Saved workspace connection: {preferences.apiUrl}
            <br />
            Status:{" "}
            {healthState.state === "online"
              ? "Connected"
              : healthState.state === "checking"
                ? "Checking"
                : healthState.reachable
                  ? "API reachable"
                  : "Unavailable"}{" "}
            · Models:{" "}
            {healthState.models ? "loaded" : healthState.reachable ? "unavailable" : "not verified"}
            {healthState.latency !== null ? ` · ${healthState.latency} ms` : ""}
          </p>
          {healthState.error && (
            <p className="error-banner">Saved connection: {healthState.error}</p>
          )}
        </section>
        <section className="settings-section">
          <h2>Appearance</h2>
          <p className="text-note mb-4">Choose a workspace theme.</p>
          <div className="segmented">
            <Button
              variant={preferences.theme === "dark" ? "default" : "outline"}
              aria-pressed={preferences.theme === "dark"}
              onClick={() => updatePreferences({ theme: "dark" })}
            >
              <Moon />
              Dark
            </Button>
            <Button
              variant={preferences.theme === "light" ? "default" : "outline"}
              aria-pressed={preferences.theme === "light"}
              onClick={() => updatePreferences({ theme: "light" })}
            >
              <Sun />
              Light
            </Button>
          </div>
        </section>
        <section className="settings-section">
          <h2>Analysis defaults</h2>
          <div className="field">
            <label htmlFor="default-mode">Preferred analysis mode</label>
            <select
              id="default-mode"
              value={preferences.mode}
              onChange={(event) => updatePreferences({ mode: event.target.value as Mode })}
            >
              {modes.map((mode) => (
                <option key={mode.id} value={mode.id}>
                  {mode.title}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="default-threshold">
              Display confidence threshold · {Math.round(preferences.threshold * 100)}%
            </label>
            <input
              id="default-threshold"
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={preferences.threshold}
              onChange={(event) => updatePreferences({ threshold: Number(event.target.value) })}
            />
            <small>
              Only controls bounding-box visualization. All model predictions are preserved in
              reports.
            </small>
          </div>
        </section>
        <section className="settings-section">
          <h2>Inspection history cache</h2>
          <p className="text-note mb-4">
            {history.length} completed inspections in this workspace. Browser records are merged
            with the backend SQLite history when available; existing local records are preserved
            during synchronization.
          </p>
          {historyError && (
            <p className="error-banner">History synchronization unavailable: {historyError}</p>
          )}
          <div className="inline-actions">
            <Button
              variant="outline"
              onClick={() => downloadJson(history, "solarvision-history.json")}
            >
              <Download />
              Export history
            </Button>
            <Button variant="outline" onClick={() => setConfirm(true)} disabled={!history.length}>
              <Trash2 />
              Clear browser cache
            </Button>
          </div>
          {confirm && (
            <div className="error-banner" role="alert">
              <p>
                Clear {history.length} cached inspection entries on this device? Server records
                remain in SQLite and may reappear after synchronization. Browser-only records will
                be removed; export a copy first if needed.
              </p>
              <div className="inline-actions mt-3">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    clearHistory();
                    setConfirm(false);
                  }}
                >
                  Confirm clear cache
                </Button>
                <Button variant="outline" size="sm" onClick={() => setConfirm(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </section>
        <div className="notice">
          <Info size={15} />
          <span>
            Preferences are saved on this device. Completed inspections are also saved by the
            backend when its SQLite storage is available.
          </span>
        </div>
      </div>
    </>
  );
}
