const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const busboy = require('busboy');
const logger = require('../../logger');
const { extensionForMime, isValidMission, IMAGE_MIME_TO_EXT } = require('./validate');

const MISSIONS_DIR = path.join(__dirname, '../../../Missions');
const DEFAULT_MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB

// Build a reusable, single-file multipart image-upload router that any plugin
// can mount under its own namespace. The saved file lands at
// Missions/<mission>/<subdir>/<uuid>.<ext> and the route responds with
// { status: 'success', path: '<subdir>/<uuid>.<ext>' } (mission-relative).
//
// Options:
//   subdir            (required) folder under Missions/<mission> to write into
//   allowedMimeToExt  mimetype -> extension allow-list (default: images)
//   maxFileBytes      per-file size cap (default: 5 MB)
//   routePath         router-relative path for the POST handler (default: /upload)
function createUploadRouter(options = {}) {
    const {
        subdir,
        allowedMimeToExt = IMAGE_MIME_TO_EXT,
        maxFileBytes = DEFAULT_MAX_FILE_BYTES,
        routePath = '/upload',
    } = options;

    if (!subdir) throw new Error('createUploadRouter: "subdir" is required');

    const router = express.Router();

    // POST <routePath>?mission=<name>  (multipart, single file)
    router.post(routePath, function (req, res) {
        const mission = req.query.mission;
        if (!isValidMission(mission)) {
            return res
                .status(400)
                .json({ status: 'failure', message: 'Invalid or missing mission' });
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

            const uploadsDir = path.join(missionDir, subdir, 'uploads');
            try {
                fs.mkdirSync(uploadsDir, { recursive: true });
            } catch (err) {
                file.resume();
                return fail(500, 'Failed to create uploads directory', err);
            }

            const filename = `${crypto.randomUUID()}.${ext}`;
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

module.exports = { createUploadRouter };
