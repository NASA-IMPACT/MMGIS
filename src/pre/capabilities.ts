/**
 * capabilities.ts
 * The single place the Essence bundle asks about its build personality.
 * SERVER is 'node' in every build; the publish task sets it to 'static'
 * through index.html's mmgis-static-config block (see public/index.html
 * and scripts/lib/static-index.js). Consumers
 * use this predicate instead of comparing the string themselves. The
 * planned post-merge capability table (feature -> personality map)
 * lands here.
 */
export const isStaticBuild = (): boolean =>
    (window as any).mmgisglobal?.SERVER !== 'node'
