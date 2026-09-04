// @vitest-environment node
import { test, expect } from 'vitest'
import {
    compileLegendStyle,
    resolveLegendStyle,
} from '../../src/essence/Basics/Layers_/LegendStyle.ts'

/**
 * LegendStyle must not need a DOM. It resolves colours inside deck.gl's style
 * accessors, so any layout work it triggers lands on the render path, and its
 * colour parsing used to measure a throwaway element appended to document.body.
 * This spec runs under plain Node, where that would throw.
 */
test('resolves a named-colour ramp with no DOM available', () => {
    expect(typeof document).toBe('undefined')

    const legend = [
        {
            styleMatching: true,
            propertyName: 'co2',
            propertyValue: '0',
            shape: 'continuous',
            color: 'black',
        },
        {
            styleMatching: true,
            propertyName: 'co2',
            propertyValue: '100',
            shape: 'continuous',
            color: 'white',
        },
    ]

    const compiled = compileLegendStyle(legend)
    expect(resolveLegendStyle(compiled, { co2: 50 }).fillColor).toBe(
        'rgb(128, 128, 128)'
    )
})
