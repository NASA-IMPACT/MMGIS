import { describe, test, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * The modern UI's stacking contract: the panel layer paints over the map's.
 *
 * The map-anchored popup card is what leans hardest on it. The card mounts
 * beside the map container and claims no level of its own (pinned in
 * MapPopup_.spec.ts), so it rises exactly as high as whatever holds the map —
 * and the app's panels have to go on painting over it. The two layouts hold
 * the map in different places, so each has its own half of the contract.
 *
 * jsdom loads no stylesheet and lays nothing out, so paint order itself is not
 * assertable here. What is assertable are the declarations that produce it,
 * which is what this spec reads.
 */

/** A stylesheet's rules, comments stripped, in source order. */
function rulesOf(path) {
    return readFileSync(path, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('}')
        .map((block) => {
            const [selectors, declarations] = block.split('{')
            return {
                selectors: selectors.split(',').map((one) => one.trim()),
                declarations: declarations ?? '',
            }
        })
        .filter((rule) => rule.declarations.trim())
}

describe('the compact layout keeps the panel regions above the map', () => {
    const rules = rulesOf(
        'src/essence/Basics/UserInterface_/UserInterfaceModern_.css'
    )
    /**
     * The declarations of the rule for exactly this selector, and nothing
     * when the stylesheet has no such rule. Each of the selectors below is
     * written once, so there is nothing for the cascade to resolve between.
     */
    const ruleFor = (selector) =>
        rules.find((rule) => rule.selectors.includes(selector))?.declarations ??
        ''
    /** The level `selector` paints at, or null when it claims none. */
    const level = (selector) => {
        const declared = ruleFor(selector).match(/z-index:\s*(-?\d+)/)
        return declared ? Number(declared[1]) : null
    }

    const compact = '.ui-modern-grid.ui-layout-compact '
    const centre = level(`${compact}.ui-region-center`)

    test('the region holding the map claims a level of its own', () => {
        // This layout puts the map in a grid cell rather than behind the whole
        // panel layer, and the cell claims a level. Everything below is what
        // keeps the panels clear of it.
        expect(centre).toEqual(expect.any(Number))
    })

    test.each(['top', 'left', 'right', 'bottom'])(
        'the %s region paints above it',
        (region) => {
            const selector = `${compact}.ui-region-${region}`
            expect(ruleFor(selector)).toContain('position: relative')
            expect(level(selector)).toBeGreaterThan(centre)
        }
    )
})

describe('the overlay layout keeps the panel layer above the map', () => {
    const source = readFileSync('src/essence/modern.js', 'utf8')
    /** The level the inline styles of `variable` set. */
    const level = (variable) => {
        const declared = source.match(
            new RegExp(`${variable}\\.css\\(\\{[^}]*'z-index':\\s*(-?\\d+)`)
        )
        return declared ? Number(declared[1]) : null
    }

    test('the panel layer outranks the map it is laid over', () => {
        // Here the map is a backdrop the whole panel layer covers, and the
        // card is mounted beside it — inside the map's layer, under the panel
        // layer along with the map itself.
        expect(level('modernContent')).toBeGreaterThan(level('mapContainer'))
    })
})
