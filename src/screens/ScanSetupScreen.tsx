import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api, formatBytes } from "../lib/api";
import type { CommonLocation, CreateSessionRequest, DeviceInfo } from "../lib/api";

// ── Timeline helpers ──────────────────────────────────────────────────────────

/** Returns a date string in "YYYY-MM-DD" format, offset by `daysAgo` from today. */
function dateDaysAgo(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

/** Today in "YYYY-MM-DD". */
function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Convert "YYYY-MM-DD" → Unix seconds (start of day UTC). Returns null for empty. */
function dateToUnix(s: string): number | null {
  if (!s) return null;
  return Math.floor(new Date(s + "T00:00:00Z").getTime() / 1000);
}

/** Convert "YYYY-MM-DD" → Unix seconds (end of day UTC). Returns null for empty. */
function dateToUnixEod(s: string): number | null {
  if (!s) return null;
  return Math.floor(new Date(s + "T23:59:59Z").getTime() / 1000);
}

interface TimelinePreset {
  id: string;
  label: string;
  fromDate: string;
  toDate: string;
}

const PRESETS: TimelinePreset[] = [
  { id: "24h",    label: "Last 24 h",  fromDate: dateDaysAgo(1),   toDate: todayStr() },
  { id: "7d",     label: "Last 7 d",   fromDate: dateDaysAgo(7),   toDate: todayStr() },
  { id: "30d",    label: "Last 30 d",  fromDate: dateDaysAgo(30),  toDate: todayStr() },
  { id: "90d",    label: "Last 3 mo",  fromDate: dateDaysAgo(90),  toDate: todayStr() },
  { id: "1y",     label: "Last year",  fromDate: dateDaysAgo(365), toDate: todayStr() },
  { id: "custom", label: "Custom",     fromDate: "",               toDate: "" },
];

interface LocationState {
  device?: DeviceInfo;
  mode?: "quick" | "deep" | "file_carving";
}

// ── Scan modes ────────────────────────────────────────────────────────────────

const MODES = [
  {
    id: "quick",
    label: "Quick Scan",
    icon: "⚡",
    description: "Scans filesystem metadata and deleted directory entries. Fast — typically completes in minutes.",
    config: {
      enable_filesystem_analysis: true,
      enable_deleted_file_recovery: true,
      enable_file_carving: false,
      enable_duplicate_detection: false,
      enable_forensic_hashing: false,
    },
  },
  {
    id: "deep",
    label: "Deep Scan",
    icon: "🔬",
    description: "Full analysis: filesystem + deleted entries + file carving. Most thorough, takes longer.",
    config: {
      enable_filesystem_analysis: true,
      enable_deleted_file_recovery: true,
      enable_file_carving: true,
      enable_duplicate_detection: true,
      enable_forensic_hashing: true,
    },
  },
  {
    id: "file_carving",
    label: "File Carving",
    icon: "🪛",
    description: "Signature-based raw sector scan. Use when the filesystem is damaged or the drive was formatted.",
    config: {
      enable_filesystem_analysis: false,
      enable_deleted_file_recovery: false,
      enable_file_carving: true,
      enable_duplicate_detection: false,
      enable_forensic_hashing: false,
    },
  },
] as const;

// ── Component ─────────────────────────────────────────────────────────────────

export function ScanSetupScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const locState = (location.state as LocationState) ?? {};

  // Step 1 — Source
  const [locations, setLocations] = useState<CommonLocation[]>([]);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [sourcePath, setSourcePath] = useState(locState.device?.path ?? "");
  const [sourceLabel, setSourceLabel] = useState(
    locState.device ? locState.device.name : ""
  );
  const [sourceDevice, setSourceDevice] = useState<DeviceInfo | null>(locState.device ?? null);
  const [loadingLocations, setLoadingLocations] = useState(true);

  // Step 2 — Mode
  const [mode, setMode] = useState<string>(locState.mode ?? "quick");

  // Step 3 — Timeline filter
  const [timelineEnabled, setTimelineEnabled] = useState(false);
  const [activePreset, setActivePreset] = useState<string>("30d");
  const [fromDate, setFromDate] = useState<string>(dateDaysAgo(30));
  const [toDate, setToDate] = useState<string>(todayStr());

  const handlePreset = (preset: TimelinePreset) => {
    setActivePreset(preset.id);
    if (preset.id !== "custom") {
      setFromDate(preset.fromDate);
      setToDate(preset.toDate);
    }
  };

  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load common locations + devices on mount
  useEffect(() => {
    Promise.all([
      api.getCommonLocations().catch(() => [] as CommonLocation[]),
      api.listDevices().catch(() => ({ devices: [] as DeviceInfo[], error: null })),
    ]).then(([locs, devRes]) => {
      setLocations(locs);
      setDevices(devRes.devices ?? []);
      setLoadingLocations(false);
    });
  }, []);

  const selectedMode = MODES.find((m) => m.id === mode) ?? MODES[0];

  const handleSelectLocation = (loc: CommonLocation) => {
    setSourcePath(loc.path);
    setSourceLabel(loc.label);
    setSourceDevice(null);
  };

  const handleSelectDevice = (dev: DeviceInfo) => {
    setSourcePath(dev.path);
    setSourceLabel(dev.name);
    setSourceDevice(dev);
  };

  const handleStart = async () => {
    if (!sourcePath.trim()) {
      setError("Please select a source location or enter a path.");
      return;
    }
    if (timelineEnabled && fromDate && toDate && fromDate > toDate) {
      setError('"From" date must be earlier than the "To" date.');
      return;
    }
    setCreating(true);
    setError(null);

    try {
      const req: CreateSessionRequest = {
        source_path: sourcePath.trim(),
        source_size_bytes: sourceDevice?.size_bytes ?? 0,
        sector_size: sourceDevice?.sector_size ?? 512,
        scan_mode: mode,
        ...selectedMode.config,
        deleted_after: timelineEnabled ? dateToUnix(fromDate) : null,
        deleted_before: timelineEnabled ? dateToUnixEod(toDate) : null,
        filter_prefix: null,
      };

      const session = await api.createSession(req);
      navigate("/scanning", { state: { session } });
    } catch (err) {
      setError(String(err));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div style={{ padding: "24px", height: "100%", overflow: "auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "24px" }}>
        <button className="btn btn-ghost" onClick={() => navigate("/devices")}>← Devices</button>
        <div>
          <h2>Scan Setup</h2>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.8125rem", marginTop: "2px" }}>
            Select a source and scan mode, then start scanning.
          </p>
        </div>
      </div>

      {error && <div className="alert alert-error" style={{ marginBottom: "16px" }}>{error}</div>}

      {/* ── STEP 1: Source ── */}
      <div className="card" style={{ marginBottom: "16px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
          <h3>① Source</h3>
          {sourcePath && (
            <span style={{ fontSize: "0.8125rem", color: "var(--accent-green)" }}>
              ✓ {sourceLabel || sourcePath}
            </span>
          )}
        </div>

        {/* Common locations */}
        {!loadingLocations && (
          <>
            <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "10px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Common Locations
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px", marginBottom: "16px" }}>
              {locations.filter(l => l.exists).map((loc) => (
                <button
                  key={loc.path}
                  onClick={() => handleSelectLocation(loc)}
                  style={{
                    padding: "12px 10px",
                    background: sourcePath === loc.path ? "var(--accent-blue)" : "var(--bg-primary)",
                    border: `1px solid ${sourcePath === loc.path ? "var(--accent-blue)" : "var(--border)"}`,
                    borderRadius: "8px",
                    color: sourcePath === loc.path ? "#fff" : "var(--text-secondary)",
                    cursor: "pointer",
                    textAlign: "center",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  <span style={{ fontSize: "1.5rem" }}>{loc.icon}</span>
                  <span style={{ fontSize: "0.8125rem", fontWeight: 600 }}>{loc.label}</span>
                  {loc.is_trash && (
                    <span style={{ fontSize: "0.65rem", color: sourcePath === loc.path ? "#ddd6fe" : "var(--accent-amber)" }}>
                      Trash
                    </span>
                  )}
                </button>
              ))}
            </div>
          </>
        )}

        {/* Physical devices */}
        {devices.filter(d => d.device_type !== "virtual").length > 0 && (
          <>
            <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "10px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Storage Devices
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "16px" }}>
              {devices.filter(d => d.device_type !== "virtual").map((dev) => (
                <button
                  key={dev.path}
                  onClick={() => dev.is_accessible && handleSelectDevice(dev)}
                  style={{
                    padding: "10px 14px",
                    background: sourcePath === dev.path ? "var(--accent-blue)" : "var(--bg-primary)",
                    border: `1px solid ${sourcePath === dev.path ? "var(--accent-blue)" : "var(--border)"}`,
                    borderRadius: "8px",
                    color: sourcePath === dev.path ? "#fff" : dev.is_accessible ? "var(--text-primary)" : "var(--text-muted)",
                    cursor: dev.is_accessible ? "pointer" : "not-allowed",
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    opacity: dev.is_accessible ? 1 : 0.5,
                    textAlign: "left",
                  }}
                >
                  <span style={{ fontSize: "1.25rem" }}>{dev.is_internal ? "🖥️" : "🔌"}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: "0.875rem" }}>{dev.name}</div>
                    <div style={{ fontSize: "0.75rem", opacity: 0.8 }}>
                      {dev.path} · {formatBytes(dev.size_bytes)}
                      {!dev.is_accessible && " · No Access (grant Full Disk Access)"}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}

        {/* Manual path */}
        <div>
          <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Or enter a path manually
          </p>
          <input
            className="form-input mono"
            type="text"
            value={sourcePath}
            onChange={(e) => { setSourcePath(e.target.value); setSourceLabel(""); setSourceDevice(null); }}
            placeholder="/dev/disk2  or  /path/to/image.img  or  /Users/you/Downloads"
          />
        </div>
      </div>

      {/* ── STEP 2: Scan Mode ── */}
      <div className="card" style={{ marginBottom: "24px" }}>
        <h3 style={{ marginBottom: "16px" }}>② Scan Mode</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px", marginBottom: "12px" }}>
          {MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              style={{
                padding: "14px 12px",
                background: mode === m.id ? "var(--accent-blue)" : "var(--bg-primary)",
                border: `1px solid ${mode === m.id ? "var(--accent-blue)" : "var(--border)"}`,
                borderRadius: "8px",
                color: mode === m.id ? "#fff" : "var(--text-secondary)",
                cursor: "pointer",
                fontWeight: 600,
                textAlign: "left",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <span style={{ fontSize: "1.2rem" }}>{m.icon}</span>
              {m.label}
            </button>
          ))}
        </div>
        <p style={{ fontSize: "0.875rem", color: "var(--text-secondary)", lineHeight: 1.6 }}>
          {selectedMode.description}
        </p>
      </div>

      {/* ── STEP 3: Timeline Filter ── */}
      <div className="card" style={{ marginBottom: "24px" }}>
        {/* Header row with toggle */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: timelineEnabled ? "20px" : "0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <h3 style={{ margin: 0 }}>③ Timeline Filter</h3>
            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", background: "var(--bg-primary)", padding: "2px 8px", borderRadius: "12px", border: "1px solid var(--border)" }}>
              optional
            </span>
          </div>
          {/* Toggle switch */}
          <button
            onClick={() => setTimelineEnabled((v) => !v)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              background: "none",
              border: "none",
              cursor: "pointer",
              color: timelineEnabled ? "var(--accent-blue)" : "var(--text-muted)",
              fontWeight: 600,
              fontSize: "0.875rem",
              padding: "4px 0",
            }}
          >
            <span
              style={{
                display: "inline-block",
                width: "40px",
                height: "22px",
                borderRadius: "11px",
                background: timelineEnabled ? "var(--accent-blue)" : "var(--border)",
                position: "relative",
                transition: "background 0.2s",
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  position: "absolute",
                  top: "3px",
                  left: timelineEnabled ? "21px" : "3px",
                  width: "16px",
                  height: "16px",
                  borderRadius: "50%",
                  background: "#fff",
                  transition: "left 0.2s",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
                }}
              />
            </span>
            {timelineEnabled ? "Enabled" : "Disabled"}
          </button>
        </div>

        {!timelineEnabled && (
          <p style={{ fontSize: "0.8125rem", color: "var(--text-muted)", margin: 0 }}>
            Scan all files regardless of deletion date. Enable to restrict the scan to a specific date range.
          </p>
        )}

        {timelineEnabled && (
          <>
            <p style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", marginBottom: "16px", lineHeight: 1.5 }}>
              Only recover files deleted within this date range. Useful for pinpointing a recent accidental deletion.
            </p>

            {/* Preset shortcuts */}
            <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Quick Presets
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "20px" }}>
              {PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => handlePreset(preset)}
                  style={{
                    padding: "6px 14px",
                    background: activePreset === preset.id ? "var(--accent-blue)" : "var(--bg-primary)",
                    border: `1px solid ${activePreset === preset.id ? "var(--accent-blue)" : "var(--border)"}`,
                    borderRadius: "20px",
                    color: activePreset === preset.id ? "#fff" : "var(--text-secondary)",
                    cursor: "pointer",
                    fontSize: "0.8125rem",
                    fontWeight: 500,
                    transition: "all 0.15s",
                  }}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            {/* Date pickers */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
              <div>
                <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  From (deleted after)
                </label>
                <input
                  className="form-input"
                  type="date"
                  value={fromDate}
                  max={toDate || todayStr()}
                  onChange={(e) => {
                    setFromDate(e.target.value);
                    setActivePreset("custom");
                  }}
                  style={{ width: "100%" }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  To (deleted before)
                </label>
                <input
                  className="form-input"
                  type="date"
                  value={toDate}
                  min={fromDate}
                  max={todayStr()}
                  onChange={(e) => {
                    setToDate(e.target.value);
                    setActivePreset("custom");
                  }}
                  style={{ width: "100%" }}
                />
              </div>
            </div>

            {/* Summary pill */}
            {(fromDate || toDate) && (
              <div style={{
                marginTop: "14px",
                padding: "10px 14px",
                background: "rgba(59,130,246,0.08)",
                border: "1px solid rgba(59,130,246,0.25)",
                borderRadius: "8px",
                fontSize: "0.8125rem",
                color: "var(--accent-blue)",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}>
                <span>📅</span>
                <span>
                  Scanning for files deleted
                  {fromDate && toDate
                    ? ` between ${fromDate} and ${toDate}`
                    : fromDate
                    ? ` after ${fromDate}`
                    : ` before ${toDate}`}
                </span>
              </div>
            )}

            {/* Validation warning */}
            {fromDate && toDate && fromDate > toDate && (
              <div className="alert alert-error" style={{ marginTop: "10px" }}>
                "From" date must be earlier than "To" date.
              </div>
            )}
          </>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
        <button
          className="btn btn-primary btn-lg"
          onClick={handleStart}
          disabled={creating || !sourcePath.trim() || (timelineEnabled && !!fromDate && !!toDate && fromDate > toDate)}
        >
          {creating ? "Starting…" : `▶ Start ${selectedMode.label}`}
        </button>
        <button className="btn btn-ghost btn-lg" onClick={() => navigate(-1)}>
          Cancel
        </button>
        {sourcePath && (
          <span style={{ fontSize: "0.8125rem", color: "var(--text-muted)", marginLeft: "auto" }}>
            {sourceLabel || sourcePath} · {selectedMode.label}
            {timelineEnabled && (fromDate || toDate) && (
              <> · 📅 {fromDate || "…"} → {toDate || "…"}</>
            )}
          </span>
        )}
      </div>

      <div className="alert alert-info" style={{ marginTop: "20px" }}>
        <strong>Safety:</strong> The source is always opened read-only. RecoverX never modifies the selected location.
      </div>
    </div>
  );
}
