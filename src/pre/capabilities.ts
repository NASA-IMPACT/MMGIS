/**
 * capabilities.ts
 * The single place the Essence bundle asks about its build personality.
 * SERVER is substituted into mmgisglobal at build time ('node' for
 * server-backed builds, 'static' for published dashboards); consumers
 * use this predicate instead of comparing the string themselves. The
 * planned post-merge capability table (feature -> personality map)
 * lands here.
 */
export const isStaticBuild = (): boolean =>
    (window as any).mmgisglobal?.SERVER !== 'node'
