import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        tinta: "#17202a",
        papel: "#f7f6f2",
        noche: "#101317",
        acento: "#c43b3b",
        guayaba: "#f0a84f",
        menta: "#2e9f78"
      },
      boxShadow: {
        suave: "0 10px 30px rgba(16, 19, 23, 0.10)"
      }
    },
  },
  plugins: [],
};

export default config;
