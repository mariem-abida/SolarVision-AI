import { useEffect, useRef, useState } from "react";
import {
  UploadCloud,
  ScanLine,
  Crosshair,
  Cpu,
  Info,
  FileImage,
  X,
  Download,
  RotateCcw,
  LoaderCircle,
  Play,
  Image as ImageIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { inspectionImageUrl, predict } from "@/lib/solar/api";
import {
  classLabel,
  downloadBlob,
  downloadJson,
  modes,
  validateFile,
  visibleDetections,
  type Mode,
  type Prediction,
  type Inspection,
} from "@/lib/solar/domain";
import { useWorkspace } from "./workspace";
import { Badge, EmptyState, PageIntro, SectionHeading } from "./common";
export function InspectionPage() {
  const { preferences, addInspection, recordError, ready } = useWorkspace();
  const input = useRef<HTMLInputElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [serverPreview, setServerPreview] = useState<string | null>(null);
  const [thermalConfirmed, setThermalConfirmed] = useState(false);
  const renderPreview = serverPreview ?? preview;
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Mode | null>(null);
  const [result, setResult] = useState<Prediction | null>(null);
  const [record, setRecord] = useState<Inspection | null>(null);
  const [threshold, setThreshold] = useState(preferences.threshold);
  const [selected, setSelected] = useState<number | null>(null);
  const [tab, setTab] = useState<"original" | "annotated">("annotated");
  const [tiffUnsupported, setTiffUnsupported] = useState(false);
  const [lastMode, setLastMode] = useState<Mode | null>(null);
  useEffect(() => {
    setThreshold(preferences.threshold);
  }, [preferences.threshold]);
  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const detections = result ? visibleDetections(result, threshold) : [];
  useEffect(() => {
    if (!result?.detections || !renderPreview || !canvas.current || !dimensions) return;
    const target = canvas.current;
    const ctx = target.getContext("2d");
    if (!ctx) return;
    let active = true;
    const image = new window.Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      if (!active) return;
      target.width = dimensions.width;
      target.height = dimensions.height;
      ctx.drawImage(image, 0, 0);
      const styles = getComputedStyle(document.documentElement);
      const normal = styles.getPropertyValue("--primary");
      const highlighted = styles.getPropertyValue("--warning");
      const backing = styles.getPropertyValue("--hero-shade");
      const foreground = styles.getPropertyValue("--hero-foreground");
      const line = Math.max(2, dimensions.width / 450);
      const font = Math.max(13, dimensions.width / 75);
      ctx.font = `${font}px sans-serif`;
      const sx = dimensions.width / (result.image_width || dimensions.width);
      const sy = dimensions.height / (result.image_height || dimensions.height);
      visibleDetections(result, threshold).forEach((d, i) => {
        const [left, top, right, bottom] = d.bbox_xyxy;
        const x1 = left * sx,
          y1 = top * sy,
          x2 = right * sx,
          y2 = bottom * sy;
        ctx.strokeStyle = i === selected ? highlighted : normal;
        ctx.lineWidth = line;
        ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
        const text = `${d.class_name || (record?.mode === "panels" ? "Panel" : "Defect")} ${i + 1} · ${(d.confidence * 100).toFixed(1)}%`;
        const w = ctx.measureText(text).width + 12;
        const y = Math.max(0, y1 - font - 10);
        ctx.fillStyle = backing;
        ctx.fillRect(x1, y, w, font + 9);
        ctx.fillStyle = foreground;
        ctx.fillText(text, x1 + 6, y + font + 1);
      });
    };
    image.src = renderPreview;
    return () => {
      active = false;
    };
  }, [result, renderPreview, dimensions, threshold, selected, record, tab, preferences.theme]);
  function choose(next: File | undefined) {
    if (!next || busy) return;
    const validation = validateFile(next);
    if (validation) {
      setError(validation);
      return;
    }
    setFile(next);
    setError(null);
    setResult(null);
    setRecord(null);
    setDimensions(null);
    setSelected(null);
    setTiffUnsupported(false);
    setServerPreview(null);
    setThermalConfirmed(false);
  }
  function reset() {
    if (busy) return;
    setFile(null);
    setResult(null);
    setRecord(null);
    setDimensions(null);
    setError(null);
    setLastMode(null);
    setServerPreview(null);
    setThermalConfirmed(false);
    if (input.current) input.current.value = "";
  }
  async function analyze(mode: Mode) {
    if (!file || busy) return;
    if (mode === "classify" && !thermalConfirmed) {
      setError(
        "Confirm that this is a compatible PVF-10 thermal panel crop before classification.",
      );
      return;
    }
    setBusy(mode);
    setLastMode(mode);
    setError(null);
    setResult(null);
    setRecord(null);
    const started = performance.now();
    try {
      const prediction = await predict(preferences.apiUrl, mode, file, thermalConfirmed);
      const entry: Inspection = {
        id: prediction.inspection_id || crypto.randomUUID(),
        date: prediction.created_at || new Date().toISOString(),
        filename: file.name,
        mode,
        duration: performance.now() - started,
        result: prediction,
        status: "Completed",
        has_image: !!prediction.inspection_id && !prediction.persistence_error,
      };
      setResult(prediction);
      setRecord(entry);
      addInspection(entry);
      setSelected(null);
      setTab("annotated");
      if (entry.has_image) {
        setServerPreview(inspectionImageUrl(preferences.apiUrl, entry.id));
        setTiffUnsupported(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed.");
      recordError();
    } finally {
      setBusy(null);
    }
  }
  function downloadImage() {
    if (!canvas.current) return;
    const filename = `${file?.name.replace(/\.[^.]+$/, "") || "inspection"}-annotated.png`;
    try {
      canvas.current.toBlob((blob) => {
        if (blob) downloadBlob(blob, filename);
        else
          setError("The annotated image could not be exported. Download the JSON report instead.");
      }, "image/png");
    } catch {
      setError("The annotated image could not be exported. Download the JSON report instead.");
    }
  }
  return (
    <>
      <PageIntro
        eyebrow="COMPUTER VISION WORKSPACE"
        title="AI Inspection"
        description="From drone imagery to a detailed, actionable inspection."
        action={
          file && (
            <Button variant="outline" onClick={reset} disabled={!!busy}>
              <RotateCcw />
              Analyze another image
            </Button>
          )
        }
      />
      <input
        ref={input}
        type="file"
        className="hidden"
        aria-label="Upload inspection image"
        accept=".jpg,.jpeg,.png,.tiff,.tif"
        onChange={(e) => choose(e.target.files?.[0])}
      />
      <div className="inspection-layout">
        <section>
          <SectionHeading
            title="Inspection image"
            subtitle="RGB imagery for detection · Compatible thermal imagery for classification"
          />
          {!file ? (
            <div
              role="button"
              tabIndex={0}
              aria-label="Choose inspection image"
              className={`upload-zone ${dragging ? "dragging" : ""}`}
              onClick={() => input.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  input.current?.click();
                }
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                choose(e.dataTransfer.files[0]);
              }}
            >
              <div className="upload-icon">
                <UploadCloud size={28} strokeWidth={1.4} />
              </div>
              <h3>Drop your solar panel image here</h3>
              <p>or choose an image from your device</p>
              <Button
                variant="outline"
                onClick={(e) => {
                  e.stopPropagation();
                  input.current?.click();
                }}
              >
                <FileImage />
                Browse files
              </Button>
              <small>JPG, JPEG, PNG, TIFF, TIF · Up to 20 MB</small>
            </div>
          ) : (
            <>
              <div className="image-stage">
                {renderPreview && !tiffUnsupported && (
                  <img
                    crossOrigin="anonymous"
                    src={renderPreview}
                    alt="Original inspection image"
                    onLoad={(e) =>
                      setDimensions({
                        width: e.currentTarget.naturalWidth,
                        height: e.currentTarget.naturalHeight,
                      })
                    }
                    onError={() => {
                      if (serverPreview) {
                        setServerPreview(null);
                        return;
                      }
                      if (/\.tiff?$/i.test(file.name)) setTiffUnsupported(true);
                      else {
                        setError(
                          "This image cannot be decoded. It may be corrupted; choose a different image.",
                        );
                        setFile(null);
                      }
                    }}
                  />
                )}{" "}
                {tiffUnsupported && (
                  <EmptyState
                    icon={ImageIcon}
                    title="TIFF preview unavailable"
                    description="Your browser cannot preview this TIFF. The original file can still be sent to the analysis service."
                  />
                )}
              </div>
              <div className="file-meta">
                <div>
                  <strong>{file.name}</strong>
                  <p>
                    {(file.size / 1024 / 1024).toFixed(2)} MB ·{" "}
                    {dimensions
                      ? `${dimensions.width} × ${dimensions.height} px`
                      : "Dimensions unavailable"}
                  </p>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Remove image"
                  disabled={!!busy}
                  onClick={reset}
                >
                  <X />
                </Button>
              </div>
            </>
          )}
          <div className="notice mt-4">
            <Info size={15} />
            <span>
              Each analysis runs independently. Thermal classification requires a compatible PVF-10
              image, not a cropped detection.
            </span>
          </div>
        </section>
        <section>
          <SectionHeading
            title="Choose your analysis"
            subtitle="Three specialized models. Three independent tasks."
          />
          <div className="mode-options">
            {modes.map((m, i) => {
              const Icon = [ScanLine, Crosshair, Cpu][i];
              return (
                <div
                  className={`mode-card ${preferences.mode === m.id ? "preferred" : ""}`}
                  key={m.id}
                >
                  <div className="mode-heading">
                    {Icon && <Icon size={17} />}
                    <h3>{m.title}</h3>
                    <Badge tone={i === 2 ? "green" : "cyan"}>{m.model}</Badge>
                  </div>
                  <p>{m.description}</p>
                  {m.id === "classify" && (
                    <label className="text-note mb-3 block">
                      <input
                        type="checkbox"
                        checked={thermalConfirmed}
                        onChange={(e) => setThermalConfirmed(e.target.checked)}
                        disabled={!!busy}
                      />{" "}
                      I confirm this is an 8-bit PVF-10 compatible thermal panel crop. RGB
                      photographs and raw radiometric data are outside this model’s domain.
                    </label>
                  )}
                  <Button
                    variant={preferences.mode === m.id ? "default" : "outline"}
                    disabled={
                      !file || !!busy || !ready || (m.id === "classify" && !thermalConfirmed)
                    }
                    onClick={() => void analyze(m.id)}
                  >
                    {busy === m.id ? (
                      <>
                        <LoaderCircle className="spinner" />
                        Analyzing image…
                      </>
                    ) : (
                      <>
                        <Play />
                        Run Analysis
                      </>
                    )}
                  </Button>
                </div>
              );
            })}
          </div>
          <p className="text-note">
            Processing happens on your configured FastAPI server. No image is sent until you run an
            analysis.
          </p>
        </section>
      </div>
      {error && (
        <div className="error-banner" role="alert">
          {error}
          {lastMode && file && (
            <Button
              variant="outline"
              size="sm"
              disabled={!!busy}
              onClick={() => {
                if (lastMode) void analyze(lastMode);
              }}
            >
              Retry
            </Button>
          )}
        </div>
      )}
      {busy && (
        <div role="status" className="notice mt-6">
          <LoaderCircle className="spinner" size={16} />
          <span>
            Running {modes.find((m) => m.id === busy)?.title}. Waiting for the model’s response…
          </span>
        </div>
      )}
      {result && record && (
        <section className="inspection-result">
          {result.persistence_error && (
            <p role="alert" className="error-banner">
              {result.persistence_error}
            </p>
          )}
          <div className="result-head">
            <div>
              <h2>
                Inspection results <Badge tone="green">Completed</Badge>
              </h2>
              <p>
                {result.model} · {(record.duration / 1000).toFixed(2)} s end-to-end
                {result.inference_ms !== undefined &&
                  ` · ${result.inference_ms.toFixed(1)} ms model inference`}
              </p>
            </div>
            <div className="inline-actions">
              <Button
                variant="outline"
                size="sm"
                onClick={() => downloadJson(record, `solarvision-${record.id}.json`)}
              >
                <Download />
                JSON report
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Reset results"
                onClick={() => {
                  setResult(null);
                  setRecord(null);
                }}
              >
                <RotateCcw />
              </Button>
            </div>
          </div>
          {record.mode !== "classify" ? (
            <div className="result-layout">
              <div>
                <div className="inline-actions mb-3">
                  <Button
                    size="sm"
                    variant={tab === "original" ? "secondary" : "ghost"}
                    onClick={() => setTab("original")}
                  >
                    Original
                  </Button>
                  <Button
                    size="sm"
                    variant={tab === "annotated" ? "secondary" : "ghost"}
                    onClick={() => setTab("annotated")}
                  >
                    Annotated
                  </Button>
                  {dimensions && (
                    <Button variant="outline" size="sm" onClick={downloadImage}>
                      <Download />
                      Download image
                    </Button>
                  )}
                </div>
                <div className="image-stage">
                  {!dimensions ? (
                    <EmptyState
                      title="Image overlay unavailable"
                      description="The image preview is unavailable. Bounding-box coordinates remain available in the detection list."
                    />
                  ) : (
                    <>
                      <canvas
                        ref={canvas}
                        aria-label="Annotated inspection image"
                        className={tab === "original" ? "hidden" : ""}
                      />
                      {tab === "original" && renderPreview && (
                        <img
                          crossOrigin="anonymous"
                          src={renderPreview}
                          alt="Original result image"
                        />
                      )}
                    </>
                  )}
                </div>
              </div>
              <div>
                <div className="result-stat">
                  <Badge tone="cyan">
                    {record.mode === "panels" ? "Panel detection" : "Defect detection"}
                  </Badge>
                  <h3>{result.count} detections</h3>
                  <p>{detections.length} visible at current threshold</p>
                </div>
                <div className="field">
                  <label htmlFor="result-threshold">
                    Display confidence threshold · {Math.round(threshold * 100)}%
                  </label>
                  <input
                    id="result-threshold"
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={threshold}
                    onChange={(e) => {
                      setThreshold(Number(e.target.value));
                      setSelected(null);
                    }}
                  />
                  <small>Visualization only. This does not change model inference.</small>
                </div>
                <div className="detection-list">
                  {detections.length ? (
                    detections.map((d, i) => (
                      <Button
                        key={i}
                        variant="ghost"
                        className={`detection-item ${selected === i ? "selected" : ""}`}
                        onClick={() => setSelected(i)}
                      >
                        <span>
                          {record.mode === "panels" ? "Panel" : "Defect"} {i + 1} ·{" "}
                          {d.class_name || `Class ${d.class_id}`}
                          <small>
                            bbox_xyxy: [{d.bbox_xyxy.map((n) => Math.round(n)).join(", ")}]
                          </small>
                        </span>
                        <span>{(d.confidence * 100).toFixed(1)}%</span>
                      </Button>
                    ))
                  ) : (
                    <EmptyState
                      title="No detections at this threshold"
                      description="Lower the display threshold or analyze another image."
                    />
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="result-layout">
              <div>
                <div className="result-stat">
                  <Badge tone="green">Thermal prediction</Badge>
                  <h3>{classLabel(result.predicted_class || "")}</h3>
                  <p>
                    {((result.confidence || 0) * 100).toFixed(2)}% confidence · Original class:{" "}
                    {String(result.predicted_class)}
                  </p>
                </div>
                <SectionHeading title="Top 3 predictions" />
                {Object.entries(result.probabilities || {})
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 3)
                  .map(([key, value], i) => (
                    <div key={key} className="evaluation-row">
                      <span>
                        {i + 1}. {classLabel(key)}
                      </span>
                      <strong>{(value * 100).toFixed(2)}%</strong>
                    </div>
                  ))}
                <div className="notice mt-5">
                  <Info size={15} />
                  <span>
                    Confidence is not a guarantee of correctness. Inspect predictions and verify
                    anomalies independently.
                  </span>
                </div>
              </div>
              <div>
                <SectionHeading title="10-class probability distribution" />
                {Object.entries(result.probabilities || {}).map(([key, value]) => {
                  const label = classLabel(key);
                  return (
                    <div key={label}>
                      <div className="probability-row">
                        <span>{label}</span>
                        <strong>
                          {value === undefined ? "Not returned" : `${(value * 100).toFixed(2)}%`}
                        </strong>
                      </div>
                      {value !== undefined && (
                        <div className="progress-track">
                          <progress max="1" value={value} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      )}
    </>
  );
}
