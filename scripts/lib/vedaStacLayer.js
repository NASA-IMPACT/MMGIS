/**
 * VEDA STAC source — pure mapping from a VEDA STAC collection to an MMGIS
 * TileLayer config (#333). Collection-level metadata only; no network, no
 * filesystem — callers own I/O and hand fetched JSON in.
 *
 * Principles (issue #331):
 * - The caller (a human in the layer editor) chooses the render entry and
 *   the time mode; nothing is decided silently, nothing is guessed —
 *   collections this can't handle are refused with a named error.
 * - Time is written as a policy, not a timestamp: an ongoing collection
 *   (null extent end — STAC's convention) gets dataEndTime "now", plus the
 *   collection's granularity (dashboard:time_interval) and periodicity
 *   (dashboard:is_periodic), so the config never goes stale (#332).
 * - VEDA semantics per veda-ui; supported backend profile is eoAPI
 *   (pgSTAC + titiler-pgstac), the VEDA/ODSI stack.
 */

const LEGEND_STOPS = 11;

class VedaStacError extends Error {}

/**
 * Picks the default render entry. VEDA collections carry a `dashboard` key
 * by convention; otherwise the first entry. Returns { key, render } | null.
 */
function pickRender(renders) {
    if (renders == null || typeof renders !== 'object') return null;
    if (renders.dashboard && typeof renders.dashboard === 'object') {
        return { key: 'dashboard', render: renders.dashboard };
    }
    for (const key of Object.keys(renders)) {
        if (renders[key] && typeof renders[key] === 'object') {
            return { key, render: renders[key] };
        }
    }
    return null;
}

/** Band indexes: only what the render declares — never inferred; absent
 *  means omit the param and let the tile service default. */
function resolveBidx(render) {
    if (Array.isArray(render.bidx) && render.bidx.length > 0) return render.bidx;
    return null;
}

/** First rescale pair; renders carry [[min,max]] per band. */
function resolveRescale(render) {
    const r = render.rescale;
    if (!Array.isArray(r) || r.length === 0) return null;
    const pair = Array.isArray(r[0]) ? r[0] : r;
    return pair.length === 2 ? pair : null;
}

/** The collection's temporal extent as trimmed ISO strings; either side may
 *  be null (a null end is STAC's "ongoing"). pgSTAC serves datetimes like
 *  "2024-12-18 00:00:00+00" — normalized here. */
function temporalExtent(collection) {
    const interval = collection?.extent?.temporal?.interval?.[0];
    const toIso = (v) => {
        if (v == null) return null;
        const d = new Date(v);
        return isNaN(d.getTime()) ? null : d.toISOString().split('.')[0] + 'Z';
    };
    return {
        start: toIso(interval?.[0]),
        end: toIso(interval?.[1]),
    };
}

/** The preselected time mode — a suggestion the user confirms, never a
 *  silent decision: any real span (or an open end) suggests time-enabled;
 *  a single instant or no extent suggests static. */
function suggestTimeMode(extent) {
    if (extent.start == null) return 'static';
    if (extent.end == null || extent.end !== extent.start) return 'time';
    return 'static';
}

function tileQuery(render) {
    const params = [];
    for (const asset of render.assets || []) {
        params.push(`assets=${encodeURIComponent(asset)}`);
    }
    for (const b of resolveBidx(render) || []) params.push(`bidx=${b}`);
    const rescale = resolveRescale(render);
    if (rescale) params.push(`rescale=${rescale[0]},${rescale[1]}`);
    if (render.colormap_name) params.push(`colormap_name=${encodeURIComponent(render.colormap_name)}`);
    if (render.resampling) params.push(`resampling=${encodeURIComponent(render.resampling)}`);
    if (render.nodata !== undefined && render.nodata !== null) params.push(`nodata=${render.nodata}`);
    return params.join('&');
}

/**
 * The titiler-pgstac collection-mosaic tile URL. Time-enabled layers carry
 * MMGIS's {starttime}/{endtime} placeholders (substituted from the time
 * slider at runtime); static layers mosaic the whole collection with no
 * datetime filter.
 */
function buildTileUrl({ rasterRoot, collectionId, render, timeEnabled }) {
    const root = String(rasterRoot).replace(/\/$/, '');
    const base = `${root}/collections/${collectionId}/tiles/WebMercatorQuad/{z}/{x}/{y}@1x`;
    const parts = [tileQuery(render)].filter(Boolean);
    if (timeEnabled) parts.push('datetime={starttime}/{endtime}');
    return parts.length > 0 ? `${base}?${parts.join('&')}` : base;
}

/**
 * Continuous legend: LEGEND_STOPS evenly spaced samples of the named
 * colormap, valued across the rescale range — legend and tiles agree by
 * construction. `colormapDef` is titiler's /colorMaps/{name} body (the
 * dict form); interval/list colormaps return null.
 */
