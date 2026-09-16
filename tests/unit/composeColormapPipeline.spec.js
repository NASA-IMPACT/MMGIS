import { test, expect, describe } from 'vitest'
import { composeColormapPipeline } from '../../src/essence/Basics/MapEngines/Adapters/DeckCOGLayer.ts'

const fakeTexture = { id: 'cmap' }

test('appends LinearRescale then Colormap to the base pipeline', () => {
    const base = { image: { id: 'img' }, renderPipeline: [{ module: { name: 'black-is-zero' } }] }
    const out = composeColormapPipeline(base, {
        rescaleMin: 0, rescaleMax: 100, colormapTexture: fakeTexture,
    })
    const names = out.renderPipeline.map((m) => m.module.name)
    expect(names).toEqual(['black-is-zero', 'linearRescale', 'colormap'])
    const rescale = out.renderPipeline.find((m) => m.module.name === 'linearRescale')
    expect(rescale.props).toEqual({ rescaleMin: 0, rescaleMax: 100 })
    const cmap = out.renderPipeline.find((m) => m.module.name === 'colormap')
    expect(cmap.props.colormapTexture).toBe(fakeTexture)
    expect(cmap.props.colormapIndex).toBe(0)
    expect(out.image).toBe(base.image)
})

test('prepends FilterNoDataVal when nodata is provided', () => {
    const base = { renderPipeline: [] }
    const out = composeColormapPipeline(base, {
        rescaleMin: 0, rescaleMax: 1, colormapTexture: fakeTexture, nodata: -9999,
    })
    expect(out.renderPipeline[0].module.name).toBe('nodata')
    expect(out.renderPipeline[0].props).toEqual({ value: -9999 })
})
