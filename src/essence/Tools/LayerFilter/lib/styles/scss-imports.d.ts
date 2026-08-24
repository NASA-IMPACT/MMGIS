// Plain (non-module) .scss imports are side-effect only — webpack handles them
// at build time. This keeps TypeScript happy for `import './styles/index.scss'`.
declare module '*.scss'
