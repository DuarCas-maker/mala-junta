import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        carbon: "#020201",
        cafe: "#070503",
        espresso: "#100D08",
        champana: "#E0D1BE",
        antiguo: "#D3C2AE",
        humo: "#1C160F",
        nogal: "#2A2118",
        bronce: "#3B2F23",
        cobre: "#4F3E2E",
        oro: "#B1855D",
        dorado: "#E2B07F",
        crema: "#FBF6ED",
        tinta: "#E0D1BE",
        papel: "#100D08",
        noche: "#020201",
        acento: "#B1855D",
        guayaba: "#E2B07F",
        menta: "#C4B39D"
      },
      boxShadow: {
        suave: "0 18px 44px rgba(0, 0, 0, 0.42)"
      }
    },
  },
  plugins: [],
};

export default config;
