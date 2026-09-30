import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import {
  DEMO,
  Track,
  Download,
  Playlist,
  User,
  ACTIVE_STATES,
  artwork,
  duplicate,
  isLocalPlaylist,
} from "./models";
import { demoTracks, demoPlaylists } from "./demo";
import {
  persistence,
  saveTrack,
  removeTrack,
  savePlaylist,
  removePlaylist as deletePlaylistRecord,
  localTracks,
  localPlaylists,
} from "./services/storage";
import { saveAudio, deleteAudio } from "./services/media";
import { request } from "./services/api";
type Tab = "Home" | "Search" | "Downloads" | "Library" | "Profile";
export type ActionMode =
  "menu" | "download" | "downloadToPlaylist" | "addToPlaylist" | "delete";
/** A multi-track download (e.g. a whole playlist) whose overall progress is shown together. */
export type Batch = {
  ids: string[];
  already: number;
  label: string;
  failed: string[];
};
type State = {
  tab: Tab;
  setTab: (tab: Tab) => void;
  library: Track[];
  removedIds: string[];
  downloads: Download[];
  playlists: Playlist[];
  /** Metadata of tracks that playlists reference, so they survive deleting the audio file. */
  knownTracks: Record<string, Track>;
  /** trackId -> playlist ids to add the track to once its download completes. */
  pendingPlaylists: Record<string, string[]>;
  recent: Track[];
  likes: string[];
  user: User | null;
  setUser: (u: User | null) => void;
  demoEntered: boolean;
  enterDemo: () => void;
  format: "mp3" | "m4a" | "opus";
  quality: 128 | 192 | 256 | 320;
  theme: "light" | "dark";
  setSetting: (key: "format" | "quality" | "theme", value: any) => void;
  paused: boolean;
  toast: string | null;
  notify: (message: string) => void;
  actions: { track: Track; mode: ActionMode } | null;
  openActions: (track: Track, mode?: ActionMode) => void;
  closeActions: () => void;
  batch: Batch | null;
  clearBatch: () => void;
  current: Track | null;
  playing: boolean;
  shuffle: boolean;
  repeat: boolean;
  queueIds: string[] | null;
  setPlaying: (value: boolean) => void;
  play: (t: Track, keepQueue?: boolean) => void;
  playTracks: (
    tracks: Track[],
    options?: { startId?: string; shuffle?: boolean },
  ) => void;
  next: (delta?: number) => void;
  toggleShuffle: () => void;
  toggleRepeat: () => void;
  like: (id: string) => void;
  viewed: (track: Track) => void;
  addPlaylist: (title: string, ids: string[], cover?: string) => string;
  renamePlaylist: (id: string, title: string) => void;
  addToPlaylist: (playlistId: string, tracks: Track[]) => number;
  removeFromPlaylist: (playlistId: string, trackId: string) => void;
  moveInPlaylist: (playlistId: string, trackId: string, delta: -1 | 1) => void;
  removePlaylist: (id: string) => void;
  remove: (track: Track) => Promise<void>;
  enqueue: (
    tracks: Track[],
    permission: boolean,
    allowDuplicate?: boolean,
    playlistId?: string,
  ) => Promise<void>;
  downloadTracks: (
    tracks: Track[],
    permission: boolean,
    options?: { playlistId?: string; label?: string },
  ) => Promise<void>;
  quickDownload: (track: Track) => void;
  queueAction: (action: string, id?: string) => Promise<void>;
  updateJob: (id: string, changes: Partial<Download>) => void;
  complete: (track: Track, playlistId?: string | null) => Promise<void>;
  initialize: () => Promise<void>;
};
/** Playlists reference tracks by id; audio may have been deleted, so fall back to saved metadata. */
export function resolveTracks(
  state: Pick<State, "library" | "knownTracks">,
  ids: string[] = [],
) {
  return ids
    .map(
      (id) => state.library.find((t) => t.id === id) || state.knownTracks[id],
    )
    .filter((t): t is Track => !!t);
}
export const playlistsContaining = (playlists: Playlist[], trackId: string) =>
  playlists.filter((p) => p.trackIds?.includes(trackId));
