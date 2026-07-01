/**
 * Tests for Tool Metadata Validation and Sanitization Utilities
 */

import { test, expect } from 'vitest'
import {
    sanitizeValue,
    sanitizeNumber,
    sanitizeEnum,
    sanitizeEnumArray,
    sanitizeBoolean,
    sanitizeToolMetadata,
    validateToolMetadata,
    normalizeIconClass,
    getValidIconClass,
    generateToolMetadata
} from '../../src/essence/Basics/ToolController_/ToolMetadataUtils.js'
import { TOOL_ORIENTATION } from '../../src/essence/Basics/ToolController_/types/tool.js'
import { PANEL_POSITION } from '../../src/essence/Basics/PanelManager_/types/layout.js'

test.describe('ToolMetadataUtils', () => {
    test.describe('sanitizeValue', () => {
        test('should sanitize text values', () => {
            expect(sanitizeValue('Hello World', 'text')).toBe('Hello World')
            expect(sanitizeValue('  test  ', 'text')).toBe('test')
        })

        test('should sanitize id values', () => {
            expect(sanitizeValue('my-tool_123', 'id')).toBe('my-tool_123')
            expect(sanitizeValue('my tool!@#', 'id')).toBe('mytool')
        })

        test('should sanitize class values', () => {
            expect(sanitizeValue('mdi mdi-layers', 'class')).toBe('mdi mdi-layers')
            expect(sanitizeValue('test!@#$%', 'class')).toBe('test')
        })

        test('should handle empty or invalid input', () => {
            expect(sanitizeValue('', 'text')).toBe('')
            expect(sanitizeValue(null, 'text')).toBe('')
            expect(sanitizeValue(undefined, 'text')).toBe('')
            expect(sanitizeValue(123, 'text')).toBe('')
        })
    })

    test.describe('sanitizeNumber', () => {
        test('should sanitize valid numbers', () => {
            expect(sanitizeNumber(100)).toBe(100)
            expect(sanitizeNumber('200')).toBe(200)
            expect(sanitizeNumber(42.7)).toBe(43)
        })

        test('should allow floats when specified', () => {
            expect(sanitizeNumber(42.7, { allowFloat: true })).toBe(42.7)
        })

        test('should clamp to min/max bounds', () => {
            expect(sanitizeNumber(50, { min: 100, max: 500 })).toBe(100)
            expect(sanitizeNumber(1000, { min: 100, max: 500 })).toBe(500)
        })

        test('should handle invalid values', () => {
            expect(sanitizeNumber(NaN, { defaultValue: 300 })).toBe(300)
            expect(sanitizeNumber(Infinity, { defaultValue: 300 })).toBe(300)
            expect(sanitizeNumber(-Infinity, { defaultValue: 300 })).toBe(300)
            expect(sanitizeNumber('invalid', { defaultValue: 300 })).toBe(300)
        })
    })

    test.describe('sanitizeEnum', () => {
        const validValues = ['value1', 'value2', 'value3']

        test('should pass valid enum values', () => {
            expect(sanitizeEnum('value1', validValues, 'value1', 'field', 'tool')).toBe('value1')
            expect(sanitizeEnum('value2', validValues, 'value1', 'field', 'tool')).toBe('value2')
        })

        test('should use default for invalid values', () => {
            expect(sanitizeEnum('invalid', validValues, 'value1', 'field', 'tool')).toBe('value1')
        })

        test('should use default for undefined/null', () => {
            expect(sanitizeEnum(undefined, validValues, 'value1', 'field', 'tool')).toBe('value1')
            expect(sanitizeEnum(null, validValues, 'value1', 'field', 'tool')).toBe('value1')
        })
    })

    test.describe('sanitizeEnumArray', () => {
        const validValues = ['value1', 'value2', 'value3']
        const defaultArray = ['value1']

        test('should pass valid array values', () => {
            expect(sanitizeEnumArray(['value1', 'value2'], validValues, defaultArray, 'field', 'tool'))
                .toEqual(['value1', 'value2'])
        })

        test('should filter out invalid values', () => {
            expect(sanitizeEnumArray(['value1', 'invalid', 'value2'], validValues, defaultArray, 'field', 'tool'))
                .toEqual(['value1', 'value2'])
        })

        test('should use default if all values are invalid', () => {
            expect(sanitizeEnumArray(['invalid1', 'invalid2'], validValues, defaultArray, 'field', 'tool'))
                .toEqual(defaultArray)
        })

        test('should use default for non-array values', () => {
            expect(sanitizeEnumArray('not-array', validValues, defaultArray, 'field', 'tool'))
                .toEqual(defaultArray)
            expect(sanitizeEnumArray(undefined, validValues, defaultArray, 'field', 'tool'))
                .toEqual(defaultArray)
        })
    })

    test.describe('sanitizeBoolean', () => {
        test('should pass through boolean values', () => {
            expect(sanitizeBoolean(true, false, 'field', 'tool')).toBe(true)
            expect(sanitizeBoolean(false, true, 'field', 'tool')).toBe(false)
        })

        test('should coerce string values', () => {
            expect(sanitizeBoolean('true', false, 'field', 'tool')).toBe(true)
            expect(sanitizeBoolean('false', true, 'field', 'tool')).toBe(false)
            expect(sanitizeBoolean('TRUE', false, 'field', 'tool')).toBe(true)
            expect(sanitizeBoolean('1', false, 'field', 'tool')).toBe(true)
            expect(sanitizeBoolean('0', true, 'field', 'tool')).toBe(false)
        })

        test('should coerce number values', () => {
            expect(sanitizeBoolean(1, false, 'field', 'tool')).toBe(true)
            expect(sanitizeBoolean(0, true, 'field', 'tool')).toBe(false)
            expect(sanitizeBoolean(42, false, 'field', 'tool')).toBe(true)
        })

        test('should use default for invalid values', () => {
            expect(sanitizeBoolean('invalid', false, 'field', 'tool')).toBe(false)
            expect(sanitizeBoolean(undefined, true, 'field', 'tool')).toBe(true)
            expect(sanitizeBoolean(null, false, 'field', 'tool')).toBe(false)
        })
    })

    test.describe('normalizeIconClass', () => {
        test('should pass through already-normalized MDI icons', () => {
            const result = normalizeIconClass('mdi mdi-layers')
            expect(result.normalized).toBe('mdi mdi-layers')
            expect(result.wasFixed).toBe(false)
        })

        test('should pass through other icon libraries', () => {
            const result = normalizeIconClass('fas fa-home')
            expect(result.normalized).toBe('fas fa-home')
            expect(result.wasFixed).toBe(false)
        })

        test('should normalize plain icon names', () => {
            const result = normalizeIconClass('layers')
            expect(result.normalized).toBe('mdi mdi-layers')
            expect(result.wasFixed).toBe(false)
        })

        test('should normalize legacy camelCase format', () => {
            const result = normalizeIconClass('mdiLayers')
            expect(result.normalized).toBe('mdi mdi-layers')
            expect(result.wasFixed).toBe(true)
            expect(result.original).toBe('mdiLayers')
        })

        test('should normalize legacy mdi- format', () => {
            const result = normalizeIconClass('mdi-layers')
            expect(result.normalized).toBe('mdi mdi-layers')
            expect(result.wasFixed).toBe(true)
            expect(result.original).toBe('mdi-layers')
        })

        test('should handle multi-word icon names', () => {
            const result = normalizeIconClass('format-list-bulleted-type')
            expect(result.normalized).toBe('mdi mdi-format-list-bulleted-type')
        })

        test('should return null for invalid formats', () => {
            const result = normalizeIconClass('Invalid Format!')
            expect(result.normalized).toBe(null)
            expect(result.wasFixed).toBe(false)
        })
    })

    test.describe('getValidIconClass', () => {
        test('should return valid normalized icon classes', () => {
            expect(getValidIconClass('layers', 'test-tool')).toBe('mdi mdi-layers')
            expect(getValidIconClass('mdi mdi-map', 'test-tool')).toBe('mdi mdi-map')
        })

        test('should return default for invalid input', () => {
            const defaultIcon = 'mdi mdi-view-dashboard'
            expect(getValidIconClass('', 'test-tool')).toBe(defaultIcon)
            expect(getValidIconClass(null, 'test-tool')).toBe(defaultIcon)
            expect(getValidIconClass(undefined, 'test-tool')).toBe(defaultIcon)
            expect(getValidIconClass('   ', 'test-tool')).toBe(defaultIcon)
        })

        test('should handle legacy formats', () => {
            expect(getValidIconClass('mdiLayers', 'test-tool')).toBe('mdi mdi-layers')
            expect(getValidIconClass('mdi-layers', 'test-tool')).toBe('mdi mdi-layers')
        })
    })

    test.describe('sanitizeToolMetadata', () => {
        test('should sanitize all metadata fields', () => {
            const input = {
                id: 'test-tool',
                name: 'Test Tool',
                icon: 'layers',
                width: 400,
                height: 300,
                requiredOrientation: TOOL_ORIENTATION.VERTICAL,
                preferredPosition: PANEL_POSITION.LEFT,
                compatiblePositions: [PANEL_POSITION.LEFT, PANEL_POSITION.RIGHT],
                separatedTool: true,
                expandable: false,
                modernLayoutSupport: true
            }

            const result = sanitizeToolMetadata(input)

            expect(result.id).toBe('test-tool')
            expect(result.name).toBe('Test Tool')
            expect(result.icon).toBe('mdi mdi-layers')
            expect(result.width).toBe(400)
            expect(result.height).toBe(300)
            expect(result.requiredOrientation).toBe(TOOL_ORIENTATION.VERTICAL)
            expect(result.preferredPosition).toBe(PANEL_POSITION.LEFT)
            expect(result.compatiblePositions).toEqual([PANEL_POSITION.LEFT, PANEL_POSITION.RIGHT])
            expect(result.separatedTool).toBe(true)
            expect(result.expandable).toBe(false)
            expect(result.modernLayoutSupport).toBe(true)
        })

        test('should use defaults for invalid enum values', () => {
            const input = {
                id: 'test-tool',
                name: 'Test Tool',
                icon: 'layers',
                requiredOrientation: 'invalid',
                preferredPosition: 'invalid',
                compatiblePositions: ['invalid1', 'invalid2']
            }

            const result = sanitizeToolMetadata(input)

            expect(result.requiredOrientation).toBe(TOOL_ORIENTATION.ANY)
            expect(result.preferredPosition).toBe(PANEL_POSITION.LEFT)
            expect(result.compatiblePositions).toEqual([PANEL_POSITION.LEFT, PANEL_POSITION.RIGHT])
        })

        test('should coerce boolean values', () => {
            const input = {
                id: 'test-tool',
                name: 'Test Tool',
                icon: 'layers',
                separatedTool: 'true',
                expandable: 1,
                modernLayoutSupport: '0'
            }

            const result = sanitizeToolMetadata(input)

            expect(result.separatedTool).toBe(true)
            expect(result.expandable).toBe(true)
            expect(result.modernLayoutSupport).toBe(false)
        })

        test('should throw error for missing critical fields', () => {
            expect(() => sanitizeToolMetadata({})).toThrow('Tool ID became empty')
            expect(() => sanitizeToolMetadata({ id: 'test' })).toThrow('Tool name became empty')
        })

        test('should not spread untrusted metadata', () => {
            const input = {
                id: 'test-tool',
                name: 'Test Tool',
                icon: 'mdi mdi-layers',
                dangerousField: '<script>alert("xss")</script>'
            }

            const result = sanitizeToolMetadata(input)

            expect(result.dangerousField).toBeUndefined()
        })

        test('should clamp numeric values to bounds', () => {
            const input = {
                id: 'test-tool',
                name: 'Test Tool',
                icon: 'layers',
                width: 50, // Below min
                height: 3000 // Above max
            }

            const result = sanitizeToolMetadata(input)

            expect(result.width).toBe(100) // Clamped to min
            expect(result.height).toBe(2000) // Clamped to max
        })
    })

    test.describe('validateToolMetadata', () => {
        test('should validate correct metadata without warnings', () => {
            const metadata = {
                id: 'test-tool',
                name: 'Test Tool',
                icon: 'mdi mdi-layers',
                requiredOrientation: TOOL_ORIENTATION.VERTICAL,
                preferredPosition: PANEL_POSITION.LEFT,
                compatiblePositions: [PANEL_POSITION.LEFT, PANEL_POSITION.RIGHT],
                separatedTool: true,
                expandable: false,
                modernLayoutSupport: true
            }

            expect(validateToolMetadata(metadata)).toBe(true)
        })

        test('should throw for missing required fields', () => {
            expect(() => validateToolMetadata({})).toThrow('missing required field: id')
            expect(() => validateToolMetadata({ id: 'test' })).toThrow('missing required field: name')
        })

        test('should return false for invalid fields', () => {
            const metadata = {
                id: 'test-tool',
                name: 'Test Tool',
                icon: 123, // Invalid type
                requiredOrientation: 'invalid',
                separatedTool: 'not-boolean'
            }

            const result = validateToolMetadata(metadata)
            expect(result).toBe(false)
        })

        test('should warn if preferredPosition not in compatiblePositions', () => {
            const metadata = {
                id: 'test-tool',
                name: 'Test Tool',
                preferredPosition: PANEL_POSITION.TOP,
                compatiblePositions: [PANEL_POSITION.LEFT, PANEL_POSITION.RIGHT]
            }

            const result = validateToolMetadata(metadata)
            expect(result).toBe(false)
        })
    })

    test.describe('generateToolMetadata', () => {
        test('should generate metadata from tool config', () => {
            const toolConfig = {
                name: 'Test Tool',
                js: 'test-tool',
                icon: 'layers',
                width: 400,
                height: 300
            }

            const metadata = generateToolMetadata(toolConfig)

            expect(metadata.id).toBe('test-tool')
            expect(metadata.name).toBe('Test Tool')
            expect(metadata.icon).toBe('mdi mdi-layers')
            expect(metadata.width).toBe(400)
            expect(metadata.height).toBe(300)
        })

        test('should prefer nested metadata over root-level', () => {
            const toolConfig = {
                name: 'Test Tool',
                js: 'test-tool',
                icon: 'old-icon',
                width: 300,
                metadata: {
                    icon: 'new-icon',
                    width: 500
                }
            }

            const metadata = generateToolMetadata(toolConfig)

            expect(metadata.icon).toBe('mdi mdi-new-icon')
            expect(metadata.width).toBe(500)
        })

        test('should handle legacy defaultIcon field', () => {
            const toolConfig = {
                name: 'Test Tool',
                js: 'test-tool',
                defaultIcon: 'layers'
            }

            const metadata = generateToolMetadata(toolConfig)
            expect(metadata.icon).toBe('mdi mdi-layers')
        })

        test('should generate id from name if js not provided', () => {
            const toolConfig = {
                name: 'My Cool Tool'
            }

            const metadata = generateToolMetadata(toolConfig)
            expect(metadata.id).toBe('my-cool-tool')
        })
    })
})
