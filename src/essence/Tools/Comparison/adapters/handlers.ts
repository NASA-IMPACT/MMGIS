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
 *
 * The labels are what core writes onto the map either side of the divider. A
 * side pinned to a date carries that date and the rest carry their layer's
 * title, so the map says what it is showing without the panel being read.
 */
export const enableComparison = async ({
    leftLayers,
    rightLayers,
    leftDate = null,
    rightDate = null,
    leftLabel = '',
    rightLabel = '',
    layout,
}: {
    leftLayers: string[]
    rightLayers: string[]
    leftDate?: string | null
    rightDate?: string | null
    leftLabel?: string
    rightLabel?: string
    layout: ComparisonLayout
}): Promise<void> => {
    await mmgisRequest('map:comparison:enable', {
        leftLayers,
        rightLayers,
        ...(leftDate == null ? {} : { leftDate }),
        ...(rightDate == null ? {} : { rightDate }),
        leftLabel,
        rightLabel,
        layout,
    })
}

/**
 * Rename the two sides without touching what they draw.
 *
 * A caption is chrome over the finished render, so it follows the timeline as
 * the user moves it. Re-enabling for that would re-clone both sides' layers for
 * a wording change, which is why this is its own call.
 */
export const setComparisonLabels = async ({
    left,
    right,
}: {
    left: string
    right: string
}): Promise<void> => {
    await mmgisRequest('map:comparison:setLabels', { left, right })
}

/** Tear down comparison and restore the normal single view. */
export const disableComparison = async (): Promise<void> => {
    await mmgisRequest('map:comparison:disable')
}
