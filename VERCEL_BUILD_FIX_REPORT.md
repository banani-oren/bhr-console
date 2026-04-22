# Vercel Build Fix — Report

Run date: 2026-04-22.

## Outcome

**Fix C (`.npmrc` with `legacy-peer-deps=true`) resolved the build.**
Both Fix A (upgrade `vite-plugin-pwa`) and Fix B (downgrade `vite`)
were blocked by upstream constraints. Committed as `6220fe2`; the
Vercel deployment flipped to `state=READY` on the third poll (~30 s).
PWA manifest, service worker, and `/m/hours` all serve correctly from
https://app.banani-hr.com.

## Why Fix C and not A or B

### Fix A — upgrade `vite-plugin-pwa`

```
$ npm view vite-plugin-pwa version
1.2.0
$ npm view vite-plugin-pwa peerDependencies
vite: ^3.1.0 || ^4.0.0 || ^5.0.0 || ^6.0.0 || ^7.0.0
```

The latest published `vite-plugin-pwa` is 1.2.0 and its `vite` peer
range stops at `^7`. No release supports vite 8. Upgrading is not
available.

### Fix B — downgrade `vite` to `^7`

```
$ npm view @vitejs/plugin-react peerDependencies
vite: ^8.0.0
```

`@vitejs/plugin-react` (already in the toolchain) peer-depends on vite
`^8.0.0` exclusively, so downgrading vite to 7 would cascade into the
React plugin failing its own peer check. Fix B would trade one
ERESOLVE for another.

### Fix C — `.npmrc` with `legacy-peer-deps=true`

The surgical option: one file, one line, scoped to this project. Both
local `npm install` and Vercel CI (which respects repo-level `.npmrc`)
use the legacy resolver, which accepts the mismatched
`vite-plugin-pwa` peer while keeping everything else intact. When
`vite-plugin-pwa` publishes a vite-8-compatible release, delete
`.npmrc` and reinstall — nothing in the app depends on the flag being
on.

## Local repro

Before the fix (reproduced by `rm -rf node_modules package-lock.json
&& npm install`):

```
npm error peer vite@"^3.1.0 || ^4.0.0 || ^5.0.0 || ^6.0.0 || ^7.0.0"
  from vite-plugin-pwa@1.2.0
npm error Found: vite@8.0.9
npm error   dev vite@"^8.0.4" from the root project
```

After `.npmrc` added: `npm install` completes; `npm run build` emits
`dist/sw.js` + `dist/workbox-22724681.js` + 12 precache entries.

## Vercel deployment verification

Commit SHA: `6220fe2`.
Poll loop output:

```
[1] state=BUILDING commit=6220fe2
[2] state=BUILDING commit=6220fe2
[3] state=READY    commit=6220fe2
```

Deployment URL: `bhr-console-dlsigbue4-banani-orens-projects.vercel.app`
(alias `https://app.banani-hr.com`).

## Live PWA verification

```
$ curl -sS https://app.banani-hr.com/manifest.webmanifest
{"name":"BHR Console","short_name":"BHR","description":"BHR Console — מערכת ניהול פיננסי",
 "start_url":"/","display":"standalone","background_color":"#f9f5ff",
 "theme_color":"#7c3aed","lang":"he","scope":"/","dir":"rtl",...}

$ curl -sS https://app.banani-hr.com/ | grep -iE "manifest|apple-touch-icon"
<link rel="apple-touch-icon" sizes="180x180" href="/icons/apple-touch-icon.png" />
<link rel="manifest" href="/manifest.webmanifest">
<script id="vite-plugin-pwa:register-sw" src="/registerSW.js"></script>

$ curl -sSI https://app.banani-hr.com/sw.js
HTTP/1.1 200 OK

$ curl -sSI https://app.banani-hr.com/m/hours
HTTP/1.1 200 OK
```

Manifest contains `name: "BHR Console"`, `dir: "rtl"`, `lang: "he"`,
and the three icons. `index.html` advertises both the manifest and the
apple-touch-icon. Service worker and mobile route respond 200.
Phase D's code is confirmed live.

## Harden the autonomous loop

Two files updated in a follow-up commit so the next run cannot trip
the same "I waited 90 seconds and declared success" pattern:

- `CLAUDE_CODE_AUTONOMOUS.md` §"The loop" step 2f — replaced
  `Wait 90 seconds for Vercel.` with a strict poll against
  `GET /v6/deployments?projectId=…&limit=1` every 10 s for up to
  5 min, with explicit branches for `ERROR`/`CANCELED` (fetch
  `/v3/deployments/<id>/events`, diagnose, fix, retry) and a hard
  requirement that the deployed commit SHA match the one just pushed
  before verification proceeds.
- `BHR_CONSOLE_PROJECT.md` §"Mandatory Development Workflow" Step 4 —
  same rule inline, with the concrete `curl` command and the explicit
  directive that "Waited 90 seconds" is not proof of a successful
  build and must never be accepted as done.

## Commits

| Purpose | SHA |
|---------|-----|
| Fix C — `.npmrc` legacy-peer-deps | `6220fe2` |
| Harden autonomous loop + report | (this commit) |

VERCEL BUILD FIX COMPLETE
