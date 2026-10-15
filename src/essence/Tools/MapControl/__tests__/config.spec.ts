import { describe, test, expect } from 'vitest'
import config from '../config.json'

type Component = { field: string; [key: string]: unknown }

/** Every component the configure page draws for the tool, across its rows. */
const components: Component[] = config.config.rows.flatMap(
    (row): Component[] => row.components,
)
const field = (name: string) => components.find((c) => c.field === name)

describe('MapControl config', () => {
    test('offers a Compass checkbox, on by default, beside the zoom one', () => {
        const compass = field('variables.showCompass')
        expect(compass).toMatchObject({
            name: 'Compass',
            type: 'checkbox',
            defaultChecked: true,
        })
        const fields = components.map((c) => c.field)
        expect(fields.indexOf('variables.showCompass')).toBe(
            fields.indexOf('variables.showZoom') + 1,
        )
    })
})
