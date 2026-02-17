import { test, expect } from '@playwright/test'
import MapEngineRegistry from '../../src/essence/Basics/MapEngines/MapEngineRegistry.ts'

function createMockAdapterClass(engineType = 'leaflet') {
    return class MockAdapter {
        engineType = engineType
        initialized = false
        destroyed = false

        init(options) {
            this.initialized = true
            this.initOptions = options
        }

        destroy() {
            this.destroyed = true
        }

        getNativeMap() {
            return null
        }
    }
}

function createAsyncMockAdapterClass(engineType = 'deckgl') {
    return class AsyncMockAdapter {
        engineType = engineType
        initialized = false
        destroyed = false

        async init(options) {
            this.initialized = true
            this.initOptions = options
        }

        async destroy() {
            this.destroyed = true
        }

        getNativeMap() {
            return null
        }
    }
}

test.describe('MapEngineRegistry', () => {
    let registry

    test.beforeEach(() => {
        registry = new MapEngineRegistry()
    })

    test.describe('register', () => {
        test('registers an adapter class under a name', () => {
            const MockAdapter = createMockAdapterClass()
            registry.register('leaflet', MockAdapter)

            expect(registry.hasEngine('leaflet')).toBe(true)
        })

        test('overwrites a previously registered adapter', () => {
            const First = createMockAdapterClass('leaflet')
            const Second = createMockAdapterClass('leaflet')

            registry.register('leaflet', First)
            registry.register('leaflet', Second)

            const engine = registry.createEngine('leaflet')
            expect(engine).toBeInstanceOf(Second)
        })

        test('throws when name is empty', () => {
            expect(() => registry.register('', createMockAdapterClass())).toThrow(
                'Engine name must be a non-empty string'
            )
        })

        test('throws when name is not a string', () => {
            expect(() => registry.register(42, createMockAdapterClass())).toThrow(
                'Engine name must be a non-empty string'
            )
        })

        test('throws when adapterClass is not a constructor', () => {
            expect(() => registry.register('leaflet', {})).toThrow(
                'Adapter class must be a constructor'
            )
        })
    })

    test.describe('createEngine', () => {
        test('creates an instance of the registered adapter', () => {
            const MockAdapter = createMockAdapterClass()
            registry.register('leaflet', MockAdapter)

            const engine = registry.createEngine('leaflet')
            expect(engine).toBeInstanceOf(MockAdapter)
            expect(engine.engineType).toBe('leaflet')
        })

        test('tracks created engine for later retrieval', () => {
            registry.register('leaflet', createMockAdapterClass())
            const engine = registry.createEngine('leaflet')

            expect(registry.getEngine('leaflet')).toBe(engine)
        })

        test('throws for unregistered engine name', () => {
            expect(() => registry.createEngine('unknown')).toThrow(
                'No adapter registered for engine "unknown"'
            )
        })
    })

    test.describe('initializeEngine', () => {
        test('calls init on the engine with options', () => {
            registry.register('leaflet', createMockAdapterClass())
            const engine = registry.createEngine('leaflet')
            const options = { containerId: 'map' }

            registry.initializeEngine(engine, options)

            expect(engine.initialized).toBe(true)
            expect(engine.initOptions).toBe(options)
        })

        test('supports async init', async () => {
            registry.register('deckgl', createAsyncMockAdapterClass())
            const engine = registry.createEngine('deckgl')
            const options = { containerId: 'map' }

            await registry.initializeEngine(engine, options)

            expect(engine.initialized).toBe(true)
        })
    })

    test.describe('destroyEngine', () => {
        test('calls destroy on the engine', () => {
            registry.register('leaflet', createMockAdapterClass())
            const engine = registry.createEngine('leaflet')

            registry.destroyEngine(engine)

            expect(engine.destroyed).toBe(true)
        })

        test('removes the engine from tracked engines', () => {
            registry.register('leaflet', createMockAdapterClass())
            const engine = registry.createEngine('leaflet')

            registry.destroyEngine(engine)

            expect(registry.getEngine('leaflet')).toBeUndefined()
        })

        test('clears activeEngine if the destroyed engine was active', () => {
            registry.register('leaflet', createMockAdapterClass())
            const engine = registry.createEngine('leaflet')
            registry.setActiveEngine(engine)

            registry.destroyEngine(engine)

            expect(registry.getActiveEngine()).toBeNull()
        })

        test('supports async destroy', async () => {
            registry.register('deckgl', createAsyncMockAdapterClass())
            const engine = registry.createEngine('deckgl')

            await registry.destroyEngine(engine)

            expect(engine.destroyed).toBe(true)
        })
    })

    test.describe('active engine management', () => {
        test('active engine is null by default', () => {
            expect(registry.getActiveEngine()).toBeNull()
        })

        test('setActiveEngine stores the engine', () => {
            registry.register('leaflet', createMockAdapterClass())
            const engine = registry.createEngine('leaflet')

            registry.setActiveEngine(engine)

            expect(registry.getActiveEngine()).toBe(engine)
        })
    })

    test.describe('hasEngine', () => {
        test('returns false for unregistered name', () => {
            expect(registry.hasEngine('leaflet')).toBe(false)
        })

        test('returns true for registered name', () => {
            registry.register('leaflet', createMockAdapterClass())
            expect(registry.hasEngine('leaflet')).toBe(true)
        })
    })

    test.describe('getRegisteredEngines', () => {
        test('returns empty array when nothing is registered', () => {
            expect(registry.getRegisteredEngines()).toEqual([])
        })

        test('returns all registered engine names', () => {
            registry.register('leaflet', createMockAdapterClass())
            registry.register('deckgl', createAsyncMockAdapterClass())

            const names = registry.getRegisteredEngines()
            expect(names).toContain('leaflet')
            expect(names).toContain('deckgl')
            expect(names.length).toBe(2)
        })
    })

    test.describe('getEngine', () => {
        test('returns undefined for uncreated engine', () => {
            expect(registry.getEngine('leaflet')).toBeUndefined()
        })

        test('returns the created engine instance', () => {
            registry.register('leaflet', createMockAdapterClass())
            const engine = registry.createEngine('leaflet')

            expect(registry.getEngine('leaflet')).toBe(engine)
        })
    })
})
