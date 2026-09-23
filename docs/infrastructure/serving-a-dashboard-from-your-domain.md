# Serving a dashboard from your domain

A published MMGIS dashboard lives at its own CloudFront address — something like `d1abc23def.cloudfront.net`. That address never changes: republishing updates the content, not the location. To serve the dashboard at a path on your own domain — say `site.gov/tools/dashboard` — point your CloudFront at ours. This page is everything your side needs to do. There is nothing to configure on ours.

The examples below use the path `/tools/dashboard`; substitute your own everywhere it appears.

Whether the dashboard prompts your visitors for a password depends on the environment it was published from: some gate every dashboard behind one shared password, some publish them open. The operator who published it can tell you, and so can the dashboard — send it a request with no credentials, and a gated one answers `401` with a `WWW-Authenticate: Basic` header while an open one serves the page. A few of the settings below exist only for the gated case, and they say so.

## Setup

1. **Add the dashboard as an origin** on your distribution: origin domain is the dashboard's address, origin protocol policy **HTTPS only**, and one custom origin header — `X-Forwarded-Prefix` with the path as its value: `/tools/dashboard`. Leading slash, no trailing slash; letters, digits, `-`, `_`, `.`, `~`, and `/` only.

2. **Create a custom cache policy** — not a managed one — with:
   - all query strings in the cache key,
   - Minimum TTL 0,
   - Maximum TTL 31536000 (one year) or more,
   - the `Authorization` header in the cache key,
   - and nothing else: no other headers, no cookies — CloudFront forwards whatever the key contains, and a forwarded `Host` is a 403.

   Include `Authorization` whether or not the dashboard is gated today — the origin request policy in step 4 forwards it to us either way, so if the gate is ever switched on, a key without it would cache one visitor's authenticated page and serve it to everyone after. An open dashboard's visitors send no `Authorization` header, so keying on it there splits nothing and costs nothing.

3. **Add two cache behaviors** pointing at that origin, both using that cache policy:
   - path pattern `/tools/dashboard` — exact, no wildcard,
   - path pattern `/tools/dashboard/*`.

   Nothing else matches, so your other routes are untouched — even ones that start with the same text, like `/tools/dashboard-archive`. Place both behaviors above any broader pattern of yours that also matches the path (e.g. `/tools/*`) — CloudFront uses the first match in the list.

4. **Attach the managed `AllViewerExceptHostHeader` origin request policy.** It forwards everything the viewer sent except the viewer's `Host` header, which our distribution rejects.

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

If the dashboard is password-gated, every row above that reaches us also sits behind the password: a wrong or missing one is a 401 before any of this runs — except a prefetch or a click handled by your site's client-side router, which gets a plain 403 (see below). The two 403s are easy to tell apart: the prefix failure is our storage layer's, and its body is S3's XML `AccessDenied`, while the prefetch refusal is ours and has no body at all, just a `cache-control: no-store` header.

## Why these settings

**Two patterns, not one:** `/tools/dashboard/*` covers everything under the path, and the exact `/tools/dashboard` covers the bare path — a visitor who types it without a trailing slash would otherwise fall through to your default behavior, and our redirect would never get a chance to run. A single wildcard pattern (`/tools/dashboard*`) could do both jobs, but it would also capture any of your own routes that start with the same text; the exact-plus-`/*` pair matches only the dashboard's path and leaves the rest of your site alone.

**The header** tells us how much of the forwarded path is yours. CloudFront forwards the full path exactly as the visitor typed it, so our side receives `/tools/dashboard/index.html` and needs to know that `/tools/dashboard` is prefix, not content. We remove exactly what the header declares and serve the file. If the header is missing or doesn't match the path, every request under the path fails with a 403 immediately — a loud failure on purpose, instead of quietly serving the wrong files. (It's a 403 rather than a 404 because the rejection comes from our storage layer, which answers "access denied.")

**All query strings in the cache key:** a policy that drops query strings never sends them to us. A deep link like `/tools/dashboard?view=2` then reaches us stripped of its `?view=2`, and the address we redirect the visitor to has lost it for good.

**Minimum TTL 0:** a policy's minimum cache time overrides what our responses ask for, and the policies you are likely to start from set one above 0. Our slash-less-entry redirect must not be cached — it contains one visitor's query string — and without an explicit 0 your edge would replay that visitor's redirect to the next. A floor above 0 also holds the pages we mark for revalidation, so a republish would not reach your visitors until that floor expired.

**Maximum TTL a year:** our responses carry three cache tiers. The entry page and the mission configuration revalidate before every use (`no-cache`, not `no-store` — there is nothing for you to purge). The files whose names are content-fingerprinted — the application's own bundles, and the images and files uploaded into the dashboard, each stored under a name that is never reused — are cacheable forever (`immutable`). Everything else, the supporting files that can change in place, gets five minutes. So a republish reaches your visitors in stages: the entry page and the configuration immediately, the supporting files within about five minutes, plus however long our own invalidation takes to propagate. AWS's managed `UseOriginCacheControlHeaders` policies pair Minimum TTL 0 with a one-year maximum, but they put `Host` and every cookie in the cache key, so a custom policy is still required: Minimum TTL 0 stops the policy raising our floor, and a Maximum TTL of at least a year stops it capping the immutable tier.

**HTTPS only to the origin:** a gated dashboard's password rides on the `Authorization` header of every request you forward, and over plain HTTP it would cross the internet unencrypted. Gated or not, the dashboard is served over HTTPS and there is no reason to ask for less.

**No viewer `Host` header:** our distribution answers only to its own `*.cloudfront.net` name; a request carrying your hostname is rejected by AWS with a 403 before anything of ours runs. The hazard is specifically the managed `AllViewer` origin request policy, which forwards it — `AllViewerExceptHostHeader` is the same policy with that one header left out, which is why it is the one to attach. The cache policy is the other way in: CloudFront forwards every header and cookie its cache key contains, so a policy that keys on `Host` sends it just as surely as an origin request policy would. Keep the key to query strings and `Authorization`, and nothing else.

### If the dashboard is password-gated

**`Authorization` in the cache key:** your CloudFront caches whatever we return. If the header is forwarded but not part of the cache key, one visitor's authenticated page gets cached and served to the next visitor who never entered a password. In the cache key, the header is both forwarded and kept separate per credential. The `AllViewerExceptHostHeader` policy from step 4 forwards the header whether or not the key contains it, which is why the cache-key entry is required even for a dashboard that is open today.

**Prefetched links don't prompt:** if your site preloads the links in its navigation — a request carrying a `Next-Router-Prefetch`, `RSC`, `Sec-Purpose` or `Purpose` header — a gated dashboard answers those with a plain `403` instead of the password challenge, so the login box never appears over an unrelated page of your site. The same goes for a click your site's own client-side router handles — Next.js sends `RSC` on those too — so it gets the `403`, the router falls back to a full page load of the dashboard, and the password box appears there, on the dashboard's own page. This is why the `AllViewerExceptHostHeader` origin request policy is required rather than optional: a cache policy alone forwards only the headers its key contains, so without it those prefetch headers never reach us and the prompt comes back.

**After the password is rotated:** invalidate your distribution. Your cache is keyed on the `Authorization` header, so the responses fetched under the old password sit in it and keep being served to anyone still presenting that password — never reaching us to be turned away — until they expire on their own, which for the immutable tier is a year. An invalidation clears them at once.
