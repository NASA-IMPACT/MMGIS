# Extensible Map Engine Architecture for MMGIS

## Executive Summary

Build a pluggable map engine architecture allowing MMGIS to use different mapping libraries (Leaflet, deck.gl, Mapbox GL) based on **mission configuration**. Engine selection happens at initialization - not runtime switching.

**Benefits**:
- User choice - missions select best engine for their needs
- Performance optimization - different engines excel at different tasks  
- Future-proofing - easy to add new engines
- Zero disruption - existing code continues working

**Key Pattern**: Adapter Pattern with unified interface

---

## Current vs Target Architecture

### Current State: Tight Leaflet Coupling

```
┌─────────────────────────────────────────────────────────┐
│                   MMGIS Application                      │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  Map_.js ──────► L.map (Leaflet instance)               │
│     │                                                    │
│     ├─► Tools (41 files) ──────► Map_.map.*            │
│     ├─► TimeControl ───────────► Map_.map.setView()    │
│     └─► Layers ─────────────────► L.tileLayer()        │
│                                                          │
│  Problem: Everything hardcoded to Leaflet               │
│  - Can't use deck.gl for better performance             │
│  - Can't use Mapbox GL for vector tiles                 │
│  - Hard to add new capabilities                         │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### Target State: Pluggable Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   MMGIS Application                      │
├─────────────────────────────────────────────────────────┤
│                                                          │
│              ┌─────────────────┐                        │
│              │  IMapEngine     │  (Interface)           │
│              │  - init()       │                        │
│              │  - setView()    │                        │
│              │  - addLayer()   │                        │
│              └────────┬────────┘                        │
│                       │                                  │
│         ┌─────────────┼─────────────┐                   │
│         ▼             ▼             ▼                   │
│    ┌────────┐   ┌────────┐   ┌────────┐                │
│    │Leaflet │   │Deck.gl │   │Mapbox  │                │
│    │Adapter │   │Adapter │   │Adapter │                │
│    └────────┘   └────────┘   └────────┘                │
│                                                          │
│  ┌──────────────────────────────────────────┐           │
│  │         Map_ (Unified Facade)            │           │
│  │  - Delegates to configured engine        │           │
│  │  - Maintains backward compatibility      │           │
│  └──────────────────────────────────────────┘           │
│                       │                                  │
│                       ▼                                  │
│              ┌────────────────┐                          │
│              │ Tools (41)     │                          │
│              │ - No changes   │                          │
│              └────────────────┘                          │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

---

## Core Components

### 1. IMapEngine Interface

**Purpose**: Contract that all map engines must implement

```typescript
interface IMapEngine {
  // === LIFECYCLE ===
  init(containerId: string, options: MapInitOptions): void
  destroy(): void
  getNativeMap(): unknown  
  
  // === VIEW CONTROL ===
  setView(lat: number, lng: number, zoom: number): void
  getCenter(): { lat: number; lng: number }
  getZoom(): number
  setZoom(zoom: number): void
  fitBounds(bounds: [[number, number], [number, number]]): void
  getBounds(): { north: number; south: number; east: number; west: number }
  
  // === COORDINATE CONVERSION ===
  latLngToContainerPoint(lat: number, lng: number): { x: number; y: number }
  containerPointToLatLng(x: number, y: number): { lat: number; lng: number }
  
  // === LAYER MANAGEMENT ===
  addTileLayer(id: string, url: string, options: TileLayerOptions): IMapLayer
  addGeoJSONLayer(id: string, geojson: GeoJSON, options: GeoJSONLayerOptions): IMapLayer
  addImageLayer(id: string, url: string, bounds: [[number, number], [number, number]]): IMapLayer
  removeLayer(id: string): void
  hasLayer(id: string): boolean
  getLayer(id: string): IMapLayer | null
  setLayerVisibility(id: string, visible: boolean): void
  setLayerOpacity(id: string, opacity: number): void
  
  // === MARKERS ===
  addMarker(id: string, lat: number, lng: number, options: MarkerOptions): IMapMarker
  removeMarker(id: string): void
  
  // === EVENTS ===
  on(event: MapEventType, callback: MapEventCallback): void
  off(event: MapEventType, callback: MapEventCallback): void
  
  // === PROJECTION (Critical for Mars/Moon) ===
  setProjection(projection: ProjectionOptions): void
  getProjection(): string
}
```

**Supporting Types**:

```typescript
interface MapInitOptions {
  center?: [number, number]
  zoom?: number
  minZoom?: number
  maxZoom?: number
  projection?: ProjectionOptions
  radius?: number 
}

interface ProjectionOptions {
  custom?: boolean
  epsg?: string
  proj?: string  
  origin?: [number, number]
  resolutions?: number[]
  bounds?: [[number, number], [number, number]]
}

