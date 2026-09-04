import express from 'express'
import http from 'http'

// A real express server on an ephemeral port, for specs whose subject is what
// goes over the wire: status codes, redirect Locations and caching headers
// are read off the response rather than inferred from a mocked req/res pair,
// and the port is picked by the OS so parallel workers never collide.

// Builds an app, hands it to `mount` to wire up whatever is under test, and
// resolves once it is listening.
export function startServer(mount) {
    const app = express()
    mount(app)
    return new Promise((resolve) => {
        const server = app.listen(0, () => {
            resolve({
                server,
                base: `http://127.0.0.1:${server.address().port}`,
            })
        })
    })
}

export function closeServer(server) {
    return new Promise((resolve) => server.close(resolve))
}

// Reports the response instead of following it, so a redirect's status,
// Location and caching directive all stay observable.
export function get(base, path, method = 'GET') {
    return new Promise((resolve, reject) => {
        const req = http.request(`${base}${path}`, { method }, (res) => {
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
