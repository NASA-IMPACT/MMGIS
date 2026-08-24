import { test, expect } from 'vitest';
import { validateModernConfig, sanitizeText } from '../../src/essence/Validators/DashboardConfigValidator.js';

test.describe('DashboardConfigValidator', () => {
    test.describe('sanitizeText', () => {
        test('removes dangerous characters', () => {
            const input = '<script>alert("hacked")\'</script>';
            const output = sanitizeText(input);
            expect(output).toBe('scriptalert(hacked)/script');
        });

        test('returns empty string for non-string inputs', () => {
            expect(sanitizeText(123)).toBe('');
            expect(sanitizeText(null)).toBe('');
            expect(sanitizeText(undefined)).toBe('');
        });

        test('handles empty input', () => {
            expect(sanitizeText('')).toBe('');
        });
    });

    test.describe('validateModernConfig', () => {
        test('fails for non-object config', () => {
            const result = validateModernConfig(null);
            expect(result.valid).toBe(false);
            expect(result.errors).toContain('Config must be an object');
        });

        test('fails if panelSettings is missing', () => {
            const result = validateModernConfig({});
            expect(result.valid).toBe(false);
            expect(result.errors).toContain('Config must have a "panelSettings" object');
        });

        test('fails if panels array is missing or empty', () => {
            const result = validateModernConfig({ panelSettings: {} });
            expect(result.valid).toBe(false);
            expect(result.errors).toContain('panelSettings must have a "panels" array');

            const result2 = validateModernConfig({ panelSettings: { panels: [] } });
            expect(result2.valid).toBe(false);
            expect(result2.errors).toContain('panelSettings must have at least one panel');
        });

        test('validates a correct minimal config', () => {
            const validConfig = {
                panelSettings: {
                    layoutStyle: 'overlay',
                    panels: [
                        {
                            id: 'panel-1',
                            position: 'left',
                            priority: 1,
                            layoutType: 'stacked',
                            stateConstraints: {
                                allowedStates: ['expanded', 'iconified'],
                                defaultState: 'expanded'
                            }
                        }
                    ]
                }
            };

            const result = validateModernConfig(validConfig);
            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        test('catches invalid layoutStyle', () => {
            const config = {
                panelSettings: {
                    layoutStyle: 'invalid_style',
                    panels: [
                        {
                            id: 'panel-1',
                            position: 'left',
                            priority: 1,
                            layoutType: 'stacked',
                            stateConstraints: {
                                allowedStates: ['expanded'],
                                defaultState: 'expanded'
                            }
                        }
                    ]
                }
            };

            const result = validateModernConfig(config);
            expect(result.valid).toBe(false);
            expect(result.errors[0]).toMatch(/panelSettings.layoutStyle must be one of/);
        });

        test('catches defaultState not in allowedStates', () => {
            const config = {
                panelSettings: {
                    panels: [
                        {
                            id: 'panel-1',
                            position: 'left',
                            priority: 1,
                            layoutType: 'stacked',
                            stateConstraints: {
                                allowedStates: ['iconified'],
                                defaultState: 'expanded'
                            }
                        }
                    ]
                }
            };

            const result = validateModernConfig(config);
            expect(result.valid).toBe(false);
            expect(result.errors).toContain('Panel[0].stateConstraints: "defaultState" must be in "allowedStates"');
        });

        test('catches duplicate panel IDs', () => {
            const config = {
                panelSettings: {
                    panels: [
                        {
                            id: 'duplicate', position: 'left', priority: 1, layoutType: 'stacked',
                            stateConstraints: { allowedStates: ['expanded'], defaultState: 'expanded' }
                        },
                        {
                            id: 'duplicate', position: 'right', priority: 2, layoutType: 'stacked',
                            stateConstraints: { allowedStates: ['expanded'], defaultState: 'expanded' }
                        }
                    ]
                }
            };

            const result = validateModernConfig(config);
            expect(result.valid).toBe(false);
            expect(result.errors).toContain('Duplicate panel ID: "duplicate"');
        });

        test.describe('panel transparency', () => {
            const withFloat = (floatPanel) => ({
                panelSettings: {
                    panels: [
                        {
                            id: 'panel-1', position: 'left', priority: 1, layoutType: 'stacked',
                            stateConstraints: { allowedStates: ['expanded'], defaultState: 'expanded' }
                        }
                    ],
                    floatingPanels: [
                        {
                            id: 'float-1', position: 'float-top-right',
                            stateConstraints: { allowedStates: ['expanded'], defaultState: 'expanded' },
                            ...floatPanel
                        }
                    ]
                }
            });

            test('accepts transparent on a floating panel', () => {
                const result = validateModernConfig(withFloat({ transparent: true }));
                expect(result.valid).toBe(true);
                expect(result.errors).toHaveLength(0);
            });

            test('accepts transparent omitted', () => {
                const result = validateModernConfig(withFloat({}));
                expect(result.valid).toBe(true);
            });

            test('rejects a non-boolean transparent', () => {
                const result = validateModernConfig(withFloat({ transparent: 'yes' }));
                expect(result.valid).toBe(false);
                expect(result.errors).toContain('FloatingPanel[0]: "transparent" must be a boolean');
            });

            test('rejects transparent on an edge panel', () => {
                const config = {
                    panelSettings: {
                        panels: [
                            {
                                id: 'panel-1', position: 'left', priority: 1, layoutType: 'stacked',
                                transparent: true,
                                stateConstraints: { allowedStates: ['expanded'], defaultState: 'expanded' }
                            }
                        ]
                    }
                };

                const result = validateModernConfig(config);
                expect(result.valid).toBe(false);
                expect(result.errors).toContain('Panel[0]: "transparent" is only supported on floating panels');
            });

            test('allows transparent false on an edge panel', () => {
                const config = {
                    panelSettings: {
                        panels: [
                            {
                                id: 'panel-1', position: 'left', priority: 1, layoutType: 'stacked',
                                transparent: false,
                                stateConstraints: { allowedStates: ['expanded'], defaultState: 'expanded' }
                            }
                        ]
                    }
                };

                expect(validateModernConfig(config).valid).toBe(true);
            });
        });

        test('validates tools array correctly', () => {
            const config = {
                panelSettings: {
                    panels: [
                        {
                            id: 'panel-1', position: 'left', priority: 1, layoutType: 'stacked',
                            stateConstraints: { allowedStates: ['expanded'], defaultState: 'expanded' }
                        }
                    ]
                },
                tools: [
                    { name: 'Tool1', icon: 'icon1', js: 'Tool1.js' },
                    { js: 'MissingName.js' }
                ]
            };

            const result = validateModernConfig(config);
            expect(result.valid).toBe(false);
            expect(result.errors).toContain('Tool[1] must have a string "name"');
        });
    });
});
