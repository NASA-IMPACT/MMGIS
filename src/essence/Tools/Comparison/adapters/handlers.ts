/**
 * Comparison change handlers — the mutations the tool triggers.
 *
 * Each drives the core swipe capability through the mmgisAPI event bus. The
 * portable lib/ never calls these; only MMGISComparisonAdapter does.
 */
import { mmgisRequest } from '../../_shared/adapters/mmgisAPI'

/** Enable swipe comparison with one layer per side. */
export const enableComparison = async (
    leftLayerId: string,
    rightLayerId: string,
): Promise<void> => {
    await mmgisRequest('map:comparison:enable', {
        leftLayers: [leftLayerId],
        rightLayers: [rightLayerId],
    })
}

/** Replace the left side's layer while comparison is active. */
export const setLeftSide = async (layerId: string): Promise<void> => {
    await mmgisRequest('map:comparison:setLeftSide', { layers: [layerId] })
}

/** Replace the right side's layer while comparison is active. */
export const setRightSide = async (layerId: string): Promise<void> => {
    await mmgisRequest('map:comparison:setRightSide', { layers: [layerId] })
}

/** Tear down comparison and restore the normal single view. */
export const disableComparison = async (): Promise<void> => {
    await mmgisRequest('map:comparison:disable')
}
