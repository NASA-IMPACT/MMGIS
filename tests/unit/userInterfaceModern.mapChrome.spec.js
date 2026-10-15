import { test, expect, vi, afterEach } from 'vitest'
vi.mock('../../src/essence/Basics/Viewer_/Viewer_', () => ({ default: {} }))

// The bottom float zones are lifted by CSS variables the layout sets from the
// map's reported chrome. jsdom does no layout, so the map and centre region
// are given the rectangles a real page would have.

const { _setMapChromeInsets } = await import(
    '../../src/essence/Basics/UserInterface_/UserInterfaceModern_.js'
)

const box = (id, bottom) => {
    const el = document.createElement('div')
    el.id = id
    el.getBoundingClientRect = () => ({ top: 0, bottom, left: 0, right: 800, height: bottom, width: 800 })
    document.body.appendChild(el)
    return el
}

const lift = (side) =>
    document.documentElement.style.getPropertyValue(`--ui-map-chrome-bottom-${side}`)

afterEach(() => {
    document.body.innerHTML = ''
    document.documentElement.removeAttribute('style')
})

test('zones rise by the full chrome when the map and centre share a bottom edge', () => {
    box('map', 600)
    box('ui-modern-center', 600)
    _setMapChromeInsets({ bottomLeft: 31, bottomRight: 18 })
    expect(lift('left')).toBe('31px')
    expect(lift('right')).toBe('18px')
})

// A bottom panel laid over the map already covers the lower part of the
// chrome; only what reaches above the centre region needs clearing.
test('chrome hidden under a panel overlaying the map is not cleared again', () => {
    box('map', 600)
    box('ui-modern-center', 580)
    _setMapChromeInsets({ bottomLeft: 31, bottomRight: 12 })
    expect(lift('left')).toBe('11px')
    expect(lift('right')).toBe('0px')
})

test('a map with no bottom chrome leaves the zones on the edge', () => {
    box('map', 600)
    box('ui-modern-center', 600)
    _setMapChromeInsets({ bottomLeft: 0, bottomRight: 0 })
    expect(lift('left')).toBe('0px')
    expect(lift('right')).toBe('0px')
})
