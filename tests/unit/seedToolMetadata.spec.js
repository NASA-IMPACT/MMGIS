import { test, expect } from 'vitest'
import { seedToolMetadata } from '../../configure/src/core/utils'

const toolConfig = {
    metadata: {
        modernLayoutSupport: false,
        requiredOrientation: 'any',
        compatiblePositions: ['top', 'left', 'right', 'bottom'],
        preferredPosition: 'left',
        width: 300,
        height: 0,
    },
}

test.describe('seedToolMetadata', () => {
    test('uses toolConfig.metadata as the base when no existing metadata', () => {
        const out = seedToolMetadata(null, toolConfig)
        expect(out).toEqual(toolConfig.metadata)
    })

    test('existing values override the toolConfig defaults', () => {
        const out = seedToolMetadata({ modernLayoutSupport: true, width: 420 }, toolConfig)
        expect(out.modernLayoutSupport).toBe(true)
        expect(out.width).toBe(420)
        expect(out.preferredPosition).toBe('left')
    })

    test('result is a deep clone of the config defaults', () => {
        const out = seedToolMetadata(null, toolConfig)
        out.compatiblePositions.push('bottom')
        expect(toolConfig.metadata.compatiblePositions).toEqual([
            'top', 'left', 'right', 'bottom',
        ])
    })

    test('returns an empty object when nothing is available', () => {
        expect(seedToolMetadata(null, {})).toEqual({})
    })
})
