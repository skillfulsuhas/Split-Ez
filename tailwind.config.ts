import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#6366f1", // indigo-500
          dark: "#4f46e5", // indigo-600
        },
        accent: {
          DEFAULT: "#8b5cf6", // violet-500
        },
      },
      fontFamily: {
        sans: [
          '"Plus Jakarta Sans"',
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
      },
      boxShadow: {
        soft: "0 6px 24px -8px rgba(79, 70, 229, 0.25)",
        card: "0 1px 3px rgba(15, 23, 42, 0.06), 0 8px 24px -12px rgba(15, 23, 42, 0.12)",
        // Floating glass card: soft ambient + colourful glow + inner top highlight.
        glass:
          "0 10px 40px -12px rgba(79, 70, 229, 0.28), 0 2px 8px -2px rgba(15, 23, 42, 0.08), inset 0 1px 0 0 rgba(255, 255, 255, 0.7)",
        float:
          "0 24px 60px -18px rgba(99, 102, 241, 0.45), inset 0 1px 0 0 rgba(255, 255, 255, 0.5)",
      },
      keyframes: {
        "pop-in": {
          "0%": { transform: "scale(0.96)", opacity: "0" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
        "rise-in": {
          "0%": { transform: "translateY(10px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        // Slowly drifting gradient mesh blobs.
        "mesh-1": {
          "0%, 100%": { transform: "translate(0, 0) scale(1)" },
          "33%": { transform: "translate(8%, 6%) scale(1.15)" },
          "66%": { transform: "translate(-6%, 4%) scale(0.92)" },
        },
        "mesh-2": {
          "0%, 100%": { transform: "translate(0, 0) scale(1)" },
          "33%": { transform: "translate(-7%, -5%) scale(0.9)" },
          "66%": { transform: "translate(5%, -8%) scale(1.12)" },
        },
        "mesh-3": {
          "0%, 100%": { transform: "translate(0, 0) scale(1)" },
          "50%": { transform: "translate(6%, -6%) scale(1.18)" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-6px)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "200% 0" },
          "100%": { backgroundPosition: "-200% 0" },
        },
      },
      animation: {
        "pop-in": "pop-in 0.18s ease-out",
        "rise-in": "rise-in 0.4s cubic-bezier(0.16, 1, 0.3, 1) both",
        "mesh-1": "mesh-1 22s ease-in-out infinite",
        "mesh-2": "mesh-2 28s ease-in-out infinite",
        "mesh-3": "mesh-3 34s ease-in-out infinite",
        float: "float 5s ease-in-out infinite",
        shimmer: "shimmer 2.5s linear infinite",
      },
    },
  },
  plugins: [],
};

export default config;
