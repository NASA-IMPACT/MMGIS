/**
 * Type definitions for Modern Interface configuration and validation.
 *
 * These types define the structure of mission configurations for the modern
 * panel-based interface mode in MMGIS.
 *
 * @module types/dashboard
 */

// Import panel types from the source of truth
import type {
    PanelConfig,
    PanelStateConstraints,
    PanelCapabilities,
    PanelDimensions,
} from '../Basics/PanelManager_/types/panel';

// Re-export them for consumers of this module
export type {
    PanelConfig,
    PanelStateConstraints,
    PanelCapabilities,
    PanelDimensions,
};

/**
 * Valid interface modes
 */
export const VALID_MODES = ['classic', 'modern'] as const;
export type InterfaceMode = typeof VALID_MODES[number];

/**
 * Valid layout styles for modern interface
 */
export const VALID_LAYOUT_STYLES = ['overlay', 'compact'] as const;
export type LayoutStyle = typeof VALID_LAYOUT_STYLES[number];

/**
 * Mission, Site, Venue configuration object
 */
export interface MSVConfig {
    /** Mission name */
    mission: string;

    /** Interface mode ('classic' | 'modern') */
    mode?: InterfaceMode;

    /** Theme identifier (e.g. 'default', 'disasters', 'earthgov') */
    theme?: string;

    /** Site name (optional) */
    site?: string;

    /** Venue name (optional) */
    venue?: string;
}

/**
 * Panel settings configuration for modern layout
 */
export interface PanelSettings {
    /** Array of panel configurations */
    panels: PanelConfig[];

    /** Floating panels rendered inside the center map area */
    floatingPanels?: PanelConfig[];

    /** Layout style ('overlay' | 'compact') */
    layoutStyle?: LayoutStyle;
}

/**
 * Tool-specific configuration
 */
export interface ToolConfig {
    /** Tool name */
    name: string;

    /** Icon identifier (Material Design Icons name) */
    icon: string;

    /** JavaScript module name for the tool */
    js: string;
}

/**
 * Complete mission configuration object
 */
export interface MissionConfig {
    /** Mission, Site, Venue configuration */
    msv: MSVConfig;

    /** Panel configuration for modern layout */
    panelSettings: PanelSettings;

    /** Tool configurations */
    tools?: ToolConfig[];

    /** Database mission name for deep linking */
    _dbMissionName?: string;

    /** Additional configuration properties */
    [key: string]: any;
}

/**
 * Validation result from configuration validation
 */
export interface ValidationResult {
    /** Whether validation passed */
    valid: boolean;

    /** Array of validation error messages */
    errors: string[];
}
