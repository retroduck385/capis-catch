# CATCH front end: design and animation guide

How the signed-in screens look and move, and where each piece lives. It covers the shared frame (top bar,
background), the staff work tray (`/adminHomePage`), the loan folder (`/loanFolderPage`, section 6) and the document check (`/documentCheckPage`, section 7). Other
pages inherit the frame but still use their older styles. **To convert one, follow the playbook in section 11.**

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
feedback; see section 12.

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
| Skyline | Full-viewport isometric glass towers behind everything (section 8) |
| Page panel (`.wt-page`) | Large tinted glass "window" (the loan folder uses a near-opaque version, section 6): max-width 110rem, radius 30px, white rim. **No backdrop-filter**, because a blurring parent would stop the cards inside from blurring the canvas |
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

## 6. Loan folder (`src/pages/loanFolder/`)

The second converted page. It reuses the work tray's look (page panel, glass cards, pills, blue with an
orange hint) and adds its own dark mode. Everything is scoped to `.lf-folder`, because the other staff pages
(financial package, CI request, credit score, review) share the `.lf-*` classes and keep their old look until
they are converted.

**One deliberate difference from the work tray:** the page panel is nearly opaque (light `rgba(247,250,255,0.96)`
→ `rgba(238,243,252,0.94)`, dark `rgba(17,27,58,0.96)` → `rgba(11,18,40,0.94)`), so the skyline shows only in the
margins around the panel and not behind the content. With the skyline visible through a long reading page it was
too busy (feedback, 16 Nov 2026). Cards are firmer to match (`--lf-glass` 0.78 white, `--lf-glass-hi` 0.92).

```
 ┌──────────────────────── page panel (.lf-folder) ────────────────────────────┐
 │ (Work tray) › [Application HL-…]                                             │
 │ 🗀 Loan folder [🔒 Read-only]                       (Messages³)(Doc check)… │
 │ Application HL-2026-000123                                                  │
 │ (📅 Submitted …) (➤ CI requested … by …)                                    │
 │ ┌ KYC ring + legend ──────────┐ ┌ Credit investigation ┐ ┌ Change history ┐ │  read-only
 │ └─────────────────────────────┘ └──────────────────────┘ └────────────────┘ │
 │ ┌ KYC verification by section ── [All 11|● Verified 6|● Needs 1|○ Not 4] ┐  │
 │ │ ▌✓ Loan Details  Verified │ ▌⚠ Employment  Needs clarification │ …     │  │
 │ ┌ Application details (blocks in two columns) ┐ ┌ ▸ Change history ┐       │
 └──────────────────────────────────────────────────────────────────────────────┘
 Editing AO:  [Your steps: 1 ✓ · 2 Next · 3]  then  nav │ section header (◂ Next ▸)
                                                        │ form (paper) │ KYC check rail (sticky)
```

