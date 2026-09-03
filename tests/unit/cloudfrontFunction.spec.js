import { test, expect } from 'vitest'

// Runtime behavior of the dashboard's password-gate CloudFront Function, as
// rendered from infrastructure/cloudfront-function.js by the generator in
// scripts/lib/cfn-template.js. The rendered code is evaluated here and driven
// with viewer-request events: the Basic-auth gate, the X-Forwarded-Prefix
// stripping and entry redirect, and the ES5-only/size limits the
// cloudfront-js-1.0 runtime imposes.

test.describe('dashboard CloudFront Function behavior', () => {
    const {
        renderAuthFunctionCode,
        BASIC_AUTH_USER,
    } = require('../../scripts/lib/cfn-template')
    const code = renderAuthFunctionCode('pw-for-tests')
    const handler = new Function(`${code}; return handler;`)()
    const AUTH =
        'Basic ' +
        Buffer.from(`${BASIC_AUTH_USER}:pw-for-tests`).toString('base64')

    function makeEvent(uri, opts) {
        opts = opts || {}
        const headers = {}
        // opts.auth === null means "omit the header entirely"; undefined
        // means "use the valid default"; any other value (including '') is
        // sent verbatim so empty-string headers can be exercised directly.
        if (opts.auth !== null)
            headers.authorization = {
                value: opts.auth != null ? opts.auth : AUTH,
            }
        if (opts.prefix != null) headers['x-forwarded-prefix'] = { value: opts.prefix }
        return {
            request: {
                method: 'GET',
                uri,
                querystring: opts.querystring || {},
                headers,
            },
        }
    }

    test('the rendered function stays under the cloudfront-js-1.0 10KB limit', () => {
        // cloudfront-js-1.0 caps a viewer-request function's code at 10 KB;
        // exceeding it fails the CreateFunction call at deploy time, not here.
        // The cap is on bytes, and the source carries non-ASCII characters.
        expect(Buffer.byteLength(code)).toBeLessThan(10240)
    })

    test('with no declared prefix, requests pass through unchanged', () => {
        expect(handler(makeEvent('/build/static/js/main.abc.js')).uri).toBe(
            '/build/static/js/main.abc.js'
        )
        // The root request earns its own assertion: a bare '/' must NOT be
        // rewritten to /index.html when no prefix is declared — the
        // distribution's default root object handles it.
        expect(handler(makeEvent('/')).uri).toBe('/')
    })

    test('valid prefix strips from an asset URI', () => {
        const result = handler(
            makeEvent('/d/v/build/x.js', { prefix: '/d/v' })
        )
        expect(result.uri).toBe('/build/x.js')
    })

    test('entry with trailing slash rewrites to index.html', () => {
        const result = handler(makeEvent('/d/v/', { prefix: '/d/v' }))
        expect(result.uri).toBe('/index.html')
    })

    test('entry without trailing slash redirects', () => {
        const result = handler(makeEvent('/d/v', { prefix: '/d/v' }))
        expect(result.statusCode).toBe(302)
        expect(result.statusDescription).toBe('Found')
        expect(result.headers.location.value).toBe('/d/v/')
        // A fronting edge caches redirects under a query-less key, so an
        // uncached response is the only way to keep one visitor's entry
        // query string from being served to the next.
        expect(result.headers['cache-control'].value).toBe('no-store')
    })

    test('query string is preserved on the redirect', () => {
        const result = handler(
            makeEvent('/d/v', {
                prefix: '/d/v',
                querystring: {
                    a: { value: '1' },
                    b: {
                        value: '2',
                        multiValue: [{ value: '2' }, { value: '3' }],
                    },
                },
            })
        )
        expect(result.headers.location.value).toBe('/d/v/?a=1&b=2&b=3')
    })

    test('valueless query params round-trip without gaining =', () => {
        const result = handler(
            makeEvent('/d/v', {
                prefix: '/d/v',
                querystring: { debug: { value: '' } },
            })
        )
        expect(result.headers.location.value).toBe('/d/v/?debug')
    })

    // The rebuild concatenates keys and values into the Location raw, so a
    // pair that arrived decoded rather than percent-encoded is escaped back
    // into wire form — it keeps its data instead of breaking the URL apart
    // and instead of being dropped.
    test('a value carrying a raw & or # is escaped, not dropped', () => {
        const result = handler(
            makeEvent('/d/v', {
                prefix: '/d/v',
                querystring: {
                    a: { value: '1' },
                    evil: { value: 'x&injected=1' },
                    frag: { value: 'y#nope' },
                    b: { value: '2' },
                },
            })
        )
        // The '=' inside evil's value is safe in a value position and stays
        // literal; only the '&' and '#' — the characters that would forge a
        // param break or a fragment — are escaped.
        expect(result.headers.location.value).toBe(
            '/d/v/?a=1&evil=x%26injected=1&frag=y%23nope&b=2'
        )
    })

    // Escaping is per value, not per key: the one unsafe value in a
    // multiValue list is escaped in place, and that key's other values are
    // untouched.
    test('an unsafe value in a multiValue param is escaped in place', () => {
        const result = handler(
            makeEvent('/d/v', {
                prefix: '/d/v',
                querystring: {
                    a: { value: '1' },
                    b: {
                        value: '2',
                        multiValue: [
                            { value: '2' },
                            { value: 'x&injected=1' },
                            { value: '4' },
                        ],
                    },
                },
            })
        )
        expect(result.headers.location.value).toBe(
            '/d/v/?a=1&b=2&b=x%26injected=1&b=4'
        )
    })

    test('a key carrying a raw # is escaped', () => {
        const result = handler(
            makeEvent('/d/v', {
                prefix: '/d/v',
                querystring: { 'a#b': { value: '1' }, ok: { value: '2' } },
            })
        )
        expect(result.headers.location.value).toBe('/d/v/?a%23b=1&ok=2')
    })

    // '=' is the one character safe inside a value but not inside a key: left
    // raw in a key it would forge the pair's separator.
    test('a key carrying a raw = is escaped', () => {
        const result = handler(
            makeEvent('/d/v', {
                prefix: '/d/v',
                querystring: { 'a=b': { value: '1' } },
            })
        )
        expect(result.headers.location.value).toBe('/d/v/?a%3Db=1')
    })

    // A lone surrogate has no UTF-8 encoding, so encodeURIComponent throws on
    // it. A throw inside a CloudFront Function fails the request outright, so
    // that pair is dropped and the redirect is still issued.
    test('a value that cannot be encoded is dropped, not thrown on', () => {
        const result = handler(
            makeEvent('/d/v', {
                prefix: '/d/v',
                querystring: {
                    a: { value: '1' },
                    bad: { value: 'x\uD800y' },
                    b: { value: '2' },
                },
            })
        )
        expect(result.statusCode).toBe(302)
        expect(result.headers.location.value).toBe('/d/v/?a=1&b=2')
    })

    // Pins the wire-form delivery the rebuild relies on for percent-ambiguity
    // ('%' is left alone so encoded values survive): if the runtime ever
    // started handing values over decoded, these fail loudly rather than
    // letting %26/%3D be silently mangled into a param break or an '='.
    test('percent-encoded values pass through byte-identical', () => {
        const result = handler(
            makeEvent('/d/v', {
                prefix: '/d/v',
                querystring: {
                    q: { value: 'a%20b' },
                    t: { value: 'a%26b%23c' },
                    e: { value: 'k%3Dv' },
                },
            })
        )
        expect(result.headers.location.value).toBe(
            '/d/v/?q=a%20b&t=a%26b%23c&e=k%3Dv'
        )
    })

    test('trailing slash on the declared prefix is normalized', () => {
        const result = handler(
            makeEvent('/d/v/x.png', { prefix: '/d/v/' })
        )
        expect(result.uri).toBe('/x.png')
    })

    test('malformed prefix: a "/../" path segment is ignored', () => {
        // The request URI begins with the declared prefix so the assertion
        // can actually fail: drop the traversal clause and this strips to
        // '/x'. Pairing it with an unrelated URI would pass either way.
        const result = handler(
            makeEvent('/d/../v/x', { prefix: '/d/../v' })
        )
        expect(result.uri).toBe('/d/../v/x')
    })

    test('prefix containing consecutive dots but no path-traversal segment is accepted', () => {
        const result = handler(
            makeEvent('/v1..2/build/x.js', { prefix: '/v1..2' })
        )
        expect(result.uri).toBe('/build/x.js')
    })

    // Each shape trips a different clause of the header validation, and a
    // prefix that fails any clause is ignored outright — the request URI
    // passes through untouched rather than being stripped against a
    // half-trusted value. The "//", ":" and "\" cases are the
    // anti-open-redirect clauses.
    //
    // As in the "/../" test above, every request URI here begins with its
    // declared prefix, so a prefix accepted when it should be rejected
    // visibly shortens the URI and the assertion fails.
    // [what is wrong with it, declared prefix, request URI]
    const MALFORMED_PREFIXES = [
        ['bare slash', '/', '//x'],
        ['an embedded "//"', '//evil.example.com', '//evil.example.com/x'],
        ['an embedded ":"', '/a:b', '/a:b/x'],
        ['an embedded "\\"', '/\\evil.com', '/\\evil.com/x'],
    ]

    test('a malformed declared prefix is ignored', () => {
        for (const [flaw, prefix, uri] of MALFORMED_PREFIXES) {
            expect(
                handler(makeEvent(uri, { prefix })).uri,
                `prefix with ${flaw} is ignored`
            ).toBe(uri)
        }
    })

    test('a lone surrogate in the declared prefix is treated as absent, not a crash', () => {
        const result = handler(
            makeEvent('/x', { prefix: '/\uD800' })
        )
        expect(result.uri).toBe('/x')
        expect(result.statusCode).toBeUndefined()
    })

    test('percent-encoded request URI strips against a raw-declared prefix', () => {
        const result = handler(
            makeEvent('/my%20path/build/x.js', { prefix: '/my path' })
        )
        expect(result.uri).toBe('/build/x.js')
    })

    test('percent-encoded entry request against a raw-declared prefix redirects', () => {
        const result = handler(
            makeEvent('/my%20path', { prefix: '/my path' })
        )
        expect(result.statusCode).toBe(302)
        expect(result.headers.location.value).toBe('/my%20path/')
    })

    // Strictly stronger than a URI sharing no prefix at all: '/d/vx/y' also
    // catches the match losing its trailing "/" (indexOf(prefix) === 0),
    // which a wholly unrelated URI would not.
    test('boundary: a longer sibling path does not match the prefix', () => {
        const result = handler(
            makeEvent('/d/vx/y', { prefix: '/d/v' })
        )
        expect(result.uri).toBe('/d/vx/y')
    })

    test('auth failure beats prefix handling', () => {
        const result = handler(
            makeEvent('/d/v', { prefix: '/d/v', auth: 'Basic wrong' })
        )
        expect(result.statusCode).toBe(401)
        expect(result.headers.location).toBeUndefined()
        // Without the challenge header a browser never offers the password
        // prompt, so the visitor sees a bare 401 with no way in.
        expect(result.headers['www-authenticate'].value).toContain(
            'Basic realm='
        )
    })

    test('a missing or empty authorization header is unauthorized', () => {
        expect(handler(makeEvent('/x', { auth: null })).statusCode).toBe(401)
        expect(handler(makeEvent('/x', { auth: '' })).statusCode).toBe(401)
    })

    test('generated function body is ES5 only', () => {
        // A real parse rather than a keyword-blocklist regex: it also
        // catches ES6+ shapes a regex would miss (classes, for-of/for-const,
        // spread, shorthand methods) and needs no upkeep as the source grows.
        const espree = require('espree')
        expect(() => espree.parse(code, { ecmaVersion: 5 })).not.toThrow()
    })
})
