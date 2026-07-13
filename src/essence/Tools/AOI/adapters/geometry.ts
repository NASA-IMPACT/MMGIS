import type { Feature } from 'geojson'

/** Average-vertex centroid for Point/Polygon/MultiPolygon, else null. */
export function featureCentroid(f: Feature): [number, number] | null {
    const g = f.geometry
    if (!g) return null
    if (g.type === 'Point') {
        const c = g.coordinates as [number, number]
        return [c[0], c[1]]
    }
    if (g.type === 'Polygon' || g.type === 'MultiPolygon') {
        const rings: number[][][] =
            g.type === 'Polygon'
                ? (g.coordinates as number[][][])
                : ((g.coordinates as number[][][][]).flat() as number[][][])
        let sx = 0
        let sy = 0
        let n = 0
        for (const ring of rings) {
            const last = ring.length - 1
            const stopAt =
                ring.length > 1 &&
                ring[0][0] === ring[last][0] &&
                ring[0][1] === ring[last][1]
                    ? last
                    : ring.length
            for (let i = 0; i < stopAt; i++) {
                sx += ring[i][0]
                sy += ring[i][1]
                n++
            }
        }
        return n > 0 ? [sx / n, sy / n] : null
    }
    return null
}

/** [west, south, east, north] bbox of a Polygon/MultiPolygon, else null. */
export function featureBounds(f: Feature): [number, number, number, number] | null {
    const g = f.geometry
    if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) return null
    const rings: number[][][] =
        g.type === 'Polygon'
            ? (g.coordinates as number[][][])
            : ((g.coordinates as number[][][][]).flat() as number[][][])
    let w = Infinity
    let s = Infinity
    let e = -Infinity
    let n = -Infinity
    for (const ring of rings) {
        for (const [x, y] of ring) {
            if (x < w) w = x
            if (y < s) s = y
            if (x > e) e = x
            if (y > n) n = y
        }
    }
    return Number.isFinite(w) ? [w, s, e, n] : null
}
