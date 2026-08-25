import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Vitest configuration for MMGIS unit tests.
 *
 * The unit specs exercise browser-coupled modules (Leaflet/deck.gl adapters,
 * PanelManager_ -> TimeControl) that read `window`/`document`/browser element
 * types at module-load time. Those imports throw under a plain Node process,
 * so the suite runs in a jsdom environment instead. End-to-end specs stay on
 * Playwright (see playwright.config.js).
 *
 * Unit specs live in two places, both covered by `include` below: engine and
 * backend specs in `tests/unit/`, and specs co-located with the source they
 * cover — beside the component they render, or under a plugin's `__tests__/`
 * so they travel with the directory when it is extracted.
 */
export default defineConfig({
  resolve: {
    alias: [
      // `src/pre/tools.js` is generated at server start (gitignored, absent in a
      // fresh checkout / CI). Specs that transitively import it only need it to
      // resolve, so point it at a hermetic stub. See tests/unit/__mocks__/preTools.js.
      {
        // Match the whole specifier — Vite does id.replace(find, replacement),
        // so a partial match would leave the relative "../../../" prefix intact.
        find: /^.*\/pre\/tools$/,
        replacement: fileURLToPath(
          new URL("./tests/unit/__mocks__/preTools.js", import.meta.url)
        ),
      },
      // `Basics/Viewer_/PDFViewer.js` holds JSX in a `.js` file — fine under the
      // Babel-driven webpack build, but Vite's default `.js` loader will not
      // parse it. Anything reaching Layers_ pulls it in (Layers_ -> Viewer_ ->
      // PDFViewer) and would fail import analysis over a file it never uses, so
      // point it at a hermetic stub. See tests/unit/__mocks__/pdfViewer.js.
      {
        // Viewer_ imports it as "./PDFViewer", so match the whole specifier.
        find: /^.*\/PDFViewer$/,
        replacement: fileURLToPath(
          new URL("./tests/unit/__mocks__/pdfViewer.js", import.meta.url)
        ),
      },
    ],
  },
  test: {
    environment: "jsdom",
    globals: false,
    include: [
      "tests/unit/**/*.spec.{js,ts}",
      "src/**/*.test.{ts,tsx}",
      "src/**/__tests__/**/*.spec.{js,ts,jsx,tsx}",
    ],
    setupFiles: ["./tests/unit/vitest.setup.js"],
  },
});
