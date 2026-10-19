import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The Google key lives only on the server (api/google.ts); the app just learns whether there is one.
const google = Boolean(process.env.GOOGLE_MAPS_KEY || process.env.VITE_GOOGLE_MAPS_KEY);

export default defineConfig({ plugins: [react()], define: { __GOOGLE__: JSON.stringify(google) } });