const withoutFile = (t: Track): Track => ({
  ...t,
  localUri: undefined,
  localThumbnail: undefined,
});
const shuffled = <T>(items: T[]) => {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};
let toastTimer: ReturnType<typeof setTimeout>;
export const useStore = create<State>()(
  persist(
    (set, get) => {
      const activeQueue = () => {
        const { library, queueIds } = get();
        if (!queueIds) return library;
        const queue = queueIds
          .map((id) => library.find((t) => t.id === id))
          .filter((t): t is Track => !!t);
        return queue.length ? queue : library;
      };
      const editPlaylist = (id: string, change: (p: Playlist) => Playlist) => {
        const existing = get().playlists.find((p) => p.id === id);
        if (!existing || !isLocalPlaylist(existing)) return;
        const first = resolveTracks(get(), change(existing).trackIds)[0];
        const updated = {
          ...change(existing),
          thumbnail: first ? artwork(first) : existing.thumbnail,
          updatedAt: new Date().toISOString(),
        };
        set({
          playlists: get().playlists.map((p) => (p.id === id ? updated : p)),
        });
        void savePlaylist(updated).catch(() => {});
      };
      const link = (trackId: string, playlistId?: string) => {
        if (!playlistId) return;
        const pending = get().pendingPlaylists;
        set({
          pendingPlaylists: {
            ...pending,
            [trackId]: [...new Set([...(pending[trackId] || []), playlistId])],
          },
        });
      };
      const unlink = (trackId: string, playlistId?: string) => {
        if (!playlistId) return;
        const { [trackId]: waiting = [], ...rest } = get().pendingPlaylists;
        const remaining = waiting.filter((id) => id !== playlistId);
        set({
          pendingPlaylists: remaining.length
            ? { ...rest, [trackId]: remaining }
            : rest,
        });
      };
      return {
        tab: "Home",
        setTab: (tab) => set({ tab }),
        library: [],
        removedIds: [],
        downloads: [],
        playlists: DEMO ? demoPlaylists : [],
        knownTracks: {},
        pendingPlaylists: {},
        recent: [],
        likes: [],
        user: null,
        demoEntered: false,
        enterDemo: () => set({ demoEntered: true }),
        setUser: (user) => set({ user }),
        format: "mp3",
        quality: 320,
        theme: "light",
        setSetting: (key, value) => set({ [key]: value }),
        paused: false,
        toast: null,
        notify: (toast) => {
          clearTimeout(toastTimer);
          set({ toast });
          toastTimer = setTimeout(() => set({ toast: null }), 4500);
        },
        actions: null,
        openActions: (track, mode = "menu") =>
          set({ actions: { track, mode } }),
        closeActions: () => set({ actions: null }),
        batch: null,
        clearBatch: () => set({ batch: null }),
        current: null,
        playing: false,
        shuffle: false,
        repeat: false,
        queueIds: null,
        setPlaying: (playing) => set({ playing }),
        play: (track, keepQueue = false) => {
          const saved = get().library.find((t) => t.id === track.id);
          if (!saved) {
            get().notify("Download this track to listen offline.");
            return;
          }
          set({
            current: saved,
            playing: true,
            ...(keepQueue ? {} : { queueIds: null }),
          });
        },
        playTracks: (tracks, options = {}) => {
          const playable = resolveTracks(
            { library: get().library, knownTracks: {} },
            tracks.map((t) => t.id),
          );
          if (!playable.length) {
            get().notify("Download these tracks to play them offline.");
            return;
          }
          const start =
            playable.find((t) => t.id === options.startId) ||
            (options.shuffle
              ? playable[Math.floor(Math.random() * playable.length)]
              : playable[0]);
          set({
            queueIds: playable.map((t) => t.id),
            current: start,
            playing: true,
            ...(options.shuffle ? { shuffle: true } : {}),
          });
        },
        next: (delta = 1) => {
          const queue = activeQueue();
          const { current, shuffle } = get();
          if (!queue.length) return;
          const index = queue.findIndex((t) => t.id === current?.id);
          const next =
            shuffle && queue.length > 1
              ? (index + 1 + Math.floor(Math.random() * (queue.length - 1))) %
                queue.length
              : (index + delta + queue.length) % queue.length;
          set({ current: queue[next], playing: true });
        },
        toggleShuffle: () => set({ shuffle: !get().shuffle }),
        toggleRepeat: () => set({ repeat: !get().repeat }),
        like: (id) =>
          set({
            likes: get().likes.includes(id)
              ? get().likes.filter((x) => x !== id)
              : [...get().likes, id],
          }),
        viewed: (track) =>
          set({
            recent: [
              withoutFile(track),
              ...get().recent.filter((t) => t.id !== track.id),
            ].slice(0, 12),
          }),
        addPlaylist: (title, ids, cover) => {
          const id =
            "local-" +
            Date.now() +
            "-" +
            Math.random().toString(36).slice(2, 7);
          const first = resolveTracks(get(), ids)[0];
          const playlist: Playlist = {
            id,
            title,
            artist: "Made by you",
            thumbnail:
              (first && artwork(first)) || cover || demoTracks[0].thumbnail,
            trackIds: ids,
            updatedAt: new Date().toISOString(),
          };
          set({ playlists: [...get().playlists, playlist] });
          void savePlaylist(playlist).catch(() => {});
          get().notify("Playlist created.");
          return id;
        },
        renamePlaylist: (id, title) => {
          editPlaylist(id, (p) => ({ ...p, title }));
          get().notify("Playlist renamed.");
        },
        addToPlaylist: (playlistId, tracks) => {
          const playlist = get().playlists.find((p) => p.id === playlistId);
          if (!playlist || !isLocalPlaylist(playlist)) return 0;
          const fresh = tracks.filter(
            (t) => !playlist.trackIds?.includes(t.id),
          );
          const known = { ...get().knownTracks };
          for (const t of tracks) known[t.id] = withoutFile(t);
          set({ knownTracks: known });
          // Playlists reference the one downloaded track; the audio is never copied.
          editPlaylist(playlistId, (p) => ({
            ...p,
            trackIds: [...(p.trackIds || []), ...fresh.map((t) => t.id)],
          }));
          return fresh.length;
        },
        removeFromPlaylist: (playlistId, trackId) =>
          editPlaylist(playlistId, (p) => ({
            ...p,
            trackIds: (p.trackIds || []).filter((id) => id !== trackId),
          })),
        moveInPlaylist: (playlistId, trackId, delta) =>
          editPlaylist(playlistId, (p) => {
            const ids = [...(p.trackIds || [])];
            const from = ids.indexOf(trackId),
              to = from + delta;
            if (from < 0 || to < 0 || to >= ids.length) return p;
            [ids[from], ids[to]] = [ids[to], ids[from]];
            return { ...p, trackIds: ids };
          }),
        removePlaylist: (id) => {
          // Only the playlist goes: downloaded audio stays in the library.
          set({ playlists: get().playlists.filter((p) => p.id !== id) });
          void deletePlaylistRecord(id).catch(() => {});
          get().notify(
            "Playlist deleted. Your downloaded songs are still here.",
          );
        },
        remove: async (track) => {
          const referenced = playlistsContaining(get().playlists, track.id);
          await deleteAudio(track);
          await removeTrack(track.id);
          set({
            library: get().library.filter((t) => t.id !== track.id),
            // Playlists keep the source info so the song can be downloaded again.
            knownTracks: referenced.length
              ? { ...get().knownTracks, [track.id]: withoutFile(track) }
              : get().knownTracks,
            removedIds: [
              ...get().removedIds.filter((id) => id !== track.id),
              track.id,
            ],
            ...(get().queueIds
              ? { queueIds: get().queueIds!.filter((id) => id !== track.id) }
              : {}),
            ...(get().current?.id === track.id
              ? { current: null, playing: false }
              : {}),
          });
          get().notify("Removed from this device.");
        },
        updateJob: (id, changes) =>
          set({
            downloads: get().downloads.map((j) =>
              j.id === id ? { ...j, ...changes } : j,
            ),
          }),
        complete: async (track, playlistId) => {
          await saveTrack(track);
          set({
            library: [track, ...get().library.filter((t) => t.id !== track.id)],
            removedIds: get().removedIds.filter((id) => id !== track.id),
          });
          const { [track.id]: waiting = [], ...rest } = get().pendingPlaylists;
          set({ pendingPlaylists: rest });
          const names: string[] = [];
          for (const id of new Set([
            ...waiting,
            ...(playlistId ? [playlistId] : []),
          ])) {
            const playlist = get().playlists.find((p) => p.id === id);
            if (!playlist || !isLocalPlaylist(playlist)) continue;
            get().addToPlaylist(id, [track]);
            names.push(playlist.title);
          }
          if (names.length)
            get().notify(`Downloaded and added to "${names[0]}" ✓`);
        },
        enqueue: async (
          tracks,
          permission,
          allowDuplicate = false,
          playlistId,
        ) => {
          if (!permission) {
            get().notify(
              "Confirm that you have permission to download this music.",
            );
            return;
          }
          const playlistName = get().playlists.find(
            (p) => p.id === playlistId,
          )?.title;
          let added = 0,
            already = 0,
            failed = 0,
            lastError = "";
          for (const track of tracks) {
            const status = duplicate(track, get().library);
            if (status === "ALREADY DOWNLOADED") {
              // Never download twice: reuse the existing local file.
              already++;
              if (playlistId)
                get().addToPlaylist(playlistId, [
                  get().library.find((t) => t.id === track.id) || track,
                ]);
              continue;
            }
            if (
              get().downloads.some(
                (j) =>
                  j.track.id === track.id && ACTIVE_STATES.includes(j.state),
              )
            ) {
              link(track.id, playlistId);
              continue;
            }
            if (status === "POSSIBLE DUPLICATE" && !allowDuplicate) {
              get().notify(
                "Possible duplicate. Review this track before downloading.",
              );
              continue;
            }
            link(track.id, playlistId);
            try {
              if (DEMO) {
                const job: Download = {
                  id: "job-" + Date.now() + "-" + track.id,
                  track,
                  state: "QUEUED",
                  progress: 0,
                  stage: "Queued",
                  playlist_id: playlistId,
                };
                set({ downloads: [job, ...get().downloads] });
                added++;
              } else {
                const job = await request<Download & { duplicate?: string }>(
                  "/downloads",
                  {
                    method: "POST",
                    body: JSON.stringify({
                      video_id: track.id,
                      url: track.source_url || undefined,
                      playlist_id: playlistId,
                      format: get().format,
                      quality: get().quality,
                      permission_confirmed: permission,
                      allow_duplicate: allowDuplicate,
                    }),
                  },
                );
                if (job.duplicate) {
                  if (job.duplicate === "ALREADY DOWNLOADED") {
                    const data = await request<{ items: Track[] }>("/library");
                    const saved = data.items.find((t) => t.id === track.id);
                    if (saved) {
                      await get().complete(await saveAudio(saved));
                      get().notify(
                        "Saved your existing download to this device.",
                      );
                    }
                  } else {
                    unlink(track.id, playlistId);
                    get().notify(
                      "Possible duplicate. Review this track before downloading.",
                    );
                  }
                  continue;
                }
                set({
                  downloads: [
                    job,
                    ...get().downloads.filter((j) => j.id !== job.id),
                  ],
                });
                added++;
              }
            } catch (e) {
              unlink(track.id, playlistId);
              // One bad track must never sink a whole batch.
              if (tracks.length === 1) throw e;
              failed++;
              lastError = (e as Error).message;
              const batch = get().batch;
              if (batch?.ids.includes(track.id))
                set({
                  batch: { ...batch, failed: [...batch.failed, track.id] },
                });
            }
          }
          if (failed)
            get().notify(
              `${failed} of ${tracks.length} tracks could not be queued: ${lastError}`,
            );
          else if (added)
            get().notify(
              `${added} ${added === 1 ? "track" : "tracks"} added to your downloads.`,
            );
          else if (already)
            get().notify(
              playlistName
                ? `Already downloaded. Added to "${playlistName}" ✓`
                : "Already downloaded",
            );
          else if (DEMO)
            get().notify("These tracks are already saved or queued.");
        },
        downloadTracks: async (tracks, permission, options = {}) => {
          const ids = tracks
            .filter((t) => duplicate(t, get().library) === "NEW")
            .map((t) => t.id);
          if (ids.length && permission)
            set({
              batch: {
                ids,
                already: tracks.length - ids.length,
                label: options.label || "Download",
                failed: [],
              },
            });
          await get().enqueue(tracks, permission, false, options.playlistId);
          // Tracks that never got a job (e.g. held back as possible duplicates) count as already available.
          const batch = get().batch;
          if (!batch) return;
          const state = get();
          const orphans = batch.ids.filter(
            (id) =>
              !batch.failed.includes(id) &&
              !state.library.some((t) => t.id === id) &&
              !state.downloads.some((j) => j.track.id === id),
          );
          if (!orphans.length) return;
          const remaining = batch.ids.filter((id) => !orphans.includes(id));
          set({
            batch: remaining.length
              ? {
                  ...batch,
                  ids: remaining,
                  already: batch.already + orphans.length,
                }
              : null,
          });
        },
        quickDownload: (track) => {
          if (get().library.some((t) => t.id === track.id))
            get().openActions(track, "menu");
          else if (DEMO)
            void get()
              .enqueue([track], true)
              .catch((e) => get().notify(e.message));
          else get().openActions(track, "download");
        },
        queueAction: async (action, id) => {
          if (action === "remove" && id)
            set({ downloads: get().downloads.filter((j) => j.id !== id) });
          if (!DEMO) {
            await request(
              id ? `/downloads/${id}/${action}` : `/downloads/queue/${action}`,
              { method: "POST" },
            );
            return;
          }
          if (action === "pause" || action === "resume")
            set({ paused: action === "pause" });
          if (action === "clear")
            set({
              downloads: get().downloads.filter(
                (j) => !["COMPLETED", "SKIPPED", "CANCELLED"].includes(j.state),
              ),
            });
          if (action === "cancel" && id)
            get().updateJob(id, { state: "CANCELLED", stage: "Cancelled" });
          if (action === "retry")
            set({
              downloads: get().downloads.map((j) =>
                (id ? j.id === id : ["FAILED"].includes(j.state))
                  ? {
                      ...j,
                      state: "QUEUED",
                      progress: 0,
                      stage: "Queued",
                      error: undefined,
                    }
                  : j,
              ),
            });
        },
        initialize: async () => {
          if (DEMO && !(await persistence.getItem("musika-seeded"))) {
            for (const track of demoTracks.slice(0, 4)) {
              await get().complete(await saveAudio(track));
            }
            await persistence.setItem("musika-seeded", "true");
          }
          // Recover from the relational tables if the persisted state blob is
          // missing or corrupted; never overrides state that already loaded.
          if (!DEMO && !get().library.length) {
            const recovered = await localTracks();
            if (recovered.length) set({ library: recovered });
          }
          if (!DEMO && !get().playlists.length) {
            const recovered = await localPlaylists();
            if (recovered.length) set({ playlists: recovered });
          }
          set({
            downloads: get().downloads.map((j) =>
              DEMO &&
              ["ANALYZING", "DOWNLOADING", "PROCESSING"].includes(j.state)
                ? { ...j, state: "QUEUED", progress: 0 }
                : j,
            ),
          });
        },
      };
    },
    {
      name: "musika-state",
      storage: createJSONStorage(() => persistence),
      partialize: (s) => ({
        library: s.library,
        removedIds: s.removedIds,
        downloads: s.downloads,
        playlists: s.playlists,
        knownTracks: s.knownTracks,
        pendingPlaylists: s.pendingPlaylists,
        recent: s.recent,
        likes: s.likes,
        format: s.format,
        quality: s.quality,
        theme: s.theme,
        paused: s.paused,
        demoEntered: s.demoEntered,
      }),
    },
  ),
);

