const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const busboy = require('busboy');
const logger = require('../../logger');
const { enabled } = require('../Utils/capabilities');
const {
    extensionForMime,
    isValidMission,
    isValidSubdir,
    IMAGE_MIME_TO_EXT,
} = require('./validate');

const MISSIONS_DIR = path.join(__dirname, '../../../Missions');
const DEFAULT_MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB

// Lean-mode S3 client for the shared admin asset bucket: created lazily on the
// first upload and injectable with setS3Client() so unit tests never touch
// real AWS. Mirrors the seam in scripts/lib/aws-provision.js.
let _s3 = null;
function getS3Client() {
    if (_s3 == null) {
        const { S3Client } = require('@aws-sdk/client-s3');
        _s3 = new S3Client({ region: process.env.AWS_REGION });
    }
    return _s3;
}
// Test seam: inject a mock S3 client ({ send }), or null to reset.
function setS3Client(client) {
    _s3 = client;
}

// Build a generic, plugin-agnostic single-file image-upload router. The caller
// supplies the target per request via the `mission` and `subdir` query params
// (both validated against path traversal). Storage depends on the deployment
// mode (validators, size cap, and response shape are identical in both):
//   full (default): the file lands at
//     Missions/<mission>/<subdir>/uploads/<uuid>.<ext> and the route responds
//     { status: 'success', path: '<subdir>/uploads/<uuid>.<ext>' }
//     (mission-relative).
//   lean: the file is written to the shared admin asset bucket
//     (MMGIS_SHARED_ASSET_BUCKET) under assets/<mission>/<subdir>/uploads/
//     <uuid>.<ext> and the route responds with the root-relative
//     { status: 'success', path: '/assets/<mission>/<subdir>/uploads/<uuid>.<ext>' }
//     — served same-origin by the admin's /assets/* CloudFront behavior and,
//     after publish copies the keys, by each dashboard's own bucket.
//
// Options (mount-level policy, not per-request):
//   allowedMimeToExt  mimetype -> extension allow-list (default: images)
//   maxFileBytes      per-file size cap (default: 5 MB)
//   routePath         router-relative path for the POST handler (default: /upload)
function createUploadRouter(options = {}) {
    const {
        allowedMimeToExt = IMAGE_MIME_TO_EXT,
        maxFileBytes = DEFAULT_MAX_FILE_BYTES,
        routePath = '/upload',
    } = options;

    const router = express.Router();

    // POST <routePath>?mission=<name>&subdir=<name>  (multipart, single file)
    router.post(routePath, function (req, res) {
        const mission = req.query.mission;
        if (!isValidMission(mission)) {
            return res
                .status(400)
                .json({ status: 'failure', message: 'Invalid or missing mission' });
        }

        const subdir = req.query.subdir;
        if (!isValidSubdir(subdir)) {
            return res
                .status(400)
                .json({ status: 'failure', message: 'Invalid or missing upload target' });
        }

        // The mission's folder may not exist yet — e.g. missions imported via
        // "Upload Config.JSON" don't materialize a Missions/<mission>/ directory
        // (only the "add mission" flow does). The mission name is already
        // validated against path traversal and this route is admin-gated, so
        // create the uploads path on demand rather than rejecting.
        const missionDir = path.join(MISSIONS_DIR, mission);

        let bb;
        try {
            bb = busboy({
                headers: req.headers,
                limits: { files: 1, fileSize: maxFileBytes },
            });
        } catch (err) {
            return res
                .status(400)
                .json({ status: 'failure', message: 'Invalid upload request' });
        }

        let responded = false;
        const fail = (code, message, err) => {
            if (err)
                logger('error', `Upload (${subdir}): ${message}`, 'Upload', req, err);
            if (responded) return;
            responded = true;
            res.status(code).json({ status: 'failure', message });
        };
        const succeed = () => {
            if (responded) return;
            responded = true;
            res.status(200).json({ status: 'success', path: savedRelPath });
        };

        let fileReceived = false;
        let savedRelPath = null;
        let destPath = null;

        bb.on('file', (name, file, info) => {
            fileReceived = true;
            const ext = extensionForMime(info && info.mimeType, allowedMimeToExt);
            if (!ext) {
                file.resume(); // drain so the request can finish
                return fail(400, 'Unsupported image type');
            }

            const filename = `${crypto.randomUUID()}.${ext}`;

            if (enabled('s3AssetUploads')) {
                // s3AssetUploads (lean): containers are ephemeral and published
                // dashboards are static, so persist to the shared admin asset
                // bucket instead of local disk. Buffer-then-put (the cap is 5 MB) so
                // an oversize upload — busboy's 'limit' — aborts without ever
                // starting a PutObject, guaranteeing no partial object.
                const bucket = process.env.MMGIS_SHARED_ASSET_BUCKET;
                if (!bucket) {
                    file.resume();
                    return fail(
                        500,
                        'Image upload is not configured',
                        new Error(
                            'MMGIS_SHARED_ASSET_BUCKET is unset (required for uploads in lean mode)'
                        )
                    );
                }
                const key = `assets/${mission}/${subdir}/uploads/${filename}`;
                let chunks = [];
                let aborted = false;
                file.on('data', (chunk) => {
                    if (!aborted) chunks.push(chunk);
                });
                file.on('limit', () => {
                    aborted = true;
                    chunks = [];
                    fail(413, 'Image exceeds size limit');
                });
                file.on('end', () => {
                    if (aborted) return;
                    const body = Buffer.concat(chunks);
                    chunks = [];
                    const { PutObjectCommand } = require('@aws-sdk/client-s3');
                    getS3Client()
                        .send(
                            new PutObjectCommand({
                                Bucket: bucket,
                                Key: key,
                                Body: body,
                                ContentLength: body.length,
                                ContentType: info.mimeType.toLowerCase(),
                            })
                        )
                        .then(() => {
                            savedRelPath = `/${key}`;
                            succeed();
                        })
                        .catch((err) =>
                            fail(500, 'Failed to save image', err)
                        );
                });
                return;
            }

            const uploadsDir = path.join(missionDir, subdir, 'uploads');
            try {
                fs.mkdirSync(uploadsDir, { recursive: true });
            } catch (err) {
                file.resume();
                return fail(500, 'Failed to create uploads directory', err);
            }

            destPath = path.join(uploadsDir, filename);
            savedRelPath = `${subdir}/uploads/${filename}`;

            const writeStream = fs.createWriteStream(destPath);
            file.pipe(writeStream);

            file.on('limit', () => {
                writeStream.destroy();
                fs.unlink(destPath, () => {});
                savedRelPath = null;
                fail(413, 'Image exceeds size limit');
            });
            writeStream.on('error', (err) => {
                fs.unlink(destPath, () => {});
                savedRelPath = null;
                fail(500, 'Failed to save image', err);
            });
            // Only report success once the bytes are flushed to disk. Responding
            // on busboy's 'close' would race the write stream — 'close' fires
            // when the file readable has been drained into the write buffer, not
            // when the file is fully written, so the client could get a path to a
            // partial or (on a late write error + unlink) already-deleted file.
            writeStream.on('finish', () => {
                if (savedRelPath) succeed();
            });
        });

        bb.on('error', (err) => fail(500, 'Upload failed', err));

        bb.on('close', () => {
            // A successful upload responds from the write stream's 'finish'. If no
            // file part ever arrived, nothing else will respond — handle that here.
            if (!fileReceived) fail(400, 'No image provided');
        });

        req.pipe(bb);
    });

    return router;
}

module.exports = { createUploadRouter, setS3Client };
