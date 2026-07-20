import { test, expect } from 'vitest'
import express from 'express'
import { createUploadRouter } from '../../../API/Backend/Upload/uploadRouter.js'

// Regression: the router must be reachable at its mount point. setup.js mounts
// it at /api/upload with routePath '/', so POST /api/upload must reach the
// handler (which returns 400 for a missing mission) rather than 404. The
// default routePath of '/upload' would push the handler to /api/upload/upload
// and 404 every real caller — the bug this test guards against.
test.describe('upload router mounting', () => {
    let server
    let base

    test.beforeAll(async () => {
        const app = express()
        app.use('/api/upload', createUploadRouter({ routePath: '/' }))
        await new Promise((resolve) => {
            server = app.listen(0, () => {
                base = `http://127.0.0.1:${server.address().port}`
                resolve()
            })
        })
    })

    test.afterAll(async () => {
        await new Promise((resolve) => server.close(resolve))
    })

    test('POST /api/upload reaches the handler (not 404)', async () => {
        // No mission query -> handler runs and rejects with 400. A 404 here
        // would mean the route is mounted at the wrong path.
        const res = await fetch(`${base}/api/upload`, { method: 'POST' })
        expect(res.status).toBe(400)
    })

    test('POST /api/upload/upload is not the handler', async () => {
        const res = await fetch(`${base}/api/upload/upload`, { method: 'POST' })
        expect(res.status).toBe(404)
    })
})
