/**
 * DeckCOGLayer — client-side single-band COG rendering via deck.gl-geotiff.
 *
 * Provides:
 *   - `composeColormapPipeline` — pure function, GPU-free, unit-testable.
 *   - `ColormappedCOGLayer` — deck.gl layer subclass; requires a GPU context at runtime.
 *   - `buildDeckCOGLayer` — factory used by Map_.js for the deckRaster code path.
 *
 * Module resolution note:
 *   tsconfig.json uses `moduleResolution: "node"` which does not read package
 *   `exports` maps, so tsc cannot resolve the `./gpu-modules` subpath export.
 *   The import below uses `@ts-ignore` to suppress that tsc-only error; the
 *   import resolves correctly at runtime (Node.js + Playwright + Webpack all
 *   honour the exports map). Updating tsconfig to `node16`/`bundler` would
 *   remove the need for the ignore comment.
 */

import type { Layer, UpdateParameters } from '@deck.gl/core'
import { COGLayer, addAlphaChannel } from '@developmentseed/deck.gl-geotiff'
import type { GetTileDataOptions } from '@developmentseed/deck.gl-geotiff'
import type { GeoTIFF, Overview } from '@developmentseed/geotiff'
import type {
    MinimalTileData,
    RasterModule,
    RenderTileResult,
} from '@developmentseed/deck.gl-raster'
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
    colormapTexture: Texture | null
    /** Sentinel no-data value (raw pixel units). null/undefined = no filtering. */
    nodata?: number | null
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
 */
export function composeColormapPipeline(
    baseResult: RenderTileResult,
    opts: ColormapOpts
): RenderTileResult {
    const extra: RasterModule[] = []

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
            colormapTexture: opts.colormapTexture,
            colormapIndex: 0,
            reversed: false,
        },
    })

    return {
        ...baseResult,
        renderPipeline: [...(baseResult.renderPipeline ?? []), ...extra],
    }
}

/**
 * Resolves the nodata sentinel to filter: an explicitly configured value wins,
 * otherwise the COG's own GDAL_NODATA tag. Returns null for NaN — the shader's
 * `==` comparison can never match NaN — NaN is canonicalized at upload instead.
 */
export function resolveNoDataValue(
    configNoData: number | null | undefined,
    fileNoData: number | null | undefined
): number | null {
    const value = configNoData ?? fileNoData
    return Number.isFinite(value as number) ? (value as number) : null
}

/**
 * The single canonical nodata value uploaded to the GPU: −FLT_MAX, exactly
 * representable in float32 and never plausible as real data.
 *
 * Nodata cannot be filtered in the shader by testing for NaN — fast-math
 * shader compilers may fold `x != x` to false (this regressed transparent
 * oceans) — but exact `==` against a canonical finite value is deterministic.
 */
export const NODATA_SENTINEL = -3.4028234663852886e38

/**
 * Replaces (in place) every NaN pixel — and every pixel matching the file's
 * declared nodata value, when one is given — with NODATA_SENTINEL, so the
 * render pipeline needs exactly one FilterNoDataVal(NODATA_SENTINEL) module.
 */
export function canonicalizeNoData(
    f32: Float32Array,
    noData: number | null | undefined
): Float32Array {
    const hasNoData = noData != null
    // The tag value is a double; pixels are float32 — round it the same way
    // or a nodata like 1e20 would never compare equal.
    const nd = hasNoData ? Math.fround(noData as number) : 0
    for (let i = 0; i < f32.length; i++) {
        const v = f32[i]
        if (v !== v || (hasNoData && v === nd)) f32[i] = NODATA_SENTINEL
    }
    return f32
}

// ---------------------------------------------------------------------------
// GPU helpers (browser/WebGL only)
// ---------------------------------------------------------------------------

/** Build a 256×1 ImageData LUT for createColormapTexture. */
function lutToImageData(lut: Uint8ClampedArray): ImageData {
    return new ImageData(lut, 256, 1)
}

/**
 * What cogGetTileData hands to renderTile. Extends the library's
 * MinimalTileData (width/height/byteLength) with our own two fields.
 */
type TileData = (MinimalTileData & {
    texture: Texture
    /** 'single' → float value in color.r (colormap path); 'rgb' → RGBA displayed directly. */
    mode: 'single' | 'rgb'
    width: number
    height: number
    byteLength: number
}) | null

