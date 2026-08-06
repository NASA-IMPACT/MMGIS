/**
 * DeckCOGLayer — client-side single-band COG rendering via deck.gl-geotiff.
 *
 * Provides:
 *   - `composeColormapPipeline` — pure function, GPU-free, unit-testable.
 *   - `buildDeckCOGLayer` — factory used by Map_.js for the deckRaster code path.
 *
 * The layer is a plain `COGLayer`: the float + colormap behaviour rides on its
 * `getTileData`/`renderTile` props, and colormap textures are cached per device
 * outside the layer, so there is no subclass and no layer-owned GPU state.
 *
 * Module resolution note:
 *   tsconfig.json uses `moduleResolution: "node"` which does not read package
 *   `exports` maps, so tsc cannot resolve the `./gpu-modules` subpath export.
 *   The import below uses `@ts-ignore` to suppress that tsc-only error; the
 *   import resolves correctly at runtime (Node.js + Playwright + Webpack all
 *   honour the exports map). Updating tsconfig to `node16`/`bundler` would
 *   remove the need for the ignore comment.
 */

import type { Layer } from '@deck.gl/core'
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
import type { Device, Texture } from '@luma.gl/core'
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
 * Resolves the finite nodata sentinel to discard: an explicitly configured
 * value wins, otherwise the COG's own GDAL_NODATA tag.
 *
 * Returns null for NaN. A NaN sentinel is not a value FilterNoDataVal can
 * match (`==` is false for NaN by definition) and needs no configuration —
 * FilterNaN discards those pixels regardless.
 */
export function resolveNoDataValue(
    configNoData: number | null | undefined,
    fileNoData: number | null | undefined
): number | null {
    const value = configNoData ?? fileNoData
    return Number.isFinite(value as number) ? (value as number) : null
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
    /**
     * Finite nodata sentinel for this tile, or null when the file declares
     * none (or declares NaN, which FilterNaN handles instead).
     */
    noDataValue?: number | null
}) | null

/**
 * Custom tile loader for COGs. Two paths, chosen by band count:
 *
 *  - **Single-band** (the primary case): upload the band as a single-channel
 *    `r32float` texture so the RAW value lands in `color.r` for the downstream
 *    FilterNaN + FilterNoDataVal + LinearRescale + Colormap modules. Pixels
 *    are uploaded untouched; the file's declared nodata rides along on the
 *    tile data for the GPU to discard.
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
        // file's GDAL_NODATA at any zoom level. Passed through to renderTile
        // rather than applied here: the pixels are left untouched and the
        // discard happens on the GPU.
        const noDataValue = resolveNoDataValue(
            options.noDataOverride,
            image?.nodata
        )
        const texture = device.createTexture({
            data: f32,
            format: 'r32float',
            width,
            height,
            mipLevels: 1,
            sampler: { minFilter: 'nearest', magFilter: 'nearest', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' },
        })
        return {
            texture,
            mode: 'single',
            width,
            height,
            byteLength: f32.byteLength,
            noDataValue,
        }
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

/**
 * GPU module that discards NaN pixels. Float COGs commonly encode nodata as
 * NaN (`GDAL_NODATA=nan`), which the library's FilterNoDataVal cannot match —
 * its `==` comparison is false for NaN by definition.
 *
 * Uses the GLSL `isnan()` intrinsic, matching deck.gl-raster's own ECMWF
 * example. An earlier version tested self-inequality (`color.r != color.r`)
 * and was folded away by the shader compiler, leaving nodata opaque.
 */
