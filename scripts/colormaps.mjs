#!/usr/bin/env node
// Regenerates the bundled standard colormaps from a tiling service, or checks
// the bundle for drift against one. Run with no arguments for usage.
//
// Requires a Node version that runs TypeScript directly (22.18 or later), as
// the ramp format is read by the same module the app uses.

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// The app and the configure page are built separately, and the configure
// page cannot import from the app's source tree, so each holds a copy.
const BUNDLE_PATHS = [
    'src/external/colormaps/standardColormaps.js',
    'configure/src/external/standardColormaps.js',
]

const usageText = (defaultTolerance) => `Usage:
  node scripts/colormaps.mjs generate <service-url> [--names a,b,...] [--add a,b,...]
  node scripts/colormaps.mjs check <service-url> [--tolerance N] [--all]

<service-url> is the tiling service's base URL, the one serving /colorMaps,
for example https://openveda.cloud/api/raster.

generate  Fetches every bundled ramp from the service and rewrites
          ${BUNDLE_PATHS.join('\n          ')}.
          The ramps bundled are the ones already in the bundle. --names
          replaces that list; --add extends it. Only standard ramps (the
          matplotlib/cmocean ones every service carries) belong in it, never a
          deployment's own.

check     Compares the bundle with the service's ramps and lists every ramp
          that is missing or differs by more than --tolerance (0-255 per
          channel, default ${defaultTolerance}). Exits 1 when any does.
          --all also converts every ramp the service lists, to find any the
          app could not read.`

const list = (value) =>
    value
        ? value
              .split(',')
              .map((name) => name.trim().toLowerCase())
              .filter(Boolean)
        : []

const main = async () => {
    if (!process.features?.typescript) {
        console.error(
            'scripts/colormaps.mjs needs Node 22.18 or later (it loads TypeScript directly).'
        )
        return 2
    }
    // The repository's package.json declares no module type, so Node warns
    // when it detects ES module syntax in the .ts files loaded below. The
    // detection is right; the warning is only noise here.
    const emitWarning = process.emitWarning
    process.emitWarning = (warning, ...rest) => {
        const code = typeof rest[0] === 'object' ? rest[0]?.code : rest[1]
        if (code !== 'MODULE_TYPELESS_PACKAGE_JSON') emitWarning(warning, ...rest)
    }
    const bundle = await import('./lib/colormap-bundle.mjs')
    const usage = usageText(bundle.DEFAULT_TOLERANCE)

    let parsed
    try {
        parsed = parseArgs({
            allowPositionals: true,
            options: {
                names: { type: 'string' },
                add: { type: 'string' },
                tolerance: { type: 'string' },
                all: { type: 'boolean' },
                help: { type: 'boolean', short: 'h' },
            },
        })
    } catch (error) {
        console.error(`${error.message}\n\n${usage}`)
        return 2
    }
    const { values, positionals } = parsed
    const [command, serviceArg] = positionals
    if (values.help || !['generate', 'check'].includes(command) || !serviceArg) {
        console.error(usage)
        return values.help ? 0 : 2
    }
    const serviceUrl = bundle.normalizeServiceUrl(serviceArg)
    const bundlePath = resolve(ROOT, BUNDLE_PATHS[0])

    const readBundle = () => {
        try {
            return bundle.parseBundleModule(readFileSync(bundlePath, 'utf8'))
        } catch (error) {
            if (error.code === 'ENOENT') return {}
            throw error
        }
    }

    if (command === 'generate') {
        const names = bundle.chooseRampNames({
            current: Object.keys(readBundle()),
            names: list(values.names),
            add: list(values.add),
        })
        const ramps = await bundle.buildBundle(serviceUrl, names)
        const source = bundle.renderBundleModule(ramps, { serviceUrl })
        for (const path of BUNDLE_PATHS) {
            writeFileSync(resolve(ROOT, path), source)
        }
        console.log(
            `Wrote ${names.length} ramps from ${serviceUrl} to ${BUNDLE_PATHS.join(
                ' and '
            )} (${Math.round(source.length / 1024)} KB each).`
        )
        return 0
    }

    const tolerance =
        values.tolerance == null ? bundle.DEFAULT_TOLERANCE : Number(values.tolerance)
    if (!Number.isInteger(tolerance) || tolerance < 0 || tolerance > 255) {
        console.error(`--tolerance must be an integer from 0 to 255\n\n${usage}`)
        return 2
    }
    const bundled = readBundle()
    if (Object.keys(bundled).length === 0) {
        console.error(`No bundle at ${relative(ROOT, bundlePath)}; run generate first.`)
        return 1
    }

    let failed = false
    const drift = await bundle.checkDrift(serviceUrl, bundled, { tolerance })
    if (drift.length === 0) {
        console.log(
            `No drift: all ${Object.keys(bundled).length} bundled ramps match ${serviceUrl} within ${tolerance}.`
        )
    } else {
        failed = true
        console.log(
            `${drift.length} of ${Object.keys(bundled).length} bundled ramps drift from ${serviceUrl} (tolerance ${tolerance}):`
        )
        drift.forEach(({ name, problem }) => console.log(`  ${name}: ${problem}`))
        console.log('Regenerate with: node scripts/colormaps.mjs generate <service-url>')
    }

    if (values.all) {
        const { count, failures } = await bundle.checkAllConvert(serviceUrl)
        if (failures.length === 0) {
            console.log(`All ${count} ramps listed by ${serviceUrl} convert.`)
        } else {
            failed = true
            console.log(`${failures.length} of ${count} listed ramps do not convert:`)
            failures.forEach(({ name, problem }) => console.log(`  ${name}: ${problem}`))
        }
    }
    return failed ? 1 : 0
}

main().then(
    (code) => {
        process.exitCode = code
    },
    (error) => {
        console.error(error.message)
        process.exitCode = 1
    }
)
