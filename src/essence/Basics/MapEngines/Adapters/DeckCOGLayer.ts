/**
 * DeckCOGLayer — client-side single-band COG rendering via deck.gl-geotiff.
 *
 * Provides:
 *   - `composeColormapPipeline` — pure function, GPU-free, unit-testable.
 *   - `ColormappedCOGLayer` — deck.gl layer subclass; requires a GPU context at runtime.
 *   - `buildDeckCOGLayer` — factory used by Map_.js for the deckRaster code path.
 *
 * Runtime render verification is deferred to Task 8 (demo task). The subclass
 * and factory are verified here only by import resolution and the unit test.
 *
 * Deviation from brief (module resolution):
 *   tsconfig.json uses `moduleResolution: "node"` which does not read package
 *   `exports` maps, so tsc cannot resolve the `./gpu-modules` subpath export.
 *   The import below uses `@ts-ignore` to suppress that tsc-only error; the
 *   import resolves correctly at runtime (Node.js + Playwright + Webpack all
 *   honour the exports map). Updating tsconfig to `node16`/`bundler` would
 *   remove the need for the ignore comment but is out of scope for this task.
 */

import type { Layer, UpdateParameters } from '@deck.gl/core'
import { COGLayer } from '@developmentseed/deck.gl-geotiff'
// `moduleResolution: "node"` in tsconfig.json does not read package exports
// maps, so tsc cannot resolve the `./gpu-modules` subpath export.  The import
// below works correctly at runtime (Node.js, Playwright, Webpack all honour
// the exports map).  See deviation note in the file header.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { Colormap, LinearRescale, FilterNoDataVal, createColormapTexture } from '@developmentseed/deck.gl-raster/gpu-modules'
import type { Texture } from '@luma.gl/core'
import { buildColormapLUT } from './colormapLUT'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ColormapOpts = {
    rescaleMin: number
    rescaleMax: number
    /** Colormap GPU texture (Texture2DArray). May be null before first updateState. */
    colormapTexture: Texture | { id: string } | null
    /** Sentinel no-data value (raw pixel units). null/undefined = no filtering. */
    nodata?: number | null
}

type PipelineEntry = {
    module: { name: string }
    props?: Record<string, unknown>
}

type PipelineResult = {
    image?: unknown
    renderPipeline: PipelineEntry[]
}

// ---------------------------------------------------------------------------
// Pure helper — no GPU dependency, unit-testable
// ---------------------------------------------------------------------------

/**
 * Append rescale + colormap (and optional nodata filter) modules to a base
 * RenderTileResult. Returns a new result with a new `renderPipeline` array;
 * the `image` field is passed through unchanged.
 *
 * Pipeline order for single-band data (value lands in color.r):
 *   [base modules…] → [FilterNoDataVal?] → LinearRescale → Colormap
 *
 * Note: exact integration with COGLayer's photometric default pipeline must be
 * confirmed by a live render in Task 8. If the band value does not land in
 * `color.r` after the default pipeline, a BlackIsZero or channel-copy step
 * will need to be inserted before LinearRescale.
 */
export function composeColormapPipeline(
    baseResult: { image?: unknown; renderPipeline?: PipelineEntry[] },
    opts: ColormapOpts
): PipelineResult {
    const extra: PipelineEntry[] = []

    if (opts.nodata != null) {
        extra.push({ module: FilterNoDataVal, props: { value: opts.nodata } })
    }
    extra.push({
        module: LinearRescale,
        props: { rescaleMin: opts.rescaleMin, rescaleMax: opts.rescaleMax },
    })
    extra.push({
        module: Colormap,
        props: {
            colormapTexture: opts.colormapTexture as unknown,
            colormapIndex: 0,
            reversed: false,
        } as Record<string, unknown>,
    })

    return {
        ...baseResult,
        renderPipeline: [...(baseResult.renderPipeline ?? []), ...extra],
    }
}

// ---------------------------------------------------------------------------
// GPU helpers (browser/WebGL only)
// ---------------------------------------------------------------------------

/** Build a 256×1 ImageData LUT for createColormapTexture. */
function lutToImageData(lut: Uint8ClampedArray): ImageData {
    return new ImageData(lut, 256, 1)
}

// ---------------------------------------------------------------------------
// ColormappedCOGLayer
// ---------------------------------------------------------------------------