const FilterNaN = {
    name: 'filter-nan',
    inject: {
        'fs:DECKGL_FILTER_COLOR': `
      if (isnan(color.r)) { discard; }
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
// Colormap textures (shared, outside the layer)
// ---------------------------------------------------------------------------

/**
 * Colormap LUT textures, cached per device and colormap name.
 *
 * Deliberately outside the layer: a texture is a function of (device,
 * colormap name) and nothing else, so caching it here lets layers stay plain
 * `COGLayer` instances instead of a subclass that owns GPU state. Deck.gl
 * layers are also replaced on every prop change, which would otherwise mean
 * rebuilding an identical texture on each rebuild.
 *
 * Never evicted: a LUT is 256×1 RGBA (1 KB) and the palette set is finite
 * (~107 colormaps → ~110 KB worst case). The WeakMap keys on the device, so
 * a torn-down map drops its whole cache and the textures die with the device.
 */
const colormapTextures = new WeakMap<Device, Map<string, Texture>>()

function getColormapTexture(device: Device, colormapName: string): Texture {
    let byName = colormapTextures.get(device)
    if (!byName) {
        byName = new Map<string, Texture>()
        colormapTextures.set(device, byName)
    }
    // buildColormapLUT normalizes the name (case, `_r` reversal), so the raw
    // configured string is a sound cache key.
    let texture = byName.get(colormapName)
    if (!texture) {
        texture = createColormapTexture(
            device,
            lutToImageData(buildColormapLUT(colormapName))
        )
        byName.set(colormapName, texture)
    }
    return texture
}

// ---------------------------------------------------------------------------
// renderTile
// ---------------------------------------------------------------------------

/**
 * Builds the `renderTile` prop: maps a loaded tile to its GPU render pipeline.
 *
 * Single-band COGs get `CreateTexture → FilterNaN → [FilterNoDataVal] →
 * LinearRescale → Colormap`; the raw value arrives in `color.r` from the
 * r32float upload. NaN fills are discarded by FilterNaN, and a file that
 * declares a finite GDAL_NODATA adds FilterNoDataVal for it — both before
 * LinearRescale clamps the raw value.
 *
 * Multi-band COGs display their colour directly, with black nodata edges
 * discarded.
 *
 * The colormap texture is resolved per tile from the tile texture's own
 * device, so a cached tile stays valid when the colormap changes — only this
 * closure is replaced (see `updateTriggers.renderTile`), never the tile data.
 */
function makeRenderTile(opts: {
    colormapName: string
    rescaleMin: number
    rescaleMax: number
}): (data: TileData) => RenderTileResult | null {
    return (data: TileData): RenderTileResult | null => {
        if (!data || !data.texture) return null

        if (data.mode === 'rgb') {
            return {
                renderPipeline: [
                    { module: CreateTexture, props: { textureName: data.texture } },
                    { module: FilterBlack },
                ],
            }
        }

        // Discard NaN fills first, then the file's finite sentinel if it
        // declares one — both before LinearRescale clamps the raw value.
        return composeColormapPipeline(
            {
                renderPipeline: [
                    { module: CreateTexture, props: { textureName: data.texture } },
                    { module: FilterNaN },
                ],
            },
            {
                rescaleMin: opts.rescaleMin,
                rescaleMax: opts.rescaleMax,
                colormapTexture: getColormapTexture(
                    data.texture.device,
                    opts.colormapName
                ),
                nodata: data.noDataValue ?? null,
            }
        )
    }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build the client-side COG layer for the deck.gl engine's makeTileLayer path.
 *
 * A plain `COGLayer` — the colormap/rescale behaviour rides on the
 * `getTileData` and `renderTile` props rather than a subclass, so there is no
 * layer-owned GPU state to keep in sync (see `colormapTextures`).
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

    return new COGLayer<TileData>({
        id,
        geotiff: options.rawCogUrl,
        opacity: options.opacity ?? 1,
        ...(Number.isFinite(minZoom) ? { minZoom } : {}),
        ...(Number.isFinite(maxZoom) ? { maxZoom } : {}),
        // Supplying getTileData + renderTile together makes COGLayer._parseGeoTIFF
        // skip its default inferRenderPipeline, which throws for float COGs
        // ('non-unsigned integers not yet supported').
        // The config nodata (if any) overrides the file's GDAL_NODATA.
        getTileData: (image, opts) =>
            cogGetTileData(image, { ...opts, noDataOverride: nodata }),
        renderTile: makeRenderTile({ colormapName, rescaleMin, rescaleMax }),
        updateTriggers: {
            // Re-runs renderTile for already-loaded tiles (no refetch) when the
            // colormap or rescale range changes. Nodata needs no trigger: it
            // comes from the file's GDAL_NODATA tag, fixed for a given URL.
            renderTile: [colormapName, rescaleMin, rescaleMax],
        },
    }) as unknown as Layer
}
