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
      // Stayable brand palette (sourced from rentstayable.com).
      colors: {
        ink: "#041E42", // Stayable deep navy — dark header / chrome
        slate850: "#0A2A52", // mid navy
        accent: "#0091F5", // Stayable bright blue — emphasis / buttons / active nav
        skyLight: "#91D1FA", // Stayable light sky — secondary bars / light accents
        gold: "#FDDA24", // Stayable gold — highlight
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica", "Arial", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
