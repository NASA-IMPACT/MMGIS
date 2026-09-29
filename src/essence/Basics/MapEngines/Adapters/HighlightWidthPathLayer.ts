import { _mergeShaders as mergeShaders } from '@deck.gl/core'
import { PathLayer } from '@deck.gl/layers'
import type { PathLayerProps } from '@deck.gl/layers'
import type { DefaultProps } from '@deck.gl/core'

type HighlightWidthProps = { highlightLineWidth: number }

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
const injectSize = /* glsl */ `
  if (highlightLineWidth.widthPixels > 0.0 && isVertexHighlighted(geometry.pickingColor)) {
    vec2 halfWidth = vec2(highlightLineWidth.widthPixels / 2.0);
    size = path.billboard
      ? vec3(halfWidth, 0.0)
      : vec3(project_pixel_size(halfWidth), 0.0);
  }
`

/**
 * A PathLayer that draws the highlighted path `highlightLineWidth` pixels wide.
 *
 * A subclass rather than a LayerExtension: it is swapped in through
 * `_subLayerProps`, where setting `extensions` would drop the ClipExtension
 * MVTLayer adds to each tile.
 */
export default class HighlightWidthPathLayer<DataT = unknown> extends PathLayer<
    DataT,
    HighlightWidthProps
> {
    static layerName = 'HighlightWidthPathLayer'
    static defaultProps: DefaultProps<PathLayerProps & HighlightWidthProps> = {
        highlightLineWidth: { type: 'number', value: 0, min: 0 },
    }

    getShaders() {
        return mergeShaders(super.getShaders(), {
            modules: [highlightLineWidthModule],
            inject: { 'vs:DECKGL_FILTER_SIZE': injectSize },
        })
    }

    draw(opts: Parameters<PathLayer['draw']>[0]) {
        this.setShaderModuleProps({
            highlightLineWidth: { widthPixels: this.props.highlightLineWidth },
        })
        super.draw(opts)
    }
}
