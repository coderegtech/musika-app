import { Platform } from "react-native";
import { Track, Playlist, normalize } from "../models";
const artistId = (name: string) => normalize(name) || "unknown";
const albumId = (artist: string, album: string) =>
  artistId(artist) + "::" + normalize(album);
let nativeDb: Promise<import("expo-sqlite").SQLiteDatabase> | undefined;
async function database() {
  if (!nativeDb)
    nativeDb = (async () => {
      const { openDatabaseAsync } = await import("expo-sqlite");
      const db = await openDatabaseAsync("musika.db");
      await db.execAsync(`PRAGMA journal_mode=WAL;
 CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,data TEXT);
 CREATE TABLE IF NOT EXISTS tracks(id TEXT PRIMARY KEY,source TEXT, data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS artists(id TEXT PRIMARY KEY,name TEXT);
 CREATE TABLE IF NOT EXISTS albums(id TEXT PRIMARY KEY,title TEXT,artist_id TEXT);
 CREATE TABLE IF NOT EXISTS playlists(id TEXT PRIMARY KEY,data TEXT);
 CREATE TABLE IF NOT EXISTS playlist_tracks(playlist_id TEXT,track_id TEXT,position INTEGER,PRIMARY KEY(playlist_id,track_id));
 CREATE TABLE IF NOT EXISTS downloads(id TEXT PRIMARY KEY,data TEXT);
 CREATE TABLE IF NOT EXISTS download_history(id INTEGER PRIMARY KEY,download_id TEXT,state TEXT,created_at TEXT);
 CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
      return db;
    })();
  return nativeDb;
}
export const persistence = {
  async getItem(key: string): Promise<string | null> {
    if (Platform.OS === "web") return localStorage.getItem(key);
    const db = await database();
    return (
      (
        await db.getFirstAsync<{ value: string }>(
          "SELECT value FROM settings WHERE key=?",
          key,
        )
      )?.value || null
    );
  },
  async setItem(key: string, value: string) {
    if (Platform.OS === "web") {
      localStorage.setItem(key, value);
      return;
    }
    const db = await database();
    await db.runAsync(
      "INSERT OR REPLACE INTO settings VALUES(?,?)",
      key,
      value,
    );
  },
  async removeItem(key: string) {
    if (Platform.OS === "web") {
      localStorage.removeItem(key);
      return;
    }
    const db = await database();
    await db.runAsync("DELETE FROM settings WHERE key=?", key);
  },
};
export async function saveTrack(track: Track) {
  if (Platform.OS !== "web") {
    const db = await database();
    await db.runAsync(
      "INSERT OR REPLACE INTO tracks VALUES(?,?,?)",
      track.id,
      track.source,
      JSON.stringify(track),
    );
    const artist = artistId(track.artist);
    await db.runAsync(
      "INSERT OR REPLACE INTO artists VALUES(?,?)",
      artist,
      track.artist,
    );
    if (track.album)
      await db.runAsync(
        "INSERT OR REPLACE INTO albums VALUES(?,?,?)",
        albumId(track.artist, track.album),
        track.album,
        artist,
      );
  }
}
export async function removeTrack(id: string) {
  if (Platform.OS !== "web") {
    const db = await database();
    await db.runAsync("DELETE FROM tracks WHERE id=?", id);
  }
}
export async function localTracks(): Promise<Track[]> {
  if (Platform.OS === "web") return [];
  const db = await database();
  return (
    await db.getAllAsync<{ data: string }>("SELECT data FROM tracks")
  ).map((r) => JSON.parse(r.data));
}
export async function savePlaylist(playlist: Playlist) {
  if (Platform.OS !== "web") {
    const db = await database();
    const { trackIds, ...meta } = playlist;
    await db.runAsync(
      "INSERT OR REPLACE INTO playlists VALUES(?,?)",
      playlist.id,
      JSON.stringify(meta),
    );
    await db.runAsync(
      "DELETE FROM playlist_tracks WHERE playlist_id=?",
      playlist.id,
    );
    for (const [position, trackId] of (trackIds || []).entries())
      await db.runAsync(
        "INSERT OR REPLACE INTO playlist_tracks VALUES(?,?,?)",
        playlist.id,
        trackId,
        position,
      );
  }
}
export async function removePlaylist(id: string) {
  if (Platform.OS !== "web") {
    const db = await database();
    await db.runAsync("DELETE FROM playlists WHERE id=?", id);
    await db.runAsync("DELETE FROM playlist_tracks WHERE playlist_id=?", id);
  }
}
export async function localPlaylists(): Promise<Playlist[]> {
  if (Platform.OS === "web") return [];
  const db = await database();
  const rows = await db.getAllAsync<{ id: string; data: string }>(
    "SELECT id, data FROM playlists",
  );
  const links = await db.getAllAsync<{
    playlist_id: string;
    track_id: string;
  }>("SELECT playlist_id, track_id FROM playlist_tracks ORDER BY position");
  return rows.map((r) => ({
    ...JSON.parse(r.data),
    trackIds: links
      .filter((l) => l.playlist_id === r.id)
      .map((l) => l.track_id),
  }));
}
