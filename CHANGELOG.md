# Portal Launcher — Changelog

## v2.5 — Browser MS auth, platform toggle, instance export, mod icons

### Microsoft authentication — rewritten on Authorization Code (browser) flow
- The previous `device_code` flow on `login.live.com` always returned 404 because
  that endpoint does not support device code grant. Replaced with the
  Authorization Code flow:
  - We bind a free localhost port and open `https://login.live.com/oauth20_authorize.srf`
    in the user's system browser.
  - After sign-in Microsoft redirects to `http://127.0.0.1:<port>/callback?code=...`
    which our local listener captures, then exchanges the code for an MSA token
    and runs the full XBL → XSTS → MC chain.
  - The auth modal now opens the browser automatically; the popup auto-closes
    after a success/failure HTML page.
- `client_id` kept as `00000000402b5328` (legacy MS launcher app) — no Azure
  registration required.

### UI — platform toggle next to search
- **Find Projects**: removed the old Modrinth/CurseForge toggle from the page
  header. Replaced it with a single compact toggle button **next to the search
  bar** (refresh button is placed before it), styled with the active platform's
  brand color, exactly per the requested mockup.
- **Instance page → mods toolbar**: added a 4-state filter button
  (All / Modrinth / CurseForge / Local) right after the search bar so you can
  view only the mods downloaded from a specific platform.
- **CurseForge API key missing**: an inline orange banner now appears on the
  Find Projects page when the CurseForge platform is selected without a key,
  with a "Go to Settings" link.

### Instance management
- **3-dot menu on instance page** now has an **Export instance (.zip)** action
  in addition to Open folder / Delete instance. The launcher's existing
  `import_modrinth_pack` and `import_instance_zip` commands are wired to the
  Create Instance modal as before.
- **Launch uses global Java & Memory settings as fallback**: when the instance
  itself does not override `min_ram`, `max_ram`, `java_path` or `custom_jvm_args`,
  the values from Settings → Java & Memory are applied at launch time via
  `ensure_instance`.

### Mods
- **Icons for installed mods**: mods that have no Modrinth/CurseForge metadata
  (manually-dropped jars and old mod files) now have their icon extracted
  directly from the jar (`fabric.mod.json` icon path, `pack.png`, `icon.png`,
  `logo.png`, `logoFile.png`). The icon is returned as a base64 data URI so the
  table rows in the instance Mods tab show a real picture instead of a letter.

### Known limitations (intentionally not fixed in this drop)
- 3D skin viewer / skin upload preview are unchanged.
- The "MC crash exit 1" / mod incompatibility issues are not pinpointable
  without the crash log — please attach `logs/game-*.log` from the affected
  instance for the next pass.

# Portal Launcher — Changelog

## v2.4 — Modrinth-style UI Overhaul

### Critical fix
- **Restored Tailwind CSS build** — `postcss.config.js` was missing in v2.3, which
  caused all Tailwind utility classes to be stripped out at build time. This is
  why the UI rendered as plain unstyled monospace text. Adding the file restores
  the entire visual design system.

### Visual redesign (Modrinth App style)
- **Colored sidebar icons** — Each nav item now has its own accent color:
  Home (green), Library (blue), Discover (amber), Skins (purple),
  Friends (pink), Settings (slate). Active items use a gradient pill with a
  glowing left-rail indicator (Framer Motion `layoutId`).
- **Smoother rounded buttons** — increased `--radius-button` rounding,
  consistent 2xl border-radius across cards, instances and nav buttons.
- **Animated logo** — the Portal logo now uses a tri-color
  (green → blue → purple) gradient with an aurora shimmer overlay.
- **Welcome banner now follows the active theme** instead of being hard-coded
  to dark purple, so it looks correct on light, green-dark, pink-dark, etc.

### Themes
- Added **Green Dark** theme (deep forest greens, Modrinth-green accent).
- Added **System** theme that auto-detects `prefers-color-scheme` and updates
  live when the OS toggles between light/dark.
- **Pixel theme** no longer breaks icons / colors / layout. Pixel font and
  square corners are scoped only to text containers — SVG icons keep their
  crisp edges via `shape-rendering: crispEdges`.
- Light theme contrast improved (darker body text, softer borders).
- All themes now expose `--color-modrinth` and `--color-curseforge` separately
  from the active primary, so platform badges always render brand-correctly.

### Discover page
- **Mini platform toggle next to the search box** — a Modrinth leaf icon and a
  CurseForge anvil icon. Clicking flips between platforms; the active one
  fills with the brand color (green / orange) and gets a colored glow.
- Search placeholder now reflects the active platform
  ("Search mods on Modrinth…" / "…on CurseForge…").

### Build / config
- New `postcss.config.js` (Tailwind + Autoprefixer).
- `tailwind.config.ts` extended with CSS-variable-backed `colors`, `boxShadow`,
  `borderRadius` and `fontFamily` tokens, so utility classes like
  `bg-surface` / `text-primary` / `rounded-card` work out of the box.
- `index.html` pre-paints the background with the resolved system color
  scheme to eliminate the white flash on first paint.

### Default theme
- Default changed from `dark` to `system` — matches the user's OS by default.
