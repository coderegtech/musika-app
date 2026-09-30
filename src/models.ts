export type Track = {
  id: string;
  source: "youtube" | "demo";
  title: string;
  artist: string;
  duration: number;
  thumbnail: string;
  original_title: string;
  original_description: string;
  normalized_title?: string;
  normalized_artist?: string;
  channel: string;
  source_url: string;
  classification: "MUSIC" | "LIKELY_MUSIC" | "NOT_MUSIC";
  album?: string;
  release?: string;
  localUri?: string;
  localThumbnail?: string;
  downloaded_at?: string;
  file_hash?: string;
  bytes?: number;
  format?: string;
};
export type Playlist = {
  id: string;
  title: string;
  artist: string;
  thumbnail: string;
  description?: string;
  trackIds?: string[];
  color?: string;
  updatedAt?: string;
};
export type DownloadState =
  | "QUEUED"
  | "ANALYZING"
  | "DOWNLOADING"
  | "PROCESSING"
  | "COMPLETED"
  | "SKIPPED"
  | "FAILED"
  | "CANCELLED";
export type Download = {
  id: string;
  track: Track;
  state: DownloadState;
  progress: number;
  error?: string;
  warning?: string;
  stage?: string;
  speed?: number | null;
  bytes_total?: number;
  playlist_id?: string | null;
};
export type Page<T> = { items: T[]; nextPageToken?: string };
export type User = {
  sub: string;
  name: string;
  email: string;
  picture?: string;
};
export const DEMO = process.env.EXPO_PUBLIC_DEMO !== "false";
export const API = process.env.EXPO_PUBLIC_API_URL || "http://localhost:8000";
export const seconds = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
export const normalize = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(
      /\((official|lyrics?|audio|video|visualizer)[^)]*\)|\[(official|lyrics?|audio|video)[^\]]*\]/g,
      "",
    )
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
export function duplicate(track: Track, library: Track[]) {
  if (
    library.some(
      (t) =>
        (t.source === track.source && t.id === track.id) ||
        (t.file_hash && t.file_hash === track.file_hash),
    )
  )
    return "ALREADY DOWNLOADED";
  if (
    library.some(
      (t) =>
        normalize(t.title) === normalize(track.title) &&
        normalize(t.artist) === normalize(track.artist) &&
        Math.abs(t.duration - track.duration) <= 5,
    )
  )
    return "POSSIBLE DUPLICATE";
  return "NEW";
}
export function parseVideoUrl(input: string) {
  try {
    const u = new URL(input);
    if (!["https:", "http:"].includes(u.protocol) || u.username || u.password)
      return null;
    const host = u.hostname.toLowerCase();
    const id =
      host === "youtu.be"
        ? u.pathname.slice(1)
        : [
              "youtube.com",
              "www.youtube.com",
              "m.youtube.com",
              "music.youtube.com",
            ].includes(host)
          ? u.searchParams.get("v") ||
            u.pathname.match(/^\/(?:shorts|embed)\/([^/]+)$/)?.[1]
          : null;
    return /^[-\w]{11}$/.test(id || "") ? id : null;
  } catch {
    return null;
  }
}
export const isLocalPlaylist = (p: Pick<Playlist, "id">) =>
  p.id.startsWith("local-");
/** The single canonical watch URL for a YouTube track, or null when it has none (demo/local audio). */
export function canonicalUrl(
  track: Pick<Track, "id" | "source" | "source_url">,
) {
  if (track.source !== "youtube") return null;
  const id =
    (track.source_url ? parseVideoUrl(track.source_url) : null) ||
    (/^[-\w]{11}$/.test(track.id) ? track.id : null);
  return id ? `https://www.youtube.com/watch?v=${id}` : null;
}
/** Prefer artwork cached on the device so covers still render offline. */
export const artwork = (track: Pick<Track, "thumbnail" | "localThumbnail">) =>
  track.localThumbnail || track.thumbnail;
export function totalDuration(tracks: Pick<Track, "duration">[]) {
  const total = Math.round(tracks.reduce((sum, t) => sum + t.duration, 0));
  const hours = Math.floor(total / 3600),
    minutes = Math.floor((total % 3600) / 60);
  if (hours) return `${hours} hr ${minutes} min`;
  return minutes ? `${minutes} min` : `${total} sec`;
}
export function formatBytes(bytes?: number | null) {
  if (!bytes || bytes < 0) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
export const ACTIVE_STATES: DownloadState[] = [
  "QUEUED",
  "ANALYZING",
  "DOWNLOADING",
  "PROCESSING",
];
const STAGES: Record<DownloadState, string> = {
  QUEUED: "Queued",
  ANALYZING: "Fetching",
  DOWNLOADING: "Downloading",
  PROCESSING: "Converting",
  COMPLETED: "Completed",
  SKIPPED: "Already downloaded",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};
/** Human status line for the download manager: stage, percent, speed and size. */
export function jobStatus(job: Download) {
  const parts = [job.stage || STAGES[job.state]];
  if (["DOWNLOADING", "PROCESSING"].includes(job.state))
    parts.push(`${Math.round(job.progress)}%`);
  if (job.state === "DOWNLOADING" && job.speed)
    parts.push(`${formatBytes(job.speed)}/s`);
  const size = formatBytes(job.bytes_total || job.track.bytes);
  if (size && !["QUEUED", "FAILED", "CANCELLED"].includes(job.state))
    parts.push(size);
  return parts.join(" · ");
}
