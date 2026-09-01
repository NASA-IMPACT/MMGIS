# Serving a dashboard from your domain

A published MMGIS dashboard lives at its own CloudFront address — something like `d1abc23def.cloudfront.net`. That address never changes: republishing updates the content, not the location. If you'd rather have the dashboard appear at a path on your own domain — say `site.gov/tools/dashboard` — you point your CloudFront at ours. This page is everything your side needs to do. There is nothing to configure on ours.

## How it works

You add one cache behavior to your CloudFront distribution:

> requests matching `/tools/dashboard*` go to `d1abc23def.cloudfront.net`

Two things to get right about that pattern:

- **No slash before the `*`.** The pattern has to match the bare path too — `/tools/dashboard`, no trailing slash. If it doesn't, a visitor who types the path without a slash falls through to your default behavior instead of ours, and our redirect never gets a chance to run.
- **Pick a path that isn't a prefix of any other route you serve.** The wildcard also matches siblings: a request for `/tools/dashboard-archive` — a different route of yours — would be sent to us and fail with a 403.

CloudFront forwards the full path exactly as the visitor typed it — it never removes the part your rule matched. So our side receives `/tools/dashboard/index.html` and has to know how much of that is your prefix. You tell us with a single header on the rule's origin configuration. We remove exactly that prefix and serve the file.

Because the prefix travels with every request, the path stays yours: rename it or move it whenever you like — change your rule and its header together, and nothing on our side needs to hear about it.

Concretely, here is what our side does with what yours forwards — using the example rule `/tools/dashboard*` and its header `X-Forwarded-Prefix: /tools/dashboard`:

| The visitor opens | `X-Forwarded-Prefix` value | What our edge does | The visitor gets |
|---|---|---|---|
| `site.gov/tools/dashboard/` | `/tools/dashboard` | strips `/tools/dashboard`, serves `/index.html` | the dashboard |
| `site.gov/tools/dashboard/js/main.js` | `/tools/dashboard` | strips `/tools/dashboard` → `/js/main.js` | the asset |
| `site.gov/tools/dashboard` *(no trailing slash)* | `/tools/dashboard` | 302 redirect to `/tools/dashboard/` | one redirect, then the dashboard |
| `site.gov/tools/dashboard?view=2` | `/tools/dashboard` | 302 to `/tools/dashboard/?view=2` | the deep link, query string intact |
| `site.gov/tools/dash board/logo.png` *(a rule whose path contains a space)* | `/tools/dash board` | the browser sends `/tools/dash%20board/logo.png`; the edge matches the encoded form of the prefix and strips it | the asset — spaces work |
| `site.gov/tools/dashboard-archive` *(a sibling route the `*` catches)* | `/tools/dashboard` | path doesn't start with `/tools/dashboard/` — passes through untouched | 403 |
| anything under the path | **missing**, or wrong — e.g. `/tools/dashbord` *(typo)* | header invalid or matches nothing — no rewrite, no redirect | 403 on every request — loud failure, never the wrong files |
| `d1abc23def.cloudfront.net/` *(the dashboard's own address, no header)* | *(none — no fronting CloudFront to add it)* | nothing — passes through | the dashboard, as always |

When the dashboard's password is on, every row also sits behind it: a wrong or missing password is a 401 before any of this runs.

## What your behavior must do

Four things, configured on the cache behavior (and its origin) that forwards to the dashboard:

**1. Declare the prefix.** Add a custom origin header `X-Forwarded-Prefix` whose value is the path your rule matches — starting with `/`, no trailing slash: `/tools/dashboard`. Write the value exactly as the path appears, un-encoded (`/tools/dash board`, not `/tools/dash%20board`), and keep the path ASCII: letters, digits, and the common URL-safe punctuation (`-`, `_`, `.`, `~`, spaces). Non-ASCII characters in the prefix are not supported.

If the header is missing or doesn't match your rule's pattern, every request under the path fails with a 403 immediately. That's deliberate — a loud failure instead of quietly serving the wrong files. (Why a 403 and not a 404: our origin is a private S3 bucket behind CloudFront's Origin Access Control, and S3 answers a rejected request with AccessDenied. There are no custom error pages dressing that up.)

**2. Build a custom cache policy — never a managed one.** Three things must be true of it, and no managed policy gets them all right. This applies whether or not the dashboard's password is on.

- **Put the `Authorization` header in the cache key** — not just on the wire. Dashboards are password-protected with HTTP Basic auth, and your CloudFront caches whatever we return. If you forward the header but don't vary the cache key on it, one visitor's authenticated response gets served to the next visitor who never entered a password: our check runs once, on our side, and your edge caches the result. In the cache key, the header is both forwarded and partitioned per credential.
- **Set Minimum TTL to 0** (a Default TTL of 0 is sensible too). The managed policies you'd otherwise reach for — CachingOptimized and friends — set a minimum of at least 1 second, which overrides whatever our responses say. Our redirect for slash-less entry links is marked uncacheable for a reason: it carries one visitor's query string. Without an explicit 0, your edge caches that visitor's redirect and replays it to the next.
- **Include all query strings in the cache key** (equivalently: forward all query strings). A policy that drops query strings never sends them to us. A deep link like `/tools/dashboard?view=2` then reaches our redirect stripped of its `?view=2`, and the address we send the visitor to has lost it for good. In the cache key, every query string is forwarded and distinct queries don't share a cached entry.

**3. Set the origin protocol policy to HTTPS-only.** The dashboard's password rides on the `Authorization` header of every request you forward to us. With an "HTTP only" or "match viewer" setting, any request that reaches your edge over plain HTTP sends that password to our origin in cleartext. Force HTTPS to the origin and the credential is never on the wire unencrypted.

**4. Don't forward the viewer's `Host` header.** Our distribution answers only to its own `*.cloudfront.net` name; a request carrying your hostname is rejected by AWS with a 403 before any of our code runs. With no origin request policy attached, CloudFront already omits the viewer's `Host` header by default — the hazard is specifically choosing the managed `AllViewer` policy, which forwards every viewer header including `Host`. If you do want an origin request policy (to forward everything else CloudFront doesn't send by default), use the managed `AllViewerExceptHostHeader` policy instead.

## What you never need to coordinate

The path itself. Choose it, rename it, nest it as deep as you like — as long as the rule's pattern and its `X-Forwarded-Prefix` header agree, the dashboard follows. Links with and without a trailing slash both work; the slash-less form costs one redirect.
