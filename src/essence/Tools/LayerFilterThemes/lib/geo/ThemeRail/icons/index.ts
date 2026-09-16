// The rail's own chrome. Theme icons are not bundled here — those come from
// the mission's config, either uploaded through the Configure page or named as
// a Material Design Icons glyph.
//
// The file carries a viewBox and no width/height, so the stylesheet sets its
// size (the build's SVG optimizer drops a viewBox that merely restates fixed
// dimensions, which would leave it unscalable).
export { ReactComponent as CollapsePanelIcon } from './collapse-panel.svg'
