import { PanelPosition } from '../../PanelManager_/types/layout';

/**
 * Tool orientation requirements.
 * Determines which panels a tool can be added to.
 */
export const TOOL_ORIENTATION = {
    HORIZONTAL: 'horizontal',
    VERTICAL: 'vertical',
    ANY: 'any',
} as const
export type ToolOrientation = (typeof TOOL_ORIENTATION)[keyof typeof TOOL_ORIENTATION]

/**
 * Tool metadata describing its requirements, compatibility, and UI behavior.
 * Tools declare their needs; panels validate against capabilities.
 *
 * This is the nested "metadata" object within config.json files.
 * Layout and UI-related properties should be defined here.
 */
export interface ToolMetadata {
    /** Unique identifier for the tool */
    id: string;

    /** Display name */
    name: string;

    /**
     * Icon identifier (MDI icon name without 'mdi-' prefix) for tool icon.
     * Example: 'clock-outline', 'layers', 'pencil'
     */
    icon?: string;

    /**
     * Required orientation for this tool.
     * - 'horizontal': Can only go in top/bottom panels
     * - 'vertical': Can only go in left/right panels
     * - 'any': Can go in any panel
     */
    requiredOrientation?: ToolOrientation;

    /**
     * Specific positions this tool is compatible with.
     * If undefined, tool can go in any position (subject to orientation).
     * Example: ['left', 'right'] means tool can only go in side panels.
     */
    compatiblePositions?: PanelPosition[];

    /**
     * Preferred position for the tool.
     * Suggests where the tool should ideally be placed.
     * Must be one of the compatible positions if compatiblePositions is defined.
     */
    preferredPosition?: PanelPosition;

    /**
     * Indicates if the tool supports the modern layout system.
     * Tools with this flag can be placed in modern layout panels.
     */
    modernLayoutSupport?: boolean;
}
