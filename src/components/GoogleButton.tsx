import React from "react";
import { Pressable, Text, TurboModuleRegistry } from "react-native";
import { GoogleAuthProvider, signInWithCredential } from "firebase/auth";
import { exchangeFirebase } from "../services/auth";
import { firebaseAuth } from "../services/firebase";
import { User } from "../models";
export default function GoogleButton({
  onSuccess,
  onError,
}: {
  onSuccess: (user: User) => void;
  onError: (error: string) => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      style={{
        padding: 18,
        backgroundColor: "white",
        borderRadius: 14,
        alignItems: "center",
        borderWidth: 1,
        borderColor: "#D9DED4",
      }}
      onPress={async () => {
        try {
          const auth = firebaseAuth();
          if (!process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID)
            throw new Error(
              "Add your Firebase web client ID to enable sign-in.",
            );
          // Expo Go doesn't ship this native module; importing it eagerly
          // crashed the whole app at startup there.
          if (!TurboModuleRegistry.get("RNGoogleSignin"))
            throw new Error(
              "Google sign-in needs a Musika development build. Expo Go can't run it.",
            );
          const { GoogleSignin, isSuccessResponse } =
            require("@react-native-google-signin/google-signin") as typeof import("@react-native-google-signin/google-signin");
          GoogleSignin.configure({
            webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
            iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
          });
          await GoogleSignin.hasPlayServices();
          const result = await GoogleSignin.signIn();
          if (isSuccessResponse(result) && result.data.idToken) {
            const { user } = await signInWithCredential(
              auth,
              GoogleAuthProvider.credential(result.data.idToken),
            );
            onSuccess(await exchangeFirebase(await user.getIdToken()));
          }
        } catch (e) {
          onError(e instanceof Error ? e.message : "Google sign-in failed.");
        }
      }}
    >
      <Text style={{ fontSize: 16, fontWeight: "600" }}>
        Continue with Google
      </Text>
    </Pressable>
  );
}
