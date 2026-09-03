import { test, expect } from 'vitest'
import { resolveMissionAssetUrl } from '../../src/pre/uploadKey.ts'
import { buildPreviewSrc } from '../../configure/src/core/upload.js'

const { ASSETS_UPLOAD_KEY } = require('../../API/Backend/Upload/validate')

// One table of stored values, run through every copy of the upload-key
// classifier: API/Backend/Upload/validate.js — the CommonJS home beside the
// router that writes the keys — the app bundle and the Configure SPA. Neither
// frontend bundle can import that module, so each carries its own regex; what
// they must agree on is which values are upload keys written by
// API/Backend/Upload/uploadRouter.js, not the bytes of the regex. A value one
// treats as an upload key and another as a mission-relative path renders a
// broken image only at runtime. What each consumer then does with a matched key
// differs by design and is asserted per classifier below.

const MISSION = 'M'
const MISSION_PATH = 'Missions/M/'
const BASE = '/mmgis/'

// [stored value, the upload key it carries — null when it is not one]
const VALUES = [
    ['assets/M/S/uploads/x.png', 'assets/M/S/uploads/x.png'],
    // A leading slash is stripped before the test, so this is the same key.
    ['/assets/M/S/uploads/x.png', 'assets/M/S/uploads/x.png'],
    [
        'assets/M/LayerFilterThemes/uploads/icon.svg',
        'assets/M/LayerFilterThemes/uploads/icon.svg',
    ],
    // A plugin whose own subdir is named "assets" stores this, mission-relative.
    ['assets/uploads/x.png', null],
    ['assets/M/x.png', null],
    ['Assets/M/S/uploads/x.png', null],
]

test.describe('upload-key classification', () => {
    // A matched key stays slash-less so the dashboard page resolves it
    // against its own root; anything else is a mission-relative path.
    test.each(VALUES)('resolveMissionAssetUrl: %s', (value, key) => {
        expect(resolveMissionAssetUrl(value, MISSION_PATH)).toBe(
            key === null ? MISSION_PATH + value : key,
        )
    })

    // The CMS anchors both outcomes to its own base.
    test.each(VALUES)('buildPreviewSrc: %s', (value, key) => {
        expect(buildPreviewSrc(value, MISSION, BASE)).toBe(
            key === null ? `${BASE}Missions/${MISSION}/${value}` : BASE + key,
        )
    })

    // The regex itself, which every consumer applies to the value with any
    // leading slash already stripped.
    test.each(VALUES)('ASSETS_UPLOAD_KEY: %s', (value, key) => {
        expect(ASSETS_UPLOAD_KEY.test(value.replace(/^\//, ''))).toBe(
            key !== null,
        )
    })
})