const active = new Set<string>();
let polling = false;
export async function tickQueue() {
  const s = useStore.getState();
  if (!DEMO) {
    if (!s.user || polling) return;
    polling = true;
    try {
      const r = await request<{ items: Download[]; paused: boolean }>(
        "/downloads",
      );
      useStore.setState({ downloads: r.items, paused: r.paused });
      for (const job of r.items) {
        if (
          job.state === "COMPLETED" &&
          !useStore.getState().removedIds.includes(job.track.id) &&
          !useStore.getState().library.some((t) => t.id === job.track.id) &&
          !active.has(job.id)
        ) {
          active.add(job.id);
          try {
            await s.complete(await saveAudio(job.track), job.playlist_id);
          } catch (e) {
            s.updateJob(job.id, {
              error:
                "Saved on server. Device transfer failed; retrying when connected.",
            });
          } finally {
            active.delete(job.id);
          }
        }
      }
    } catch (e) {
      /* Keep local playback available while offline. */
    } finally {
      polling = false;
    }
    return;
  }
  if (s.paused) return;
  for (const job of s.downloads.filter((j) => j.state === "QUEUED")) {
    if (active.size >= 3) break;
    if (active.has(job.id)) continue;
    active.add(job.id);
    s.updateJob(job.id, {
      state: "DOWNLOADING",
      progress: 15,
      stage: "Downloading",
    });
    void (async () => {
      try {
        const track = await saveAudio(job.track);
        if (
          useStore.getState().downloads.find((j) => j.id === job.id)?.state ===
          "CANCELLED"
        ) {
          await deleteAudio(track);
          return;
        }
        s.updateJob(job.id, {
          state: "PROCESSING",
          progress: 85,
          stage: "Saving metadata",
        });
        await s.complete(track, job.playlist_id);
        s.updateJob(job.id, {
          state: "COMPLETED",
          progress: 100,
          stage: "Completed",
        });
      } catch (e) {
        s.updateJob(job.id, {
          state: "FAILED",
          error: (e as Error).message,
          progress: 0,
          stage: "Failed",
        });
      } finally {
        active.delete(job.id);
      }
    })();
  }
}
