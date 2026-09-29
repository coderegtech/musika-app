import type { Track, Playlist } from "../models";
// Web uses localStorage for metadata and IndexedDB for audio. Keeping this in a
// platform module prevents Metro from bundling native SQLite's WASM worker.
export const persistence = {
  async getItem(key: string) {
    return localStorage.getItem(key);
  },
  async setItem(key: string, value: string) {
    localStorage.setItem(key, value);
  },
  async removeItem(key: string) {
    localStorage.removeItem(key);
  },
};
export async function saveTrack(_track: Track) {}
export async function removeTrack(_id: string) {}
export async function localTracks(): Promise<Track[]> {
  return [];
}
export async function savePlaylist(_playlist: Playlist) {}
export async function removePlaylist(_id: string) {}
export async function localPlaylists(): Promise<Playlist[]> {
  return [];
}
