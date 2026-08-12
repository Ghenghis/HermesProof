# Visual Asset Specification

Canonical design tokens, file rules, and quality gates for every visual asset in HermesProof. Every SVG / image / badge / web page MUST conform.

## 1. Color tokens

| Token | Hex | Role |
|---|---|---|
| `bg-deep` | `#07091c` | Outer background, hero stops, page body |
| `bg-mid` | `#0a0e27` | Cards, surfaces, secondary panels |
| `bg-elev` | `#101638` | Elevated surface, table rows |
| `border-low` | `#1f2a44` | Subtle borders, separators |
| `border-glow` | `#2a3a66` | Active state borders |
| `accent-cyan` | `#06b6d4` | Primary accent, "MCP / transport" semantics |
| `accent-violet` | `#a855f7` | Secondary accent, "claim / lock" semantics |
| `accent-magenta` | `#ec4899` | Tertiary accent, "agent / coordination" semantics |
| `proof-green` | `#22c55e` | Pass, attest, verified |
| `warn-amber` | `#f59e0b` | Warning, pending, handoff |
| `fail-red` | `#ef4444` | Fail, blocked, denied |
| `text-primary` | `#e2e8f0` | Body copy on dark |
| `text-muted` | `#94a3b8` | Secondary copy, captions |
| `text-mono` | `#cbd5e1` | Monospace text in diagrams |

These tokens are **the only allowed colors** in SVG fills, strokes, gradient stops, and `site/styles.css` accents. The Tailwind palette in `site/styles.css` MUST be derivable from this list.

## 2. Typography

- **Sans**: system-ui stack: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`
- **Mono**: `ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace`
- **No external font imports.** No Google Fonts, no `@font-face` URLs, no remote assets.
- SVGs must use `font-family="ui-monospace, monospace"` (or sans equivalent) and rely on system fallback.
- Code labels and gate IDs in diagrams MUST be monospace.

## 3. Mood

Advanced, agentic, verified, cybernetic, professional. Avoid: cute mascot art, sketchy hand-drawn lines, photographic backgrounds, gradient confetti. Prefer: clean technical lines, single-pixel strokes, glowing nodes, subtle scanlines, dashed-line flow connectors.

## 4. SVG file rules

| Rule | Required |
|---|---|
| `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 W H">` | yes |
| Self-contained — no external `href`, `xlink:href`, `<image>` to remote URLs, no `<script>` | yes |
| `role="img"` on root `<svg>` | yes |
| `<title>` (short, ≤ 60 chars) | yes |
| `<desc>` (long, full alt-text, ≤ 240 chars) | yes (Phase 1 add) |
| `aria-labelledby="t d"` referencing the title + desc IDs | yes (Phase 1 add) |
| Reduced-motion `<style>@media (prefers-reduced-motion: reduce){*{animation:none!important;animation-duration:0.001s!important}}</style>` inside `<defs>` | yes (Phase 1 add) |
| `width` / `height` MUST NOT be set on root `<svg>` (let parent control sizing) | yes |
| Single `<defs>` block at top, gradient + filter ids prefixed by file basename (e.g. `hero-grad-1`) to avoid collisions when multiple SVGs render in the same DOM | yes |
| Target file size ≤ 100 KiB; current largest is 13.4 KiB | yes |

## 5. Animation rules

See [SVG_ANIMATION_SPEC.md](SVG_ANIMATION_SPEC.md) for motion semantics. Hard rules:

- SMIL only (`<animate>`, `<animateTransform>`, `<animateMotion>`).
- No JavaScript, no SVG `<script>`, no CSS animation.
- No flashing > 3 Hz (WCAG 2.3.1).
- No essential information conveyed only through motion (WCAG 1.4.13).

## 6. Per-asset specification

| File | viewBox | Hard cap | Animations | Semantic role |
|---|---|---|---|---|
| `docs/diagrams/hero.svg` | `0 0 1200 360` | 8 KiB | wordmark glow, pulsing nodes | README + Pages hero, brand mark |
| `docs/diagrams/pipeline-flow.svg` | `0 0 1200 520` | 16 KiB | 6 staged checkmarks, flowing dashes | 6-step pipeline, README §1 |
| `docs/diagrams/truth-gates-animated.svg` | `0 0 1200 540` | 16 KiB | 9 staggered gate fires | 9-gate harness, README §2 |
| `docs/diagrams/architecture.svg` | `0 0 1200 580` | 12 KiB | client→server data lines | system architecture, README §3 |
| `docs/diagrams/multi-agent-flow.svg` | `0 0 1200 620` | 12 KiB | 3 swimlane progress | sequence diagram, README §4 |
| `docs/diagrams/lock-lifecycle.svg` | `0 0 1100 540` | 10 KiB | state-machine pulse | 4-state machine, README §4 |
| `docs/diagrams/mcp-composition.svg` | `0 0 1200 540` | 10 KiB | composition arrows | peer-server topology, README §5 |

## 7. Light-mode variants (Phase 3 optional)

For `hero`, `pipeline-flow`, `architecture`: produce `*-light.svg` palette flips (swap `bg-*` for off-white tones, keep accents). Wrap in `<picture><source media="(prefers-color-scheme: light)" srcset="...-light.svg"><img src="...">`.

## 8. Web site (`site/`)

- `site/styles.css` MUST derive its palette from §1 tokens. No new colors.
- `site/index.html` MUST NOT import remote CSS or JS. No CDN, no analytics, no fonts.
- `site/app.js` ≤ 200 lines, no external libraries, vanilla DOM only.
- Lighthouse target (manual + future CI gate): **a11y ≥ 95, perf ≥ 90, best-practices ≥ 95**.

## 9. Badges

- All shields.io badges use a flat-square style: `?style=flat-square`.
- Badge color MUST be one of the §1 tokens (use shield's hex param: `?color=a855f7`).
- Maximum 5 badges in the README hero (trim from current 6 in Phase 1).

## 10. Validation

- Every SVG must pass an XML well-formed check (`xmllint --noout` or equivalent).
- Every SVG must contain zero `<script>` tags (`grep -c '<script' = 0`).
- Every SVG must reference no remote URLs (`grep -E 'https?://' must match only `xmlns` declarations).
- Phase 1 truth-gate `mcp-scan` does NOT cover SVGs; consider a future gate `assets.svg_clean` if SVG security becomes a concern.
