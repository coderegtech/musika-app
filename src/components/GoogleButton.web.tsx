import React, { useEffect, useRef } from "react";
import { exchangeGoogle } from "../services/auth";
import { User } from "../models";
declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (options: object) => void;
          renderButton: (element: HTMLElement, options: object) => void;
        };
      };
    };
  }
}
export default function GoogleButton({
  onSuccess,
  onError,
}: {
  onSuccess: (u: User) => void;
  onError: (e: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const client = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
    if (!client) return;
    let active = true;
    const init = () => {
      if (!active || !ref.current || !window.google) return;
      window.google.accounts.id.initialize({
        client_id: client,
        callback: async (r: { credential: string }) => {
          try {
            onSuccess(await exchangeGoogle(r.credential));
          } catch (e) {
            onError((e as Error).message);
          }
        },
      });
      window.google.accounts.id.renderButton(ref.current, {
        theme: "outline",
        size: "large",
        width: 300,
        text: "continue_with",
      });
    };
    if (window.google) init();
    else {
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.onload = init;
      script.onerror = () =>
        onError("Google could not load. Check your connection.");
      document.head.appendChild(script);
    }
    return () => {
      active = false;
    };
  }, []);
  return process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ? (
    <div ref={ref} />
  ) : (
    <button
      onClick={() =>
        onError(
          "Google sign-in needs your OAuth client ID. Configure .env, then restart Expo.",
        )
      }
      style={{
        border: "1px solid #D9DED4",
        background: "#fff",
        padding: "16px 28px",
        borderRadius: 12,
        fontSize: 15,
        cursor: "pointer",
        width: "100%",
      }}
    >
      Continue with Google
    </button>
  );
}
