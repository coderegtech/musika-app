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
        : ["youtube.com", "www.youtube.com", "m.youtube.com"].includes(host)
          ? u.searchParams.get("v") ||
            u.pathname.match(/^\/(?:shorts|embed)\/([^/]+)$/)?.[1]
          : null;
    return /^[-\w]{11}$/.test(id || "") ? id : null;
  } catch {
    return null;
  }
}
