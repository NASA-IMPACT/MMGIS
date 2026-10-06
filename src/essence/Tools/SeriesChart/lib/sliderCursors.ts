// echarts gives every draggable part of a slider dataZoom the same
// `ew-resize` cursor, so the window's body (which moves the window) reads
// exactly like its end handles (which resize it). This gives the body a
// grab cursor, and a grabbing one while it is dragged.
//
// The slider exposes no option for this; the body is found in the rendered
// scene as the one draggable rectangle (the handles are icon paths). The
// slider rebuilds its shapes when the zoom changes from outside it, so this
// re-runs on every render.

import * as echarts from 'echarts'

const PATCHED = '__seriesChartGrab'

type Draggable = {
    draggable?: boolean
    cursor?: string
    [PATCHED]?: boolean
    on: (event: string, handler: () => void) => void
}

function patchMoveZones(chart: echarts.ECharts) {
    const zr = chart.getZr()
    const shapes = (zr as unknown as {
        storage: { getDisplayList: (update?: boolean) => unknown[] }
    }).storage.getDisplayList()
    for (const shape of shapes) {
        if (!(shape instanceof echarts.graphic.Rect)) continue
        const el = shape as unknown as Draggable
        if (!el.draggable || el[PATCHED]) continue
        el[PATCHED] = true
        el.cursor = 'grab'
        el.on('dragstart', () => {
            el.cursor = 'grabbing'
            zr.setCursorStyle('grabbing')
        })
        el.on('dragend', () => {
            el.cursor = 'grab'
            zr.setCursorStyle('grab')
        })
    }
}

/** Keeps the slider body's grab cursor across re-renders. Returns the
 *  unsubscribe. */
export function grabCursorOnSlider(chart: echarts.ECharts): () => void {
    const apply = () => patchMoveZones(chart)
    apply()
    chart.on('finished', apply)
    return () => chart.off('finished', apply)
}
