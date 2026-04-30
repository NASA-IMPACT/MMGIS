// TODO: Move this file to a separate directory (e.g. closer to ToolController) when refactoring tools.

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
 * Tool metadata describing its requirements and compatibility.
 * Tools declare their needs; panels validate against capabilities.
 */
export interface ToolMetadata {
    /** Unique identifier for the tool */
    id: string;

    /** Display name */
    name: string;

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
     * Icon URL or class name for tool icon in iconified state.
     */
    icon?: string;
}
