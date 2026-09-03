// Plain (non-module) .css imports are side-effect only — webpack handles them at
// build time. This mirrors the scss-imports.d.ts each other plugin's lib carries.
// Under this tsconfig (strict: false) the compiler already tolerates a bare
// `import './DateSelector.css'`; the declaration states the intent and is what
// keeps such imports resolving if the compiler is tightened.
declare module '*.css'
