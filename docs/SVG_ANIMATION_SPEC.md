# SVG Animation Specification

Defines what motion HermesProof's diagrams may use, how it must degrade, and how to author it consistently.

## 1. Permitted techniques

- `<animate attributeName="..." values="...; ..." dur="..." repeatCount="indefinite"/>`
- `<animateTransform attributeName="transform" type="translate|rotate|scale" .../>`
- `<animateMotion path="..." dur="..." repeatCount="indefinite"/>` (used sparingly)
- Animated gradient `stop-color` / `stop-opacity` for "glow" pulses
- `stroke-dasharray` + `stroke-dashoffset` animation for flowing connectors

## 2. Forbidden techniques

- JavaScript: `<script>`, `onload`, `onclick`, ECMAScript event handlers
- CSS animations / transitions inside SVGs (use SMIL only — keeps a11y media-query handling consistent)
- External resources: `<image href="...">`, `xlink:href` to URLs, `@import url(...)`
- Embedded raster (`data:image/png;base64,...`) — vector only
- `<foreignObject>` containing HTML

## 3. Motion budget

Per SVG, total simultaneously-animating elements:

| Diagram | Max concurrent | Total animation tags |
|---|---|---|
| Static (lockscreen idle) | 0 | — |
| Decorative (hero) | 8 | ≤ 16 |
| Process (pipeline, truth-gates, multi-agent, lock-lifecycle) | 12 | ≤ 24 |
| Reference (architecture, mcp-composition) | 6 | ≤ 12 |

Frame rate target: ≥ 60 fps on a 2018-era ultrabook. Animations using `transform`/`opacity` are preferred over those using `width`/`height`/`x`/`y` (which trigger reflow).

## 4. Timing taxonomy

Every animation MUST belong to one of these classes:

| Class | `dur` range | `repeatCount` | Example |
|---|---|---|---|
| `pulse` | 1.5s – 3s | `indefinite` | node glow, status dot |
| `flow` | 2s – 4s | `indefinite` | dashed line marching to next stage |
| `stage` | 0.4s – 0.8s | `1` (one-shot inside a `begin` chain) | gate firing on staggered offset |
| `sweep` | 6s – 10s | `indefinite` | scanline across diagram |
| `breath` | 3s – 5s | `indefinite` | ambient gradient drift |

`stage` animations chain via `begin="prev.end+0.2s"` to produce a sequenced reveal.

## 5. Reduced-motion compliance

Every SVG MUST contain inside `<defs>`:

```xml
<style>
  @media (prefers-reduced-motion: reduce) {
    * { animation: none !important; animation-duration: 0.001s !important; }
    animate, animateTransform, animateMotion { display: none; }
  }
</style>
```

The CSS rules disable any CSS-driven motion (defense in depth — none should exist), and the SMIL-element rule short-circuits SMIL playback. The static composition MUST remain meaningful (every readable label, color, position must still convey the same information).

This is the WCAG 2.2 AA criterion 2.3.3 + 1.4.13 line we MUST hold.

## 6. Accessibility scaffolding

```xml
<svg xmlns="http://www.w3.org/2000/svg"
     viewBox="0 0 1200 520"
     role="img"
     aria-labelledby="pipeline-title pipeline-desc">
  <title id="pipeline-title">End-to-end pipeline</title>
  <desc id="pipeline-desc">Six gates: intent, claim, work, handoff, verify, attest. Edits flow left to right; every gate emits an evidence record.</desc>
  <defs>
    <style>@media (prefers-reduced-motion: reduce){*{animation:none!important;animation-duration:0.001s!important}animate,animateTransform,animateMotion{display:none}}</style>
    <!-- gradients, filters -->
  </defs>
  <!-- artwork -->
</svg>
```

The `<title>` is the SHORT name (read by AT before everything else). The `<desc>` is the LONG narrative — write it so a screen-reader user understands the diagram without seeing it.

## 7. Color usage in animation

Pulses must respect WCAG contrast on their final/static frame. A pulse that runs `proof-green → bg-mid → proof-green` is fine because the static frame is `proof-green`. A pulse that runs `proof-green → fail-red` is **not allowed** (it implies state change without one).

## 8. Authoring conventions

- Indent at 2 spaces.
- Sort gradient stops by `offset` ascending.
- ID prefix every reusable element with file basename (e.g. `pipeline-flow-grad-cyan`) to prevent collisions when multiple SVGs render in the same DOM (GitHub Pages, README rendering, Inspector).
- Comment animation chains with one-line `<!-- stage X: gate fires -->` headers above each `<g>` group.

## 9. Validation

After every SVG edit, verify locally:

```bash
# 1. Well-formed XML
xmllint --noout docs/diagrams/<file>.svg

# 2. No script tags
! grep -q '<script' docs/diagrams/<file>.svg

# 3. No remote refs (only xmlns is allowed)
! grep -E '(href|src)\s*=\s*"https?://' docs/diagrams/<file>.svg

# 4. Reduced-motion stanza present
grep -q 'prefers-reduced-motion' docs/diagrams/<file>.svg

# 5. Accessibility scaffold present
grep -q 'aria-labelledby' docs/diagrams/<file>.svg
grep -q '<title' docs/diagrams/<file>.svg
grep -q '<desc' docs/diagrams/<file>.svg
```

A future Phase-1 truth-gate (`assets.svg_a11y`) will automate items 4 and 5.

## 10. Examples (existing)

The seven shipped SVGs in `docs/diagrams/` were authored under this spec. After Phase 1's a11y pass they will all satisfy items 4 and 5; after that, this spec becomes a new-asset gate, not a remediation list.
