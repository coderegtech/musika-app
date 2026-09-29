import { API, DEMO, Page, Playlist, Track } from "../models";
import { demoTracks, demoPlaylists } from "../demo";
import { authHeaders, clearSession, sessionExpired } from "./auth";
export async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const r = await fetch(API + path, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
      ...init.headers,
    },
  });
  if (r.status === 401) {
    await clearSession();
    sessionExpired();
    throw new Error("Your session expired. Sign in again from Profile.");
  }
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(
      typeof e.detail === "string"
        ? e.detail
        : "The request failed. Please try again.",
    );
  }
  return r.json();
}
const cache = new Map<string, Page<Track | Playlist>>();
export async function searchMusic(
  q: string,
  kind: "tracks" | "playlists",
  page = "",
  signal?: AbortSignal,
): Promise<Page<Track | Playlist>> {
  const key = JSON.stringify([q.trim().toLowerCase(), kind, page]);
  if (cache.has(key)) return cache.get(key)!;
  let result: Page<Track | Playlist>;
  if (DEMO) {
    const all = kind === "tracks" ? demoTracks : demoPlaylists;
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const filtered = all.filter((t) =>
      words.every((w) =>
        (t.title + " " + t.artist + " " + ("album" in t ? t.album : ""))
          .toLowerCase()
          .includes(w),
      ),
    );
    const start = Number(page || 0);
    result = {
      items: filtered.slice(start, start + 8),
      nextPageToken:
        start + 8 < filtered.length ? String(start + 8) : undefined,
    };
  } else
    result = await request(
      `/music/search?q=${encodeURIComponent(q)}&kind=${kind}&page=${encodeURIComponent(page)}`,
      { signal },
    );
  if (cache.size > 100) cache.delete(cache.keys().next().value!);
  cache.set(key, result);
  return result;
}
export const discover = () =>
  DEMO
    ? Promise.resolve({ items: demoTracks })
    : request<Page<Track>>("/music/discover");
export const getVideo = (id: string) =>
  DEMO
    ? Promise.reject(
        new Error(
          "Paste URL is available when your live YouTube connection is configured. Explore the demo catalog for now.",
        ),
      )
    : request<Track>("/music/video/" + id);
export const getPlaylistItems = (p: Playlist, page = "") =>
  DEMO
    ? Promise.resolve({
        items: demoTracks.filter((t) => p.trackIds?.includes(t.id)),
      } as Page<Track>)
    : request<Page<Track>>(
        `/music/playlists/${p.id}?page=${encodeURIComponent(page)}`,
      );
