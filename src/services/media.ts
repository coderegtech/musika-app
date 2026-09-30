import { Platform } from "react-native";
import { Asset } from "expo-asset";
import * as FileSystem from "expo-file-system/legacy";
import { Track, API } from "../models";
import { authHeaders } from "./auth";
const audioAssets = [
  require("../../assets/demo-0.wav"),
  require("../../assets/demo-1.wav"),
  require("../../assets/demo-2.wav"),
];
function blobDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("musika-audio", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("audio");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function storeBlob(id: string, blob: Blob) {
  const db = await blobDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("audio", "readwrite");
    tx.objectStore("audio").put(blob, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
export async function audioUri(track: Track): Promise<string> {
  if (Platform.OS !== "web") {
    if (track.localUri) return track.localUri;
    throw new Error("Save this track to your library first.");
  }
  const db = await blobDb();
  const blob = await new Promise<Blob | undefined>((resolve, reject) => {
    const r = db.transaction("audio").objectStore("audio").get(track.id);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  db.close();
  if (!blob)
    throw new Error(
      "Offline audio is missing. Remove this track and download it again.",
    );
  return URL.createObjectURL(blob);
}
export async function saveAudio(track: Track): Promise<Track> {
  const asset =
    track.source === "demo"
      ? Asset.fromModule(audioAssets[Number(track.id.slice(-2)) % 3])
      : null;
  if (asset) await asset.downloadAsync();
  const url = asset?.localUri || asset?.uri || `${API}/files/${track.id}`;
  if (Platform.OS === "web") {
    const r = await fetch(url, {
      headers: track.source === "youtube" ? authHeaders() : {},
      credentials: track.source === "youtube" ? "include" : "omit",
    });
    if (!r.ok)
      throw new Error("Audio could not be saved. Retry your download.");
    const blob = await r.blob();
    await storeBlob(track.id, blob);
    return {
      ...track,
      localUri: `indexeddb:${track.id}`,
      bytes: blob.size,
      downloaded_at: new Date().toISOString(),
    };
  }
  const dir = FileSystem.documentDirectory + "music/";
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  const path =
    dir +
    track.id +
    "." +
    (track.source === "demo" ? "wav" : track.format || "mp3");
  try {
    if (asset) await FileSystem.copyAsync({ from: url, to: path });
    else {
      const r = await FileSystem.downloadAsync(url, path, {
        headers: authHeaders(),
      });
      if (r.status !== 200) throw new Error("Audio could not be saved.");
    }
    // A track is only "saved" if a non-empty file really landed on the device.
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists || !info.size)
      throw new Error("Audio could not be saved. Retry your download.");
  } catch (e) {
    await FileSystem.deleteAsync(path, { idempotent: true });
    throw e;
  }
  return {
    ...track,
    localUri: path,
    localThumbnail: await cacheThumbnail(track),
    downloaded_at: new Date().toISOString(),
  };
}
/** Best effort: cover art is cached so library artwork renders offline; failure never blocks the audio. */
async function cacheThumbnail(track: Track) {
  if (!/^https:\/\//.test(track.thumbnail || "")) return undefined;
  const dir = FileSystem.documentDirectory + "thumbnails/";
  const path = dir + track.id + ".jpg";
  try {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    const r = await FileSystem.downloadAsync(track.thumbnail, path);
    const info = await FileSystem.getInfoAsync(path);
    if (r.status === 200 && info.exists && info.size) return path;
    await FileSystem.deleteAsync(path, { idempotent: true });
  } catch {
    await FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {});
  }
  return undefined;
}
export async function deleteAudio(track: Track) {
  if (Platform.OS === "web") {
    const db = await blobDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("audio", "readwrite");
      tx.objectStore("audio").delete(track.id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } else {
    if (track.localUri)
      await FileSystem.deleteAsync(track.localUri, { idempotent: true });
    if (track.localThumbnail)
      await FileSystem.deleteAsync(track.localThumbnail, { idempotent: true });
  }
}
