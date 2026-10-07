import { fileURLToPath } from "node:url";
import { transformAsync } from "@babel/core";
import { defineConfig } from "vitest/config";

// The Configure app (configure/) is a create-react-app bundle that writes JSX
// in plain .js files, which Vite only parses in .jsx/.tsx. Specs that render a
// Configure component need those sources compiled first; JSX is the only
// syntax this adds, so everything else passes through for Vite as usual.
// configure/node_modules is not installed for the unit run, and when it is
// present locally its React 17 must not load beside the root React, so
// `resolve.dedupe` pins every `react`/`react-dom` import to the root copy.
const CONFIGURE_JS = /\/configure\/src\/.*\.js$/;
const configureJsx = {
  name: "configure-jsx",
  enforce: "pre" as const,
  async transform(code: string, id: string) {
    if (!CONFIGURE_JS.test(id) || !/<[A-Za-z>]/.test(code)) return null;
    const result = await transformAsync(code, {
      filename: id,
      babelrc: false,
      configFile: false,
      sourceMaps: true,
      presets: [["@babel/preset-react", { runtime: "automatic" }]],
    });
    return result && { code: result.code ?? code, map: result.map };
  },
};

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
  plugins: [configureJsx],
  resolve: {
    dedupe: ["react", "react-dom"],
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
      // MUI belongs to the Configure app and is not installed for the unit
      // run. Each `@mui/material/<Name>` import is served by the same-named
      // stub. See tests/unit/__mocks__/mui/components.js.
      {
        find: /^@mui\/material\/(Button|Typography|TextField)$/,
        replacement: fileURLToPath(
          new URL("./tests/unit/__mocks__/mui/$1.js", import.meta.url)
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