function buildLegend(colormapDef, rescale) {
    if (colormapDef == null || Array.isArray(colormapDef) || typeof colormapDef !== 'object') return null;
    if (!rescale || rescale.length !== 2) return null;
    const [min, max] = rescale.map(Number);
    if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
    const stops = [];
    for (let i = 0; i < LEGEND_STOPS; i++) {
        const t = i / (LEGEND_STOPS - 1);
        const rgba = colormapDef[String(Math.round(t * 255))];
        if (!Array.isArray(rgba) || rgba.length < 3) return null;
        const value = min + t * (max - min);
        stops.push({
            shape: 'continuous',
            color: `#${rgba.slice(0, 3).map((c) => Number(c).toString(16).padStart(2, '0')).join('')}`,
            value: Number(value.toFixed(6)),
        });
    }
    return stops;
}

/** Collection spatial extent as an MMGIS boundingBox, 3D extents flattened. */
function boundingBoxOf(collection) {
    const bbox = collection?.extent?.spatial?.bbox?.[0];
    if (!Array.isArray(bbox)) return null;
    if (bbox.length === 4) return bbox;
    if (bbox.length === 6) return [bbox[0], bbox[1], bbox[3], bbox[4]];
    return null;
}

/**
 * The MMGIS TileLayer fields for one collection. No uuid — the layer
 * editor owns identity; this object fills a form.
 *
 * @param {object} args
 * @param {object} args.collection - The STAC collection body.
 * @param {string} [args.renderKey] - Which renders entry to use (default:
 *   'dashboard', else first).
 * @param {'auto'|'time'|'static'} [args.timeMode] - Time architecture;
 *   'auto' follows suggestTimeMode(extent).
 * @param {object|null} args.colormapDef - titiler colormap body for the
 *   render's colormap_name, or null.
 * @param {{raster: string}} args.endpoints
 * @returns {{ layer: object, warnings: string[] }}
 */
function buildLayer({ collection, renderKey, timeMode = 'auto', colormapDef, endpoints }) {
    if (!collection || typeof collection.id !== 'string' || collection.id === '') {
        throw new VedaStacError('A STAC collection with an id is required');
    }
    const warnings = [];
    const collectionId = collection.id;

    let render;
    if (renderKey != null) {
        render = collection.renders?.[renderKey];
        if (render == null || typeof render !== 'object') {
            throw new VedaStacError(
                `Collection '${collectionId}' has no render '${renderKey}' (has: ${Object.keys(collection.renders || {}).join(', ') || 'none'})`
            );
        }
    } else {
        const picked = pickRender(collection.renders);
        if (picked == null) {
            throw new VedaStacError(
                `Collection '${collectionId}' declares no renders — it cannot be filled automatically`
            );
        }
        render = picked.render;
    }

    const extent = temporalExtent(collection);
    const timeEnabled =
        timeMode === 'time'
            ? true
            : timeMode === 'static'
              ? false
              : suggestTimeMode(extent) === 'time';

    const url = buildTileUrl({
        rasterRoot: endpoints.raster,
        collectionId,
        render,
        timeEnabled,
    });

    const rescale = resolveRescale(render);
    const legend = render.colormap_name ? buildLegend(colormapDef, rescale) : null;
    if (render.colormap_name && legend == null) {
        warnings.push(
            `'${collectionId}' uses colormap '${render.colormap_name}' but no continuous legend could be built from it`
        );
    }

    const variables = { legendOrientation: 'vertical' };
    if (legend) variables.legend = legend;

    let time = { enabled: false };
    if (timeEnabled) {
        // An open-ended extent (null end — STAC's "ongoing") becomes the
        // "now" policy (#332): the layer's end follows the clock instead
        // of going stale as the collection grows.
        const endValue = extent.end != null ? extent.end : 'now';
        if (extent.start == null) {
            warnings.push(
                `'${collectionId}' has no temporal start in its extent — start fields omitted`
            );
        }
        time = {
            enabled: true,
            type: 'global',
            format: '%Y-%m-%dT%H:%M:%SZ',
            ...(extent.start != null
                ? { start: extent.start, dataStartTime: extent.start }
                : {}),
            end: endValue,
            dataEndTime: endValue,
        };
        const interval = collection['dashboard:time_interval'];
        if (typeof interval === 'string' && interval !== '') time.interval = interval;
        const isPeriodic = collection['dashboard:is_periodic'];
        if (typeof isPeriodic === 'boolean') time.isPeriodic = isPeriodic;
    }

    const layer = {
        name: collection.title || collectionId,
        type: 'TileLayer',
        visibility: false,
        sourceType: 'url',
        url,
        tileformat: 'wmts',
        initialOpacity: 1,
        minZoom: 0,
        maxNativeZoom: 20,
        maxZoom: 20,
        style: { brightness: 1, contrast: 1, saturation: 1, blend: 'none' },
        time,
        variables,
        properties: { key: collectionId },
    };
    const bbox = boundingBoxOf(collection);
    if (bbox) layer.boundingBox = bbox;
    else warnings.push(`'${collectionId}' has no spatial extent — boundingBox omitted`);
    if (typeof collection.description === 'string' && collection.description.trim() !== '') {
        layer.description = collection.description.trim();
    }

    return { layer, warnings };
}

module.exports = {
    VedaStacError,
    pickRender,
    resolveBidx,
    resolveRescale,
    temporalExtent,
    suggestTimeMode,
    buildTileUrl,
    buildLegend,
    boundingBoxOf,
    buildLayer,
};
