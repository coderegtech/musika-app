import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { DEMO, Track, Download, Playlist, User, duplicate } from "./models";
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
type State = {
  tab: Tab;
  setTab: (tab: Tab) => void;
  library: Track[];
  removedIds: string[];
  downloads: Download[];
  playlists: Playlist[];
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
  current: Track | null;
  /** What next/previous step through; empty means the library. */
  queue: Track[];
  playing: boolean;
  shuffle: boolean;
  repeat: boolean;
  setPlaying: (value: boolean) => void;
  play: (t: Track, queue?: Track[]) => void;
  next: (delta?: number) => void;
  toggleShuffle: () => void;
  toggleRepeat: () => void;
  like: (id: string) => void;
  addPlaylist: (title: string, ids: string[]) => void;
  removePlaylist: (id: string) => void;
  remove: (track: Track) => Promise<void>;
  enqueue: (tracks: Track[], allowDuplicate?: boolean) => Promise<void>;
  queueAction: (action: string, id?: string) => Promise<void>;
  updateJob: (id: string, changes: Partial<Download>) => void;
  complete: (track: Track) => Promise<void>;
  initialize: () => Promise<void>;
};
let toastTimer: ReturnType<typeof setTimeout>;
export const useStore = create<State>()(
  persist(
    (set, get) => ({
      tab: "Home",
      setTab: (tab) => set({ tab }),
      library: [],
      removedIds: [],
      downloads: [],
      playlists: DEMO ? demoPlaylists : [],
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
      current: null,
      queue: [],
      playing: false,
      shuffle: false,
      repeat: false,
      setPlaying: (playing) => set({ playing }),
      play: (track, queue) => {
        const saved = get().library.find((t) => t.id === track.id);
        // Tracks that aren't downloaded stream from the server instead.
        if (!saved && track.source !== "youtube") {
          get().notify("Download this track to listen offline.");
          return;
        }
        set({
          current: saved || track,
          queue: queue?.length ? queue : saved ? [] : [track],
          playing: true,
        });
      },
      next: (delta = 1) => {
        const { library, queue, current, shuffle } = get();
        const list = queue.length ? queue : library;
        if (!list.length) return;
        const index = list.findIndex((t) => t.id === current?.id);
        const next =
          shuffle && list.length > 1
            ? (index + 1 + Math.floor(Math.random() * (list.length - 1))) %
              list.length
            : (index + delta + list.length) % list.length;
        // Prefer the downloaded copy so playback stays offline when it can.
        const track = library.find((t) => t.id === list[next].id) || list[next];
        set({ current: track, playing: true });
      },
      toggleShuffle: () => set({ shuffle: !get().shuffle }),
      toggleRepeat: () => set({ repeat: !get().repeat }),
      like: (id) =>
        set({
          likes: get().likes.includes(id)
            ? get().likes.filter((x) => x !== id)
            : [...get().likes, id],
        }),
      addPlaylist: (title, ids) => {
        const playlist = {
          id: "local-" + Date.now(),
          title,
          artist: "Made by you",
          thumbnail:
            get().library.find((t) => ids.includes(t.id))?.thumbnail ||
            demoTracks[0].thumbnail,
          trackIds: ids,
        };
        set({ playlists: [...get().playlists, playlist] });
        void savePlaylist(playlist).catch(() => {});
        get().notify("Playlist created.");
      },
      removePlaylist: (id) => {
        set({ playlists: get().playlists.filter((p) => p.id !== id) });
        void deletePlaylistRecord(id).catch(() => {});
        get().notify("Playlist deleted.");
      },
      remove: async (track) => {
        await deleteAudio(track);
        await removeTrack(track.id);
        set({
          library: get().library.filter((t) => t.id !== track.id),
          removedIds: [
            ...get().removedIds.filter((id) => id !== track.id),
            track.id,
          ],
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
      complete: async (track) => {
        await saveTrack(track);
        set({
          library: [track, ...get().library.filter((t) => t.id !== track.id)],
          removedIds: get().removedIds.filter((id) => id !== track.id),
        });
      },
      enqueue: async (tracks, allowDuplicate = false) => {
        let added = 0;
        for (const track of tracks) {
          const status = duplicate(track, get().library);
          if (
            status === "ALREADY DOWNLOADED" ||
            get().downloads.some(
              (j) =>
                j.track.id === track.id &&
                ["QUEUED", "ANALYZING", "DOWNLOADING", "PROCESSING"].includes(
                  j.state,
                ),
            )
          )
            continue;
          if (status === "POSSIBLE DUPLICATE" && !allowDuplicate) {
            get().notify(
              "Possible duplicate. Review this track before downloading.",
            );
            continue;
          }
          if (DEMO) {
            const job: Download = {
              id: "job-" + Date.now() + "-" + track.id,
              track,
              state: "QUEUED",
              progress: 0,
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
                  format: get().format,
                  quality: get().quality,
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
                  get().notify("Saved your existing download to this device.");
                }
              } else
                get().notify(
                  "Possible duplicate. Review this track before downloading.",
                );
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
        }
        if (added)
          get().notify(
            `${added} ${added === 1 ? "track" : "tracks"} added to your downloads.`,
          );
        else if (DEMO)
          get().notify("These tracks are already saved or queued.");
      },
      queueAction: async (action, id) => {
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
          get().updateJob(id, { state: "CANCELLED" });
        if (action === "retry")
          set({
            downloads: get().downloads.map((j) =>
              (id ? j.id === id : ["FAILED"].includes(j.state))
                ? { ...j, state: "QUEUED", progress: 0, error: undefined }
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
            DEMO && ["ANALYZING", "DOWNLOADING", "PROCESSING"].includes(j.state)
              ? { ...j, state: "QUEUED", progress: 0 }
              : j,
          ),
        });
      },
    }),
    {
      name: "musika-state",
      storage: createJSONStorage(() => persistence),
      partialize: (s) => ({
        library: s.library,
        removedIds: s.removedIds,
        downloads: s.downloads,
        playlists: s.playlists,
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
            await s.complete(await saveAudio(job.track));
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
    s.updateJob(job.id, { state: "DOWNLOADING", progress: 15 });
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
        s.updateJob(job.id, { state: "PROCESSING", progress: 85 });
        await s.complete(track);
        s.updateJob(job.id, { state: "COMPLETED", progress: 100 });
      } catch (e) {
        s.updateJob(job.id, {
          state: "FAILED",
          error: (e as Error).message,
          progress: 0,
        });
      } finally {
        active.delete(job.id);
      }
    })();
  }
}
