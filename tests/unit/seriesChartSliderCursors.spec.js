import { describe, test, expect, vi } from 'vitest'

class Rect {
    constructor(draggable) {
        this.draggable = draggable
        this.cursor = 'ew-resize'
        this.listeners = {}
    }
    on(event, handler) {
        ;(this.listeners[event] ||= []).push(handler)
    }
    fire(event) {
        ;(this.listeners[event] || []).forEach((h) => h())
    }
}

vi.mock('echarts', () => ({ graphic: { Rect } }))

const { grabCursorOnSlider } = await import(
    '../../src/essence/Tools/SeriesChart/lib/sliderCursors'
)

function fakeChart(shapes) {
    const handlers = {}
    const zr = {
        cursor: null,
        storage: { getDisplayList: () => shapes },
        setCursorStyle(c) {
            zr.cursor = c
        },
    }
    return {
        zr,
        getZr: () => zr,
        on: (event, h) => (handlers[event] = h),
        off: vi.fn((event) => delete handlers[event]),
        finish: () => handlers.finished?.(),
    }
}

describe('grabCursorOnSlider', () => {
    test("the slider's draggable body grabs; handles and static shapes keep their cursor", () => {
        const body = new Rect(true)
        const background = new Rect(false)
        const handle = { draggable: true, cursor: 'ew-resize', on() {} }
        grabCursorOnSlider(fakeChart([body, background, handle]))
        expect(body.cursor).toBe('grab')
        expect(background.cursor).toBe('ew-resize')
        expect(handle.cursor).toBe('ew-resize')
    })

    test('dragging the body shows a grabbing cursor until it is let go', () => {
        const body = new Rect(true)
        const chart = fakeChart([body])
        grabCursorOnSlider(chart)
        body.fire('dragstart')
        expect(body.cursor).toBe('grabbing')
        expect(chart.zr.cursor).toBe('grabbing')
        body.fire('dragend')
        expect(body.cursor).toBe('grab')
    })

    test('a body rebuilt by a later render is patched once, and the release unsubscribes', () => {
        const shapes = []
        const chart = fakeChart(shapes)
        const release = grabCursorOnSlider(chart)
        const rebuilt = new Rect(true)
        shapes.push(rebuilt)
        chart.finish()
        chart.finish()
        expect(rebuilt.cursor).toBe('grab')
        expect(rebuilt.listeners.dragstart).toHaveLength(1)
        release()
        expect(chart.off).toHaveBeenCalledWith('finished', expect.any(Function))
    })
})
