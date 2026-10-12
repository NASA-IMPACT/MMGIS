import { LayerExtension } from '@deck.gl/core'
import { PathLayer } from '@deck.gl/layers'
import type { Layer } from '@deck.gl/core'

type HighlightLineWidthProps = { highlightLineWidth?: number }

const highlightLineWidthModule = {
    name: 'highlightLineWidth',
    vs: /* glsl */ `
layout(std140) uniform highlightLineWidthUniforms {
  float widthPixels;
} highlightLineWidth;
`,
    uniformTypes: { widthPixels: 'f32' },
} as const

// `size` is the half width, in pixels when billboarded and in common space otherwise.
// `geometry.pickingColor` is raw; the picking module normalizes it only later, in DECKGL_FILTER_COLOR.
const injectSize = /* glsl */ `
  if (
    highlightLineWidth.widthPixels > 0.0 &&
    isVertexHighlighted(picking_normalizeColor(geometry.pickingColor))
  ) {
    vec2 halfWidth = vec2(highlightLineWidth.widthPixels / 2.0);
    size = path.billboard
      ? vec3(halfWidth, 0.0)
      : vec3(project_pixel_size(halfWidth), 0.0);
  }
`

/**
 * Draws the highlighted path `highlightLineWidth` pixels wide. Applies to
 * PathLayers only; on a composite layer it reaches them as sub-layers, and
 * other primitive layers are left untouched.
 */
export default class HighlightLineWidthExtension extends LayerExtension {
    static extensionName = 'HighlightLineWidthExtension'
    static defaultProps = {
        highlightLineWidth: { type: 'number', value: 0, min: 0 },
    }

    getShaders(this: Layer) {
        if (!(this instanceof PathLayer)) return null
        return {
            modules: [highlightLineWidthModule],
            inject: { 'vs:DECKGL_FILTER_SIZE': injectSize },
        }
    }

    draw(this: Layer<HighlightLineWidthProps>) {
        if (!(this instanceof PathLayer)) return
        this.setShaderModuleProps({
            highlightLineWidth: { widthPixels: this.props.highlightLineWidth },
        })
    }
}
