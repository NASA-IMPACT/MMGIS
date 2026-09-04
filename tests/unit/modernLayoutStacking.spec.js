import { describe, test, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * A tripwire on the compact layout's stacking declarations.
 *
 * The map-anchored popup card is what leans on them. The card is a positioned
 * box at `z-index: auto` mounted beside the map container (pinned in
 * MapPopup_.spec.ts), so it paints over the map and over every non-positioned
 * sibling of it; anything meant to paint over the card has to be positioned
 * itself and carry a level of its own. The compact layout's panel regions are
 * the app's answer, and this is what fails when they lose it.
 *
 * jsdom loads no stylesheet and lays nothing out, so paint order itself is not
 * assertable here. The declarations that produce it are, and they are what
 * this spec reads.
 */

/**
 * A stylesheet's rules, comments stripped, in source order. It reads a flat
 * stylesheet: a rule nested in an at-rule would come back split at the
 * at-rule's own brace.
 */
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

describe('the compact layout stylesheet keeps the panel regions above the card', () => {
    const rules = rulesOf(
        'src/essence/Basics/UserInterface_/UserInterfaceModern_.css'
    )
    /**
     * The declarations of every rule written for exactly this selector,
     * joined. Rules with other selectors reach the same elements — a bare
     * `.ui-region-center` carries a level of its own — so this reads what the
     * compact layout says rather than what the cascade settles on. A selector
     * no rule carries is an assertion against nothing, so it throws.
     */
    const ruleFor = (selector) => {
        const written = rules
            .filter((rule) => rule.selectors.includes(selector))
            .map((rule) => rule.declarations)
        if (written.length === 0)
            throw new Error(
                `No rule in UserInterfaceModern_.css for "${selector}"`
            )
        return written.join('\n')
    }
    /** The level `selector` paints at, or null when it claims none. */
    const level = (selector) => {
        const declared = ruleFor(selector).match(/z-index:\s*(-?\d+)/)
        return declared ? Number(declared[1]) : null
    }

    const compact = '.ui-modern-grid.ui-layout-compact '
    const centre = level(`${compact}.ui-region-center`)

    test('the region holding the map claims a level of its own', () => {
        // The card is a positioned box in this region, so the level the four
        // panel regions have to beat is the one written here.
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