/**
 * A COGLayer subclass that appends LinearRescale + Colormap GPU modules to
 * the default render pipeline, enabling client-side colormap rendering of
 * single-band COGs without a TiTiler backend.
 *
 * Custom props (passed through layerObj):
 *   - colormapName: string  — matplotlib-compatible colormap name
 *   - rescaleMin: number    — data value → 0.0
 *   - rescaleMax: number    — data value → 1.0
 *   - nodata: number | null — pixel value to discard (FilterNoDataVal)
 *
 * GPU state:
 *   - colormapTexture: Texture — Texture2DArray built from the LUT; stored in
 *     layer state via this.setState({ colormapTexture }).
 *
 * Re-render without tile refetch: pass
 *   updateTriggers: { renderTile: [colormapName, rescaleMin, rescaleMax] }
 * so deck.gl re-evaluates _renderTileCallback() when params change.
 */
export class ColormappedCOGLayer extends COGLayer<any> {
    static override layerName = 'ColormappedCOGLayer'

    override updateState(params: UpdateParameters<this>): void {
        super.updateState(params)
        const { props, oldProps, changeFlags } = params
        const p = props as any
        const op = oldProps as any
        // Rebuild the colormap texture whenever the colormap name changes (or on
        // first init where oldProps.colormapName is undefined).
        if (
            changeFlags.propsChanged &&
            p.colormapName !== op.colormapName &&
            (this.context as any)?.device
        ) {
            const lut = buildColormapLUT(p.colormapName ?? 'viridis')
            const texture = createColormapTexture(
                (this.context as any).device,
                lutToImageData(lut)
            )
            const oldTexture = (this.state as any).colormapTexture
            if (oldTexture && typeof oldTexture.destroy === 'function') {
                oldTexture.destroy()
            }
            this.setState({ colormapTexture: texture })
        }
    }

    // Return type is `any` to avoid TypeScript's return-type assignability
    // check against the parent signature (which uses the full RenderTileResult
    // union from @developmentseed/deck.gl-raster). The actual runtime type
    // satisfies the union contract; this is validated by Task 8's render test.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    protected override _renderTileCallback(): any {
        const base = super._renderTileCallback()
        if (!base) return undefined

        const p = this.props as any
        const { rescaleMin, rescaleMax, nodata } = p
        // Capture colormapTexture at callback-construction time; the updateTriggers
        // on the layer force _renderTileCallback() to be re-called whenever
        // colormapName/rescaleMin/rescaleMax change, so the closure stays fresh.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const colormapTexture = (this.state as any).colormapTexture as Texture | null

        return (data: any) => {
            const result = base(data)
            if (!result) return null
            return composeColormapPipeline(
                result as { image?: unknown; renderPipeline?: PipelineEntry[] },
                { rescaleMin, rescaleMax, colormapTexture, nodata }
            )
        }
    }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build a ColormappedCOGLayer for use in the deck.gl engine's makeTileLayer path.
 *
 * @param id        - Layer id (layer name from layerObj).
 * @param options   - Raw COG file URL + layer config. `rawCogUrl` is the bare
 *                    `.tif` URL with no TiTiler host or query params (saved by
 *                    Map_.js before `ServiceUrls.buildTiTilerCogTilesUrl` runs).
 */
export function buildDeckCOGLayer(
    id: string,
    options: {
        rawCogUrl: string
        layerObj: Record<string, any>
        opacity?: number
        minZoom?: number
        maxZoom?: number
    }
): Layer {
    const l = options.layerObj
    const colormapName = (l.currentCogColormap ?? l.cogColormap ?? 'viridis') as string
    const rescaleMin = Number(l.currentCogMin ?? l.cogMin ?? 0)
    const rescaleMax = Number(l.currentCogMax ?? l.cogMax ?? 1)
    const nodata = l.cogNoData != null ? Number(l.cogNoData) : null

    return new ColormappedCOGLayer({
        id,
        geotiff: options.rawCogUrl,
        opacity: options.opacity ?? 1,
        minZoom: options.minZoom,
        maxZoom: options.maxZoom,
        // Custom props consumed in updateState and _renderTileCallback:
        colormapName,
        rescaleMin,
        rescaleMax,
        nodata,
        updateTriggers: {
            // Forces _renderTileCallback() to be re-evaluated (tiles re-rendered
            // without re-fetching) when colormap, rescale range, or nodata changes.
            renderTile: [colormapName, rescaleMin, rescaleMax, nodata],
        },
    } as any) as unknown as Layer
}
