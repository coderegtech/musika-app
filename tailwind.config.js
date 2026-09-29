module.exports = {
  content: ["./App.tsx", "./src/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: { colors: { paper: "#F5F2E9", ink: "#26332C", accent: "#D9F279" } },
  },
  plugins: [],
};
