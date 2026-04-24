export function formatDistance(m) {
    if (m < 1000) {
        const ft = m * 3.28084
        return `${ft.toFixed(0)} ft (${m.toFixed(1)} m)`
    }
    const mi = m * 0.000621371
    const km = m / 1000
    return `${mi.toFixed(2)} mi (${km.toFixed(2)} km)`
}
