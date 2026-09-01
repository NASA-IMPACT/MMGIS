# Serving a dashboard from your domain

A published MMGIS dashboard lives at its own CloudFront address — something like `d1abc23def.cloudfront.net`. That address never changes: republishing updates the content, not the location. To serve the dashboard at a path on your own domain — say `site.gov/tools/dashboard` — point your CloudFront at ours. This page is everything your side needs to do. There is nothing to configure on ours.

The examples below use the path `/tools/dashboard`; substitute your own everywhere it appears.

## Setup

1. **Add a cache behavior** to your distribution: path pattern `/tools/dashboard*` — no slash before the `*` — with the dashboard's address as its origin. Pick a path that isn't the start of any other route you serve.

2. **Declare the prefix.** On that behavior's origin, add a custom header `X-Forwarded-Prefix` whose value is the path from your pattern: `/tools/dashboard`. Leading slash, no trailing slash, written un-encoded (`/tools/dash board`, not `/tools/dash%20board`), ASCII only.

3. **Create a custom cache policy** for the behavior — not a managed one — with:
   - the `Authorization` header in the cache key,
   - all query strings in the cache key,
   - Minimum TTL 0.

4. **Set the origin protocol policy to HTTPS only.**

5. **Don't forward the viewer's `Host` header.** Attaching no origin request policy is fine. If you want one, use the managed `AllViewerExceptHostHeader`.

That's the whole setup. The path stays yours to change: rename it or move it whenever you like — update the pattern and the header together, and nothing on our side needs to hear about it.

## What to expect

With the rule `/tools/dashboard*` and header `X-Forwarded-Prefix: /tools/dashboard`:

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

## Why these settings

**The pattern has no slash before the `*`** so it also matches the bare path (`/tools/dashboard`, no trailing slash). Otherwise a visitor who types the path without a slash falls through to your default behavior, and our redirect never gets a chance to run. The same wildcard also catches sibling routes (`/tools/dashboard-archive`), which is why the path must not be the start of any other route you serve — a sibling's requests would come to us and 403.

**The header** tells us how much of the forwarded path is yours. CloudFront forwards the full path exactly as the visitor typed it, so our side receives `/tools/dashboard/index.html` and needs to know that `/tools/dashboard` is prefix, not content. We remove exactly what the header declares and serve the file. If the header is missing or doesn't match the pattern, every request under the path fails with a 403 immediately — a loud failure on purpose, instead of quietly serving the wrong files. (It's a 403 rather than a 404 because the rejection comes from our storage layer, which answers "access denied.")

**`Authorization` in the cache key:** dashboards are password-protected, and your CloudFront caches whatever we return. If the header is forwarded but not part of the cache key, one visitor's authenticated page gets cached and served to the next visitor who never entered a password. In the cache key, the header is both forwarded and kept separate per credential. This matters whether or not the dashboard's password is currently on.

**All query strings in the cache key:** a policy that drops query strings never sends them to us. A deep link like `/tools/dashboard?view=2` then reaches us stripped of its `?view=2`, and the address we redirect the visitor to has lost it for good.

**Minimum TTL 0:** managed policies impose a minimum cache time that overrides what our responses ask for. Our slash-less-entry redirect must not be cached — it contains one visitor's query string — and without an explicit 0 your edge would replay that visitor's redirect to the next.

**HTTPS only to the origin:** the dashboard's password rides on the `Authorization` header of every request you forward. Over plain HTTP it would cross the internet unencrypted.

**No viewer `Host` header:** our distribution answers only to its own `*.cloudfront.net` name; a request carrying your hostname is rejected by AWS with a 403 before anything of ours runs. CloudFront omits the viewer's `Host` by default — the hazard is specifically the managed `AllViewer` origin request policy, which forwards it. `AllViewerExceptHostHeader` forwards everything else while excluding it.
