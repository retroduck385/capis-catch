# CATCH front end: design and animation guide

How the signed-in screens look and move, and where each piece lives. It covers the shared frame (top bar,
background) and the staff work tray (`/adminHomePage`), which is the most finished screen. Other pages inherit
the frame but still use their older styles.

When you change a colour, size or timing, change it here too.

---

## 1. Principles

- **Blue and white carry the page; orange is a hint.** Orange marks the brand, things waiting on you
  (Unassigned, "Your turn to review", "Assign me") and Clear filters. It is never used for status.
- **Green, amber and red mean turnaround time and nothing else.** They are on track, near TAT and beyond TAT.
  Stage colours and accents are kept clear of them.
- **Glass over colour.** Cards are frosted glass on a coloured canvas. Glass only reads as glass when there is
  colour behind it, so the canvas and skyline exist partly to feed the glass.
- **Every number filters.** Dashboard tiles, chart rows and legend keys toggle the table filter.
- **Quiet by default, detail on demand.** Labels slide out on hover (nav links, profile, sign out), names show
  in tooltips (avatar stacks), and the navbar tucks away while you scroll.
- **Accessible first.** Text meets 4.5:1 contrast. Nothing depends on hover alone: keyboard focus opens the
  same things, and touch screens show labels. All motion stops under `prefers-reduced-motion`.

---

## 2. Colour

### Core (light mode)

| Token / value | Use |
|---|---|
| `--navy` `#14295f` | Headings, navbar gradient start, skyline edges |
| `--blue` `#1e3f97` → `#2b52c4` | Navbar gradient, hero tile, Refresh, active filter, links |
| `#f26a33` → `#c2410c` | Brand mark and avatar gradient (orange) |
| `#c2410c` (hover `#9a3412`) | Orange **with white text** or as text on white (5.2:1). Never use the brighter orange behind white text |
| `--ink` `#0f1b33`, `--muted` `#475569` | Body text, secondary text |

### Turnaround (TAT) tones (`.wt .ok/.warn/.bad/.info/.plain` in `workTray.css`)

| Tone | Text | Meaning |
|---|---|---|
| ok | `#15714a` | On track |
| warn | `#a8480b` (bars `#e8873a`) | Near TAT |
| bad | `#b3261e` | Beyond TAT |
| info | `#1b3180` | Neutral highlight, selections |
| plain | `#475569` | Inactive or zero |

### Stage scale (`STAGE_COLORS` in `src/pages/workTray/options.js`)

The scale gets deeper as an application moves along. It is used for the stage arrows and the small square
beside the stage name in the table.

| Stage | Colour |
|---|---|
| Intake | `#0284c7` sky |
| Credit Investigation | `#2563eb` blue |
| Credit Evaluation | `#1d4ed8` royal |
| Review | `#1e40af` deep blue |
| Approval | `#172b6b` navy |
| Decided | `#64748b` slate |

### Avatars (`AVATAR_TONES` in `options.js`)

Each avatar is a pastel fill with dark initials (4.5:1 or better), picked from a hash of the name so a person
always gets the same colour. The tones are mostly blue, with one peach. Your own avatar is the blue gradient.

### Dark mode

Dark mode is opt-in, using the moon button in the top bar. Light stays the default because of earlier meeting
feedback; see section 9.

- **Canvas:** `#0a1124` → `#0d1730`, with blue and faint orange glows.
- **Text:** `--ink` `#e6ecff`, `--muted` `#a3b0cc`, headings `#dbe5ff` / `#f1f5ff`.
- **Status tones** are lighter tints so they stay readable on dark glass: ok `#4ade80`, warn `#fdba74`,
  bad `#fca5a5`, info `#a9c0ff`.
- **Glass:** `rgba(22, 34, 68, 0.62)` with a `rgba(255,255,255,0.08)` rim.
- **Pages not yet adapted** sit on a light rounded sheet (`#f4f7fc`) so their dark text stays readable.

---

## 3. Surfaces and shape

