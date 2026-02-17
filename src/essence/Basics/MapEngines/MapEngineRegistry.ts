import type { IMapEngine } from './IMapEngine'
import type { MapInitOptions } from './types/view'
import type { MapEngineAdapterClass } from './types/engine'

/**
 * Registry for map engine adapters. Tracks available engine types,
 * instantiates their adapters, and manages their lifecycle.
 */
class MapEngineRegistry {
    private adapters = new Map<string, MapEngineAdapterClass>()
    private activeEngine: IMapEngine | null = null
    private engines = new Map<string, IMapEngine>()

    /**
     * Register a new engine adapter class under the given name.
     * @throws {Error} If name is not a non-empty string or adapterClass is not a constructor.
     */
    register(name: string, adapterClass: MapEngineAdapterClass): void {
        if (typeof name !== 'string' || name.length === 0) {
            throw new Error('Engine name must be a non-empty string')
        }
        if (typeof adapterClass !== 'function') {
            throw new Error('Adapter class must be a constructor')
        }
        this.adapters.set(name, adapterClass)
    }

    /**
     * Instantiate an adapter for a registered engine name.
     * @throws {Error} If no adapter is registered under the given name.
     */
    createEngine(name: string, options?: MapInitOptions): IMapEngine {
        const AdapterClass = this.adapters.get(name)
        if (!AdapterClass) {
            throw new Error(`No adapter registered for engine "${name}"`)
        }
        const engine = new AdapterClass(options)
        this.engines.set(name, engine)
        return engine
    }

    initializeEngine(engine: IMapEngine, options: MapInitOptions): void | Promise<void> {
        return engine.init(options)
    }

    /**
     * Destroy a map engine and remove it from tracked engines.
     * Clears the active engine reference if the destroyed engine was active.
     */
    destroyEngine(engine: IMapEngine): void | Promise<void> {
        for (const [name, tracked] of this.engines) {
            if (tracked === engine) {
                this.engines.delete(name)
                break
            }
        }
        if (this.activeEngine === engine) {
            this.activeEngine = null
        }
        return engine.destroy()
    }

    getActiveEngine(): IMapEngine | null {
        return this.activeEngine
    }

    setActiveEngine(engine: IMapEngine): void {
        this.activeEngine = engine
    }

    hasEngine(name: string): boolean {
        return this.adapters.has(name)
    }

    getRegisteredEngines(): string[] {
        return Array.from(this.adapters.keys())
    }

    getEngine(name: string): IMapEngine | undefined {
        return this.engines.get(name)
    }
}

export default MapEngineRegistry

export const mapEngineRegistry = new MapEngineRegistry()
