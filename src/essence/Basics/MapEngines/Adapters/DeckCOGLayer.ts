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
import { COGLayer, addAlphaChannel } from '@developmentseed/deck.gl-geotiff'
// `moduleResolution: "node"` in tsconfig.json does not read package exports
// maps, so tsc cannot resolve the `./gpu-modules` subpath export.  The import
// below works correctly at runtime (Node.js, Playwright, Webpack all honour
// the exports map).  See deviation note in the file header.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { Colormap, LinearRescale, FilterNoDataVal, CreateTexture, createColormapTexture } from '@developmentseed/deck.gl-raster/gpu-modules'
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

type TileData = {
    texture: any
    /** 'single' → float value in color.r (colormap path); 'rgb' → RGBA displayed directly. */
    mode: 'single' | 'rgb'
    width: number
    height: number
    byteLength: number
} | null

/**
 * Custom tile loader for COGs. Two paths, chosen by band count:
 *
 *  - **Single-band** (the primary case): upload the band as a single-channel
 *    `r32float` texture so the RAW value lands in `color.r` for the downstream
 *    FilterNaN + LinearRescale + Colormap modules. Nearest sampling (float
 *    linear filtering is not guaranteed in WebGL2).
 *  - **Multi-band uint (RGB/RGBA)**: upload as `rgba8unorm` and display the
 *    colour directly via CreateTexture (no colormap/rescale). This is the
 *    multi-band case #158 defers — supported here as a passthrough so true-colour
 *    COGs (e.g. Sentinel-2 TCI) render client-side. Assumes 8-bit samples.
 *
 * Supplying this `getTileData` (+ a `renderTile`) makes `COGLayer._parseGeoTIFF`
 * skip its default `inferRenderPipeline`, whose auto-inference throws for float
 * COGs (`non-unsigned integers not yet supported`, SampleFormat 3).
 *
 * @param image   A `GeoTIFF` (full-res) or `Overview`, selected per-zoom by
 *                COGLayer's `_getTileDataCallback` wrapper — this is what makes
 *                higher zooms load finer overviews.
 * @param options `{ device, x, y, signal, pool }` supplied by the wrapper.
 */