/**
 * Custom tile loader for COGs. Two paths, chosen by band count:
 *
 *  - **Single-band** (the primary case): upload the band as a single-channel
 *    `r32float` texture so the RAW value lands in `color.r` for the downstream
 *    FilterNoDataVal + LinearRescale + Colormap modules. NaN and the file's
 *    declared nodata are canonicalized to NODATA_SENTINEL before upload.
 *    Nearest sampling (float linear filtering is not guaranteed in WebGL2).
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
 * @param options `{ device, x, y, signal, pool }` supplied by the wrapper,
 *                plus `noDataOverride` bound in by buildDeckCOGLayer.
 */
async function cogGetTileData(
    image: GeoTIFF | Overview,
    options: GetTileDataOptions & { noDataOverride?: number | null }
): Promise<TileData> {
    const { device, x, y, signal, pool } = options
    let array = (await image.fetchTile(x, y, { boundless: false, pool, signal }))?.array
    if (!array) return null
    const { width, height, count: samples } = array

    if (samples === 1) {
        // RasterArray is a union discriminated on `layout`: band-separate
        // carries `bands`, pixel-interleaved carries `data`. With one band
        // both hold the same samples.
        const src =
            array.layout === 'band-separate' ? array.bands[0] : array.data
        const f32 = src instanceof Float32Array ? src : Float32Array.from(src)
        // Overview.nodata delegates to the parent GeoTIFF, so this reads the
        // file's GDAL_NODATA at any zoom level.
        canonicalizeNoData(
            f32,
            resolveNoDataValue(options.noDataOverride, image?.nodata)
        )
        const texture = device.createTexture({
            data: f32,
            format: 'r32float',
            width,
            height,
            mipLevels: 1,
            sampler: { minFilter: 'nearest', magFilter: 'nearest', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' },
        })
        return { texture, mode: 'single', width, height, byteLength: f32.byteLength }
    }

    // Multi-band: WebGL2 has no RGB-only format, so pad RGB → RGBA.
    if (samples === 3) array = addAlphaChannel(array)
    if (array.layout === 'band-separate') {
        // addAlphaChannel throws for this layout too; fail with a message that
        // names the cause instead of a downstream undefined-array crash.
        throw new Error(
            'Band-separate multi-band COGs are not supported by the client-side renderer.'
        )
    }
    const u8 = array.data instanceof Uint8Array ? array.data : Uint8Array.from(array.data)
    const texture = device.createTexture({
        data: u8,
        format: 'rgba8unorm',
        width,
        height,
        mipLevels: 1,
        sampler: { minFilter: 'linear', magFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' },
    })
    return { texture, mode: 'rgb', width, height, byteLength: u8.byteLength }
}

/** Truthy placeholder so COGLayer._parseGeoTIFF skips the (float-unsupported)
 *  default `inferRenderPipeline`. The real render pipeline is produced by the
 *  overridden `_renderTileCallback()` below, so this is never invoked. */
const RENDER_TILE_PLACEHOLDER = (): null => null

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
 *
 * Nodata (NaN or the file's GDAL_NODATA, optionally overridden by config) is
 * canonicalized to NODATA_SENTINEL at tile upload and discarded by a single
 * FilterNoDataVal in the pipeline.
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
        const { rescaleMin, rescaleMax } = p
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
            // Single-band: raw value in color.r → discard nodata → rescale →
            // colormap. NaN and the file's declared nodata were canonicalized
            // to NODATA_SENTINEL at upload, so one exact-equality filter
            // catches everything.
            return composeColormapPipeline(
                {
                    renderPipeline: [
                        { module: CreateTexture, props: { textureName: data.texture } },
                    ],
                },
                {
                    rescaleMin,
                    rescaleMax,
                    colormapTexture,
                    nodata: NODATA_SENTINEL,
                }
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
 *                    `.tif` URL with no TiTiler host or query params
 *                    (resolveTileLayerSource's `fileUrl`).
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
        // The config nodata (if any) is bound in as an override of the file's
        // GDAL_NODATA; both canonicalize to NODATA_SENTINEL at upload.
        getTileData: (image: any, opts: any) =>
            cogGetTileData(image, { ...opts, noDataOverride: nodata }),
        renderTile: RENDER_TILE_PLACEHOLDER,
        // Custom props consumed in updateState and _renderTileCallback:
        colormapName,
        rescaleMin,
        rescaleMax,
        updateTriggers: {
            // Forces _renderTileCallback() to be re-evaluated (tiles re-rendered
            // without re-fetching) when the colormap or rescale range changes.
            // Nodata needs no trigger: it comes from the file's GDAL_NODATA tag,
            // which is fixed for the lifetime of a URL, and a config override
            // would arrive as a new layer anyway.
            renderTile: [colormapName, rescaleMin, rescaleMax],
        },
    } as any) as unknown as Layer
}
