import { useMemo, useState } from "react";
import { Download, Search, HardDrive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { downloadJson, modes, classLabel } from "@/lib/solar/domain";
import { useWorkspace } from "./workspace";
import { PageIntro } from "./common";
import { HistoryTable } from "./history-table";

export function HistoryPage() {
  const { history, historyError } = useWorkspace();
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState("all");
  const [sort, setSort] = useState("newest");
  const filtered = useMemo(
    () =>
      history
        .filter((record) => {
          const classes = [
            record.result.predicted_class === undefined
              ? ""
              : classLabel(record.result.predicted_class),
            ...(record.result.detections ?? []).map(
              (detection) => detection.class_name ?? `Class ${detection.class_id}`,
            ),
          ].join(" ");
          return (
            (mode === "all" || record.mode === mode) &&
            `${record.filename} ${record.id} ${record.mode} ${record.result.model} ${classes}`
              .toLowerCase()
              .includes(query.trim().toLowerCase())
          );
        })
        .sort((a, b) =>
          sort === "name"
            ? a.filename.localeCompare(b.filename)
            : sort === "oldest"
              ? a.date.localeCompare(b.date)
              : b.date.localeCompare(a.date),
        ),
    [history, query, mode, sort],
  );

  return (
    <>
      <PageIntro
        eyebrow="INSPECTION RECORDS"
        title="Inspection History"
        description="Completed analyses from this browser and your connected inspection database."
        action={
          <Button
            variant="outline"
            disabled={!filtered.length}
            onClick={() => downloadJson(filtered, "solarvision-history.json")}
          >
            <Download />
            Export {filtered.length === history.length ? "history" : "filtered results"}
          </Button>
        }
      />
      <div className="notice mb-6">
        <HardDrive size={16} />
        <span>
          Browser records are preserved and merged with server history. New server inspections
          retain a PNG preview up to 1600 pixels per side. Imported older records may have no image.
        </span>
      </div>
      {historyError && (
        <p role="alert" className="error-banner">
          Server history could not be synchronized. Local records are preserved. {historyError}
        </p>
      )}
      <div className="tool-row">
        <div className="relative flex flex-1 items-center gap-2">
          <Search size={15} className="text-muted-foreground" />
          <input
            aria-label="Search inspections"
            placeholder="Search images, classes or inspection IDs…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <select
          aria-label="Filter analysis type"
          value={mode}
          onChange={(event) => setMode(event.target.value)}
        >
          <option value="all">All analysis types</option>
          {modes.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title}
            </option>
          ))}
        </select>
        <select
          aria-label="Sort inspections"
          value={sort}
          onChange={(event) => setSort(event.target.value)}
        >
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="name">Image name</option>
        </select>
      </div>
      <p className="text-note mb-3">
        {filtered.length} of {history.length} inspections
      </p>
      <HistoryTable records={filtered} />
    </>
  );
}
