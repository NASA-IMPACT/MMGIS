// Cosmetic gradient swatch for a basemap row, guessed from the style name.

const BASEMAP_GRADIENTS: Record<string, string> = {
    streets: 'linear-gradient(135deg,#f0ebe0,#ddd0b8,#bca888)',
    satellite: 'linear-gradient(135deg,#0c1f2e,#163b20,#0a2e0a)',
    outdoors: 'linear-gradient(135deg,#e0f5c8,#88c458,#4a8030)',
    light: 'linear-gradient(135deg,#fff,#ebebeb,#d4d4d4)',
    dark: 'linear-gradient(135deg,#2c2c3a,#1a1a28,#0c0c18)',
    terrain: 'linear-gradient(135deg,#d4edbc,#6ab040,#3d6e28)',
    liberty: 'linear-gradient(135deg,#f5e6ca,#d4a853,#8b7355)',
    bright: 'linear-gradient(135deg,#dff0fb,#93cce8,#4a9ec4)',
    positron: 'linear-gradient(135deg,#f8f8f8,#e0e0e0,#b8b8b8)',
}
const DEFAULT_BG = 'linear-gradient(135deg,#4a90d9,#2a6db8,#1450a0)'

export function basemapGradient(name: string): string {
    const k = (name || '').toLowerCase()
    const entry = Object.entries(BASEMAP_GRADIENTS).find(([key]) => k.includes(key))
    return entry ? entry[1] : DEFAULT_BG
}
