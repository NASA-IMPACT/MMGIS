import React, { useState, useEffect, useCallback } from 'react'
import ReactDOM from 'react-dom'
import MapControl from './MapControl'

const ROOT_ID = 'mmgis-map-control-root'
const ROOT_STYLE =
    'position:absolute;inset:0;pointer-events:none;z-index:1002;'
const TOP_BAR_ID = 'topBarRight'
const MAP_SCREEN_ID = 'mapScreen'

function useTopBarOffset() {
    const [offset, setOffset] = useState(12)

    useEffect(() => {
        function measure() {
            const el = document.getElementById(TOP_BAR_ID)
            if (!el) {
                setOffset(12)
                return
            }
            const w = el.getBoundingClientRect().width
            setOffset(w > 0 ? Math.ceil(w) + 16 : 12)
        }
        measure()
        const t = setTimeout(measure, 300)
        window.addEventListener('resize', measure)
        return () => {
            clearTimeout(t)
            window.removeEventListener('resize', measure)
        }
    }, [])

    return offset
}

function ConnectedMapControl() {
    const [styles, setStyles] = useState([])
    const [active, setActive] = useState(null)
    const rightOffset = useTopBarOffset()

    useEffect(() => {
        const api = window.mmgisAPI
        if (!api) return
        Promise.all([api.getBasemapStyles(), api.getBasemap()]).then(
            ([s, a]) => {
                setStyles(s || [])
                setActive(a || (s && s[0]) || null)
            }
        )
    }, [])

    const onSelectBasemap = useCallback((entry) => {
        setActive(entry)
        const api = window.mmgisAPI
        if (api) api.setBasemap(entry.name)
    }, [])

    const onZoomIn = useCallback(() => {
        const api = window.mmgisAPI
        if (api) api.zoomIn()
    }, [])

    const onZoomOut = useCallback(() => {
        const api = window.mmgisAPI
        if (api) api.zoomOut()
    }, [])

    const subscribeToMap = useCallback(({ onClick, onMouseMove }) => {
        const api = window.mmgisAPI
        if (!api || !api.on) return () => {}
        const offClick = api.on('map:click', onClick)
        const offMove = api.on('map:mousemove', onMouseMove)
        return () => {
            if (typeof offClick === 'function') offClick()
            if (typeof offMove === 'function') offMove()
        }
    }, [])

    const drawOverlay = useCallback((opts) => {
        const api = window.mmgisAPI
        if (api) api.addOverlay(opts)
    }, [])

    const removeOverlay = useCallback((id) => {
        const api = window.mmgisAPI
        if (api) api.removeOverlay(id)
    }, [])

    const projectLatLng = useCallback((latlng) => {
        const api = window.mmgisAPI
        if (!api) return null
        return api.latLngToContainerPoint(latlng)
    }, [])

    const setMapCursor = useCallback((cursor) => {
        const screen = document.getElementById(MAP_SCREEN_ID)
        if (screen) screen.style.cursor = cursor
    }, [])

    return (
        <MapControl
            styles={styles}
            active={active}
            rightOffset={rightOffset}
            onSelectBasemap={onSelectBasemap}
            onZoomIn={onZoomIn}
            onZoomOut={onZoomOut}
            subscribeToMap={subscribeToMap}
            drawOverlay={drawOverlay}
            removeOverlay={removeOverlay}
            projectLatLng={projectLatLng}
            setMapCursor={setMapCursor}
        />
    )
}

function InterfaceWithMMGIS() {
    const mapScreen = document.getElementById(MAP_SCREEN_ID)
    if (!mapScreen) {
        this.separateFromMMGIS = () => {}
        return
    }

    const container = document.createElement('div')
    container.id = ROOT_ID
    container.style.cssText = ROOT_STYLE
    mapScreen.appendChild(container)

    ReactDOM.render(<ConnectedMapControl />, container)

    this.separateFromMMGIS = () => {
        ReactDOM.unmountComponentAtNode(container)
        container.remove()
    }
}

const MapControlTool = {
    height: 0,
    width: 0,
    MMGISInterface: null,
    make() {
        if (this.MMGISInterface) return
        this.MMGISInterface = new InterfaceWithMMGIS()
    },
    destroy() {
        if (this.MMGISInterface) this.MMGISInterface.separateFromMMGIS()
        this.MMGISInterface = null
    },
}

export default MapControlTool
