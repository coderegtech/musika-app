import { Linking } from "react-native";
import * as Clipboard from "expo-clipboard";
import { Track, canonicalUrl } from "../models";
/** Copies the canonical watch URL; resolves false when the track has no YouTube source. */
export async function copyLink(track: Track) {
  const url = canonicalUrl(track);
  if (!url) return false;
  await Clipboard.setStringAsync(url);
  return true;
}
export async function openOnYouTube(track: Track) {
  const url = canonicalUrl(track);
  if (!url) return false;
  await Linking.openURL(url);
  return true;
}
