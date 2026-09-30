import { FirebaseApp, getApp, getApps, initializeApp } from "firebase/app";
import { Auth, getAuth, inMemoryPersistence, initializeAuth } from "firebase/auth";
import { Platform } from "react-native";

// Firebase only proves the Google identity once; the Musika server then issues
// its own session, so Firebase never needs to persist a user on native.
const config = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};
export const firebaseConfigured = Boolean(
  config.apiKey && config.authDomain && config.projectId && config.appId,
);
let auth: Auth | null = null;
export function firebaseAuth(): Auth {
  if (!firebaseConfigured)
    throw new Error(
      "Add your Firebase web app config to .env to enable sign-in.",
    );
  if (auth) return auth;
  const app: FirebaseApp = getApps().length ? getApp() : initializeApp(config);
  auth =
    Platform.OS === "web"
      ? getAuth(app)
      : initializeAuth(app, { persistence: inMemoryPersistence });
  return auth;
}
