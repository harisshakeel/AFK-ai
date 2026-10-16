# The AFK.ai mark

An empty chair in profile, and at head height, where the sitter's face would be, one
amber line of the transcript. You are away from keyboard; the meeting carries on, and
what is said still lands in your notes. The amber is the product's own "now" colour (the
current transcript line).

Files, all on a transparent background:

| File | Use |
|---|---|
| `afk-mark.svg`, `afk-mark.png` (1024 px) | The mark in ink, for light backgrounds |
| `afk-mark-white.svg`, `afk-mark-white.png` (1024 px) | The mark in white, for dark or blue backgrounds |
| `afk-wordmark.png`, `afk-wordmark-white.png` | The mark beside the name, in Instrument Sans |

Rules: no container around it, at least its own stroke width of clear space on every side,
never recoloured except ink or white (the amber line stays amber), never rotated. The
source of truth is `src/components/ui/logo.tsx`; the favicon, the home-screen icon and the
social image are drawn from the same paths. Regenerate the PNGs with the render tool in
`e2e/render-svg.spec.ts` (see the commit that added them).