| Part | Notes |
|---|---|
| Header (`loanFolderPage.jsx`) | Eyebrow "Loan folder" with a mode tag (**You can edit** blue / **Read-only** slate), the title at 2.1rem / 700, meta as glass chips, actions as pills. Messages' unread count is orange. **History** sits left of Messages with the number of changes as a quiet blue pill (`.lf-btn-n`; not a badge, since nothing is unread). It opens the change history, scrolls its top into view (below the sticky bar) and focuses its heading. The editing AO is switched to the overview first, since the history lives there. The Change history dashboard tile does the same. Read-only viewers also get the explanation strip |
| Dashboard, read-only | **KYC ring** (`kycOverview.jsx`): verified (ok) and needs clarification (warn bar `#e8873a`) segments, centre counts up. Its legend keys filter the section board and scroll to it. Tiles: **Credit investigation** (requested / not) and **Change history** (count; opens and scrolls to the history) |
| Dashboard, editing AO | The step strip (`stepStrip.jsx`) as glass step cards: done = blue disc with a tick, next = orange ring and an orange "Next" tag (it waits on you), current = white with a blue outline. Meters are blue. Optional view sits under it as a dashed strip |
| KYC board | Segmented filter (All / Verified / Needs clarification / Not checked, each with its count), shared with the ring's legend. Section cards have a left stripe in the status tone and a status icon (✓ / ⚠ / dashed circle). For the editing AO each title opens that section. **Alignment:** a card is a 3-column grid (icon 1.25rem · name · chip), all pinned to the first line, and the icon box, name line, comment button and chip are each exactly 1.5rem tall so they share one centre line. The body (Incomplete, who / when, remark, Ask) sits in the name column, so every line of text starts at the same x. A long name wraps in its own column; the chip never moves. The **comment button** sits in a footer row at the **bottom right** of every card (rows `auto 1fr auto`), so the buttons line up across a row |
| Application details (`applicationDetails.jsx`) | **Tabs**, one group at a time: Loan · Borrowers (n) · Obligations (n) · References (n) · Collateral & referral (ARIA tabs; arrows / Home / End). Fields are label-over-value tiles (`.sum-fields`, auto-fill 11.5rem). Each block is its **own bordered card** (`.sum-block`) with a tinted header band and a blue left edge; a borrower's band also shows the person's name. Inside a borrower, Personal details, the addresses, employment and documents are tinted sub-panels, **each full width with the same tile grid**, so columns line up from panel to panel. List items are numbered sub-panels ("Reference 1"), two to a row. Tiles use CSS subgrid (labels in one row, values in the next), so a two-line label doesn't push its value below its neighbours'. Borrowers stack one per row, so two people's fields never sit next to each other. Tokens `--lf-block-*` / `--lf-sub-*` have dark values with visible 0.11–0.14 white borders. **Empty fields are hidden** unless the "Show empty fields" switch is on. Uses the shared `applicationSummary.jsx` through its opt-in `groups` prop and `SummaryContext` (`stacked`, `hideEmpty`), so the applicant's review step is unchanged |
| Change history | A collapsible card; inside, a timeline (`.lf-tl`, also used by the financial package, credit score and review pages). Action tags use the blue scale and slate (Added blue, Changed sky, Removed slate), never TAT colours. Old values are struck through, then → new. In the loan folder (`tools` prop): **search** (every word must match what / who / when / field names or values; matches highlighted light blue), **Action / Area / Changed by** filters (the work tray's `FilterSelect`; a filter that's on is tinted blue), Clear (orange text), a "n of N changes" count, and paging, 25 at a time ("Show 25 more") |
| Section navigator counts | One count pill (`.lf-nav-cnt`: 2.75rem minimum width, 1.5rem tall, 0.75rem / 800 tabular) for the group headings (KYC verification 3/12) and items (Document check 0/10). They share the same right edge and turn green when complete. Status words ("Sent", "Incomplete") stay chips or tags |
| Section view (editing AO) | Header: "Section n of N", status icon, Incomplete tag, ◂ / Next ▸ pager (after the last section, Next goes to Request CI). Previous is a glass pill; **Next is orange** (`#c2410c`, hover `#9a3412`, white text 5.2:1), since it moves you on to what is waiting. Below, the applicant's form on a "paper" card beside a **sticky KYC check rail** (22rem). At ≤1300px the rail stacks above the form |
| KYC check (`kycCheckPanel.jsx`) | Latest result in a quiet box, Verified / Needs clarification as choice cards with icons (fieldset + legend), a visible Remarks label (required for Needs clarification), the blue primary pill. Incomplete sections show a warning note, not an error |
| Primary buttons | The blue gradient pill (Record check, Send to the CI, the form's Save). The applicant theme's orange arrow disc is turned off inside the folder |
| Section forms (every step, wizard and loan folder) | One look for all steps. **Every `Section`** (`applicationForm/fields.jsx`) gets the same four-column field grid (`ct-cols-4` is always on) and the same bordered panel. The wizard's `.ct-shell` rules in `applicantTheme.css` also cover the loan folder's `.lf-formcard`, so the two can't drift. **Dropdowns** are `SelectMenu` (`components/selectMenu.jsx` + `.css`), not a native `<select>`, for applicants too. It is sized and bordered like the text inputs, the menu drops in (fade, 6px, scale 0.97, 0.18s), options appear one by one (18ms apart), the chevron turns, the highlight shifts 3px, the chosen option gets an orange tick, and a new value fades in. It opens upward when there's under 300px below. Keyboard matches a native select: arrows, Home / End, PageUp / PageDown, type-ahead, Enter / Space, Esc, Tab. **Yes / No** are two choice pills (blue when chosen). List rows have a quiet **Remove** and a dashed **+ Add**. Intro lines share `.ct-intro`. **Field rows line up:** each `.ct-field` is a subgrid spanning 4 shared rows (label, control, hint, error) with its label at the bottom of its row, so a label that wraps to two lines never pushes its input below its neighbours'. The required `*` is joined to the label's last word by a no-break space. **File pickers** ("Choose Files") are a blue tinted pill with an upload icon. Invalid inputs and dropdowns get a red border, as well as the message under them |
| Steps 2 and 3 in the folder's look | Inside the loan folder, the wizard's pieces are re-skinned to match the page. **Step 2:** form panels have 16px corners on `#f8faff` with navy titles; inputs and dropdowns have 12px corners; Back / View / Remove are pills; "Changes saved" is a green strip. **Ask the applicant** is an orange outline pill (`.lf-ask-btn`, via `AskApplicantButton`'s `plain` prop), since it waits on the AO. The KYC result radios are drawn (ring, then dot) so they read the same in dark mode. **Step 3:** the warning strip has 16px corners; **Missing** is amber, not red (red is TAT only); the TU tiles are inset cards with a blue edge; every table (NFIS / TU forms, CI results) has a rounded frame, a tinted uppercase header band and hairline rows; the CI results are their own card |

**Dark mode.** Tokens on `[data-theme='dark'] .lf-folder` (same values as the work tray). `applicantTheme.css`
leaves `.lf-folder` off the light sheet. The applicant's forms aren't dark-adapted, so they sit on **light paper**
(`.lf-paper` resets the tokens to light values, background `#f4f7fc`). The Send notice and document-request panels
use the tokens and follow dark mode.

**Motion** (all off under reduced motion):

| What | How | Timing |
|---|---|---|
| Panel rows (crumbs, header, dashboard, body) | Rise in (12px) | 0.55s, staggered 0 / 0.05 / 0.1 / 0.16 / 0.22s |
| KYC ring | Segments draw; centre counts up | 0.9s, delay 0.3s / 700ms |
| Step meters | Fill from the left | 0.8s, delay 0.45s |
| Section cards | Fade in (4px), first 12 cascade; again whenever the filter changes | 0.4s, from 0.12s, 30ms apart |
| Section / overview / CI switch | Content fades in | 0.35s |
| Tiles, section cards, step cards | Lift 2–3px on hover; section stripe widens 4→6px | 0.2s |
| Nav current item | Blue indicator grows from the centre | 0.25s |
| KYC choice | The chosen result's icon pops | 0.35s once |
| Pager arrows | Nudge 2px toward their direction on hover | 0.2s |

### Ask the applicant for documents (`src/pages/documentRequests/requestPanel.jsx`, `requestPanel.css`)

The box under the loan folder's panels (`.lf-panels`). It no longer sits on paper: it uses the `--lf-*` tokens (with
light fallbacks), so it follows dark mode. Send notice (below) uses the same styles.

```
 ┌ (✉) Ask the applicant for documents [⚠ Documents back: check them] [1 earlier]      ⌃ ┐
 │ ┃ The applicant sent the documents back. Check them, then close the request.   (↻)   │
 │ ┃ Sent by (JD) Josh Denzel · Yesterday, 3:33 PM    Sent back (A) Applicant · Today… │
 │ ┃ ▌ "Please send a clearer copy…"                                                  │
 │ ┃ ┌ Valid ID / Passport  Principal Borrower                              [1 / 1] ┐  │
 │ ┃ │ (▤ passport-new.pdf) (A) Applicant · Today, 7:33 PM                          │  │
 │ ┃ │ ┌ Staff check of this file [✓ Cleared] (JD) Josh Denzel · …              ⌄ ┐ │  │
 │ ┃ [SMS 0917…: Sent] [Email: Skipped]      (✓ Close: documents received)          │
 │ GOES TO THE APPLICANT BY  [In the app] [SMS to 0917…] [⚠ Email skipped: …]         │
 │ DOCUMENTS NEEDED                                                                    │
 │ ┌ (👤) Principal borrower [2 missing] ──────────────────────────────────────────┐ │
 │ │ ┌☑ Valid ID  [1/2]┐ ┌☐ COE / ITR [2/2]┐ ┌☑ Payslips [0/3]┐                    │ │
 │ └──────────────────────────────────────────────────────────────────────────────┘ │
 │ ┌ (👤) Spouse [✓ All uploaded] ─────────────────────────────────────────────────┐ │
 │                   (+ Add another document)                                          │
 │ WHAT WE NEED      [ textarea ]                                        0 / 300       │
 │ WHAT THE APPLICANT WILL RECEIVE  ┌ In the app ┐ ┌ SMS · 1 SMS ┐ ┌ Email ┐          │
 │ (➤ Send request)                                                                    │
 │ ──────────────────────────────────────────────────────────────────────────────────── │
 │ (⟲) Earlier requests [3]   Closed, newest first.                                     │
 │ ┃(✓) FS / Bank Statements                                         [Received]  ⌄     │
 │ ┃    Sent Nov 7, 2026 · Closed Nov 10, 2026 · 3 files                                │
 │ ┃(↶) Signed application form                                      [Withdrawn] ⌄     │
 └──────────────────────────────────────────────────────────────────────────────────────┘
```

| Part | Notes |
|---|---|
| Frame | A `<details className="dr">` glass card. The summary is an icon disc, the title, a status chip and a chevron. Status: **Documents back: check them** amber (it waits on you) · **Waiting for the applicant** info blue · none when there is no open request. "N earlier" is a slate chip |
| Current request | An inset card with a 4px left stripe: **orange** when the documents are back (your move), blue while waiting. Title line + a round refresh icon button. "Sent by" / "Sent back" are verbs outside an inline `Byline` (section 11.10). The staff message is a quote box |
| Requested items | Inset cards: name, whose document (muted), and an uploads count chip (`dr-count`): **green** when the minimum is met, **amber** when short. Uploads are file pills (`.dr-file-btn`) with the uploader's byline, then the shared `FileMark` ("Staff check of this file") |
| Delivery | One chip per channel: Sent ok · Sending / Logged (test mode) info · Queued / Skipped slate · Failed err |
| Close | Blue primary pill "Close: documents received", or a quiet "Withdraw request" while waiting. Both open a blue confirm panel with an optional note |
| New request form | Uppercase block labels (`.dr-h`). **Goes to the applicant by**: channel chips (ok, or amber when the number / address is missing, with the reason in the chip). **Why the file is deferred**: KYC deferral notes as suggestion cards with a "Use this" pill. **Documents needed**: one sub-panel per person (`.dr-party-group`, a labelled `role="group"`: principal borrower, spouse, co-borrower 1…, in that order) headed by who it is and a chip, **N missing** amber or **All uploaded** green (grouped 23 Nov 2026, after feedback that with a spouse and co-borrowers you couldn't tell whose documents were whose). Inside, checkbox cards (`.dr-pick`, a native checkbox so keyboard and screen readers work) with the count chip; others are rows of `SelectMenu` (whose document) + text input + Remove, and a dashed "Add another document" pill. A counter under the message box. **What the applicant will receive**: three preview cards (In the app, SMS with characters and segments, Email) |
| Send | Blue primary pill with the Send icon; asks to confirm in the same blue panel |
| Earlier requests | A disclosure under a hairline divider, **closed by default** (the form above is the main job). Its summary row: History icon disc, title, count chip, chevron on the right, and a one-line hint below; it gets the panel header's hover tint, and the list fades in when it opens. Inside, **one closed card per request** (`.dr-past`, a `<details>`), 0.6rem apart, each with a 4px stripe and a round icon in the outcome tone (Received: green check · Withdrawn: slate undo arrow), so the cards tell apart without opening them. Summary row: what was asked (the item names, truncated), then "Sent **date** · Closed **date** · N files" (`formatDay`, full date on hover), the status chip and a chevron. Opened: "Sent by" / "Closed by" (or "Withdrawn by") bylines, the close note in a labelled box, the message, the items (white, one level deeper) and delivery chips. Each file's staff check starts **closed** here (`FileMark autoOpen={false}`); it opens by itself only in the current request |

**Motion** (off under reduced motion): the body drops in (4px, 0.28s) and the chevron turns.

### Send notice to applicant (`src/pages/applicantNotices/sendNoticePanel.jsx`, `sendNoticePanel.css`)

The box above Ask the applicant, shown to the assigned AO once the file is Approved, Rejected or Deferred. Moved off
paper into the staff look on 23 Nov 2026: it reuses the `dr-*` styles from `requestPanel.css`, plus a few `sn-*` rules.

| Part | Notes |
|---|---|
| Frame | A `<details className="dr sn">` glass card, **open until the notice is sent**, then closed. Summary: Megaphone icon disc, title, an **Outcome** chip (Approved ok · Deferred amber · Rejected slate; never red) and **Not sent yet** amber (it waits on you) or **Notice sent** green |
| Correction | Once sent: an info strip (the first notice is kept) and a "Send a correction" checkbox card (`.dr-pick`) that opens the form |
| Form | **Goes to the applicant by** channel chips, as in Ask the applicant. **Suggestions from the file** as suggestion cards with "Use this". The note box (`.dr-h` label, hint, counter). **What the applicant will receive** (`MessagePreview`). A blue Send pill that confirms in the blue panel |
| Notices sent | Under a hairline divider: title and a round refresh button, then one inset card per notice: outcome chip, a Correction info chip if it is one, a "Sent by" byline, the in-app text in a quote box and one delivery chip per channel (same tones as the document requests) |

### Messages (`src/pages/messages/messagesPanel.jsx`, `messages.css`)

The staff-only thread for one file. The trigger is a `lf-btn` pill with the `MessageSquare` icon and an orange count
badge (unread). The drawer is a portal into `.ct-e-app` (so it is never inside a page's `<form>`, and still follows the
theme). It has its own `--m-*` tokens (light, and dark on `[data-theme='dark'] .msg-drawer`), because it can open over
any page, not only `.lf-folder` ones.

```
                              ┌ (💬) Messages                     (✕) ┐
                              │      Staff only · this application   │
                              │            (Load earlier)            │
                              │ ┌ Maria Santos Credit Officer · CE ┐ │
                              │ │ (KYC · Employment ↗)              │ │
                              │ │ Hi [@Josh Denzel], the payslip…   │ │
                              │(MS)                Yesterday, 7:34 PM│
                              │      ┌ You Account Officer · CE ───┐ │
                              │      │ Sure, I will send…  (blue)   │ │
                              │ ─────────────── NEW ──────────────── │
                              │ Write a message                       │
                              │ [ Message the team on this file    ]  │
                              │ 0 / 2000  @ to mention · …    (➤ Send)│
                              └───────────────────────────────────────┘
```

| Part | Notes |
|---|---|
| Drawer | Fixed below the top bar, `0.75rem` from the right and bottom, `min(28rem, 100vw − 1.5rem)` wide, radius 22px, glass. Esc and the round close button close it and return focus to the trigger. It slides in from the right (0.28s); messages rise in (6px, 0.25s) and the mention list pops (0.16s), all off under reduced motion |
| Bubbles | Others: white (dark: raised navy) card with a stacked avatar on the left. Mine: light blue, right-aligned, no avatar ("You"). The meta line is name (strong) · role · stage (muted), separators drawn in CSS. The topic is a blue outline pill that jumps to the section (↗). The time is a `<time>` with the full date in `title`, bottom right |
| Mentions | `@Name` in a blue tint; a mention of **you** is orange (it waits on you) plus a screen-reader "(you)". The list inserts the clean name (`personName`), and matching accepts the clean or the stored name, so seeded names with a role suffix still highlight |
| New divider | An orange "NEW" chip on a hairline before the first unread message from someone else |
| Composer | A tinted footer: visible label, an optional "About: section" chip with a remove ✕, the textarea (blue focus ring), the counter and hint, and a blue Send pill (half-faded and disabled until there is text). The mention list is a listbox above the textarea: avatar, name, role, and a green "On this file" chip; the active row is blue-tinted |
| Read-only | A slate strip with a lock icon instead of the composer |
| Empty | Icon disc, "No messages yet", and how to start |


---

## 7. Document check (`src/pages/documentCheck/`)

The first page converted with the playbook (section 11). Its root is `lf lf-folder lf-doccheck`, so the panel, cards,
pills, header, tabs, tokens and dark mode come from `loanFolder.css`. `documentCheck.css` adds only the workspace,
the document list, the viewer and the extraction panel. The same page serves the CI's report check (`&ci=1`).

```
 ┌──────────────────────── page panel (.lf-folder.lf-doccheck) ─────────────────┐
 │ (Work tray) › (Application HL-…) › [Document check]                           │
 │ ⌗ Document check (AI) [✓ You confirm]                         (← Loan folder) │
 │ Application HL-2026-000123        (✓ 2 of 5 documents confirmed)              │
 │ ⓘ The AI only proposes values…                                                │
 │ Ana Cruz · Principal Borrower 2/3 │ Ben Cruz · Co-borrower 1 2/2               │
 │ ┌ Documents for Ana Cruz ───────────┐ ┌ Extracted information ──── Ready ┐   │
 │ │ ▌▣ Valid ID   passport…   Ready    │ │ Passport · read by AI  (Run AI)(Confirm)│
 │ │ ▌▣ COE / ITR  coe…        Confirmed│ │ ⚠ Check on the document              │
 │ │ (− 100% + ↺)(‹ Page 1 of 2 ›)(Open)│ │ ┌ First name  Differs  Hard to read ┐ │
 │ │ ┌ the document; blue box = value ┐ │ │ │ [ANNA]  Application: Ana (Keep)(Update)│
 └──────────────────────────────────────────────────────────────────────────────┘
```

| Part | Notes |
|---|---|
| Header | The breadcrumb includes the page (`docs` / `cidocs` in `breadcrumbs.jsx`). Eyebrow with a mode tag (**You confirm** blue / **Read-only** slate). A progress chip ("2 of 5 documents confirmed") turns green when all are done. A back pill to the loan folder (CI: the CI request). The human-in-the-loop line is an info strip |
| Next step | Once everything is confirmed: a green strip with an orange "Go to step 2: KYC verification" pill (CI: "Go to step 4: Results") |
| Borrowers | The loan folder's tabs (`.lf-tabs`, `aria-current`). Each has a small **person disc** (`UserRound` in a 1.85rem circle: tinted, then blue gradient with a white icon on the open borrower), the name, the role in smaller muted text, and confirmed / total (green when complete). Tabs are 3.25rem tall, 0.35rem apart, and scroll sideways on a phone |
| Workspace | Two glass panes. Above 1100px they stick below the top bar and fill the screen (`--dc-pane-h`), each scrolling inside. At 1100px and below they stack, with the viewer at 75vh |
| Document list | Inset cards with a left stripe in the status tone. The open one is outlined blue (it used to be solid green, which read as a status). Statuses: **Confirmed** ok · **Ready to check** amber (it waits on you) · **Reading document / AI extracting** info blue with a spinner · **Waiting for AI** slate · **Could not read file / AI extraction failed** err (form red: an error, not a TAT colour) |
| Staff check of the file | `fileMark.jsx` + `fileMark.css`, also used in the loan folder's "Ask the applicant for documents" box. A compact **disclosure**: the summary row shows the title, the latest mark as a chip (Cleared ok, Needs a new copy amber, Not marked yet slate) and "name · role · date" (`nameWithoutRole` stops a role repeating). The body opens on demand: the latest comment in a quote box, Ask the applicant (orange outline pill), a labelled comment box with **Mark Cleared** / **Needs a new copy** outline pills in their tone, and History as a small timeline. It starts open only while the file needs something from the viewer. Built on the `--lf-*` tokens with light fallbacks: it follows dark mode on this page and stays light on paper (`.lf-paper` now also resets the surface tokens) |
| Viewer | Pill groups for zoom (− %, +, reset) and pages (‹ Page n of N ›), all icon buttons with labels; Open file is a quiet pill. A rounded stage; the location box is **blue**, matching the ring on the focused field, and pulses once when it appears |
| Extracted information | Action bar: Run AI again (quiet) and Confirm (blue). The confirmed state is a green strip, read-only is the info note, the review step is a blue panel. AI issues are the amber note. The CI result uses the choice cards (No adverse findings ok, With findings amber). Each field is an inset card with a **blue ring** when it is the one shown on the document. **Keep / Update** are choice pills, and the chosen one's effect is written under them, not only in a tooltip. The Sex field is `SelectMenu`. Row tables use the table frame; amber cells = wrong format or hard to read, blue = focused |
| Chips | Matches ok · Differs amber · Not in application / not found slate · Hard to read amber · Expired amber · Corrected info · Wrong format err. Summary lines that used to be red (more than 10% off, undeclared loans, past dues) are amber (`.dc-flag`); "no issues" is green (`.dc-good`) |

**Spacing.** The page was loosened after feedback that it felt crammed (16 Nov 2026). In the shared header (all `.lf-folder` pages) the
title block has 0.6rem between lines, the meta chips sit 0.3rem lower, and a strip right under the header gets 0.35rem more than the grid gap. Panes have `1.25rem 1.4rem` padding and
1rem gaps, the workspace gap is 1.25rem, document cards are 3.4rem tall, field cards have `0.9rem 1rem` padding with 0.75rem
between them, and the extracted-values sections are 1.5rem apart.

**Motion** (all off under reduced motion): the panel rows rise in as on the loan folder. The staff-check body drops in (0.25s) and its chevron turns. A new document's viewer and
values fade in (4px, 0.3s). The working spinner turns (0.9s loop). The location box pulses once (0.9s). Document cards
nudge 2px on hover.

---

## 8. Background skyline (`src/components/skylineBackdrop.jsx`)

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

## 9. Motion

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

## 10. Accessibility checklist

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

## 11. Converting a page: the playbook

Use this section to bring a page that still has its older styles (financial package, CI request, credit score,
review, profiles…) in line with the work tray and loan folder. It gathers the reusable parts: steps, tokens,
scales, components and the mistakes already made once.

### 11.1 Steps

1. **Give the page a root class and the panel.** The page's root element is the direct child of `.ct-main`. Give it
   the page panel: max-width 110rem, radius 30px (22px at ≤960px), padding `1.5rem 2rem 2rem` (`1rem` at ≤960px),
   `grid-template-columns: minmax(0, 1fr)`. Use the **near-opaque** panel for reading and working pages (loan folder
   values, section 6). Keep the see-through panel only for dashboards.
   - **Shortcut for `.lf-*` pages** (financial package, CI request, credit score, review): add `lf-folder` beside `lf`
     on the root. That brings the panel, glass cards, pills, section nav, step strip, breadcrumb, chips, notes and all
     the dark-mode tokens in one go. The name is historical; it is not loan-folder-only. **It also takes the page
     off the dark light-sheet at once** (step 2 happens automatically), so check dark mode and do steps 3 and 5
     before shipping. Otherwise the page's own light-only boxes end up on dark glass.
2. **Take it off the dark light-sheet.** Add the page's root class to the `:not(.wt-page, .lf-folder)` rule at the end
   of `applicantTheme.css`. Do this only once the page has its own dark rules.
3. **Restyle the page's own classes** (`fp-*`, `rv-*`, `ci-*`…) with the tokens in 11.2. Don't use raw hex values.
   Scope every new rule to the page's root class, so the pages that share the classes don't change.
4. **Swap the pieces** using the table in 11.4. For example, a native `<select>` becomes `SelectMenu` or
   `FilterSelect`, boxed key/value rows become label-over-value tiles, and bare tables get the table frame.
5. **Wrap anything not dark-ready in `.lf-paper`.** This covers Tailwind panels with fixed light colours and the
   applicant forms. They stay light in dark mode instead of turning unreadable.
6. **Add motion** with the standard recipe (11.6), inside `@media (prefers-reduced-motion: no-preference)`.
7. **Update the loading skeleton** (`components/skeleton.jsx`) to the new markup, so nothing jumps when data arrives.
8. **Check it** against 11.9, then document the page here: a section like 6 with its layout sketch, parts and motion.

### 11.2 Tokens (`.lf-folder` in `loanFolder.css`; copy the pair for a new root class)

| Token | Light | Dark | Use |
|---|---|---|---|
| `--lf-glass` / `--lf-glass-hi` | white 0.78 / 0.92 | `rgba(22,34,68,.62)` / `rgba(30,46,90,.75)` | Cards and tiles / their hover |
| `--lf-glass-rim`, `--lf-glass-shadow`, `--lf-glass-blur` | white 0.8 rim, soft navy shadow, `saturate(1.5) blur(20px)` | white 0.08 rim, black shadow | Card edge, depth, frost |
| `--lf-inset` / `-hover` / `-rim` | white 0.62 / 0.88 / 0.9 | white 0.04 / 0.08 / 0.08 | Cards inside cards (no blur of their own) |
| `--lf-control` / `-hover` / `-rim` | white 0.72 / `#fff` / white 0.95 | white 0.07 / 0.14 / 0.14 | Pills: buttons, chips, pager, crumbs |
| `--lf-selected` | `#fff` | `rgba(126,162,255,.18)` | Current nav item, pressed filter, current step |
| `--lf-wash` | `rgba(20,41,95,.05)` | white 0.05 | Quiet fills: segmented track, latest-result box |
| `--lf-hair` / `--lf-track` | `rgba(20,41,95,.08)` | white 0.08 / 0.09 | Hairlines / empty meter and ring track |
| `--lf-text-2` / `--lf-text-3` | `#2b3a5c` / `#4c5a73` | `#c7d2ee` / `#a3b0cc` | Strong secondary text / eyebrows, small-caps labels |
| `--lf-accent` / `--lf-accent-bg` | `#1e3f97` / `rgba(30,63,151,.1)` | `#a9c0ff` / `rgba(126,162,255,.16)` | Icons, counts, links / their tinted backgrounds |
| `--lf-hollow` | `#8b97ab` | `#8f9cba` | "Not done" rings and dashed icons |
| `--lf-block-bg` / `-line` / `-head` | `#fff` / navy 0.13 / blue 0.06 | white 0.035 / 0.14 / blue 0.12 | Bordered blocks, table frames, header bands |
| `--lf-sub-bg` / `--lf-sub-line` | navy 0.035 / 0.09 | white 0.04 / 0.11 | Sub-panels inside a block |
| `--lf-ok` `-bg` `-line`, `--lf-warn…`, `--lf-none…` | `#15714a` · `#a8480b` · `#475569` | `#4ade80` · `#fdba74` · `#a3b0cc` | Status tones (set `--tone*` via `.ok` / `.warn` / `.none`) |
| `--lf-orange` / `--lf-orange-text` | `#c2410c` / `#c2410c` | `#c2410c` / `#fdba74` | Fill behind white text / orange as text |
| `--lf-blue-grad`, `--lf-bar-grad` | `#14295f → #1e3f97 → #2b52c4`, `#1e3f97 → #3a63d6` | same | Primary buttons, done discs / meters |
| `--lf-ease` | `cubic-bezier(0.2, 0.8, 0.2, 1)` | same | Every transition and animation |

The general tokens (`--ink`, `--muted`, `--navy`, `--blue`, `--blue-700`, `--line`, `--line-strong`) are redefined
for dark mode on the root too. Anything that uses them adapts for free.

### 11.3 Scales

| | Values |
|---|---|
| **Corners** | 30px page panel · 22px cards · 20px tiles · 18px step cards, dashed strips · **16px** inset cards, blocks, sub-panels, notes · 14px table frames, menus, choice cards, text areas · 12px inputs and small boxes · 10px menu items, tab tops · 8px mode tag · 6px timeline tags · **999px** every button, chip, filter, crumb, meta chip and segmented control |
| **Type** | Page title 2.1rem / 700 / −0.03em navy (1.7rem at ≤960px) · section title 1.5rem / 700 · card title 1.1rem / 700 navy · widget title 1rem / 600 · body 0.92–1rem · meta 0.84–0.88rem muted · small-caps label 0.72rem / 700 / 0.07em uppercase · chip 0.76rem / 700 · big numbers 1.65–2.3rem / 600, tabular, −0.03em |
| **Spacing** | 1–1.25rem between cards · card padding `1.25rem 1.4rem` (`1rem 1.1rem` at ≤960px) · 0.75–1rem inside cards · field tiles `0.95rem 1.5rem` |
| **Touch** | Every control is at least 2.75rem (44px) tall; compact ones grow to that under `(pointer: coarse)` |
| **Breakpoints** | 1300px (side rail stacks) · 1100px (dashboard to 2 columns) · 960px (frame and nav stack, tighter padding) · 640px (single column) |

### 11.4 Which piece for which job

| Need | Use | Notes |
|---|---|---|
| Page header | Eyebrow (icon + page kind + mode tag), title, meta chips, action pills (`.lf-hero`) | Status tags: blue "You can edit", slate "Read-only" |
| A card | `.lf-card` + `.lf-cardhead` (`h2` + muted `span`, or `.lf-cardtitle` + `.lf-count`) | One h2 per card, sentence case |
| A number someone acts on | `.lf-tile` (a `<button>` when it does something) or a ring / donut with legend keys that **filter** | "Every number filters" |
| Primary action (one per area) | Blue gradient pill (`.lf-primary`, or any `type="submit"` in the folder) | |
| Secondary action | Glass pill `.lf-btn`; quieter `.lf-btn.quiet` | |
| "Go on / it's waiting on you" | Orange: solid `#c2410c` (Next, Assign me) or outline (`.lf-ask-btn`) | Never more than one or two per screen |
| Inline text action | `.lf-linkbtn`; Clear filters is orange text | |
| Icon-only button | `.lf-iconbtn` (2.75rem) with an `aria-label` | |
| Count on a button | Orange `.count` badge = unread / waiting; blue `.lf-btn-n` pill = a plain count | |
| Status | Chip `.lf-chip ok/warn/none`, or icon + word; `.lf-tag` for Incomplete | Never colour alone |
| Note / warning / success / error | `.lf-note` (info, icon) · `.lf-warnnote` or `.ci-warn` · `.lf-ok-note` · `.lf-err` with `role="alert"` | 16px strips |
| A list of records | Inset cards with a left status stripe (`.lf-kyc-item`), or a timeline (`.lf-tl`) for changes | |
| A table | `.ci-tablewrap`-style frame: 14px rounded border, tinted uppercase header band, hairline rows, row hover | `display: table; width: 100%` inside the wrapper |
| Key / value data | Label-over-value tiles (`.sum-fields` / `.sum-f`), grouped in `.sum-block` cards (header band + body) and sub-panels | Hide empty values behind a "Show empty fields" switch |
| Too much at once | Tabs (`.lf-tabs`, ARIA tabs) or a collapsible card (`<details>` like `.lf-history`) | |
| Filter a list | Segmented buttons `.lf-seg` (`aria-pressed`) for 3–5 options; `FilterSelect` for longer lists; a search pill | Show "n of N" and a Clear |
| Choose in a form | `SelectMenu` (via `Field options`), never a native `<select>` | `FilterSelect` is for toolbars, `SelectMenu` for form fields |
| Yes / no, one of two | `.ct-yesno` pills (forms) or `.lf-choice` cards with drawn radios (decisions) | |
| On / off | `.lf-switch` (checkbox with `role="switch"`) | |
| Upload | Native file input; the theme styles "Choose Files" as a blue pill | |
| Section nav on a long page | Sticky `.lf-nav` with numbered groups, status icons and a blue current-item bar | |
| Something not yet dark-ready | Wrap it in `.lf-paper` | |
| Who did it, and when | `Byline` (`components/byline.jsx`): stacked in cards, inline in strips and chips; header facts are a label + value | 11.10. Never hand-write "by X · date" |

### 11.5 Colour rules

- **Blue** for structure, links, selection, primary actions and counts.
- **Orange** only for what waits on the viewer: Next, Assign me, Ask the applicant, unread counts, Clear filters,
  the "Next" step. Use `#c2410c` behind white text, never the brighter `#f26a33`.
- **Green / amber / red** mean status. **Red is turnaround time only.** A missing or incomplete value is **amber**.
  Errors in forms use the form red (`--red`) with a message, not a TAT chip.
- **Action tags** (Added / Changed / Removed) use the blue scale and slate, so they never read as a status.
- **Highlights** (search matches, a pressed filter) are light blue.

### 11.6 Motion recipe

| Moment | Standard |
|---|---|
| Page load | Each panel row rises 12px, 0.55s, staggered about 0.05s; lists cascade 4px, 30ms apart, first 12 only |
| Switching view (tab, section, filter) | Remount the content (`key`) so it fades in 4px, 0.3–0.35s |
| Hover | Cards and tiles lift 2–3px, 0.2s; buttons lift 1px; arrows nudge 2–3px toward their direction |
| Menus | Drop in 0.18s (fade, 6px, scale 0.97); items 18–22ms apart; chevron turns 0.25s |
| Numbers and meters | Count up 700ms (`useCountUp`); rings draw 0.9s; meters fill 0.8s from the left |
| Rules | Use `--lf-ease` throughout. Animate transform and opacity only, never width or height. Close faster than open. Put everything in `@media (prefers-reduced-motion: no-preference)` |

### 11.7 Alignment rules

- **Grids never blow out:** columns are `minmax(0, 1fr)` and grid children get `min-width: 0`. Without this, one long
  value widens the whole page on phones.
- **Rows of fields line up:** a label-over-control item is a **subgrid** spanning shared rows (label, control, hint,
  error), with the label at the bottom of its row. A wrapped label then can't push its control below its
  neighbours'. See `.sum-f` and the `.ct-field` rule.
- **Same grid, same width:** groups whose columns should line up (a borrower's sub-panels) are all full width with
  the same column template. Don't put them side by side.
- **First-line alignment in cards:** an icon | text | chip row is a 3-column grid pinned to the top. The icon box,
  text line and chip are all the same height (1.5rem). The card's body sits in the text column, so every line
  starts at the same x.
- **Keep a `*` with its label** (no-break space). Use `overflow-wrap: anywhere` for names, addresses and ids.

### 11.8 Gotchas (each one cost a round of fixes)

- **Tailwind makes every `svg` a block.** Inline icons in text need `display: inline-block`.
- **`font: inherit` resets `line-height`.** Put `line-height` after it.
- **A flex rule left on an element you turn into a grid** (`justify-content: flex-start`) shrinks the grid's columns.
  Set `grid-template-columns` and `justify-content: stretch`.
- **Layers:** theme and component rules live in `@layer components`, so the unlayered page CSS beats them. Tailwind
  `!important` utilities can't be beaten from unlayered CSS. Give the component a `plain` / `className` prop instead
  (see `AskApplicantButton`).
- **A shared class changes every page that uses it.** Scope new rules to the page's root class, and make shared
  component changes opt-in (props such as `tools`, `groups`, `plain`, or a context like `SummaryContext`).
- **`backdrop-filter` on a parent** stops the children from blurring the canvas. It also makes a containing block
  for `position: fixed`. Keep it off panels and use portals for tooltips and drawers.
- **Sticky elements** need `top: calc(var(--ct-head) + var(--ct-gap) + 1rem)` so they clear the top bar.
- **ids built from labels can contain spaces,** which breaks `aria-labelledby` and `aria-describedby`. Replace spaces
  first.
- **Line endings:** some CSS files are CRLF. Keep each file's existing endings when editing with scripts.
- **Headless screenshots:** Edge has a ~500px minimum window, so test phone width inside a 390px iframe. Sticky
  elements look pushed down on an unscrolled test page.

### 11.9 Definition of done

- [ ] `npm run lint` and `npm run build` pass
- [ ] Light and dark both checked; nothing light-only left on dark glass (or it is on `.lf-paper`)
- [ ] 390px wide: no sideways scroll, nothing cut off
- [ ] Keyboard: every control reachable, visible focus ring, menus work with arrows / Esc
- [ ] Contrast 4.5:1 for text; colour is never the only signal
- [ ] Reduced motion: no animation, numbers show straight away
- [ ] Shared classes and components still look the same on the pages that weren't converted
- [ ] Skeleton matches the new layout
- [ ] This file updated (page section, motion, files, open points)

---

### 11.10 Attribution: who did it, and when

Every "by Josh Denzel Account Officer · Oct 26, 2026, 2:07 PM" line became one component, after feedback that these
lines always looked off (16 Nov 2026). The old lines had three problems: the role was repeated inside test names,
full timestamps broke across lines mid-date, and they read as run-on sentences.

**Use `Byline`** (`components/byline.jsx` + `byline.css`; formatting in `components/people.js`, tested in
`tests/people.test.mjs`):

| Layout | Looks like | Use for |
|---|---|---|
| `stacked` (default) | (JD) **Josh Denzel** / Account Officer · Today, 2:07 PM | Cards and lists (KYC cards, the latest check) |
| `inline` | (JD) **Josh Denzel** · Credit Officer · Yesterday, 4:48 PM | Strips, chips, timeline rows, summary rows |
| `ai` | (✦) **AI** · claude-sonnet-5-5 · Today, 11:00 AM | Something the AI produced (the model goes in `role`) |
| `time="day"` | Sep 29, 2026 | A record date, not an event time |

**Rules**

- **Name:** `personName()` drops a role label from a test account's name ("Josh Denzel Account Officer" → "Josh
  Denzel"). The role, when it matters, is its own quiet item.
- **Avatar:** initials in the person's pastel tone (`avatarStyle()`, the same tones as the work tray), so the same
  person looks the same everywhere.
- **Time:** short and relative while it is recent: Just now · 12 min ago · Today, 2:07 PM · Yesterday, 4:48 PM ·
  Thu, 2:07 PM (this week) · Oct 26, 2:07 PM (this year) · Oct 26, 2025 (older). The exact moment is in the tooltip
  (`fullWhen()`) and in `<time datetime>`. The locale is fixed to `en-PH`, so every viewer sees the same format.
- **Wrapping:** a name truncates with an ellipsis; a role or a time **never breaks inside itself**. Items wrap only
  between each other, and the "·" separators are drawn by CSS, so a missing item leaves no stray dot.
- **Extras after a byline** (a count, a status) are small chips, not "· 5 values". A chip can wrap to the next line
  without starting with a dot.
- **Header facts** (`.lf-meta`): a quiet label, then the value: "📅 Submitted **Sep 29, 2026**", "➤ CI requested
  (JD) Josh Denzel · Yesterday, 4:48 PM". No sentences ("CI requested Oct 20, 2026, 4:48 PM by …").
- **Verbs** stay outside the byline: "Confirmed by" + byline, "Sent by" + byline. Don't repeat "by" or "on".
- **Search** still matches both forms: the change history indexes the short time and the full date.

**Where it is used:** the loan folder header facts, the KYC cards and check panel, the change history timeline, the
staff check of a file, the document check's AI line and confirmed strip, the CI request's sent line, and the step
strip's "Sent …". `whenOf()` (`loanFolder/options.js`) is still used by pages that haven't been converted; switch them
to `Byline` / `formatWhen` when they are.

---

## 12. Files and open points

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
| `src/pages/loanFolder/loanFolderPage.jsx` | Loan folder: header, dashboard, KYC board, section view with the check rail |
| `src/pages/loanFolder/kycOverview.jsx` | KYC ring with filtering legend, filterable section board, status icons |
| `src/pages/loanFolder/loanFolder.css` | Shared `.lf-*` staff styles first, then the timeline, then the loan folder blocks scoped to `.lf-folder`: Look, Layout, Motion, Dark mode |
| `src/pages/documentCheck/documentCheck.css` | Document check: workspace panes, document list, viewer, extraction panel, `info` / `err` chip tones |
| `src/components/byline.jsx`, `byline.css`, `people.js` | Who + when: `Byline`, and name / initials / avatar tone / time formatting (tested in `tests/people.test.mjs`) |
| `src/pages/documentRequests/requestPanel.jsx`, `requestPanel.css`, `fileMark.jsx` | Ask the applicant for documents (section 6) and the shared staff check of a file |
| `src/pages/messages/messagesPanel.jsx`, `messages.css` | Messages trigger and drawer, own `--m-*` tokens (section 6) |
| `src/components/selectMenu.jsx`, `selectMenu.css` | Animated form dropdown used by every `Field` with options (applicant wizard and loan folder) |
| `src/pages/workTray/workTray.css` | All work tray styles. Later blocks override earlier ones and are labelled: Look, Table, Colour, Motion, Dropdowns, Dark mode |

**Open points**

- **Dark mode vs. meeting feedback.** `notificationBell.jsx` records "no dark mode". It is opt-in for that
  reason; confirm with the group or advisor before keeping it.
- **Other pages** (financial package, CI request, credit score, review, profiles) still use their older styles and
  show on a light sheet in dark mode. Convert them with the playbook in section 11.
- **A generic name for the shared look.** `.lf-folder` and its `--lf-*` tokens now serve as the shared staff look
  (section 11.1). Renaming them to something neutral (e.g. `.ct-staff` / `--st-*`) would make that clearer. Do it in
  one pass across `loanFolder.css`, `applicantTheme.css` and the pages, and update this file.
- **Native selects left on other pages:** Credit score, Staff accounts and Approval routing still use
  `<select>`; move them to `SelectMenu` / `FilterSelect` when those pages are converted.
- **Chip tones `info` and `err`** live in `documentCheck.css` for now. Move them to the shared `.lf-folder` block
  (`loanFolder.css`) when a second page needs them.
- **Loan folder's embedded panels.** The applicant forms stay light in dark mode (on paper, `.lf-paper`). Converting them means replacing their fixed Tailwind colours with tokens, as was done for Ask the applicant and Send notice.
- **`workTray.css` layering.** It grew in stages, so some properties are set more than once. When you tidy it,
  fold each block's overrides into the original rules and delete the dead `.wt .wt-select` rule.
