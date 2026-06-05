import { test, expect } from '@playwright/test'
import {
    extensionForMime,
    isValidMission,
} from '../../../API/Backend/Upload/validate.js'

test.describe('Upload validation', () => {
    test('extensionForMime maps allowed image types', () => {
        expect(extensionForMime('image/png')).toBe('png')
        expect(extensionForMime('image/jpeg')).toBe('jpg')
        expect(extensionForMime('image/webp')).toBe('webp')
        expect(extensionForMime('image/gif')).toBe('gif')
    })

    test('extensionForMime rejects disallowed types', () => {
        expect(extensionForMime('image/svg+xml')).toBeNull()
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
})