interface IMapLayer {
  id: string
  getNativeLayer(): unknown
  setStyle(style: LayerStyle): void
  getData(): GeoJSON | null
  on(event: string, callback: Function): void
  off(event: string, callback: Function): void
}

type MapEventType = 'click' | 'dblclick' | 'mousemove' | 'moveend' | 'zoomend'

interface MapEvent {
  lat: number
  lng: number
  originalEvent?: Event
  containerPoint?: { x: number; y: number }
}
```

---

### 2. Engine Adapters

**Purpose**: Translate IMapEngine interface to engine-specific APIs

#### LeafletAdapter

```javascript
class LeafletAdapter implements IMapEngine {
  private map: L.Map
  private layers: Map
  
  init(containerId, options) {
    let crs = L.CRS.EPSG3857
    if (options.projection?.custom) {
      crs = new L.Proj.CRS(
        options.projection.epsg,
        options.projection.proj,
        { origin: options.projection.origin, ... }
      )
    }
    
    this.map = L.map(containerId, {
      crs: crs,
      center: options.center,
      zoom: options.zoom,
      ...
    })
  }
  
  setView(lat, lng, zoom) {
    this.map.setView([lat, lng], zoom)
  }
  
  addTileLayer(id, url, options) {
    const layer = L.tileLayer(url, options)
    layer.addTo(this.map)
    this.layers.set(id, layer)
    return new LeafletLayerWrapper(id, layer)
  }
  
  addGeoJSONLayer(id, geojson, options) {
    const layer = L.geoJSON(geojson, {
      style: this._convertStyle(options.style),
      onEachFeature: (feature, layer) => {
        if (options.onClick) {
          layer.on('click', (e) => options.onClick(feature, e))
        }
      }
    })
    layer.addTo(this.map)
    this.layers.set(id, layer)
    return new LeafletLayerWrapper(id, layer)
  }
  
  on(eventType, callback) {
    this.map.on(eventType, (e) => {
      callback({
        lat: e.latlng.lat,
        lng: e.latlng.lng,
        originalEvent: e.originalEvent
      })
    })
  }
}
```

#### DeckGLAdapter

```javascript
class DeckGLAdapter implements IMapEngine {
  private deck: Deck
  private deckLayers: Map
  private viewState: ViewState
  
  init(containerId, options) {
    this.viewState = {
      longitude: options.center[1],
      latitude: options.center[0],
      zoom: options.zoom
    }
    
    this.deck = new Deck({
      container: document.getElementById(containerId),
      initialViewState: this.viewState,
      controller: true,
      onViewStateChange: ({viewState}) => {
        this.viewState = viewState
      }
    })
  }
  
  setView(lat, lng, zoom) {
    this.viewState = { latitude: lat, longitude: lng, zoom }
    this.deck.setProps({ initialViewState: this.viewState })
  }
  
  addTileLayer(id, url, options) {
    const layer = new TileLayer({
      id: id,
      data: url,
      renderSubLayers: props => new BitmapLayer(props, {...})
    })
    this.deckLayers.set(id, layer)
    this._updateLayers()
    return new DeckLayerWrapper(id, layer)
  }
  
  addGeoJSONLayer(id, geojson, options) {
    const layer = new GeoJsonLayer({
      id: id,
      data: geojson,
      getFillColor: this._parseColor(options.style.fillColor),
      getLineColor: this._parseColor(options.style.color),
      onClick: options.onClick
    })
    this.deckLayers.set(id, layer)
    this._updateLayers()
    return new DeckLayerWrapper(id, layer)
  }
  
  _updateLayers() {
    this.deck.setProps({
      layers: Array.from(this.deckLayers.values())
    })
  }
}
```

#### MapboxAdapter

```javascript
class MapboxAdapter implements IMapEngine {
  private map: mapboxgl.Map
  private sources: Map
  
  init(containerId, options) {
    this.map = new mapboxgl.Map({
      container: containerId,
      center: [options.center[1], options.center[0]],
      zoom: options.zoom,
      style: options.style || 'mapbox://styles/mapbox/dark-v11'
    })
  }
  
  setView(lat, lng, zoom) {
    this.map.setCenter([lng, lat])
    this.map.setZoom(zoom)
  }
  
