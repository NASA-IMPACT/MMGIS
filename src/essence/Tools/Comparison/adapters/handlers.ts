/**
 * Comparison change handlers — the mutations the tool triggers.
 *
 * Each drives the core swipe capability through the mmgisAPI event bus. The
 * portable lib/ never calls these; only MMGISComparisonAdapter does.
 *
 * Both sides and the layout are set together, by re-enabling with the whole
 * arrangement. Core preserves the divider across re-enables and rebuilds only
 * what actually changed, so one call that names everything is both cheaper to
 * reason about and safe to repeat — which is why the per-side and layout-only
 * capabilities core also provides have no wrapper here.
 */
import { mmgisRequest } from '../../_shared/adapters/mmgisAPI'
import type { ComparisonLayout } from '../lib/types'

/**
 * Enable comparison with a layer set per side, drawn in the given layout.
 *
 * A side without a pinned date follows the global timeline. Its date field is
 * left off the payload rather than sent as null; MapComparison.enable defaults
 * both dates to null, so the two forms are identical on the wire and this is a
 * tidier payload, not a different instruction.
 */
export const enableComparison = async ({
    leftLayers,
    rightLayers,
    leftDate = null,
    rightDate = null,
    layout,
}: {
    leftLayers: string[]
    rightLayers: string[]
    leftDate?: string | null
    rightDate?: string | null
    layout: ComparisonLayout
}): Promise<void> => {
    await mmgisRequest('map:comparison:enable', {
        leftLayers,
        rightLayers,
        ...(leftDate == null ? {} : { leftDate }),
        ...(rightDate == null ? {} : { rightDate }),
        layout,
    })
}

/** Tear down comparison and restore the normal single view. */
export const disableComparison = async (): Promise<void> => {
    await mmgisRequest('map:comparison:disable')
}
