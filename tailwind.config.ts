import type { Config } from "tailwindcss";

// IB-clean aesthetic (CLAUDE.md §6 / org standard): dark headers, clean grid,
// no chartjunk. Restrained palette, generous spacing.
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./config/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "#0b1220", // dark header / chrome
        slate850: "#172033",
        accent: "#2563eb", // restrained blue for emphasis
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica", "Arial", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
