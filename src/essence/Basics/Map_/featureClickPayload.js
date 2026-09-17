export function buildFeatureClickPayload(feature, layerName, e) {
    if (feature == null) return null
    const featureCopy = { ...feature }
    if (feature.geometry !== undefined) featureCopy.geometry = feature.geometry
    if (feature.properties != null)
        featureCopy.properties = { ...feature.properties }
    return {
        feature: featureCopy,
        layerName: layerName ?? null,
        latlng: e?.latlng ? { lat: e.latlng.lat, lng: e.latlng.lng } : null,
        pixel: e?.containerPoint
            ? { x: e.containerPoint.x, y: e.containerPoint.y }
            : null,
    }
}
