import { test, expect } from 'vitest'
import { resolveMissionAssetUrl } from '../../src/pre/uploadKey.ts'
import { buildPreviewSrc } from '../../configure/src/core/upload.js'

const { cacheControlForKey } = require('../../scripts/lib/aws-provision')

// One table of stored values, run through every copy of the upload-key
// classifier: the app bundle, the Configure SPA and the publish scripts. None
// of the three can share a module with the others, so each carries its own
// regex; what they must agree on is which values are upload keys written by
// API/Backend/Upload/uploadRouter.js, not the bytes of the regex. A value one
// treats as an upload key and another as a mission-relative path renders a
// broken image only at runtime. What each consumer then does with a matched
// key differs by design and is asserted per classifier below.

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

    // The publish gives a matched key the immutable tier, because the upload
    // router names those files crypto.randomUUID() and never overwrites one.
    // The rooted row sits out: S3 object keys have no leading slash, so it is
    // not a value this classifier is ever handed.
    test.each(VALUES.filter(([value]) => !value.startsWith('/')))(
        'cacheControlForKey: %s',
        (value, key) => {
            expect(cacheControlForKey(value)).toBe(
                key !== null
                    ? 'public, max-age=31536000, immutable'
                    : 'public, max-age=300',
            )
        },
    )
})
