import React from "react";
import { Pressable, Text } from "react-native";
import {
  GoogleSignin,
  isSuccessResponse,
} from "@react-native-google-signin/google-signin";
import { exchangeGoogle } from "../services/auth";
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
          if (!process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID)
            throw new Error(
              "Add your Google OAuth client IDs to enable sign-in.",
            );
          GoogleSignin.configure({
            webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
            iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
          });
          await GoogleSignin.hasPlayServices();
          const result = await GoogleSignin.signIn();
          if (isSuccessResponse(result) && result.data.idToken)
            onSuccess(await exchangeGoogle(result.data.idToken));
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