async function cogGetTileData(
    image: any,
    options: { device: any; x: number; y: number; signal?: AbortSignal; pool?: any }
): Promise<TileData> {
    const { device, x, y, signal, pool } = options
    let array = (await image.fetchTile(x, y, { boundless: false, pool, signal }))?.array
    if (!array) return null
    const width = array.width
    const height = array.height
    const samples =
        (array.bands && array.bands.length) ||
        Math.max(1, Math.round(array.data.length / (width * height)))

    if (samples === 1) {
        const src =
            array.layout === 'band-separate' && array.bands && array.bands.length
                ? array.bands[0]
                : array.data
        const f32 = src instanceof Float32Array ? src : Float32Array.from(src)
        const texture = device.createTexture({
            data: f32,
            format: 'r32float',
            width,
            height,
            mipmaps: false,
            sampler: { minFilter: 'nearest', magFilter: 'nearest', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' },
        })
        return { texture, mode: 'single', width, height, byteLength: f32.byteLength }
    }

    // Multi-band: WebGL2 has no RGB-only format, so pad RGB → RGBA.
    if (samples === 3) array = addAlphaChannel(array)
    const u8 = array.data instanceof Uint8Array ? array.data : Uint8Array.from(array.data)
    const texture = device.createTexture({
        data: u8,
        format: 'rgba8unorm',
        width,
        height,
        mipmaps: false,
        sampler: { minFilter: 'linear', magFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' },
    })
    return { texture, mode: 'rgb', width, height, byteLength: u8.byteLength }
}

/** Truthy placeholder so COGLayer._parseGeoTIFF skips the (float-unsupported)
 *  default `inferRenderPipeline`. The real render pipeline is produced by the
 *  overridden `_renderTileCallback()` below, so this is never invoked. */
const RENDER_TILE_PLACEHOLDER = (): null => null

/**
 * GPU module that discards NaN pixels. Float COGs almost always encode nodata
 * as NaN (GDAL_NODATA="nan"), and the library's FilterNoDataVal uses `==`
 * equality — which never matches NaN. `color.r != color.r` is the portable
 * self-inequality NaN test (NaN is the only value not equal to itself), so this
 * discards ocean/fill pixels and leaves them transparent. Harmless for integer
 * data (no pixel is NaN). Runs right after CreateTexture, before rescale.
 */
const FilterNaN = {
    name: 'filter-nan',
    inject: {
        'fs:DECKGL_FILTER_COLOR': `
      if (color.r != color.r) { discard; }
    `,
    },
}

/**
 * GPU module for the multi-band RGB path: discards fully-black pixels. Satellite
 * true-colour COGs (e.g. Sentinel-2 TCI) encode nodata as exact black (0,0,0) —
 * most visibly the rotated UTM tile edges — so this leaves them transparent
 * rather than painting black over the basemap. Heuristic: also discards any
 * legitimately pure-black pixel (rare in true-colour imagery).
 */
const FilterBlack = {
    name: 'filter-black',
    inject: {
        'fs:DECKGL_FILTER_COLOR': `
      if (color.r == 0.0 && color.g == 0.0 && color.b == 0.0) { discard; }
    `,
    },
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

    override finalizeState(context: any): void {
        const tex = (this.state as any).colormapTexture
        if (tex && typeof tex.destroy === 'function') {
            tex.destroy()
        }
        // deck.gl's Layer base class always defines finalizeState.
        super.finalizeState(context)
    }

    // Return type is `any` to avoid TypeScript's return-type assignability
    // check against the parent signature (which uses the full RenderTileResult
    // union from @developmentseed/deck.gl-raster). The actual runtime type
    // satisfies the union contract.
    //
    // The pipeline is built from scratch — CreateTexture samples our r32float
    // tile texture into `color` (raw value in color.r), then composeColormapPipeline
    // appends [FilterNoDataVal?, LinearRescale, Colormap]. We do NOT call
    // super._renderTileCallback() because COGLayer's default renderTile pairs
    // with its default getTileData (inferRenderPipeline), which throws for float.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    protected override _renderTileCallback(): any {
        const p = this.props as any
        const { rescaleMin, rescaleMax, nodata } = p
        // Capture colormapTexture at callback-construction time; the updateTriggers
        // on the layer force _renderTileCallback() to be re-called whenever
        // colormapName/rescaleMin/rescaleMax change, so the closure stays fresh.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const colormapTexture = (this.state as any).colormapTexture as Texture | null

        return (data: any) => {
            if (!data || !data.texture) return null
            // Multi-band RGB: display the colour directly (no colormap/rescale);
            // discard black nodata edges → transparent.
            if (data.mode === 'rgb') {
                return {
                    renderPipeline: [
                        { module: CreateTexture, props: { textureName: data.texture } },
                        { module: FilterBlack },
                    ],
                }
            }
            // Single-band: raw value in color.r → discard NaN → rescale → colormap.
            return composeColormapPipeline(
                {
                    renderPipeline: [
                        { module: CreateTexture, props: { textureName: data.texture } },
                        { module: FilterNaN },
                    ],
                },
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
    }
): Layer {
    const l = options.layerObj
    const colormapName = (l.currentCogColormap ?? l.cogColormap ?? 'viridis') as string
    const rescaleMin = Number(l.currentCogMin ?? l.cogMin ?? 0)
    const rescaleMax = Number(l.currentCogMax ?? l.cogMax ?? 1)
    const nodata = l.cogNoData != null ? Number(l.cogNoData) : null
    // Derived here rather than passed by callers so every rebuild path
    // (creation, colormap/rescale refresh, time reload) keeps the same limits.
    const minZoom = parseInt(l.minZoom)
    const maxZoom = parseInt(l.maxZoom)

    return new ColormappedCOGLayer({
        id,
        geotiff: options.rawCogUrl,
        opacity: options.opacity ?? 1,
        ...(Number.isFinite(minZoom) ? { minZoom } : {}),
        ...(Number.isFinite(maxZoom) ? { maxZoom } : {}),
        // Supplying getTileData + renderTile makes COGLayer._parseGeoTIFF skip
        // its default inferRenderPipeline (which throws for float COGs).
        // getTileData uploads the band as r32float; renderTile is overridden by
        // the subclass (this placeholder only satisfies the parse-time guard).
        getTileData: cogGetTileData,
        renderTile: RENDER_TILE_PLACEHOLDER,
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
