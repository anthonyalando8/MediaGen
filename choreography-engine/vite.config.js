import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";

/**
 * vite.config.js
 * --------------
 * vite-plugin-svgr enables the `?react` import suffix:
 *   import HeadSVG from "./head.svg?react"
 *
 * This transforms each SVG file into a React component
 * that renders inline SVG — fully accessible to GSAP DOM targeting.
 *
 * Install dependencies:
 *   npm install gsap
 *   npm install -D vite-plugin-svgr
 */
export default defineConfig({
  plugins: [
    react(),
    svgr({
      // Export SVG as a React component when ?react suffix is used
      include: "**/*.svg?react",
      svgrOptions: {
        // Preserve IDs so GSAP can target #lip-upper etc by ID
        svgoConfig: {
          plugins: [
            {
              name: "preset-default",
              params: {
                overrides: {
                  cleanupIds: false,    // keep IDs for GSAP targeting
                  removeViewBox: false, // keep viewBox for scaling
                },
              },
            },
          ],
        },
        // Pass through all SVG props (width, height, aria-hidden…)
        expandProps: "end",
      },
    }),
  ],
});