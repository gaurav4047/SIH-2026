/**
 * RecoverX Tauri API bindings.
 *
 * Wraps @tauri-apps/api/core invoke() with typed interfaces for all backend commands.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AppInfo {
  name: string;
  version: string;
  description: string;
}

export interface DeviceInfo {
  path: string;
  name: string;
  size_bytes: number;
  sector_size: number;
  device_type: "fixed" | "removable" | "optical" | "sd_card" | "virtual" | "unknown";
  is_internal: boolean;
  filesystem: string | null;
  is_accessible: boolean;
  model: string | null;
  serial: string | null;
  is_write_protected: boolean;
}

export interface DeviceListResponse {
  devices: DeviceInfo[];
  error: string | null;
}

export interface ScanSession {
  id: string;
  source_identity: SourceIdentity;
  source_size_bytes: number;
  sector_size: number;
  configuration: ScanConfiguration;
  status: SessionStatus;
  last_offset: number;
  processed_bytes: number;
  files_found: number;
  bad_sectors: number;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
  last_error: string | null;
}

export interface SourceIdentity {
  label: string;
  path: string;
  size_bytes: number;
  sector_size: number;
  model: string | null;
  serial: string | null;
  filesystem_label: string | null;
  filesystem_type: string | null;
  partial_hash: string | null;
}

export interface ScanConfiguration {
  mode: ScanMode;
  enable_filesystem_analysis: boolean;
  enable_deleted_file_recovery: boolean;
  enable_file_carving: boolean;
  enable_duplicate_detection: boolean;
  enable_forensic_hashing: boolean;
  file_categories: string[];
}

export type ScanMode = "quick" | "deep" | "file_carving";

export type SessionStatus =
  | "created"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export interface CreateSessionRequest {
  source_path: string;
  source_size_bytes: number;
  sector_size: number;
  scan_mode: string;
  enable_filesystem_analysis: boolean;
  enable_deleted_file_recovery: boolean;
  enable_file_carving: boolean;
  enable_duplicate_detection: boolean;
  enable_forensic_hashing: boolean;
  deleted_after: number | null;   // Unix timestamp seconds
  deleted_before: number | null;  // Unix timestamp seconds
  filter_prefix: string | null;
}

/**
 * Helper type representing a date-range timeline filter.
 * `deleted_after` and `deleted_before` are Unix timestamp seconds (or null for open-ended).
 */
export interface TimelineFilter {
  enabled: boolean;
  deleted_after: number | null;
  deleted_before: number | null;
  /** Human-readable summary, e.g. "Last 30 days" */
  label: string;
}

export interface CommonLocation {
  label: string;
  path: string;
  icon: string;
  exists: boolean;
  is_trash: boolean;
  filter_prefix: string | null;
  hint: string;
}

export interface RecoveredFile {
  id: string;
  session_id: string;
  name: string;
  original_path: string | null;
  size_bytes: number;
  source_offset: number;
  partition_index: number | null;
  filesystem_type: string | null;
  recovery_method: string;
  confidence: number;
  status: "complete" | "partial" | "fragmented" | "corrupted" | "encrypted" | "overwritten";
  sha256: string | null;
  created_at: string | null;
  modified_at: string | null;
  accessed_at: string | null;
  extension: string | null;
  mime_type: string | null;
  is_deleted: boolean;
  is_fragmented: boolean;
  fragments: FileFragment[];
  metadata: Record<string, unknown>;
}

export interface FileFragment {
  offset: number;
  length: number;
  order: number;
}

export interface DetectedPartition {
  index: number;
  partition_table_type: string;
  type_guid: string | null;
  type_id: number | null;
  start_lba: number;
  end_lba: number;
  start_offset: number;
  size_bytes: number;
  name: string | null;
  filesystem: string | null;
  is_bootable: boolean;
  is_active: boolean;
}

export interface RecoveryResult {
  file_id: string;
  name: string;
  destination_path: string;
  status: "success" | "partial" | "failed";
  sha256: string | null;
  size_recovered: number;
  error: string | null;
}

export interface RecoverFilesRequest {
  session_id: string;
  source_path: string;
  file_ids: string[];
  destination_dir: string;
}

