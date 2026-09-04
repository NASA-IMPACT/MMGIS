import { test, expect } from 'vitest';
import {
    isDimensionSet,
    toCssDimension,
    toPixelNumber,
} from '../../src/essence/Basics/PanelManager_/dimensions.js';

test.describe('panel dimensions', () => {
    test.describe('isDimensionSet', () => {
        test('absent values are unset', () => {
            expect(isDimensionSet(undefined)).toBe(false);
            expect(isDimensionSet(null)).toBe(false);
        });

        test('an emptied Configure field reads as unset', () => {
            expect(isDimensionSet('')).toBe(false);
            expect(isDimensionSet('   ')).toBe(false);
        });

        test('a value of any kind reads as set', () => {
            expect(isDimensionSet(0)).toBe(true);
            expect(isDimensionSet(320)).toBe(true);
            expect(isDimensionSet('40vh')).toBe(true);
            expect(isDimensionSet('nonsense')).toBe(true);
        });
    });

    test.describe('toCssDimension', () => {
        test('a bare number is pixels', () => {
            expect(toCssDimension(320)).toBe('320px');
            expect(toCssDimension(62.5)).toBe('62.5px');
        });

        test('a numeric string is pixels', () => {
            expect(toCssDimension('320')).toBe('320px');
            expect(toCssDimension(' 62 ')).toBe('62px');
        });

        test('a string with a supported unit passes through', () => {
            expect(toCssDimension('40vh')).toBe('40vh');
            expect(toCssDimension('30%')).toBe('30%');
            expect(toCssDimension('20rem')).toBe('20rem');
            expect(toCssDimension('  50dvh ')).toBe('50dvh');
        });

        test('unset values yield null', () => {
            expect(toCssDimension(undefined)).toBe(null);
            expect(toCssDimension('')).toBe(null);
        });

        test('zero and negatives are not usable sizes', () => {
            expect(toCssDimension(0)).toBe(null);
            expect(toCssDimension('0')).toBe(null);
            expect(toCssDimension('0px')).toBe(null);
            expect(toCssDimension(-10)).toBe(null);
        });

        test('a unit the browser would drop is rejected', () => {
            expect(toCssDimension('40furlongs')).toBe(null);
            expect(toCssDimension('calc(100% - 10px)')).toBe(null);
            expect(toCssDimension('content')).toBe(null);
            expect(toCssDimension({ min: 1, max: 2 })).toBe(null);
            expect(toCssDimension(NaN)).toBe(null);
        });
    });

    test.describe('toPixelNumber', () => {
        test('numbers and numeric strings read back as numbers', () => {
            expect(toPixelNumber(40)).toBe(40);
            expect(toPixelNumber('40')).toBe(40);
        });

        test('a pixel string reads back as its number', () => {
            expect(toPixelNumber('40px')).toBe(40);
        });

        test('a non-pixel unit has no pixel count', () => {
            expect(toPixelNumber('40vh')).toBe(null);
            expect(toPixelNumber('40%')).toBe(null);
        });

        test('unset and unusable values yield null', () => {
            expect(toPixelNumber('')).toBe(null);
            expect(toPixelNumber(undefined)).toBe(null);
            expect(toPixelNumber('wide')).toBe(null);
            expect(toPixelNumber(-5)).toBe(null);
        });

        test('zero is usable only where a floor is meaningful', () => {
            expect(toPixelNumber(0)).toBe(null);
            expect(toPixelNumber(0, { allowZero: true })).toBe(0);
            expect(toPixelNumber('0', { allowZero: true })).toBe(0);
        });
    });
});
