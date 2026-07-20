import { test, expect } from 'vitest'
import {
    extensionForMime,
    isValidMission,
    isValidSubdir,
} from '../../../API/Backend/Upload/validate.js'

test.describe('Upload validation', () => {
    test('extensionForMime maps allowed image types', () => {
        expect(extensionForMime('image/png')).toBe('png')
        expect(extensionForMime('image/jpeg')).toBe('jpg')
        expect(extensionForMime('image/webp')).toBe('webp')
        expect(extensionForMime('image/gif')).toBe('gif')
        expect(extensionForMime('image/svg+xml')).toBe('svg')
    })

    test('extensionForMime rejects disallowed types', () => {
        expect(extensionForMime('application/pdf')).toBeNull()
        expect(extensionForMime(undefined)).toBeNull()
    })

    test('isValidMission accepts plain names', () => {
        expect(isValidMission('MSL')).toBe(true)
        expect(isValidMission('My_Mission-1')).toBe(true)
    })

    test('isValidMission rejects traversal and separators', () => {
        expect(isValidMission('')).toBe(false)
        expect(isValidMission('.')).toBe(false)
        expect(isValidMission('..')).toBe(false)
        expect(isValidMission('a/../b')).toBe(false)
        expect(isValidMission('a/b')).toBe(false)
        expect(isValidMission('a\\b')).toBe(false)
        expect(isValidMission(null)).toBe(false)
        expect(isValidMission(42)).toBe(false)
    })

    test('isValidSubdir accepts plain names and rejects traversal', () => {
        expect(isValidSubdir('CardPlugin')).toBe(true)
        expect(isValidSubdir('')).toBe(false)
        expect(isValidSubdir('.')).toBe(false)
        expect(isValidSubdir('..')).toBe(false)
        expect(isValidSubdir('a/../b')).toBe(false)
        expect(isValidSubdir('a/b')).toBe(false)
        expect(isValidSubdir('a\\b')).toBe(false)
        expect(isValidSubdir(null)).toBe(false)
        expect(isValidSubdir(undefined)).toBe(false)
    })
})
