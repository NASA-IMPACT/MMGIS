import { test, expect } from 'vitest'
import express from 'express'
import http from 'http'

// The entry redirects in scripts/lib/rootPathRedirect.js, driven over a real
// express server on an ephemeral port (the harness in
// tests/unit/uploadRouterS3.spec.js). Redirects are read off the wire rather
// than followed, so the status, the Location and the caching directive are
// all observable.

const {
    rootPathRedirect,
    stripTrailingSlashRedirect,
} = require('../../scripts/lib/rootPathRedirect')

// Mounts `middleware` ahead of a handler that answers 'through', so a request
// that is not redirected is visibly distinguishable from one that is.
function startServer(middleware) {
    const app = express()
    app.use(middleware)
    app.use((req, res) => res.status(200).send('through'))
    return new Promise((resolve) => {
        const server = app.listen(0, () => {
            resolve({
                server,
                base: `http://127.0.0.1:${server.address().port}`,
            })
        })
    })
}

function closeServer(server) {
    return new Promise((resolve) => server.close(resolve))
}

function get(base, path) {
    return new Promise((resolve, reject) => {
        const req = http.request(`${base}${path}`, { method: 'GET' }, (res) => {
            let data = ''
            res.on('data', (chunk) => (data += chunk))
            res.on('end', () =>
                resolve({
                    status: res.statusCode,
                    location: res.headers.location,
                    cacheControl: res.headers['cache-control'],
                    body: data,
                })
            )
        })
        req.on('error', reject)
        req.end()
    })
}

// Runs one request against a fresh server and always tears it down.
async function drive(middleware, path) {
    const { server, base } = await startServer(middleware)
    try {
        return await get(base, path)
    } finally {
        await closeServer(server)
    }
}

test.describe('rootPathRedirect', () => {
    test('the slash-less entry URL redirects to its trailing-slash form', async () => {
        const res = await drive(rootPathRedirect('/mmgis'), '/mmgis')
        expect(res.status).toBe(302)
        expect(res.location).toBe('/mmgis/')
        // A cache keys a redirect by path alone, so an uncached response is
        // the only thing keeping one visitor's entry query string from being
        // handed to the next.
        expect(res.cacheControl).toBe('no-store')
    })

    test('the query string rides along verbatim', async () => {
        const res = await drive(rootPathRedirect('/mmgis'), '/mmgis?a=1&b=2')
        expect(res.status).toBe(302)
        expect(res.location).toBe('/mmgis/?a=1&b=2')
    })

    test('the trailing-slash form passes through instead of redirecting to itself', async () => {
        const res = await drive(rootPathRedirect('/mmgis'), '/mmgis/')
        expect(res.status).toBe(200)
        expect(res.body).toBe('through')
    })

    test('an empty root path is a pass-through', async () => {
        const res = await drive(rootPathRedirect(''), '/')
        expect(res.status).toBe(200)
        expect(res.body).toBe('through')
    })
})

test.describe('stripTrailingSlashRedirect', () => {
    test('the trailing-slash form redirects back to the slash-less path', async () => {
        const res = await drive(
            stripTrailingSlashRedirect('/mmgis/configure'),
            '/mmgis/configure/?a=1'
        )
        expect(res.status).toBe(302)
        expect(res.location).toBe('/mmgis/configure?a=1')
        expect(res.cacheControl).toBe('no-store')
    })

    test('the slash-less path passes through instead of redirecting to itself', async () => {
        const res = await drive(
            stripTrailingSlashRedirect('/mmgis/configure'),
            '/mmgis/configure'
        )
        expect(res.status).toBe(200)
        expect(res.body).toBe('through')
    })
})
