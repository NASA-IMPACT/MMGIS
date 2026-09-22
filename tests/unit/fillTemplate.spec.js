import { test, expect, describe } from 'vitest'

import { fillTemplate } from '../../src/essence/Tools/_shared/content/fillTemplate'

const PROPS = {
    name: 'Jezero',
    depth: 12,
    deep: 0,
    site: { name: 'Nili', tags: ['a'] },
    retired: null,
}

describe('fillTemplate', () => {
    test('leaves text with no placeholder as written', () => {
        expect(fillTemplate('Sample site', PROPS)).toBe('Sample site')
    })

    test('replaces a placeholder with the property value', () => {
        expect(fillTemplate('{name}', PROPS)).toBe('Jezero')
    })

    test('fills several placeholders amid text', () => {
        expect(fillTemplate('Crater {name} ({depth} m)', PROPS)).toBe(
            'Crater Jezero (12 m)'
        )
    })

    test('reaches a nested property by dot notation', () => {
        expect(fillTemplate('{site.name}', PROPS)).toBe('Nili')
    })

    test('keeps a zero, which is a value like any other', () => {
        expect(fillTemplate('{deep}', PROPS)).toBe('0')
    })

    test('resolves an absent property to nothing', () => {
        expect(fillTemplate('{nope}', PROPS)).toBe('')
        expect(fillTemplate('a{nope}b', PROPS)).toBe('ab')
    })

    test('resolves a property holding no value to nothing', () => {
        expect(fillTemplate('{retired}', PROPS)).toBe('')
    })

    test('resolves a nested value to nothing rather than [object Object]', () => {
        expect(fillTemplate('{site}', PROPS)).toBe('')
        expect(fillTemplate('{site.tags}', PROPS)).toBe('')
    })

    test('resolves a path through a missing branch to nothing', () => {
        expect(fillTemplate('{a.b.c}', PROPS)).toBe('')
    })

    test('survives properties being absent entirely', () => {
        expect(fillTemplate('{name}', null)).toBe('')
        expect(fillTemplate('plain', undefined)).toBe('plain')
    })

    test('leaves an empty placeholder as nothing', () => {
        expect(fillTemplate('a{}b', PROPS)).toBe('ab')
    })

    test('answers empty for a template that is not a string', () => {
        expect(fillTemplate(null, PROPS)).toBe('')
    })
})
