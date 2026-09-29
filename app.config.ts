export default {
  expo: {
    name: "Musika",
    slug: "musika",
    scheme: "musika",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/icon.png",
    userInterfaceStyle: "automatic",
    ios: {
      bundleIdentifier: "app.musika.mobile",
      supportsTablet: true,
      infoPlist: { UIBackgroundModes: ["audio"] },
    },
    android: {
      package: "app.musika.mobile",
      versionCode: 1,
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#F5F2E9",
      },
    },
    web: {
      favicon: "./assets/favicon.png",
      name: "Musika — Your music. Your library.",
      bundler: "metro",
    },
    plugins: [
      "expo-secure-store",
      "expo-sqlite",
      [
        "expo-audio",
        { microphonePermission: false, recordAudioAndroid: false },
      ],
      [
        "expo-splash-screen",
        {
          image: "./assets/splash.png",
          imageWidth: 160,
          backgroundColor: "#F5F2E9",
        },
      ],
      ...(process.env.GOOGLE_IOS_URL_SCHEME
        ? [
            [
              "@react-native-google-signin/google-signin",
              { iosUrlScheme: process.env.GOOGLE_IOS_URL_SCHEME },
            ],
          ]
        : []),
    ],
    // Filled in by `eas init` (run once, after `eas login`) so EAS Build
    // knows which project this app belongs to on your Expo account.
    extra: { eas: { projectId: process.env.EAS_PROJECT_ID || "7c04b495-1dc6-4288-86b6-c50ebfbdd75b" } },
  },
};
