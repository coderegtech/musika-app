import React, { useState } from "react";
import { FirebaseError } from "firebase/app";
import { GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { exchangeFirebase } from "../services/auth";
import { firebaseAuth, firebaseConfigured } from "../services/firebase";
import { User } from "../models";
const CANCELLED = new Set([
  "auth/popup-closed-by-user",
  "auth/cancelled-popup-request",
]);
export default function GoogleButton({
  onSuccess,
  onError,
}: {
  onSuccess: (u: User) => void;
  onError: (e: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const signIn = async () => {
    if (!firebaseConfigured)
      return onError(
        "Google sign-in needs your Firebase config. Configure .env, then restart Expo.",
      );
    setBusy(true);
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      const { user } = await signInWithPopup(firebaseAuth(), provider);
      onSuccess(await exchangeFirebase(await user.getIdToken()));
    } catch (e) {
      if (e instanceof FirebaseError && CANCELLED.has(e.code)) return;
      if (e instanceof FirebaseError && e.code === "auth/popup-blocked")
        return onError("Allow pop-ups for this site to sign in with Google.");
      onError(e instanceof Error ? e.message : "Google sign-in failed.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      onClick={signIn}
      disabled={busy}
      style={{
        border: "1px solid #D9DED4",
        background: "#fff",
        padding: "16px 28px",
        borderRadius: 12,
        fontSize: 15,
        cursor: busy ? "default" : "pointer",
        opacity: busy ? 0.6 : 1,
        width: "100%",
      }}
    >
      {busy ? "Signing in…" : "Continue with Google"}
    </button>
  );
}
