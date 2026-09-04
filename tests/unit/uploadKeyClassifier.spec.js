import { test, expect } from 'vitest'
import {
    resolveMissionAssetUrl,
    ASSETS_UPLOAD_KEY as APP_KEY,
} from '../../src/pre/uploadKey.ts'
import {
    buildPreviewSrc,
    ASSETS_UPLOAD_KEY as CMS_KEY,
} from '../../configure/src/core/upload.js'

// One table of stored values, run through every copy of the upload-key
// classifier. The app bundle and the Configure SPA cannot share a module, so
// each carries its own regex; what they must agree on is which values are
// upload keys written by API/Backend/Upload/uploadRouter.js. A value one
// treats as an upload key and another as a mission-relative path renders a
// broken image only at runtime.
//
// The table proves the two copies agree on every value it lists. The
// identity check alongside it covers the rest: a spelling that drifts in some
// direction no listed value happens to separate still fails, and names the
// edit that caused it. What each consumer then does with a matched key
// differs by design, so the table carries a column of expected URLs per
// consumer.

const MISSION = 'M'
const MISSION_PATH = 'Missions/M/'
const BASE = '/mmgis/'

// [stored value, the URL the app asks for, the URL the CMS preview asks for]
// A slash-less app URL is an upload key, left for the dashboard page to
// resolve against its own root; a "Missions/M/" one is a mission-relative
// path. The CMS anchors both outcomes to its own base.
const VALUES = [
    [
        'assets/M/S/uploads/x.png',
        'assets/M/S/uploads/x.png',
        '/mmgis/assets/M/S/uploads/x.png',
    ],
    // A leading slash is stripped before the test, so this is the same key.
    [
        '/assets/M/S/uploads/x.png',
        'assets/M/S/uploads/x.png',
        '/mmgis/assets/M/S/uploads/x.png',
    ],
    [
        'assets/M/LayerFilterThemes/uploads/icon.svg',
        'assets/M/LayerFilterThemes/uploads/icon.svg',
        '/mmgis/assets/M/LayerFilterThemes/uploads/icon.svg',
    ],
    // A plugin whose own subdir is named "assets" stores this, mission-relative.
    [
        'assets/uploads/x.png',
        'Missions/M/assets/uploads/x.png',
        '/mmgis/Missions/M/assets/uploads/x.png',
    ],
    [
        'assets/M/x.png',
        'Missions/M/assets/M/x.png',
        '/mmgis/Missions/M/assets/M/x.png',
    ],
    [
        'Assets/M/S/uploads/x.png',
        'Missions/M/Assets/M/S/uploads/x.png',
        '/mmgis/Missions/M/Assets/M/S/uploads/x.png',
    ],
]

test.describe('upload-key classification', () => {
    test('the two copies of the regex are the same pattern', () => {
        expect(APP_KEY.source).toBe(CMS_KEY.source)
        expect(APP_KEY.flags).toBe(CMS_KEY.flags)
    })

    test.each(VALUES)('resolveMissionAssetUrl: %s', (value, appUrl) => {
        expect(resolveMissionAssetUrl(value, MISSION_PATH)).toBe(appUrl)
    })

    test.each(VALUES)('buildPreviewSrc: %s', (value, appUrl, cmsUrl) => {
        expect(buildPreviewSrc(value, MISSION, BASE)).toBe(cmsUrl)
    })
})