| Element | Spec |
|---|---|
| Canvas | Fixed radial gradients on `.ct-e-app`: blue left and lower right, peach bottom, small orange glow top right |
| Skyline | Full-viewport isometric glass towers behind everything (section 6) |
| Page panel (`.wt-page`) | Large tinted glass "window": max-width 110rem, radius 30px, white rim. **No backdrop-filter**, because a blurring parent would stop the cards inside from blurring the canvas |
| Cards and tiles | `rgba(255,255,255,0.55)` + `saturate(1.5) blur(20px)`, 1px white rim, top inner highlight, radius 22px (tiles 20px) |
| Hero tile | Royal-blue gradient (#1a3683 → #3463d8), white text, a drifting soft white light and a faint white ring in the corner. Selected: white + blue outline |
| Controls | Pills (radius 999px) for search, filters, buttons and nav. Small row buttons are 8px rounded rectangles. "Your turn to review" is a 6px tag |
| Spacing | Toolbar padding `1.25rem 1.5rem`, cells `1.1rem 1.15rem`, gaps 0.75–1rem |

Typography is Inter throughout. Page title 2.1rem / 700 / −0.03em. Card titles 1rem / 600 in sentence case.
Big numbers are 600 weight with tight tracking.

---

## 4. Layout: the frame (`src/components/appLayout.jsx`, `src/applicantTheme.css`)

```
╭──────────────────────────────────────────────────────────────────────────────╮
│ ■ CATCH   (◈)(📖)(+)                          (🔔 | JD)  (☾)  (⇥)             │  floating rounded bar, sticky
╰──────────────────────────────────────────────────────────────────────────────╯
 ┌──────────────────────── page panel (glass window) ──────────────────────────┐
 │ Good afternoon, Josh                                   [ Monday, 16 Nov ]    │
 │ Work tray                                                                    │
 │ [✓ Account Officer]                                                          │
 │ ┌ Turnaround ┐ ┌ Applications by stage ──────────┐ ┌ Assigned to me (hero) ┐ │
 │ │   donut    │ │ ⟩Intake⟩Inv.⟩Eval.⟩Review⟩Appr.⟩ │ ├ Unassigned            ┤ │
 │ └────────────┘ └─────────────────────────────────┘ └───────────────────────┘ │
 │ ┌ Applications 8 of 10 ─────────────────────────────────────── [⟳ Refresh] ┐ │
 │ │ [🔍 Search…]                     [All TAT ▾] [All applications ▾] [Stage ▾]│ │
 │ │ # │ Application │ Stage │ Amount │ TAT │ Assigned to │ Review & approval  │ │
 └──────────────────────────────────────────────────────────────────────────────┘
        3D skyline fixed behind everything
```

- **Top bar:**
  - **Shape:** a pill, 4.25rem tall, floating 0.75rem below the top (`--ct-head`, `--ct-gap`). It lines up
    with the page panel edges.
  - **Brand:** an orange gradient square and the "CATCH" wordmark.
  - **Nav:** icon-only round buttons in a translucent group. The current page is a white pill. There is no
    "My profile" link; the avatar opens the profile.
  - **Right side:** the bell and avatar share a translucent pill. Next to it are the theme switch and sign out
    (door icon).
  - **Offsets:** sticky in-page navs (`.lf-nav`, `.ct-aside-inner`) and anchor jumps allow for
    `--ct-head + --ct-gap`.
- **Small screens (≤960px):** the bar becomes a rounded rectangle and stops being sticky, the links wrap onto
  their own row, and all labels show.

---

## 5. Work tray components (`src/pages/workTray/`)

| Component | Notes |
|---|---|
| Header (`adminHomePage.jsx`) | A greeting by time of day with the first name (`staff_name` RPC), the title, the role as a tag, and today's date. `nameWithoutRole()` stops a role being repeated in test names |
| Turnaround donut | Round-ended segments (ok, near, beyond); the centre counts open applications. Legend keys filter the table |
| Applications by stage | **Process arrows**: one interlocking chevron per open stage, in order and equal width, holding the stage name, the count (it counts up) and a white "N late" tag. The fill is the stage colour mixed 12–40% with white, stronger for busier stages and capped so navy text stays 4.5:1. The selected stage turns solid navy. Narrow screens stack them as downward steps. Decided is a footer "finish line" button (navy double-tick tile, count, "decided", sliding arrow; solid navy when selected), so its ever-growing count stays out of the flow |
| Tiles | **Assigned to me / For my review** (blue hero) above **Unassigned** (glass; orange number and icon while it is above 0) |
| Toolbar | Row 1: "Applications", the count and Refresh (last refresh time in its tooltip). Row 2: search (capped at 24rem, on the left), then the filters, then Clear (orange text) |
| Filters (`filterSelect.jsx`) | Custom listbox, because a native `<select>` menu can't be animated. Keyboard: arrows, Home/End, Enter/Space, Esc, Tab. A filter that's on gets a light blue tint. Class `wt-fsel`; don't reuse `wt-select`, which an older rule caps at 11rem |
| Table rows | Left stripe in the TAT colour. Stage name with a coloured square, then status as icon + word (Pending ⏳, In progress ▶, Requested ➤, Returned ↩, Done ✓). Flags are icon + word; only "Your turn to review" is a tag |
| Assigned to | AO and CO lines: an avatar and name, or a dashed circle and "Unassigned". **Assign me** (orange) and **Release** (outline, **two clicks**: Release → Confirm?, which resets after 3s or on blur). Heads get a gear icon for Manage |
| Review & approval | Its own column. Each line is an avatar stack, up to 3 then "+N". A green tick means the reviewer signed off. Names are in tooltips and in screen-reader text |

---

## 6. Background skyline (`src/components/skylineBackdrop.jsx`)

- **What it draws:** nine isometric towers. Four tall ones at the back are fainter. Five in front have stepped
  crowns.
- **How each tower is drawn:**
  - Each tower is an `IsoBox`: a lit left face, a shaded right face and a top.
  - Floor lines and window columns run on both faces.
  - The faces are translucent, so towers read as glass and back towers show through.
- **Where it sits:** fixed to the viewport, behind content. The frame has `isolation: isolate` and the SVG sits
  at `z-index: -1`, so it never disturbs how the bar, dropdowns or drawers layer.
- **No antennas:** don't add lone lines on roofs. With see-through faces they read as stray strokes. Use a small
  crown box instead.
- **Tuning** (`applicantTheme.css`, `.ct-skyline`):

| Selector | Light | Dark |
|---|---|---|
| `.edge` stroke-opacity | 0.42 (back row 0.2) | 0.32 (back row 0.16) |
| `.grid` (windows) | 0.13 (back row 0.07) | 0.10 (back row 0.05) |
| faces | white / pale blue at ~0.4 | navy at ~0.3–0.4 |

To move or add a building, edit the `<Tower x y w d h floors cols crown>` lines in the component.

---

## 7. Motion

The standard easing is **`cubic-bezier(0.2, 0.8, 0.2, 1)`** (fast out, gentle settle). Things close faster than
they open. Everything below is turned off by `prefers-reduced-motion: reduce`, where numbers appear without
counting and controls snap.

### On page load (work tray)

| What | How | Timing |
|---|---|---|
| Header, three dashboard cards, table card | Rise in (fade, 12px up) | 0.55s, staggered 0 / 0.06 / 0.12 / 0.18 / 0.26s |
| Turnaround donut | Segments draw around the ring | 0.9s, delay 0.3s |
| Stage arrows | Slide in from the left, one stage after another; counts count up | 0.5s, delays 0.3–0.62s |
| Tile and donut numbers | Count up from 0 (`useCountUp.js`); later changes count to the new value | 700ms, ease-out cubic |
| Table rows | Fade in (4px up), first 12 cascade | 0.4s, from 0.36s, 30ms apart |
| TAT bars in rows | Fill from the left | 0.8s, delay 0.55s |

### Interaction (work tray)

| What | How | Timing |
|---|---|---|
| Tiles | Lift 3px on hover, press down slightly | 0.2s |
| Hero tile | White corner light drifts | 7s loop |
| Unassigned icon | Gentle orange pulse while there is work | 2.4s loop |
| Stage arrow | Lifts 2px and its fill deepens on hover; dips (scale 0.97) when pressed | 0.2s |
| Stage arrows: sheen | A light band sweeps across each chevron in turn, Intake → Approval, so the flow reads left to right. The shape lives in `--shape`, shared by `::before` (fill) and `::after` (sheen) | 6.5s loop, 0.16s between chevrons, first pass at 1.4s |
| Stage arrows: late tag | Soft red ring pulse | 2.4s loop |
| Stage arrows: selected | The chosen stage pops in as it fills navy (fill and count scale up from 0.93) | 0.35s once |
| Table row hover | TAT stripe widens 5→8px, a → slides in after the reference, avatar stacks fan out | 0.18–0.22s |
| Filter dropdown | Menu drops in (fade, 6px, scale 0.97); options appear one by one; chevron turns; highlighted option shifts 3px; orange tick on the chosen one | 0.18s, items 22ms apart, chevron 0.25s |
| Refresh | Icon spins while loading (button disabled) | 0.8s loop |
| Release → Confirm? | Turns orange with a small side-to-side nudge | 0.3s once |

### Top bar

| What | How | Timing |
|---|---|---|
| Nav group | At rest: icons only. Hover or keyboard focus anywhere on the group opens **all** labels, left to right | 0.3s, 0.04s apart |
| Profile picture | Slides open to name and role | 0.3s; text fades in 0.2s after a 0.08s delay |
| Theme switch / Sign out | Slide open to "Dark mode" / "Sign out"; hover turns white | 0.3s |
| Bell | Rings once on hover | 0.6s |
| Nav icons | Lift 2px on hover | 0.2s |
| Collapse on scroll | Past 80px of scroll the bar shrinks (left-aligned) to a round button holding the logo. Hover, keyboard focus or an open notifications panel opens it again. Back at the top it opens fully | 0.45s (contents fade out in 0.12s, back in 0.25s) |

The slide-open effect animates `grid-template-columns: auto 0fr → auto 1fr` (class `ct-expand` /
`ct-expand-text`). Labels are only faded, never removed, so screen readers still read them. Touch screens
(`hover: none`) and layouts ≤960px always show labels, and the bar never collapses there.

---

## 8. Accessibility checklist

- **Contrast:** text is 4.5:1 or better in both themes. White on orange uses `#c2410c`, never the brighter
  orange.
- **Keyboard:** everything that opens on hover also opens on keyboard focus. The navbar uses
  `:has(:focus-visible)`, so a mouse click doesn't leave it stuck open. Focus rings are visible on dark and
  light.
- **Icon-only controls** carry an accessible name: sign out, the theme switch (with `aria-pressed`), the avatar
  ("My profile (name · role)") and the Manage gear ("Manage assignment for HL-…").
- **Charts:**
  - The donut has an `aria-label` with all three counts.
  - Stage arrows read like "Credit Evaluation: 6 applications, 1 beyond TAT".
  - Colour is never the only signal: there is a legend, and counts are written out.
- **Filters** are a proper `listbox` with `aria-activedescendant`.
- **Decoration:** the skyline is `aria-hidden` and ignores the pointer.
- **Motion:** everything is off under `prefers-reduced-motion`.

---

## 9. Files and open points

| File | What it holds |
|---|---|
| `src/components/appLayout.jsx` | Frame: top bar, scroll collapse, theme switch, profile name lookup |
| `src/components/skylineBackdrop.jsx` | 3D skyline |
| `src/applicantTheme.css` | Frame styles: canvas, top bar, expanding controls, collapse, skyline, dark frame |
| `src/pages/adminHomePage.jsx` | Work tray header |
| `src/pages/workTray/workTray.jsx` | Dashboard, table, avatars, Release, count-up |
| `src/pages/workTray/filterSelect.jsx` | Animated filter dropdown |
| `src/pages/workTray/useCountUp.js` | Number count-up hook |
| `src/pages/workTray/options.js` | Stage and avatar colours, greeting, `nameWithoutRole` |
| `src/pages/workTray/workTray.css` | All work tray styles. Later blocks override earlier ones and are labelled: Look, Table, Colour, Motion, Dropdowns, Dark mode |

**Open points**

- **Dark mode vs. meeting feedback.** `notificationBell.jsx` records "no dark mode". It is opt-in for that
  reason; confirm with the group or advisor before keeping it.
- **Other pages** (loan folder, financial package, forms, profiles) still use their older styles and show on a
  light sheet in dark mode. Converting one means giving it the glass card styles and its own dark-mode rules,
  like `workTray.css`.
- **`workTray.css` layering.** It grew in stages, so some properties are set more than once. When you tidy it,
  fold each block's overrides into the original rules and delete the dead `.wt .wt-select` rule.