// ── Scan progress event (emitted via Tauri window events) ─────────────────────

export interface ScanProgressPayload {
  type: string;
  session_id?: { "0": string };
  // ScanProgress fields
  processed_bytes?: number;
  total_bytes?: number;
  percent?: number;
  speed_bps?: number;
  files_found?: number;
  bad_sectors?: number;
  current_stage?: string;
  eta_seconds?: number | null;
  // ScanCompleted fields
  files_found_total?: number;
  duration_seconds?: number;
  status?: string;
  // TaskStateChanged
  task_type?: string;
  new_status?: string;
  // Error
  error?: string;
}

// ── API calls ─────────────────────────────────────────────────────────────────

export const api = {
  getAppInfo: (): Promise<AppInfo> => invoke("get_app_info"),

  getCommonLocations: (): Promise<CommonLocation[]> => invoke("get_common_locations"),

  listDevices: (): Promise<DeviceListResponse> => invoke("list_devices"),

  getDeviceInfo: (path: string): Promise<DeviceInfo> =>
    invoke("get_device_info", { path }),

  /** Returns true if Full Disk Access is granted (or not on macOS). */
  checkFullDiskAccess: (): Promise<boolean> => invoke("check_full_disk_access"),

  createSession: (request: CreateSessionRequest): Promise<ScanSession> =>
    invoke("create_session", { request }),

  listSessions: (): Promise<ScanSession[]> => invoke("list_sessions"),

  loadSession: (sessionId: string): Promise<ScanSession> =>
    invoke("load_session", { sessionId }),

  deleteSession: (sessionId: string): Promise<void> =>
    invoke("delete_session", { sessionId }),

  startScan: (
    sessionId: string,
    sourcePath: string,
    sourceSizeBytes: number,
    sectorSize: number
  ): Promise<void> =>
    invoke("start_scan", { sessionId, sourcePath, sourceSizeBytes, sectorSize }),

  pauseScan: (sessionId: string): Promise<void> =>
    invoke("pause_scan", { sessionId }),

  resumeScan: (
    sessionId: string,
    sourcePath: string,
    sourceSizeBytes: number,
    sectorSize: number
  ): Promise<void> =>
    invoke("resume_scan", { sessionId, sourcePath, sourceSizeBytes, sectorSize }),

  cancelScan: (sessionId: string): Promise<void> =>
    invoke("cancel_scan", { sessionId }),

  listRecoveredFiles: (sessionId: string): Promise<RecoveredFile[]> =>
    invoke("list_recovered_files", { sessionId }),

  queryRecoveredFiles: (
    sessionId: string,
    category: string | null,
    search: string | null,
    limit: number,
    offset: number
  ): Promise<RecoveredFile[]> =>
    invoke("query_recovered_files", { sessionId, category, search, limit, offset }),

  getCategoryCounts: (sessionId: string): Promise<[string, number][]> =>
    invoke("get_category_counts", { sessionId }),

  listPartitions: (sessionId: string): Promise<DetectedPartition[]> =>
    invoke("list_partitions", { sessionId }),

  recoverFiles: (request: RecoverFilesRequest): Promise<RecoveryResult[]> =>
    invoke("recover_files", { request }),

  verifyFileHash: (destinationPath: string): Promise<string> =>
    invoke("verify_file_hash", { destinationPath }),

  onScanEvent: (callback: (event: ScanProgressPayload) => void) =>
    listen<string>("recoverx-event", (ev) => {
      try {
        const parsed = JSON.parse(ev.payload) as ScanProgressPayload;
        callback(parsed);
      } catch (_) {}
    }),

  scanForCorruption: (request: ScanCorruptionRequest): Promise<CorruptionReport[]> =>
    invoke("scan_for_corruption", { request }),

  repairCorruptedFiles: (request: RepairCorruptedRequest): Promise<RepairResult[]> =>
    invoke("repair_corrupted_files", { request }),

  /** Opens the native macOS folder-picker. Resolves to the chosen path, or null if cancelled. */
  openFolderDialog: (): Promise<string | null> =>
    invoke("open_folder_dialog"),

  /** Opens a native file-picker (multi-select). Resolves to array of chosen paths. */
  openFileDialog: (): Promise<string[]> =>
    invoke("open_file_dialog"),

  /** Opens a native folder-picker for secure-delete targets. Resolves to path or null. */
  openTargetFolderDialog: (): Promise<string | null> =>
    invoke("open_target_folder_dialog"),
};

