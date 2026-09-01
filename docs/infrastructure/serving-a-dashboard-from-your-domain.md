# Serving a dashboard from your domain

A published MMGIS dashboard lives at its own CloudFront address — something like `d1abc23def.cloudfront.net`. That address is stable: republishing the dashboard updates its content but never changes where it lives. If you want the dashboard to appear at a path on your own domain instead — say `site.gov/tools/dashboard` — you point your CloudFront at ours. This page is everything your side needs to do; there is no configuration on ours.

## How it works

You add a cache behavior to your CloudFront distribution: "requests matching `/tools/dashboard*` go to `d1abc23def.cloudfront.net`." Note there's no slash before the `*` — the pattern has to match the bare path too, with no trailing slash, or a visitor who types the path without one falls through to your default behavior instead of ours, and our redirect never gets a chance to run. The same wildcard also matches any sibling path that merely starts with that string — `/tools/dashboard-archive`, for instance — so a request meant for a different route of yours would reach us instead and fail with a 403. Pick a path that isn't a prefix of any other route you serve.

CloudFront forwards the full path as the visitor typed it — it never removes the part your rule matched — so our side receives `/tools/dashboard/index.html` and has to know how much of that is your prefix. You tell us with a single header on the forwarding rule's origin configuration. Our side removes exactly that prefix and serves the file. Because the prefix travels with every request, you can rename or move the path whenever you like — change your rule and its header together, and nothing on our side needs to hear about it.

Concretely, here is what our side does with what yours forwards — using the example rule `/tools/dashboard*` and its header `X-Forwarded-Prefix: /tools/dashboard`:

| The visitor opens | `X-Forwarded-Prefix` value | What our edge does | The visitor gets |
|---|---|---|---|
| `site.gov/tools/dashboard/` | `/tools/dashboard` | strips `/tools/dashboard`, serves `/index.html` | the dashboard |
| `site.gov/tools/dashboard/js/main.js` | `/tools/dashboard` | strips `/tools/dashboard` → `/js/main.js` | the asset |
| `site.gov/tools/dashboard` *(no trailing slash)* | `/tools/dashboard` | 302 redirect to `/tools/dashboard/` | one redirect, then the dashboard |
| `site.gov/tools/dashboard?view=2` | `/tools/dashboard` | 302 to `/tools/dashboard/?view=2` | the deep link, query string intact |
| `site.gov/tools/dash board/logo.png` *(a rule whose path contains a space)* | `/tools/dash board` | the browser sends `/tools/dash%20board/logo.png`; our edge matches the encoded form of the prefix and strips it | the asset |
| `site.gov/tools/dashboard-archive` *(a sibling route the `*` catches)* | `/tools/dashboard` | the path doesn't start with `/tools/dashboard/` — passes through untouched | 403 |
| anything under the path | missing, or wrong — e.g. `/tools/dashbord` *(typo)* | ignores the header — no rewrite, no redirect | 403 on every request — loud failure, never the wrong files |
| `d1abc23def.cloudfront.net/` *(the dashboard's own address)* | *(none — no fronting CloudFront to add it)* | nothing — passes through | the dashboard, as always |

When the dashboard's password is on, every row also sits behind it: a wrong or missing password is a 401 before any of this runs.

## What your behavior must do

Configure these things on the cache behavior (and its origin) that forwards to the dashboard:

1. **Declare the prefix.** Add a custom origin header `X-Forwarded-Prefix` whose value is the path your rule matches, starting with `/` and without a trailing slash — for the example above, `/tools/dashboard`. Write the value exactly as the path appears, un-encoded — `/tools/dash board`, not `/tools/dash%20board` — and keep the path itself ASCII: letters, digits, and the common URL-safe punctuation (`-`, `_`, `.`, `~`, spaces). Non-ASCII characters in the prefix are not supported. If the header is missing or doesn't match the rule's pattern, every request under the path comes back as a 403 immediately — a loud failure, on purpose, rather than quietly serving the wrong files. (It's a 403, not a 404: our origin is a private S3 bucket behind CloudFront's Origin Access Control, and S3 answers a rejected request with AccessDenied — there are no custom error pages standing in to make it look like a 404.)
2. **Build a custom cache policy — never a managed one.** Two things have to be true of it, and no managed policy gets both right. This applies whether or not the dashboard's password is on.
   - **Put the `Authorization` header in the cache key**, not just on the wire. Dashboards are password-protected with HTTP Basic auth, and your CloudFront caches whatever our origin returns. A policy that forwards `Authorization` to us but doesn't vary the cache key on it will serve one visitor's authenticated response to the next visitor who hasn't entered a password at all — our password check runs on our distribution, once, and your edge then caches the result. Putting the header in the cache key both forwards it (satisfying the auth requirement) and partitions your cache per credential.
   - **Set Minimum TTL to 0** (a Default TTL of 0 is sensible too). The managed policies you'd otherwise reach for, CachingOptimized and friends, set a minimum TTL of at least 1 second, which overrides the response headers our origin returns regardless of what they say. The redirect that sends a slash-less entry link to its trailing-slash form is marked uncacheable for a reason — it carries the visitor's query string — so without an explicit 0, your edge caches one visitor's redirect and replays it to the next.
   - **Include all query strings in the cache key** (equivalently, forward all query strings). A policy that drops query strings never sends them to our origin, so a slash-less deep link like `/tools/dashboard?view=2` reaches our redirect stripped of its `?view=2`, and the trailing-slash URL we send the visitor to loses it for good. Keeping every query string in the cache key both forwards it and keeps distinct query strings from sharing one cached entry.
3. **Set the origin protocol policy to HTTPS-only.** The dashboard's shared Basic-auth password rides on the `Authorization` header of every request you forward to us. A "HTTP only" or "match viewer" origin setting will send that header — and the password inside it — to our origin in cleartext on any request that reaches your edge over plain HTTP. Force HTTPS to the origin so the credential is never on the wire unencrypted.
4. **Do not forward the viewer's `Host` header.** Our distribution answers only to its own `*.cloudfront.net` name; a request carrying your hostname is rejected by AWS with a 403 before any of our code runs. With no origin request policy attached at all, CloudFront already omits the viewer's `Host` header by default, so the hazard here is specifically choosing the managed `AllViewer` origin request policy, which forwards every viewer header including `Host`. If you do want an origin request policy — to forward everything else CloudFront doesn't send by default — use the managed `AllViewerExceptHostHeader` policy, which forwards the rest of the viewer's headers while still excluding `Host`.

## What you never need to coordinate

The path itself. Choose it, rename it, nest it as deep as you like — as long as the rule's pattern and its `X-Forwarded-Prefix` header agree, the dashboard follows. Links with and without a trailing slash both work; the slash-less form costs one redirect.
