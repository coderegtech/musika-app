import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { signOut as fbSignOut } from "firebase/auth";
import { API, User } from "../models";
import { firebaseAuth, firebaseConfigured } from "./firebase";
let token: string | null = null;
const expiredListeners = new Set<() => void>();
export function onSessionExpired(callback: () => void) {
  expiredListeners.add(callback);
  return () => {
    expiredListeners.delete(callback);
  };
}
export function sessionExpired() {
  expiredListeners.forEach((callback) => callback());
}
export const authHeaders = () =>
  token ? { Authorization: `Bearer ${token}` } : { Authorization: "" };
export async function restoreSession(): Promise<User | null> {
  if (Platform.OS !== "web")
    token = await SecureStore.getItemAsync("musika.session");
  const result = await fetch(`${API}/auth/me`, {
    headers: authHeaders(),
    credentials: "include",
  });
  if (result.status === 401) {
    await clearSession();
    return null;
  }
  if (!result.ok)
    throw new Error("Could not restore your session. Check your connection.");
  return result.json();
}
export async function clearSession() {
  token = null;
  if (Platform.OS !== "web")
    await SecureStore.deleteItemAsync("musika.session");
}
export async function exchangeFirebase(idToken: string): Promise<User> {
  const result = await fetch(`${API}/auth/firebase`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken }),
  });
  const body = await result.json();
  if (!result.ok) throw new Error(body.detail || "Google sign-in failed.");
  token = Platform.OS === "web" ? null : body.token;
  if (token) await SecureStore.setItemAsync("musika.session", token);
  return body.user;
}
export async function signOut() {
  const result = await fetch(`${API}/auth/logout`, {
    method: "POST",
    headers: authHeaders(),
    credentials: "include",
  });
  if (!result.ok && result.status !== 401)
    throw new Error("Could not sign out. Try again when connected.");
  await clearSession();
  if (firebaseConfigured) await fbSignOut(firebaseAuth()).catch(() => {});
}