// ── Helpers ───────────────────────────────────────────────────────────────────

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const GB = 1_073_741_824;
  const MB = 1_048_576;
  const KB = 1_024;
  if (bytes >= GB) return `${(bytes / GB).toFixed(1)} GB`;
  if (bytes >= MB) return `${(bytes / MB).toFixed(1)} MB`;
  if (bytes >= KB) return `${(bytes / KB).toFixed(1)} KB`;
  return `${bytes} B`;
}

export function sessionStatusColor(status: SessionStatus): string {
  switch (status) {
    case "running": return "#22c55e";
    case "completed": return "#3b82f6";
    case "paused": return "#f59e0b";
    case "failed": return "#ef4444";
    case "cancelled": return "#6b7280";
    default: return "#8b5cf6";
  }
}

export function confidenceColor(confidence: number): string {
  if (confidence >= 80) return "#22c55e";
  if (confidence >= 50) return "#f59e0b";
  if (confidence >= 20) return "#ef4444";
  return "#6b7280";
}

export function fileStatusLabel(status: RecoveredFile["status"]): string {
  switch (status) {
    case "complete": return "Complete";
    case "partial": return "Partially Recoverable";
    case "fragmented": return "Fragmented";
    case "corrupted": return "Corrupted or Incomplete";
    case "encrypted": return "Encrypted";
    case "overwritten": return "Overwritten";
    default: return status;
  }
}

export function fileIcon(ext: string | null): string {
  if (!ext) return "📄";
  switch (ext.toLowerCase()) {
    case "jpg": case "jpeg": case "png": case "gif": case "bmp":
    case "tiff": case "webp": case "heic": return "🖼️";
    case "mp4": case "mov": case "avi": case "mkv": case "mpeg": return "🎬";
    case "mp3": case "wav": case "flac": case "ogg": case "m4a": return "🎵";
    case "pdf": return "📕";
    case "doc": case "docx": return "📝";
    case "xls": case "xlsx": return "📊";
    case "ppt": case "pptx": return "📽️";
    case "zip": case "rar": case "7z": case "gz": case "tar": return "📦";
    case "sqlite": case "db": return "🗄️";
    case "txt": case "csv": case "rtf": return "📃";
    default: return "📄";
  }
}

// ── Corrupted Data Recovery types ────────────────────────────────────────────

export type CorruptionKind =
  | "bad_header"
  | "bad_footer"
  | "broken_structure"
  | "truncated_content"
  | "zero_padded_tail"
  | "empty_file"
  | "healthy"
  | "unknown";

export interface CorruptionReport {
  path: string;
  size_bytes: number;
  format: string;
  corruption: CorruptionKind;
  description: string;
  repairable: boolean;
  repair_confidence: number;
}

export interface RepairResult {
  original_path: string;
  repaired_path: string;
  success: boolean;
  action: string;
  bytes_written: number;
  error: string | null;
}

export interface ScanCorruptionRequest {
  paths: string[];
}

export interface RepairCorruptedRequest {
  reports: CorruptionReport[];
  output_dir: string;
}

export function corruptionKindLabel(kind: CorruptionKind): string {
  switch (kind) {
    case "bad_header":        return "Bad Header";
    case "bad_footer":        return "Missing Footer";
    case "broken_structure":  return "Broken Structure";
    case "truncated_content": return "Truncated";
    case "zero_padded_tail":  return "Zero-Padded Tail";
    case "empty_file":        return "Empty File";
    case "healthy":           return "Healthy";
    default:                  return "Unknown";
  }
}

export function corruptionKindColor(kind: CorruptionKind): string {
  switch (kind) {
    case "healthy":    return "#22c55e";
    case "unknown":    return "#6b7280";
    case "empty_file": return "#6b7280";
    default:           return "#ef4444";
  }
}
