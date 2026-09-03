// Webpack's babel-plugin-named-asset-import routes `.svg` through @svgr, so
// every SVG exports its URL by default and a React component as
// `ReactComponent`. This declaration makes both visible to TypeScript.
declare module '*.svg' {
    import type * as React from 'react'

    export const ReactComponent: React.FC<
        React.SVGProps<SVGSVGElement> & { title?: string }
    >

    const src: string
    export default src
}