  addGeoJSONLayer(id, geojson, options) {
    this.map.addSource(id, {
      type: 'geojson',
      data: geojson
    })
    
    // Add fill layer for polygons
    this.map.addLayer({
      id: `${id}-fill`,
      type: 'fill',
      source: id,
      paint: { 'fill-color': options.style.fillColor },
      filter: ['==', '$type', 'Polygon']
    })
    
    // Add line layer
    this.map.addLayer({
      id: `${id}-line`,
      type: 'line',
      source: id,
      paint: { 'line-color': options.style.color }
    })
    
    this.sources.set(id, id)
    return new MapboxLayerWrapper(id, this.map)
  }
}
```

---

### 3. MapEngineRegistry

**Purpose**: Factory for creating and managing engine instances

```javascript
class MapEngineRegistry {
  private engines: Map
  private activeEngine: IMapEngine | null
  private activeEngineName: string
  
  constructor() {
    this.register('leaflet', LeafletAdapter)
    this.register('deckgl', DeckGLAdapter)
    this.register('mapbox', MapboxAdapter)
  }
  
  register(name: string, EngineClass: Function) {
    this.engines.set(name, EngineClass)
  }
  
  getAvailableEngines(): string[] {
    return Array.from(this.engines.keys())
  }
  
  initializeEngine(name: string, containerId: string, options: MapInitOptions): IMapEngine {
    if (this.activeEngine) {
      this.activeEngine.destroy()
    }
    
    const EngineClass = this.engines.get(name)
    if (!EngineClass) {
      throw new Error(`Unknown engine: ${name}`)
    }
    
    this.activeEngine = new EngineClass()
    this.activeEngine.init(containerId, options)
    this.activeEngineName = name
    
    return this.activeEngine
  }
  
  getActiveEngine(): IMapEngine | null {
    return this.activeEngine
  }
}

// Singleton
export const mapEngineRegistry = new MapEngineRegistry()
```

---

### 4. Map_ Facade

**Purpose**: Maintain backward compatibility while using engine abstraction

```javascript
const Map_ = {
  map: null,
  
  _engine: null,
  _engineName: 'leaflet',
  
  init(essenceFinal, config) {
    const engineName = config.look?.mapEngine || 'leaflet'
    
    const options = {
      center: [config.msv.view[0], config.msv.view[1]],
      zoom: config.msv.view[2],
      projection: config.projection,
      radius: config.msv.radius
    }
    
    this._engine = mapEngineRegistry.initializeEngine(
      engineName,
      'map',
      options
    )
    this._engineName = engineName

    this.map = this._engine.getNativeMap()
    
    this.makeLayers(config.layers)
  },
  
  resetView(latlngzoom) {
    const lat = parseFloat(latlngzoom[0])
    const lng = parseFloat(latlngzoom[1])
    const zoom = parseInt(latlngzoom[2])
    this._engine.setView(lat, lng, zoom)
  },
  
  hasLayer(layerId) {
    return this._engine.hasLayer(layerId)
  },
  
  makeLayers(layerConfigs) {
    for (const config of layerConfigs) {
      if (config.type === 'tile') {
        this._engine.addTileLayer(
          config.id,
          config.url,
          { minZoom: config.minZoom, maxZoom: config.maxZoom }
        )
      } else if (config.type === 'vector') {
        this._engine.addGeoJSONLayer(
          config.id,
          config.geojson,
          { style: config.style }
        )
      }
    }
  }
}
```

---

## Configuration

**Engine Selection**: Specify in mission configuration (database)

```json
{
  "look": {
    "mapEngine": "leaflet"
  }
}
```

**Supported Values**:
- `"leaflet"` - Default, best for general use and planetary projections
- `"deckgl"` - Best for large datasets and performance
- `"mapbox"` - Best for vector tiles and modern styling

**Engine loads at application start** - no runtime switching needed.

---

## Key Architectural Decisions

### 1. Configuration-Based Selection
**Decision**: Engine chosen at initialization from config, not runtime switching

**Rationale**:
- Simpler implementation
- No state preservation complexity
- No UI for switching needed
- Clearer for users (set and forget)

### 2. Backward Compatibility
**Decision**: Maintain `Map_.map` reference for existing code

**Rationale**:
- Zero disruption to existing tools
- Tools continue working without changes
- Gradual migration possible

### 3. Event Normalization
**Decision**: All adapters normalize events to standard format

**Rationale**:
- Tools see consistent events regardless of engine
- Easier to write engine-agnostic code
- Hides engine-specific quirks

### 4. Layer Wrapping
**Decision**: Adapters wrap native layers in IMapLayer interface

**Rationale**:
- Consistent layer API across engines
- Escape hatch via getNativeLayer() for advanced use
- Easier testing and mocking

---

## Summary

This architecture provides:

**Pluggable engines** - easy to switch via config  
**Backward compatibility** - existing code unchanged  
**Clean abstraction** - tools work with any engine  
**Maintainability** - clear separation of concerns  
**Future-proof** - new engines easily added  

The adapter pattern successfully decouples MMGIS from any specific mapping library while maintaining full backward compatibility.