/**
 * VEDA STAC source — fetch orchestration for the layer editor's backend
 * routes (#333). Collection-level fetches only: the collection body, plus
 * the colormap definition when a legend is possible. The fetch
 * implementation is injectable (node-fetch on the server, fakes in tests);
 * the mapping itself stays in ./vedaStacLayer (pure).
 */

const {
    buildLayer,
    pickRender,
    temporalExtent,
    suggestTimeMode,
} = require('./vedaStacLayer');

const FETCH_TIMEOUT_MS = 60000;

function makeGetJson(fetchImpl) {
    const doFetch = fetchImpl || globalThis.fetch;
    return async function getJson(url) {
        const resp = await doFetch(url, {
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
        return resp.json();
    };
}

/**
 * The Look Up step: the facts a human decides from before any layer is
 * written — available renders (with their parameters), the temporal extent
 * (a null end means "ongoing"), granularity/periodicity, and the
 * preselections (default render key, suggested time mode).
 *
 * @param {string} id - STAC collection id.
 * @param {{ stac: string, fetchImpl?: Function }} opts
 */
async function inspectCollection(id, opts) {
    const getJson = makeGetJson(opts.fetchImpl);
    const stacRoot = opts.stac.replace(/\/$/, '');
    const collection = await getJson(`${stacRoot}/collections/${id}`);
    const picked = pickRender(collection.renders);
    const renders = Object.entries(collection.renders || {})
        .filter(([, r]) => r && typeof r === 'object')
        .map(([key, r]) => ({
            key,
            assets: r.assets || [],
            bidx: r.bidx || null,
            rescale: r.rescale || null,
            colormap_name: r.colormap_name || null,
            nodata: r.nodata !== undefined ? r.nodata : null,
        }));
    const extent = temporalExtent(collection);
    return {
        id,
        title: collection.title || id,
        renders,
        defaultRender: picked ? picked.key : null,
        temporal: extent,
        interval:
            typeof collection['dashboard:time_interval'] === 'string'
                ? collection['dashboard:time_interval']
                : null,
        isPeriodic:
            typeof collection['dashboard:is_periodic'] === 'boolean'
                ? collection['dashboard:is_periodic']
                : null,
        suggestedTimeMode: suggestTimeMode(extent),
        hasBbox: Array.isArray(collection.extent?.spatial?.bbox?.[0]),
    };
}

/**
 * The Fill step: fetches what one collection needs (its body, and the
 * colormap when a legend is possible) and maps it to layer fields.
 *
 * @param {string} id - STAC collection id.
 * @param {{ stac: string, raster: string, render?: string,
 *   timeMode?: 'auto'|'time'|'static', fetchImpl?: Function }} opts -
 *   `render` and `timeMode` carry the human's dialog choices; absent, the
 *   preselection rules apply.
 * @param {(msg: string) => void} warn - Receives non-fatal warnings.
 * @returns {Promise<object>} The MMGIS TileLayer fields.
 */
async function generateLayer(id, opts, warn) {
    const getJson = makeGetJson(opts.fetchImpl);
    const stacRoot = opts.stac.replace(/\/$/, '');
    const collection = await getJson(`${stacRoot}/collections/${id}`);

    // The legend needs the actual colors of the chosen render's colormap.
    const chosen =
        opts.render != null
            ? collection.renders?.[opts.render]
            : (pickRender(collection.renders) || {}).render;
    let colormapDef = null;
    if (chosen?.colormap_name) {
        try {
            colormapDef = await getJson(
                `${opts.raster.replace(/\/$/, '')}/colorMaps/${chosen.colormap_name}`
            );
        } catch (err) {
            warn(`'${id}': could not fetch colormap '${chosen.colormap_name}' (${err.message}) — legend omitted`);
        }
    }

    const { layer, warnings } = buildLayer({
        collection,
        renderKey: opts.render,
        timeMode: opts.timeMode || 'auto',
        colormapDef,
        endpoints: { raster: opts.raster },
    });
    warnings.forEach(warn);
    return layer;
}

module.exports = { inspectCollection, generateLayer, makeGetJson };
