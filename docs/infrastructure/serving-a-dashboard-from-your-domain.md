# Serving a dashboard from your domain

A published MMGIS dashboard lives at its own CloudFront address — something like `d1abc23def.cloudfront.net`. That address never changes: republishing updates the content, not the location. To serve the dashboard at a path on your own domain — say `site.gov/tools/dashboard` — point your CloudFront at ours. This page is everything your side needs to do. There is nothing to configure on ours.

The examples below use the path `/tools/dashboard`; substitute your own everywhere it appears.

## Setup

1. **Add the dashboard as an origin** on your distribution: origin domain is the dashboard's address, origin protocol policy **HTTPS only**, and one custom origin header — `X-Forwarded-Prefix` with the path as its value: `/tools/dashboard`. Leading slash, no trailing slash; letters, digits, `-`, `_`, `.`, `~`, and `/` only, with no `//` and no `..` segment.

2. **Create a custom cache policy** — not a managed one — with:
   - the `Authorization` header in the cache key,
   - all query strings in the cache key,
   - Minimum TTL 0,
   - Maximum TTL 31536000 (one year) or more.

3. **Add two cache behaviors** pointing at that origin, both using that cache policy:
   - path pattern `/tools/dashboard` — exact, no wildcard,
   - path pattern `/tools/dashboard/*`.

   Nothing else matches, so your other routes are untouched — even ones that start with the same text, like `/tools/dashboard-archive`. Place both behaviors above any broader pattern of yours that also matches the path (e.g. `/tools/*`) — CloudFront uses the first match in the list.

4. **Don't forward the viewer's `Host` header.** Attaching no origin request policy is fine. If you want one, use the managed `AllViewerExceptHostHeader`.

That's the whole setup. The path stays yours to change: rename it or move it whenever you like — update the two patterns and the header together, and nothing on our side needs to hear about it.

## What to expect

With the two patterns above and header `X-Forwarded-Prefix: /tools/dashboard`:

| The visitor opens | `X-Forwarded-Prefix` value | What our edge does | The visitor gets |
|---|---|---|---|
| `site.gov/tools/dashboard/` | `/tools/dashboard` | strips `/tools/dashboard`, serves `/index.html` | the dashboard |
| `site.gov/tools/dashboard/js/main.js` | `/tools/dashboard` | strips `/tools/dashboard` → `/js/main.js` | the asset |
| `site.gov/tools/dashboard` *(no trailing slash)* | `/tools/dashboard` | 302 redirect to `/tools/dashboard/` | one redirect, then the dashboard |
| `site.gov/tools/dashboard?view=2` | `/tools/dashboard` | 302 to `/tools/dashboard/?view=2` | the deep link, query string intact |
| `site.gov/tools/dashboard-archive` *(a route of yours with a similar name)* | *(never sent)* | nothing — matches neither pattern, so it never leaves your site | your own route, unaffected |
| anything under the path | **missing**, or wrong — e.g. `/tools/dashbord` *(typo)* | header invalid or matches nothing — no rewrite, no redirect | 403 on every request — loud failure, never the wrong files |
| `d1abc23def.cloudfront.net/` *(the dashboard's own address, no header)* | *(none — no fronting CloudFront to add it)* | nothing — passes through | the dashboard, as always |

Every dashboard is password-protected, so every row also sits behind the password: a wrong or missing password is a 401 before any of this runs.

## Why these settings

**Two patterns, not one:** `/tools/dashboard/*` covers everything under the path, and the exact `/tools/dashboard` covers the bare path — a visitor who types it without a trailing slash would otherwise fall through to your default behavior, and our redirect would never get a chance to run. A single wildcard pattern (`/tools/dashboard*`) could do both jobs, but it would also capture any of your own routes that start with the same text; the exact-plus-`/*` pair matches only the dashboard's path and leaves the rest of your site alone.

**The header** tells us how much of the forwarded path is yours. CloudFront forwards the full path exactly as the visitor typed it, so our side receives `/tools/dashboard/index.html` and needs to know that `/tools/dashboard` is prefix, not content. We remove exactly what the header declares and serve the file. If the header is missing or doesn't match the path, every request under the path fails with a 403 immediately — a loud failure on purpose, instead of quietly serving the wrong files. (It's a 403 rather than a 404 because the rejection comes from our storage layer, which answers "access denied.")

**`Authorization` in the cache key:** dashboards are password-protected, and your CloudFront caches whatever we return. If the header is forwarded but not part of the cache key, one visitor's authenticated page gets cached and served to the next visitor who never entered a password. In the cache key, the header is both forwarded and kept separate per credential. The password is shared by every dashboard published from the same MMGIS environment, so it is an internal credential, not something to hand to your visitors.

**All query strings in the cache key:** a policy that drops query strings never sends them to us. A deep link like `/tools/dashboard?view=2` then reaches us stripped of its `?view=2`, and the address we redirect the visitor to has lost it for good.

**Minimum TTL 0:** managed policies impose a minimum cache time that overrides what our responses ask for. Our slash-less-entry redirect must not be cached — it contains one visitor's query string — and without an explicit 0 your edge would replay that visitor's redirect to the next. A floor above 0 also holds the pages we mark for revalidation, so a republish would not reach your visitors until that floor expired.

**Maximum TTL a year:** our responses carry three cache tiers. The entry page and the mission configuration revalidate before every use (`no-cache`, not `no-store` — a republish reaches your domain with no purge on your side: the entry page and the mission configuration immediately, the supporting files within five minutes). The files whose names are content-fingerprinted — the JS, CSS and media bundles, and the images and files uploaded into the dashboard, each stored under a name that is never reused — are cacheable forever (`immutable`). Everything else, the supporting files that can change in place, gets five minutes. CloudFront has no single "obey the origin" switch: Minimum TTL 0 stops the policy raising our floor, and a Maximum TTL of at least a year stops it capping the immutable tier.

**HTTPS only to the origin:** the dashboard's password rides on the `Authorization` header of every request you forward. Over plain HTTP it would cross the internet unencrypted.

**No viewer `Host` header:** our distribution answers only to its own `*.cloudfront.net` name; a request carrying your hostname is rejected by AWS with a 403 before anything of ours runs. CloudFront omits the viewer's `Host` by default — the hazard is specifically the managed `AllViewer` origin request policy, which forwards it. `AllViewerExceptHostHeader` forwards everything else while excluding it.
