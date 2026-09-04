import { test, expect } from 'vitest'
import { startServer, closeServer, get } from './__helpers__/expressServer'

// The entry redirects in API/Backend/Utils/rootPathRedirect.js. A redirect is
// read off the wire rather than followed, so the status, the Location and the
// caching directive are all observable.

const {
    rootPathRedirect,
    stripTrailingSlashRedirect,
} = require('../../API/Backend/Utils/rootPathRedirect')

// Runs one request against a fresh server and always tears it down. The
// middleware sits ahead of a handler that answers 'through', so a request
// that is not redirected is visibly distinguishable from one that is.
async function drive(middleware, path, method) {
    const { server, base } = await startServer((app) => {
        app.use(middleware)
        app.use((req, res) => res.status(200).send('through'))
    })
    try {
        return await get(base, path, method)
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

    test('a differently cased entry URL redirects to the canonical one', async () => {
        const res = await drive(rootPathRedirect('/mmgis'), '/MMGIS')
        expect(res.status).toBe(302)
        expect(res.location).toBe('/mmgis/')
    })

    test('the trailing-slash form passes through instead of redirecting to itself', async () => {
        const res = await drive(rootPathRedirect('/mmgis'), '/mmgis/')
        expect(res.status).toBe(200)
        expect(res.body).toBe('through')
    })

    test('a path under the prefix is left to the routes', async () => {
        const res = await drive(rootPathRedirect('/mmgis'), '/mmgis/anything')
        expect(res.status).toBe(200)
        expect(res.body).toBe('through')
    })

    test('a POST to the bare prefix is left to the routes', async () => {
        // A 302 asks the client to reissue the request at the new location,
        // which for a POST is a request whose body has been dropped.
        const res = await drive(rootPathRedirect('/mmgis'), '/mmgis', 'POST')
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
