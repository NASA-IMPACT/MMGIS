import { test, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { LayerLegend } from '../../../src/essence/Tools/LayerManager/lib/geo/LayerLegend/LayerLegend.tsx'

// A minimal but type-valid Layer, overridden per test. `visible: true` keeps
// the legend content mounted, since the component hides it behind the
// layer's own visibility toggle.
const baseLayer = (overrides) => ({
    id: 'layer1',
    title: 'Test Layer',
    description: null,
    opacity: 1,
    visible: true,
    type: 'none',
    cog: null,
    ...overrides,
})

const render = (layer) =>
    renderToStaticMarkup(createElement(LayerLegend, { layer }))

test.describe('LayerLegend description rendering', () => {
    test('renders a text legend description as markdown', () => {
        const html = render(baseLayer({ type: 'text', description: '**bold**' }))
        expect(html).toContain('<strong>bold</strong>')
        // Ties the rendered class to its layer-legend.scss rule — the only
        // check that renaming one side without the other leaves descriptions
        // unstyled.
        expect(html).toContain('blocks-layer-legend__markdown')
    })

    test('disables the info button when the layer has no description', () => {
        const html = render(baseLayer({ description: null }))
        expect(html).toContain('blocks-layer-legend__action-btn--disabled')
        expect(html).toContain('aria-disabled="true"')
    })

    test('enables the info button when the layer has a description', () => {
        const html = render(baseLayer({ description: 'Some text.' }))
        expect(html).not.toContain('blocks-layer-legend__action-btn--disabled')
        expect(html).toContain('aria-disabled="false"')
    })
})
