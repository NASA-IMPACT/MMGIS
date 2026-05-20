// Plain (non-module) .scss imports are side-effect only — webpack handles them at
// build time. This declaration keeps the TypeScript compiler happy for bare imports
// like `import './styles/index.scss'` in the lib/index.ts barrel.
declare module '*.scss'
