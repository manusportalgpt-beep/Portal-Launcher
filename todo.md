# Mod update repair

# Full localization and OptiFine

- [x] Audit hardcoded Russian/English strings, alerts, errors, tabs, tooltips and settings labels.
- [x] Add missing RU/EN translation keys and replace mixed-language UI text.
- [x] Verify language persistence and fallback behavior for missing keys.
- [x] Trace OptiFine version loading, custom `.jar` import, compatibility checks and installation.
- [x] Fix OptiFine selection/install errors without changing Fabric, Forge, NeoForge or Quilt.
- [x] Verify OptiFine is shown as a core and installed in the correct instance path.
- [ ] Run TypeScript checks and package the localization/OptiFine fix.

# LabyMod account capability and System theme

- [x] Locate LabyMod eligibility check and account provider/type fields.
- [x] Ensure Microsoft/Mojang accounts are treated as licensed and Ely.by/offline accounts remain restricted.
- [x] Make the LabyMod dialog explain the exact reason only for unsupported account types.
- [x] Locate theme store initialization and set System as the fallback default.
- [x] Preserve an explicitly saved user theme instead of overwriting it.
- [x] Run TypeScript checks and package the fix.

# Direct instance shortcuts

- [x] Locate shortcut creation command and current target/arguments/icon handling.
- [x] Add a direct-launch command-line mode that starts only the selected instance.
- [x] Ensure shortcut invocation does not open or focus the main launcher window.
- [x] Convert the instance icon to a real Windows shortcut icon and use it as `IconLocation`.
- [x] Preserve Microsoft/Ely.by auth and first-run prepare-only behavior for shortcut launches.
- [x] Run TypeScript checks and package the shortcut fix. Rust cargo check is blocked by sandbox Cargo 1.75 parsing the existing edition2024 dependency.

# Skin texture deduplication

- [x] Locate skin history persistence and texture download/save code.
- [x] Compute a stable hash or byte comparison for each PNG texture.
- [x] Reuse the existing texture path when the same skin texture is applied again.
- [x] Deduplicate legacy history records without deleting the active skin.
- [x] Keep Ely.by, Microsoft and local skin history compatible.
- [x] Run checks and package the fix.

# Prepare-only first launch

- [x] Locate launch_instance flow after install_version, Java and natives preparation.
- [x] Detect whether the required Minecraft files were missing before preparation.
- [x] Return a ready-for-launch result after first preparation instead of spawning Minecraft.
- [x] Preserve normal launch behavior when all required files were already present.
- [x] Show a clear ready status and tell the user to press Launch again.
- [x] Run available checks and package the fix.

# Installation progress scope

- [x] Identify which progress events are emitted during normal Minecraft launch.
- [x] Mark instance import/install events with an explicit installation context.
- [x] Ignore normal launch/download/install events in the instance-install progress bar.
- [x] Keep the progress bar visible for actual pack import/install and hidden on subsequent launches.
- [x] Run TypeScript checks and package the fix.

# Persistent instance installation

- [x] Locate local install progress state, backend progress events, and navigation unmount behavior.
- [x] Move installation state into a shared store that survives page changes.
- [x] Keep the backend installation task alive when the instance page unmounts.
- [x] Add a global progress indicator with stage, percent, file counts, and error/completed states.
- [x] Restore the same installation progress when returning to the instance page.
- [x] Run TypeScript checks and package the fix.

# Install Preview manifest metadata

- [x] Locate the Install Preview component and manifest dependency parser.
- [x] Trace why author/version/icon metadata is empty on first open but appears after reopening.
- [x] Add manifest metadata cache and request deduplication.
- [x] Load dependency metadata in batches and update preview cards incrementally.
- [x] Keep install enabled with a clear loading state instead of `Loading metadata…` placeholders.
- [x] Run TypeScript and available Rust checks; TypeScript passed and Rust formatting is unavailable in the sandbox.

# Compiler, manifest and avatar/icon reliability

- [x] Fix `&str` versus `str` comparison in `src-tauri/src/commands/mods.rs`.
- [x] Locate manifest loading and prevent first-load metadata from rendering incomplete records.
- [x] Add stable metadata/icon loading and cache reuse after the manifest is ready.
- [x] Fix Microsoft UUID head/avatar URL with fallback and error recovery.
- [x] Crop/prepare the Modrinth wrench icon and use it in the existing Modrinth icon locations.
- [x] Run TypeScript checks. `rustfmt` is unavailable in the sandbox; the compiler fix is applied at the reported line.
- [x] Prepare an archive and write a short GitHub-only fix instruction.

# Instance loading and project avatar

- [x] Locate the instance page bootstrap effect and all awaited calls that block first render.
- [x] Locate instance icon/avatar data and Find Projects navigation context.
- [x] Render the instance shell immediately and load secondary data independently.
- [x] Prevent duplicate bootstrap requests and expensive repeated scans.
- [x] Pass the instance avatar into Find Projects and add a stable fallback.
- [x] Run TypeScript checks and package the performance/avatar fix.

# Resource files, previews and clicker

- [x] Locate file classification and the source of the Mods/Resource Packs/Shaders tabs.
- [x] Locate file move commands and Files UI actions.
- [x] Locate world preview generation/loading and player head/skin image loading.
- [x] Locate clicker request/loading trigger and current click counter behavior.
- [x] Fix resourcepack and shaderpack classification without changing normal mods.
- [x] Add safe file/folder move between instance directories with overwrite protection.
- [x] Restore world preview loading with a fallback state.
- [x] Restore player head rendering with provider-aware fallback URLs.
- [x] Batch clicker loading so a request is triggered only after three clicks.
- [x] Run TypeScript checks and package the repaired project.

# Search filters and icons

- [x] Locate filter state, source tabs, category mapping, and query construction.
- [x] Verify Modrinth category parameters independently from CurseForge category parameters.
- [x] Identify why two selected filters produce empty results or are not applied.
- [x] Fix selected filter chip/icon rendering so icons remain visible in active and inactive states.
- [x] Preserve clear-all, remove-chip, source switching, loader and Minecraft version filters.
- [x] Run TypeScript checks and package the repaired project.

# Game log isolation

- [x] Locate all log/event listeners used by the Minecraft log screen.
- [x] Identify launcher UI/session events that are currently leaking into the game log view.
- [x] Keep only stdout/stderr and process events belonging to the active Minecraft instance.
- [x] Preserve log filtering, auto-scroll, copy, clear, crash analysis, and mclo.gs sharing.
- [x] Update README with the new log scope, instance identity, and diagnostics behavior.
- [x] Run TypeScript checks. Rust validation remains limited by the sandbox Cargo 1.75 toolchain and the existing edition 2024 dependency requirement.
- [x] Prepare an archive containing the log isolation fix and README changes.

# One-launch log sessions, interface controls and Manus achievement

- [x] Locate game-log persistence, launch boundaries and session reset events.
- [x] Reset visible game logs when a new Minecraft process is started, while retaining all lines during one running session.
- [x] Preserve crash analysis and mclo.gs sharing for the current session only.
- [x] Extend Appearance with safe layout-scale, density and interface-control settings that preserve existing themes.
- [x] Locate the clicker counter, achievement data and audio effect pipeline.
- [x] Add the 250-click “Who are you?” achievement with the requested Manus image and a dedicated one-time click sound.
- [x] Verify TypeScript production build and package the complete project archive.


- [x] Locate frontend update action and backend command used to update a mod.
- [x] Trace version resolution, download path, filename normalization, and replacement logic.
- [x] Verify that the old mod remains intact until the new artifact is fully downloaded and validated.
- [x] Implement atomic update with a temporary file, backup/rollback, and cleanup of stale partial files.
- [x] Preserve loader/version compatibility and avoid renaming a mod into an invalid filename.
- [x] Improve update progress and error reporting for failed downloads or invalid artifacts.
- [x] Run TypeScript checks. Rust `cargo check` is blocked by the sandbox Cargo 1.75 toolchain, which cannot parse the existing edition 2024 dependency manifest.
- [x] Prepare an archive with the repaired project.

# Instance Settings redesign

- [x] Inspect the current Instance Settings layout, update flow and image/icon storage.
- [x] Rebuild the page hierarchy around a visual instance header, contextual left navigation and prominent save/play actions.
- [x] Add a safe local cover-image replacement workflow with preview and removal.
- [x] Improve Minecraft version, loader and loader-version controls without breaking automatic Java or existing instances.
- [x] Keep General, Java & Memory, Content and Maintenance tools reachable in the redesigned layout.
- [x] Verify TypeScript production build and package the complete project archive.

# Desktop shortcut icon quality

- [x] Locate the highest-quality Portal Launcher source icon and the Windows shortcut creation code.
- [x] Generate or select a multi-resolution Windows ICO resource with 16–256 px entries.
- [x] Make newly created instance shortcuts reference the high-quality ICO resource.
- [x] Verify the resource paths and package the complete project archive.

# Per-instance desktop shortcut image

- [x] Trace the selected instance cover from the interface to the Rust shortcut command.
- [x] Convert the selected image data or on-disk icon into a multi-resolution ICO for the instance shortcut.
- [x] Fall back to the high-quality Portal Launcher icon only when the instance has no image.
- [x] Verify frontend build and package the complete project archive.

# Java module Path import

- [x] Inspect imports in commands/jvm.rs and add the missing Path type.
- [x] Package the corrected source archive without running the frontend build.

# Workspace edge and localization regression

- [x] Locate workspace padding defaults and remove the unintended outer margin.
- [x] Make 100% workspace width fill the remaining area after navigation, without a blank right column.
- [x] Keep optional Appearance spacing controls without allowing the default layout to float away from the window edges.
- [x] Remove the global text-mutating LocaleTextBridge from the app shell.
- [x] Add proper i18n keys for the screens changed in the recent work.
- [x] Verify frontend build and package the repaired project archive.

# Shortcut, author scroll and log clear fixes

- [x] Move generated shortcut ICO files out of the Desktop and remove obsolete desktop ICO artifacts.
- [x] Keep one direct-launch `.lnk` per instance and preserve its custom cover icon.
- [x] Restore scrollability on AuthorPage for long project lists.
- [x] Persist manual log clearing so the cleared session is not restored on tab navigation.
- [x] Verify frontend build and package the repaired project archive.

# Unified launcher fixes

- [x] Remove the duplicate standalone search-results count shown below the search field.
- [x] Verify the primary Portal Launcher icon source, ICO sizes, Tauri packaging and shortcut icon target.
- [x] Keep exactly one direct-launch shortcut per instance and never expose helper ICO files on the Desktop.
- [x] Make installed pack icons and names visible in the global installation progress surface.
- [x] Add library-level drag-and-drop import for .mrpack and .zip builds using the real importer.
- [x] Keep build installation running across navigation and show themed top-right progress.
- [x] Restore AuthorPage scrolling and session-persistent log clearing.
- [x] Add expanded Appearance controls, background music and optional video background with readability overlay.
- [x] Verify frontend build and package the complete project archive.

# Previous attempted feature setup was not used for this Tauri task; all implementation remains in Portal-Launcher-main.

# Compact progress, secret achievements and visual settings

- [x] Make the installation progress widget collapse into a compact themed icon and expand on demand.
- [x] Move Manus to the 500-click secret achievement, keep it hidden from public achievement lists, and show it for three minutes only when unlocked.
- [x] Add the visible Verity achievement at 1000 clicks with the text “Что-то случиться через 3 дня...”.
- [x] Restore the success sound after mod installation and route it through the existing audio settings.
- [x] Expand i18n coverage for settings, instances, mod pages, Discover, project pages and filters without translating internal identifiers.
- [x] Move Custom Background controls into the custom theme editor and repair background persistence/rendering.
- [x] Repair player head rendering and cape texture rendering in all skin/account states.
- [x] Remove Back/Cancel buttons from the requested creation and preset dialogs, leaving only the close icon.
- [x] Verify frontend build and package the complete project archive.

# Game log autoscroll

- [x] Inspect the log container ref, scroll listener and new-line effect.
- [x] Scroll the log container to its bottom when autoscroll is enabled and new lines arrive.
- [x] Disable autoscroll when the user manually moves away from the bottom, and restore it through the toggle.
- [x] Verify the frontend build and package the corrected project archive.

# Quilt 26.2 compatibility

- [x] Inspect Quilt version selection, Java version and launch argument construction.
- [x] Handle Minecraft 26.2 class file major version 69 with a compatible Quilt Loader/ASM strategy.
- [x] Ensure the Quilt launch path supplies a valid gameDir and mappings before loader initialization.
- [x] Verify the frontend build and package the Quilt fix archive.

# Discover and background media regression

- [x] Reproduce and locate the old Discover regression, including route state, filters and page shell rendering.
- [x] Trace custom background image persistence, URL/data loading and global layer rendering.
- [x] Trace background video persistence, source loading, autoplay/muted policy and visibility layering.
- [x] Fix image and video backgrounds without breaking Quiet Orbit themes, readability overlays or navigation state.
- [x] Verify Discover, Settings and navigation persistence with the selected background media.
- [x] Run TypeScript production build and package the corrected project archive.

# Modpack installation icons, metadata and cancellation regression

- [x] Trace modpack icon extraction, instance cover persistence and installed-content metadata resolution.
- [x] Restore imported pack icon in Library, instance header and global installation progress.
- [x] Resolve installed mod metadata/icons from manifest IDs and download URLs without treating every entry as Local file.
- [x] Reduce avoidable sequential metadata/download work during modpack installation while preserving progress accuracy.
- [x] Add a visible cancel action to the global installation progress widget and safely stop the active installation.
- [x] Verify cancellation, icon rendering, metadata rendering and production build; package the corrected archive.

# Crash diagnosis and mod conflict reporting

- [x] Trace current crash-log collection, mclo.gs response handling and in-launcher diagnosis UI.
- [x] Detect direct mod conflicts from crash logs, including conflicting mod IDs/names and the relevant log lines.
- [x] Detect non-conflict causes such as Java version, loader incompatibility, missing dependency, missing game file, authentication, network/download and native-library errors.
- [x] Show a concrete diagnosis when evidence exists and keep an explicit "cause not determined" fallback when it does not.
- [x] Preserve mclo.gs links and raw-log access without claiming a cause that the log does not support.
- [x] Run only `tsc` as requested, package the corrected archive, and do not run `pnpm build`.

# Windows executable build verification

- [x] Inspect Tauri bundle configuration, Rust targets and Windows installer settings.
- [x] Check whether the sandbox has a usable Windows cross-compilation target and required system dependencies.
- [x] Attempt the appropriate Tauri Windows build without changing project behavior.
- [ ] Verify generated artifact metadata and package the executable if produced.
- [x] Record the exact GitHub Actions fallback if local Windows compilation is unavailable.

# Final four UI regressions

- [x] Trace Notch Panel and Sidebar rendering for blur, backdrop-filter, scaling and device-pixel-ratio issues.
- [x] Separate Minecraft launch/preparation progress from actual installation/download progress so launching does not show as downloading.
- [x] Add a persisted interface opacity control in Appearance and apply it without making controls unreadable.
- [x] Restore background image/video visibility inside Settings while preserving readability overlays and theme layers.
- [x] Run TypeScript verification, update TODO and package the corrected archive.

# Final localization and Modrinth search regression

- [ ] Make Russian the default locale for a fresh install and normalize persisted invalid locale values.
- [ ] Audit visible Discover/Find Projects/filters labels for English fallback strings that bypass i18n.
- [ ] Trace Modrinth search loading, request cancellation, timeout and stale-response handling.
- [ ] Stop infinite Modrinth loading and show retry/error/empty states with Russian labels.
- [ ] Run TypeScript verification and package the final corrected archive.

# Complete current Modrinth integration

- [x] Inspect the Rust `search_modrinth` command, URL construction, response decoding and current Modrinth API compatibility.
- [x] Align frontend Modrinth facets, project type, loaders, versions, sort order, pagination and query encoding with the current backend contract.
- [x] Add request cancellation and a finite timeout without leaving stale loading state or stale results.
- [x] Preserve icon, author and result metadata from the current Modrinth response format.
- [x] Make Russian the default locale while preserving an explicit user-selected English locale.
- [x] Run TypeScript verification and package the final Modrinth/localization archive.

# Per-account player face cache

- [x] Trace Microsoft, Ely.by and offline account identity fields and current avatar/head rendering URLs.
- [x] Add device-local face-image storage keyed by provider plus stable account UUID/name.
- [x] Load cached face first, then refresh from the network and atomically replace the cached image only after a successful download.
- [x] Update navigation/account/profile surfaces to render the correct cached face per selected account with safe fallback initials.
- [x] Cleanly handle logout/account switching without deleting another account's cached face.
- [x] Run TypeScript verification and package the face-cache fix archive.

# Modrinth outage investigation — 2026-08-18

- [ ] Check official Modrinth status, API and website availability on the incident date.
- [ ] Check independent outage reports and regional connectivity evidence, including Russia and other regions.
- [ ] Compare external results with the Portal Launcher symptom: requests remain in loading with empty cards.
- [ ] Explain whether the issue is Modrinth-side, regional routing/ISP/DNS/TLS filtering, or a local launcher regression.
- [ ] Provide safe troubleshooting and fallback options without bypassing access controls or fabricating Modrinth data.

# Millida Launcher feasibility assessment

- [ ] Obtain the exact Millida Launcher repository or local project folder from the user.
- [ ] Inspect license, attribution requirements, dependencies and redistribution permissions.
- [ ] Compare Millida and Portal Launcher architecture, Tauri/Rust versions, frontend stack and storage/auth models.
- [ ] Identify reusable UI, launcher, account, hosting and social components without copying incompatible or restricted code.
- [ ] Prepare a migration plan with risks, estimated rewrite areas and a legally safe integration boundary.

# Millida to Portal Launcher full adaptation

- [ ] Map Millida engine, IPC commands, screens and service adapters against Portal features.
- [ ] Define Portal branding, GPL notices, attribution and Millida service replacement boundaries.
- [ ] Create a global theme token system covering surfaces, text, borders, controls, panels, overlays, media and states.
- [ ] Make Russian the default complete UI locale and keep English as an explicit alternate locale.
- [ ] Port Quiet Orbit visual language, free responsive layout, Notch Panel and Sidebar customization across every screen.
- [ ] Redesign Library, instance details, Discover, settings, skins, worlds, logs and progress surfaces for Portal Launcher.
- [ ] Replace Millida Files with the Portal file manager: syntax-aware editor, drag-and-drop, create/move/delete, search, sizes and log tools.
- [ ] Add Portal background image/video, interface opacity, theme editor and persistent media handling to the new shell.
- [ ] Add service-neutral Modrinth/CurseForge gateway adapters with transparent fallback and diagnostics.
- [ ] Plan migration tests for accounts, Java, loaders, imports, mods, worlds, skins, crash diagnosis and offline mode.
- [ ] Document GitHub Actions Windows/macOS/Linux build, GPL source distribution and artifact verification.

# Static audit of launcher-main.zip before first test

- [x] Inspect the supplied archive without launching, building or installing dependencies.
- [x] Inventory frontend screens, Rust commands, loaders, themes, Files and storage layers.
- [x] Compare present features with the Portal Launcher target feature set.
- [x] Identify missing loaders, theme surfaces, Russian localization, redesign areas and file-manager capabilities.
- [x] Prepare implementation order and risk notes; do not modify runtime behavior before the user's first test.

# Simple Russian Portal style and safe cleanup

- [ ] Use the supplied launcher as the visual reference: simple, readable, attractive and low-noise rather than overloaded.
- [ ] Use Russian for all future user-facing implementation text; preserve original English file/folder names in Files.
- [ ] Remove the oversized launcher title from the upper content area without removing the native window identity.
- [ ] Redesign minimize, maximize/restore and close controls in a minimal Portal style with clear hover and danger states.
- [ ] Audit project folders and identify unused text/config files using import, build and runtime references.
- [ ] Do not delete uncertain files; produce a safe cleanup report and target a compact folder only where removal is proven safe.
- [ ] Preserve the user's no-launch/no-build constraint until the first test is completed.

# GitHub Actions main workflow for launcher-main

- [x] Inspect the existing `.github/workflows/ci.yml` and package/Tauri build commands.
- [x] Add `.github/workflows/main.yaml` with readable build-stage log text and artifact upload.
- [x] Cover Windows first and retain optional macOS/Linux matrix entries without launching the app locally.
- [x] Validate the YAML and archive the modified launcher-main source.

# Millida functionality migration into Portal Launcher

- [ ] Compare Tauri IPC command registries, Rust engine modules, frontend state stores and API clients.
- [ ] Classify reusable local features versus Millida-specific cloud/account/hosting services.
- [ ] Plan the working Modrinth/CurseForge content engine migration with cache, dependencies, loaders and diagnostics.
- [ ] Plan friends, chat, presence, file sharing and hosting adapters without coupling Portal UI to Millida branding.
- [ ] Map Millida screens into the simple Russian Portal shell, themes and Portal Files manager.
- [ ] Define GPL-3.0-only attribution, source distribution, branding replacement and service-boundary requirements.
- [ ] Define migration milestones, test matrix and rollback strategy before implementation.

# Friends navigation and Modrinth resilience

- [ ] Add a Russian «Друзья» entry point to Portal Notch Panel and Sidebar.
- [ ] Connect both entry points to one Friends screen/state so navigation, unread count and selected profile remain synchronized.
- [ ] Wire friend list, presence, profiles, chat, notifications, rooms and file-transfer UI to available backend adapters with honest unavailable states.
- [ ] Add a transparent Portal Modrinth gateway/fallback boundary with cache, timeout, stale-response protection and source diagnostics.
- [ ] Do not implement server hosting in this change; reserve it for tomorrow's separate scope.
- [ ] Verify TypeScript and document any backend credentials or service requirements before packaging.

# Portal NAT Friends and Modrinth gateway

- [ ] Define Friends invite, identity, presence and room contracts shared by launcher clients.
- [x] Design STUN discovery and UDP hole-punching flow for direct peer connectivity.
- [x] Design authenticated relay fallback for symmetric NAT/CGNAT without exposing private addresses unnecessarily.
- [x] Connect LAN session state to Friends presence, invites, server address and Minecraft join flow.
- [x] Define secure session tokens, room expiry, rate limits, abuse controls and explicit user consent for background networking.
- [ ] Design an official Modrinth API gateway with search, project/version metadata, icons, downloads, cache and source diagnostics.
- [ ] Preserve Modrinth terms, attribution, takedown handling and rate limits; do not implement hidden access-control bypass.
- [ ] Define free/self-hosted deployment options and clear relay bandwidth limitations.

# Portal v1: Millida Friends adapter and Modrinth gateway

- [x] Preserve the current Portal launcher as the protected baseline and avoid hosting changes.
- [x] Define a Millida Friends adapter boundary for auth, friends, presence, profiles, chat, rooms and notifications.
- [x] Add synchronized Russian «Друзья» entry points to Notch Panel and Sidebar.
- [x] Connect the Portal Friends screen to Millida state without duplicating or corrupting Portal account state.
- [x] Add explicit unavailable/offline states when Millida API credentials or service are not available.
- [x] Add a transparent Modrinth gateway boundary with direct API fallback, cache, timeout and source diagnostics.
- [x] Preserve official Modrinth IDs, metadata, download URLs, rate limits and attribution.
- [x] Run TypeScript verification only where possible, inspect diffs, and package a rollback-friendly first-version archive.
- [ ] Add an explicit Millida account/token connection flow; do not reuse Microsoft/Ely.by access tokens as Millida credentials.

# Millida account isolation and profiles

- [x] Add isolated Millida account login flow without reusing Microsoft/Ely.by tokens.
- [x] Persist Millida session separately and implement explicit logout/expired-session handling.
- [x] Render authenticated Millida profile, avatar, friends, presence and selected profile details.
- [x] Preserve existing Microsoft, Ely.by and other authentication flows unchanged.
- [x] Add regression tests/type verification for auth boundaries and profile rendering.
- [x] Prepare a first-test archive without launching the game or running a production build.

These items supersede further Portal LAN tunnel work until Millida authentication and profile display are verified by the user.

# NAT/direct LAN and Modrinth gateway continuation

- [x] Bind Portal LAN sessions to authenticated Millida friends and explicit room/invite identity.
- [x] Implement real ICE/STUN candidate exchange and direct WebRTC data-channel lifecycle.
- [x] Add relay fallback, connection timeout, disconnect cleanup and clear direct/relay diagnostics.
- [ ] Connect LAN session details to Minecraft server address/join flow without changing Microsoft/Ely.by auth.
- [x] Audit official Modrinth API access, Resourcify behavior and modrinth.black compatibility.
- [x] Strengthen the transparent Modrinth gateway with cache, timeouts, retries, fallback and source diagnostics.
- [x] Preserve official Modrinth metadata, attribution, URLs, rate limits and terms; do not implement hidden access-control bypass.
- [x] Verify TypeScript and inspect Rust changes without launching the game or running a production build.
- [ ] Prepare a test archive after the user validates Millida login/profile behavior.

---

# Full proxy connection and Millida account integration

- [ ] Add a clear Modrinth proxy connection section in Settings with enable/disable, endpoint, test connection and source status.
- [ ] Route search, project, version, metadata, icon and download operations through the configured proxy with official fallback.
- [ ] Keep proxy credentials out of frontend storage and never send Microsoft/Ely.by credentials to a Modrinth proxy.
- [ ] Complete Millida account profile lifecycle: connect, refresh, logout, expired session, avatar, profile URL and account status.
- [ ] Connect Millida friends, presence, invites and LAN controls to the active Millida account.
- [ ] Keep Microsoft, Ely.by and offline accounts separate; document that Millida cannot automatically replace Ely.by credentials.
- [ ] Verify type boundaries and prepare a test archive without launching Minecraft or running production build.

---

# Manifest authors and CurseForge preview fixes

- [x] Show normalized author name, avatar/icon and clickable author profile in Modrinth and CurseForge manifest install preview.
- [x] Preserve author identity from manifest metadata while enriching it from Modrinth/CurseForge project data when available.
- [x] Fix CurseForge preview/detail mismatch so project author, icon and source remain consistent.
- [x] Fix CurseForge install action from preview so it installs the selected modpack instead of navigating to a project page or losing metadata.
- [x] Add safe fallback for missing author avatars and non-clickable local/unknown authors.
- [x] Verify TypeScript and the affected preview/detail flows.

---

# CurseForge gallery, filters and panel icon sharpness

- [x] Load and render CurseForge screenshots/gallery for mods, resource packs, shaders and modpacks.
- [x] Preserve selected CurseForge Minecraft version and loader from filters through version query, detail state and install action.
- [x] Prevent incompatible CurseForge versions/loaders from being selected as fallback when filtered results are empty.
- [x] Remove blur/scaling artifacts from Notch Panel and Sidebar icons while preserving theme tinting.
- [x] Verify screenshots, filter persistence, selected install version and TypeScript.

---

# Millida integrity and Portal Hosting page

- [x] Audit Millida registration/login/session restore/logout boundaries without changing Microsoft/Ely.by.
- [x] Audit Friends profiles, avatar/presence and Portal LAN identity wiring.
- [x] Audit skin selection, saved profile, body type/cape and registration-related states.
- [x] Verify available Millida Hosting API/runtime contract before claiming server creation is live.
- [x] Build a themed Hosting page in the Portal Launcher visual language with clear connected/disconnected states.
- [x] Add Hosting icon and route to Notch Panel and Sidebar with theme-aware rendering.
- [x] Verify Hosting page responsiveness and TypeScript.

---

# Maximal end-to-end integration

- [x] Add secure Millida Hosting API key connection through protected storage; never hardcode or expose the key in UI logs.
- [x] Implement Hosting server discovery/status/start/stop/restart/address and console stream states.
- [ ] Add explicit hosting invite/share flow from Millida Friends and a Minecraft join action using the server address.
- [x] Complete the most reliable direct LAN path available with consent, ICE/STUN, relay fallback, cleanup and actionable diagnostics.
- [ ] Add a platform-safe join boundary without claiming WebRTC data channels are an OS-wide VPN.
- [ ] Define and connect a real remote Modrinth gateway endpoint for metadata, icons, versions and downloads; keep official fallback and cache.
- [ ] Add gateway connectivity test and clear diagnostics for blocked upstream, invalid endpoint, rate limit and download failure.
- [x] Verify all auth boundaries, TypeScript/Rust contracts and user-visible failure states.

---

# Extended theme editor and hover indicator

- [x] Add appearance setting for hover indicator shape: square outline, circular outline, or none.
- [x] Apply the selected hover indicator consistently to Notch Panel, Sidebar, cards, buttons and navigation items.
- [x] Expand theme editor with additional surface, border, text, accent, opacity, shadow, radius, motion and background controls.
- [x] Persist new theme fields with safe defaults and preserve compatibility with existing saved themes.
- [x] Add compact previews and reset controls so the editor remains understandable instead of visually overloaded.
- [x] Verify TypeScript and theme persistence after the appearance expansion.

---

# Create instance version selection

- [x] Remove the automatic 1.21.4 selection from the create-instance wizard.
- [x] Make Minecraft version selection explicit and required before the user can continue/create an instance.
- [x] Preserve release/snapshot filtering and loader compatibility after the version becomes unset initially.
- [x] Show a clear Russian validation message when no version has been selected.
- [x] Verify the wizard and TypeScript after the change.

---

# Millida device-code click fix

- [x] Make the `Открыть Millida` action a real clickable button/link with the correct device authorization URL.
- [x] Add copy-link fallback and clear open/copy feedback in the Millida login modal.
- [x] Verify the device-code flow and TypeScript.

---

# Full interface and integration stabilization

- [ ] Replace non-clickable Tauri/WebView actions with reliable launcher-native interactions and remove unintended microphone permission prompts.
- [x] Remove fabricated/fake chat content and use empty/loading/error states until real Millida data is available.
- [x] Redesign Friends into one clear flow for profiles, add friend, chat, files, calls and Portal LAN.
- [x] Add a visible real Add Friend action and connect it to the Millida adapter without inventing friend records.
- [x] Fix file upload/download, image rendering, upload progress, retry and synchronized message state.
- [ ] Remove legacy icon rendering paths causing hover flicker/Z-fighting and keep one sharp panel icon source.
- [x] Audit and fix taskbar/app icon source and packaging references.
- [ ] Validate and connect only a documented, reachable Modrinth gateway for metadata and downloads.
- [x] Re-check Hosting, Friends, LAN, auth, settings and panel interactions after the stabilization pass.
- [x] Run TypeScript/tests and package a regression-fix version.

---

# Portal LAN, background sync and metadata regression

- [x] Make Portal LAN connection cancellable with one authoritative timeout, abort controller, cleanup and terminal error state.
- [x] Prevent duplicate Portal LAN attempts and stale handlers from keeping the UI in infinite connecting state.
- [x] Add persistent metadata cache with stale-while-revalidate background refresh and change detection.
- [x] Avoid blocking page render on unchanged manifest/project metadata and reuse cached data immediately.
- [x] Restore CurseForge author/profile enrichment for project, modpack, resource-pack and shader records.
- [x] Preserve local-file labels while enriching known files with Modrinth/CurseForge author and source metadata.
- [x] Re-check Library, Instance, Find Projects and ModDetail flows for metadata regressions.
- [x] Run TypeScript/tests and package the regression fix.

---

# Modrinth.black and Millida completion

- [x] Validate the actual Modrinth.black API/download contract and define one fixed launcher transport endpoint.
- [x] Replace generic proxy routing with Modrinth.black health-check, timeout, cache and explicit fallback state.
- [x] Keep download URL validation and do not route requests through untrusted rotating public proxy lists.
- [x] Audit Millida auth, profile, friends, chat, files, call signaling, Portal LAN and Hosting commands against their documented endpoints.
- [x] Remove remaining legacy Mojang-stub friend paths from the active launcher flow.
- [x] Complete available Millida interface flows with honest unavailable/error states for unsupported server capabilities.
- [x] Verify TypeScript/frontend build and package the integration revision.

---

# Simplification, Modrinth reliability and UI redesign

- [x] Remove Friends, Portal LAN and Hosting navigation, routes, components, stores and active Tauri commands without affecting Microsoft or Ely.by accounts.
- [x] Remove unused Millida social/hosting dependencies and preserve only the existing game-account authentication flows.
- [x] Audit and unify all Modrinth search, project metadata, version and download paths behind one resilient transport contract.
- [x] Validate the Modrinth.black contract and ensure unavailable endpoints fast-fail to cache/official fallback without inconsistent results.
- [x] Redesign Discover and Find Projects with compact themed filters, clear content hierarchy, source-neutral icons and no hard-coded accent colours.
- [x] Redesign Settings and utility pages with clearer sections, theme-aware controls and preserved existing settings behavior.
- [x] Keep the Instances/library page layout unchanged except for necessary navigation cleanup.
- [x] Run TypeScript and production build, then commit and push the completed simplification/redesign to GitHub main.

---

# Interface mode and screenshot preview repair

- [x] Add a persisted Classic/New interface mode that works with both Notch panel and Sidebar navigation without changing Instances page content.
- [x] Add a clear Appearance setting for selecting the interface mode and preserve the current navigation placement behavior.
- [x] Trace screenshot paths from Rust list/read commands through the React gallery to Tauri-safe asset URLs.
- [x] Fix screenshot grid/detail previews, loading state and broken-image fallback without changing or deleting instance files.
- [x] Run TypeScript only, then commit and push the repair to GitHub main.

---

# Skin Studio import and animation polish

- [x] Add Minecraft skin import by nickname using a public texture lookup with clear loading and unavailable states.
- [x] Highlight the selected skin preset with a fixed green selection state independent from launcher themes.
- [x] Add a short skin application sequence: turn, white transition, particles, then applied texture.
- [x] Add smooth cursor-follow head rotation to the 3D skin preview with reduced-motion safe behavior.
- [x] Run TypeScript only and commit/push the Skin Studio polish to GitHub main.

---

# Skin Studio motion, UI polish and icon framing repair

- [x] Persist selected skin preset ID across page changes and restore its fixed green selected state safely.
- [x] Correct cursor coordinate direction for head/body tracking, with smooth bounded body response and no inverted axes.
- [x] Add a grounded circular stand shadow and lengthen the real white-particle apply sequence.
- [x] Improve global UI transitions while respecting reduced-motion settings and keeping high-frequency interactions fast.
- [x] Rebuild Windows app/installer icons with tighter logo framing so taskbar and installer surfaces do not show excessive padding.
- [x] Run TypeScript only and commit/push the repair to GitHub main.

---

# Screenshot, skin account, panel and diagnostics regressions

- [x] Replace failing screenshot asset preview path with a Tauri-safe byte/data URL flow and preserve original screenshot files.
- [x] Match the active skin against saved preset texture hashes, keep the selected state across pages and remove automatic "active" suffixes from preset names.
- [x] Repair Ely.by texture/profile loading, fallback and cache behavior without changing the selected account type.
- [x] Make the 3D skin idle motion more natural while preserving smooth head/body tracking.
- [x] Remove icon/text flicker and blur in navigation/panel controls and ensure selected controls use theme tokens instead of white blocks.
- [x] Add Russian instance mod conflict analysis with actionable conflicting mod/version details.
- [x] Render mclo.gs crash diagnostics with theme-aware red cause emphasis and yellow key conflict/mod highlights.
- [x] Run TypeScript only and commit/push the regression repair to GitHub main.

---

# Ordered repair sequence

- [x] 1. Screenshot loading and saving.
- [x] 2. Notch panel icons.
- [x] 3. Text flicker.
- [x] 4. Ely.by.
- [x] 5. Skins.
- [x] 6. mclo.gs.
- [x] 7. Interface theme polish.
- [x] 8. Russian localization.
- [x] Run TypeScript only and commit/push the ordered repair sequence to GitHub main.

---

# Imported pack, screenshot editor and rollback regressions

- [x] Hydrate imported pack content immediately with real Modrinth/CurseForge/local metadata: title, author, installed version and icon; never display the artificial Imported version label.
- [x] Resolve and persist the imported pack cover before the Library/header/settings screens render, with Modrinth cover or the user-selected image as an honest fallback.
- [x] Ensure the import drop zone becomes visibly active with a themed dashed target while a .mrpack or .zip is dragged over the Library.
- [x] Make Screenshot Editor undo/redo restore the complete image state instead of clearing the canvas, and do not open Notch Panel from editor pointer interactions.
- [x] Remove obsolete rollback confirmation UI, refresh the history after restore and remove fully restored update entries from the visible list.
- [x] Make imported or reset instances hydrate their cover, settings and installed content reliably after reload without fabricated placeholders.
- [x] Strengthen the 3D Skin Studio idle animation while preserving cursor tracking, reduced-motion behavior and quick apply feedback.
- [x] Run TypeScript only and commit/push the regression repair to GitHub main.

---

# Library intelligence, skin polish and adaptive top bar

- [x] Add a smart Library search that can match instance name, Minecraft version, loader, installed mod name, author, last-played state and on-disk size without inventing metadata.
- [x] Improve Skin Studio motion: preserve a dark ground shadow during apply, use beautiful white particles that take only a theme-derived gradient on coloured themes, and keep Light/Dark/System/Glasswhite particles white.
- [x] Name a nickname-imported skin preset after the resolved Minecraft player name.
- [x] Keep the Title Bar visible above every launcher surface, add the Portal Launcher app icon immediately before its name at the left edge, and avoid Notch overlap.
- [x] Require an explicit Minecraft version before a Java instance can be created; disable Create Instance and show the exact Russian validation text in white until selected.
- [x] Add an enabled-by-default Appearance setting in Russian for an adaptive top-bar colour matching the active page surface.
- [x] Run TypeScript only and commit/push the Library, Skin Studio and top-bar improvements to GitHub main.

---

# Manifest preparation, package media, controls and experience redesign

- [x] Add a compact honest manifest-preparation dialog before local import and Discover modpack installation, showing icon, author, title, source and install target for every detected item.
- [x] Let the user safely disable or exclude individual pre-install items in that dialog without inventing missing metadata or deleting source archive files.
- [x] Persist real pack cover artwork and screenshots from both local imports and Discover manifests into instance settings, Library/header rendering and the instance Screenshots tab.
- [x] Add global, editable keyboard shortcuts that work from every ordinary launcher page but respect open editors, manifest previews and screenshot/object dialogs.
- [x] Add a Russian Controls settings section with conflict detection, recording/reset flows and task-specific bindings.
- [x] Redesign Home and Settings around clear priority, professional empty/loading/error states and safe fast actions without changing the Library layout.
- [x] Expand Skin Studio stand motion with distinct idle and post-apply self-inspection sequences while preserving cursor tracking, theme rules and reduced-motion support.
- [x] Run TypeScript only and commit/push the manifest, media, controls and UX improvement work to GitHub main.

---

# Portal Launcher .mrpack round-trip compatibility

- [x] Export a standards-compatible .mrpack with a complete modrinth.index.json, exact extensions, dependency metadata, hashes where available and no Portal Launcher filename suffix.
- [x] Package supported non-downloadable instance files as overrides, including configs, resource packs, shaderpacks, datapacks, options and Portal-specific display metadata.
- [x] Preserve the real instance cover and supported screenshots in Portal-specific archive metadata without breaking external Modrinth-compatible importers.
- [x] Restore Portal-specific cover, screenshots, settings and supported override files when importing a Portal-exported .mrpack, while remaining compatible with ordinary .mrpack files.
- [x] Run TypeScript only and commit/push the .mrpack round-trip repair to GitHub main.

---

# Full attached launcher request

- [x] Read the attached full launcher request, break it into code-verifiable work items and implement every compatible requirement without regressing existing flows.
- [x] Fix the reported Rust E0382 moved `icon` error in .mrpack export and remove the unused Command imports that generate shown build warnings.
- [x] Add a first-launch onboarding with language choice, an honest disk-space summary, launcher preview and Microsoft/Ely.by sign-in entry points.
- [x] Add a dismissible round tutorial after onboarding that introduces Home, Library, Discover, Notch Panel and the main navigation.
- [x] Redesign Home in a rounded, professional System-theme-aware visual language with real local data, clear actions and safe empty states.
- [x] Add randomly chosen Skin Studio idle poses (standing, sitting, lying and jumping) and smoothly stand up when the user begins drag inspection.
- [x] Run TypeScript only and commit/push the attached full request implementation to GitHub main.

---

# Navigation interaction shape

- [x] Verify the existing Appearance hover shape setting and add an independent square/round selection for active and pressed navigation states in both Notch Panel and Sidebar.
- [x] Run TypeScript only and commit/push the navigation interaction shape update to GitHub main.

---

# Independent navigation editors and installer polish

- [x] Split Appearance controls into independent Notch Panel and Sidebar editor state so changes in one mode never alter the other.
- [x] Redesign Sidebar navigation with larger usable items, clear labels and theme-aware active/hover states while preserving shortcuts and route behaviour.
- [x] Ensure the installer setup.exe is built with the branded Portal Launcher icon used by the launcher itself.
- [x] Add relevant icons to first-launch onboarding storage and sign-in information where they improve scanning without obscuring text.
- [x] Name a nickname-searched skin preset with the exact searched nickname; retain filename naming only for direct file imports.
- [x] Run TypeScript only and commit/push the navigation, installer and skin naming improvement to GitHub main.

---

# Skin pose, hotkey and Notch Panel regressions

- [x] Replace the broken pseudo-sitting pose with a real low seated pose: hips lowered, both legs extended forward, arms at the sides; remove the lying pose entirely.
- [x] Restore configurable global hotkeys on normal launcher pages, while preserving priority closing behavior for editors and manifest previews.
- [x] Fix Notch Panel layer ordering and exact edge hit geometry so it remains visible, clickable and never hides behind Title Bar or page content.
- [x] Run TypeScript only and commit/push the regression repair to GitHub main.

---

# Title Bar drag zone regression

- [x] Restore the draggable Title Bar area over the Portal Launcher name and safe empty header space without making window controls or Notch Panel draggable.
- [x] Run TypeScript only and commit/push the Title Bar drag-zone fix to GitHub main.

---

# Find Projects TypeScript build regression

- [x] Fix TS2367 ProjectType comparisons for resource packs, shaderpacks and datapacks in FindProjectsPage.
- [x] Run TypeScript only and commit/push the Find Projects build fix to GitHub main.

---

# Revert of incorrect screenshot-based change

- [x] Revert only the unnecessary FindProjectsPage type mapping change from b89abbc after the user confirmed the screenshot was unrelated.

---

# Navigation icon rendering regression

- [x] Remove navigation icon flicker/blur caused by overlapping active, hover and pressed surfaces.
- [x] Set the default active and pressed navigation form to a square outline and keep the option configurable in Appearance.
- [x] Run TypeScript only and commit/push the navigation icon rendering fix to GitHub main.

---

# Skin, Sidebar and screenshot viewer regressions

- [x] Restore Skin Studio texture loading and selected preview rendering without replacing the user’s saved preset data.
- [x] Reduce the default permanent Sidebar footprint while keeping labels, accessibility and usable icon targets.
- [x] Add large accessible previous/next arrows to the screenshot viewer for moving between actual screenshots.
- [x] Run TypeScript only and commit/push the regression repair to GitHub main.

---

# Adaptive Tab Color regression

- [x] Restrict Adaptive Tab Color to a stable, subtle Title Bar tint derived from the active page class without colouring neighbouring surfaces or background layers.
- [x] Run TypeScript only and commit/push the Adaptive Tab Color fix to GitHub main.

---

# Skin Studio stand, lighting and tracking refinement

- [x] Remove random/alternate idle poses and keep one stable standing pose in Skin Studio.
- [x] Add a restrained white top-light reflection effect without bleaching the skin texture or shadow.
- [x] Correct and smooth head/body cursor tracking with clamped, natural axes and no inverted directions.
- [x] Run TypeScript only and commit/push the Skin Studio refinement to GitHub main.

---

# Compact Title Bar refinement

- [x] Reduce the default Title Bar height while preserving a usable drag zone, small app icon, concise title and compact window controls.
- [x] Keep window controls excluded from dragging and avoid changing navigation/content layout dimensions.
- [x] Run TypeScript only and commit/push the compact Title Bar refinement to GitHub main.

---

# Instance content actions, Notch Panel and Settings localization

- [x] Add selection checkboxes and a bottom action bar for real multi-select actions in the instance content list.
- [x] Restore independent Notch Panel appearance settings so changes apply immediately without modifying Sidebar settings.
- [x] Translate all user-facing English function labels in Settings to Russian while preserving technical identifiers, file names, providers and mod names.
- [x] Run TypeScript only and commit/push the instance-content, Notch Panel and Settings localization work to GitHub main.

---

# Screenshot viewer, navigation, install flow and recovery refinement

- [x] Raise the screenshot viewer above Title Bar and remove inner image scrolling so every aspect ratio fits while navigation controls remain clickable.
- [x] Add non-destructive editable layers to ScreenshotEditor so the eraser affects only the active drawing layer and never clears the original image.
- [x] Correct compact Title Bar icon/title alignment and make Notch Panel open only from its exact visual hitbox without an excessive offset.
- [x] Remove the obsolete duplicate install-files flow, hide the redundant Content heading, and separate Install modpack discovery from local Import files.
- [x] Add a separate Deleted tab for recoverable removed mods with real Restore and permanent Delete actions.
- [x] Translate remaining user-facing Search and related visible English labels to Russian without translating file names, providers or identifiers.
- [x] Run TypeScript only and commit/push the refinement work to GitHub main.

---

# Title Bar Drag zone regression

- [x] Replace the broad native drag-region with a compact explicit Drag zone beside the title to eliminate the black native-window artifact while dragging.
- [x] Increase and precisely align the Title Bar app icon and Portal Launcher title while keeping compact window controls.
- [x] Run TypeScript only and commit/push the Title Bar Drag zone fix to GitHub main.

---

# Runtime screenshot, Notch Panel and localization regressions

- [x] Identify the components used by the screenshot editor and instance windows shown in the runtime screenshots instead of relying on stale or unused page variants.
- [x] Keep the screenshot editor fully above all application chrome with clickable back/save controls and no Title Bar overlap.
- [x] Replace delayed Notch Panel hover behaviour with immediate opening from the visible panel tab and remove the oversized empty hitbox.
- [x] Translate the user-facing Instance content tab and actual instance-settings Content panel shown at runtime to Russian.
- [x] Run TypeScript only and commit/push the runtime regression repair to GitHub main.

---

# i18n migration and text-bridge retirement

- [x] Inventory the active translation resources, LocaleTextBridge attachment and user-visible hard-coded runtime strings in instance windows, Screenshot Editor, Discover and Settings.
- [x] Add shared i18n keys for common user-facing actions, states, errors and navigation in Russian and English resources.
- [x] Migrate the real instance windows and Screenshot Editor from hard-coded user-facing text to useTranslation keys.
- [x] Migrate Discover and Settings from hard-coded user-facing text to useTranslation keys.
- [x] Remove or disable LocaleTextBridge only after its active user-facing mappings are represented by normal i18n resources.
- [x] Run TypeScript only and commit/push the i18n migration to GitHub main.

---

# Active search, CurseForge and local-file metadata regression repair

- [x] Map active search, install and local metadata paths to remove old duplicate project-search UI and identify the source of visible English statuses.
- [x] Migrate the actual active project-search cards, buttons and install states to i18n Russian/English resources.
- [x] Repair active CurseForge installation flow and surface a specific localized error when a download or response body fails.
- [x] Hydrate manually added local mod/resourcepack/shader files with real platform metadata when an unambiguous Modrinth or CurseForge match exists.
- [x] Keep unknown local files honest as local files when no safe metadata match exists.
- [x] Run TypeScript only and commit/push the active search and metadata repair to GitHub main.

---

# Final CurseForge and Modrinth compatibility regression

- [x] Trace and normalize malformed Minecraft version values such as 1.21.11 before platform requests.
- [x] Keep exact Fabric and Minecraft-version compatibility checks after normalization, without installing an unrelated fallback mod file.
- [x] Run TypeScript only and commit/push the final CurseForge/Modrinth compatibility repair to GitHub main.

---

# Minecraft launch and Stop runtime lifecycle regression

- [x] Trace the active launch, Stop and game-exited paths that leave the launcher unresponsive after Minecraft starts or is stopped.
- [x] Make Stop return promptly while process cleanup continues safely and always emits a terminal lifecycle status.
- [x] Prevent launch-state from blocking normal tabs, search, Notch Panel or page interaction, and recover UI state on exit/error.
- [x] Run TypeScript only and commit/push the runtime lifecycle repair to GitHub main.

---

# Final runtime UI, account and navigation refinement

- [x] Migrate the actual LibraryPage runtime labels and controls to i18n and match buttons to the compact Title Bar/tab visual language.
- [x] Translate active Instance Studio and instance page panels, including Content, Files, Worlds, Screenshots and Logs; replace the requested instance settings Mods panel entry with Deleted.
- [x] Correct screenshot search type labels so Screenshots never use the Worlds term and expand visible screenshot controls with translated states.
- [x] Reinvestigate the active CurseForge failure path and expose a concrete localized failure reason instead of a generic error badge.
- [x] Preserve more than one Ely.by account, allow switching, and prevent sign-out of one account from deleting unrelated saved accounts.
- [x] Hydrate and persist player head/profile information at first use so it renders reliably rather than reporting placeholder launcher metadata.
- [x] Default hover/pressed interactions to circular styling, repair the requested instance-vs-library selection semantics, and use the consistent Modrinth icon in Discover.
- [x] Refine the skin nameplate to a Minecraft-like translucent platform label and correct cursor tracking axes/smoothing.
- [x] Apply coherent theme-aware page polish without replacing functional layouts or inventing data.
- [x] Run TypeScript only and commit/push the final runtime refinement to GitHub main.

---

# Final platform filters, import and compatibility refinement

- [x] Separate active Modrinth and CurseForge filter state so each provider receives only its own supported category, version and loader parameters.
- [x] Add a clearly visible dashed drop-zone in Library while dragging .mrpack/.zip, followed by specific import progress feedback for large manifests.
- [x] Repair .mrpack import parsing and distinguish an absent manifest from a genuinely invalid or incomplete ZIP archive in localized errors.
- [x] Check only installed mods before changing Minecraft version or loader, warn about unavailable compatible updates, and retain data needed for mclo.gs diagnostics if the user proceeds.
- [x] Simplify first-launch presentation and add original undisclosed local easter-egg achievements without external meme assets.
- [x] Run TypeScript only and commit/push the final platform/import refinement to GitHub main.

---

# Visual polish, onboarding and local easter eggs

- [x] Refine Library hierarchy and interactive cards with theme-aware surfaces, stronger focus states and no layout regression.
- [x] Add short, interruptible motion for cards, panels and feedback while respecting reduced-motion preferences.
- [x] Simplify first-launch presentation into a lighter, more focused onboarding flow while retaining language, disk and account steps.
- [x] Add several undisclosed original local easter-egg achievements without external meme assets or fabricated user content.
- [x] Run TypeScript only and commit/push the visual polish to GitHub main.

---

# Notch Panel and tab geometry regression

- [x] Separate the real Notch Panel and tab geometry so their visible surfaces never overlap.
- [x] Reduce the default Notch Panel footprint and offset it forward from the tab with a stable visual gap.
- [x] Run TypeScript only and commit/push the Notch Panel geometry fix to GitHub main.

---

# Critical `.mrpack` import and Library drop regression

- [x] Trace the `.mrpack` ZIP-signature validation and accept valid ZIP variants without rejecting intact files.
- [x] Make a library drop immediately show the import path/progress instead of leaving the empty Library view unchanged.
- [x] Preserve all project files on validation, manifest, metadata or installation failure; show a concrete safe error rather than silently losing the dropped action.
- [x] Run TypeScript-only verification and available targeted import tests, then commit/push the repair to GitHub main.

---

# Instance page Russian localization and compact progress

- [x] Replace remaining English instance-page tabs, action-menu labels, tooltips, errors and progress text with Russian i18n keys.
- [x] Keep internal folder names unchanged while translating only user-visible interface text.
- [x] Remove the wide installation progress panel from the instance page and retain progress only in the compact global panel.
- [x] Run TypeScript-only verification and commit/push the instance-page localization and progress fix to GitHub main.

---

# Notch proximity and complete `.mrpack` validation

- [x] Position the opened Notch Panel directly adjacent to its compact handle without overlapping the tab or adding a large gap.
- [x] Detect a complete ZIP central directory and a `modrinth.index.json` before offering a `.mrpack` manifest preview or fallback import.
- [x] Never fall back to ordinary import after a `.mrpack` archive fails ZIP parsing; preserve the source file and show a precise Russian error with the next safe action.
- [x] Run TypeScript-only verification and commit/push both repairs to GitHub main.

---

# Notch Panel zero-gap refinement

- [x] Remove the remaining visual gap between the compact handle and opened Notch Panel without lowering its layer above the tab.
- [x] Run TypeScript-only verification and commit/push the zero-gap geometry refinement to GitHub main.

---

# Notch Panel seamless top-edge refinement

- [x] Remove the remaining black separation line so the opened Notch Panel meets the top UI with no visible gap.
- [x] Run TypeScript-only verification and commit/push the seamless Notch Panel edge to GitHub main.

---

# Native local `.mrpack` selection repair

- [x] Replace browser file-input path guessing with the real native Tauri `.mrpack` file selection API.
- [x] Ensure local archive preview never invokes HTTP/reqwest when a local selection is intended.
- [x] Keep the source archive untouched and show a specific Russian validation error only for a genuinely unreadable archive.
- [x] Run TypeScript-only verification and commit/push the local `.mrpack` selection repair to GitHub main.

---

# File action popover readability

- [x] Raise the file action popover above surrounding controls and make its surface opaque under every theme.
- [x] Ensure the popover label and icon use high-contrast theme-aware foreground colors.
- [x] Run TypeScript-only verification and commit/push the file popover readability repair to GitHub main.

---

# Fast modpack import and deleted instance recovery

- [x] Trace and remove the long finalization stall after all modpack files are downloaded.
- [x] Persist and render the imported pack icon, Minecraft version and loader from available manifest/project metadata.
- [x] Show an immediate «Пожалуйста, подождите…» state after the first archive drop or upload action.
- [x] Merge the separate Install and Import choices into one user-facing modpack install/import entry.
- [x] Add a Deleted instances view with restore, permanent delete and no fabricated entries.
- [x] Add an Advanced setting for automatic deleted-instance cleanup from 15 minutes through 1 year.
- [x] Run TypeScript-only verification and commit/push the full import and recovery improvement to GitHub main.

---

# Persistent player face, file scrolling and group localization

- [x] Persist the active account face to the launcher assets folder and refresh it whenever the player changes the active skin.
- [x] Use the cached local account face in both launcher UI locations, with a safe existing fallback while it is first downloaded.
- [x] Fix wheel scrolling in the text file editor so content scrolls along with its scrollbar.
- [x] Translate the New group dialog title, field hint and confirmation action to Russian.
- [x] Run TypeScript-only verification and commit/push the profile cache, file scrolling and localization repair to GitHub main.

---

# Screenshot studio and configurable Notch Panel

- [x] Add large previous/next arrows to the screenshot viewer for direct navigation.
- [x] Give brush and eraser separate numeric size controls, with an upper limit of 160.
- [x] Add named editable drawing layers and non-destructive image controls for brightness, contrast, palette and blur.
- [x] Remove redundant «Изображение» and «Рисунок» labels from the screenshot editor.
- [x] Add Notch Panel settings for hover activation on the tab or just above it, plus adjustable panel size.
- [x] Run TypeScript-only verification and commit/push the screenshot studio and Notch Panel changes to GitHub main.

---

# Project screenshot gallery and keyboard navigation

- [x] Add previous/next controls when a mod or modpack has more than one screenshot.
- [x] Add safe download actions for the current project screenshot: system Downloads and, for an installed pack, the instance screenshots folder.
- [x] Add a persisted keyboard-navigation preference, enabled by default, to Settings → Controls.
- [x] Implement Arrow keys and Enter navigation without hijacking typing, open editors, dialogs or screenshot overlays.
- [x] Run TypeScript-only verification and commit/push the gallery and keyboard-navigation improvements to GitHub main.

---

# Deleted content recovery and translucent instance settings

- [x] Ensure deleting any supported instance content — mods, resource packs, shaders, data packs and worlds where applicable — moves its file and metadata to the recovery area instead of silently losing it.
- [x] Add restore and permanent-delete actions for each deleted content item, and apply the Advanced deleted-content retention period to every content type.
- [x] Ensure deleted-instance cards provide restore and permanent delete with no empty nonfunctional controls.
- [x] Make the instance-settings surface subtly translucent so the current page background remains visible while all text stays readable.
- [x] Run TypeScript-only verification and commit/push deleted-content recovery and instance-settings visual improvements to GitHub main.

---

# Runtime, files, loader and update reliability repair

- [x] Reduce the music mini-player footprint and let the user drag it to a remembered launcher position.
- [x] Repair the Add files action so it opens a native picker and transfers selected files into the current instance.
- [x] Restore reliable NeoForge version discovery and installation for the chosen Minecraft version.
- [x] Persist changed Minecraft version and loader settings, then refresh mod compatibility/update requirements after save and reopen.
- [x] Make the installation Cancel action stop promptly, dismiss the install window, and retain resumable unfinished download state for a later retry.
- [x] Use singular Russian category labels in search: «Моды», «Ресурс-паки», «Шейдеры».
- [x] Translate the per-mod Update action and make it update the selected mod rather than only supporting Update all.
- [x] Run TypeScript-only verification and commit/push the reliability repair package to GitHub main.

---

# Critical first-launch visibility and instance isolation

- [x] Show explicit first-launch stages for Java, Minecraft client, libraries, assets, natives and loader preparation, with per-stage progress and actionable wait context.
- [x] Audit all launch paths and cancel states so the compact install panel never presents a stale or incomplete status.
- [x] Prevent stale asynchronous mod results, update counts and metadata from one instance rendering inside another instance after navigation.
- [x] Remove the visible untranslated `instancePage.updatesReady` key and verify all update UI uses localized text.
- [x] Profile and reduce repeated foreground work in instance content and first-launch progress paths that causes interface slowdown.
- [x] Run TypeScript-only verification and commit/push the critical launch and instance-isolation repair to GitHub main.

---

# Shared Minecraft runtime cache recovery

- [x] Trace the shared version, game JAR and loader-cache preparation path causing TinyRemapper `Unfixable conflicts` across loaders.
- [x] Safely validate and recover only corrupted runtime artifacts, preserving instance mods, worlds, screenshots, configs and account data.
- [x] Report the recovery stage and retry the affected profile once without leaving the launcher in a stale running state.
- [x] Run TypeScript-only verification and commit/push the shared runtime-cache repair to GitHub main.

---

# Launch-card completion and placement

- [x] Trace why the global launch card stays in a download state after Minecraft reports that it is running.
- [x] Finish or replace stale progress on the definitive running/stopped/error launch events.
- [x] Redesign the compact launch card for a readable lower-right placement across themes.
- [x] Run TypeScript-only verification and commit/push the launch-card repair to GitHub main.

---

# In-game performance regression

- [x] Inspect recent global JVM launch arguments and memory defaults that could cause severe stutter in previously stable modpacks.
- [x] Remove unsafe launcher-wide CPU or thread-stack constraints while preserving per-instance RAM choices and custom JVM arguments.
- [x] Add non-sensitive launch diagnostics for selected Java and effective memory settings.
- [x] Run TypeScript-only verification and commit/push the performance regression repair to GitHub main.

---

# Home screen, storage and theme editor refresh

- [x] Audit the current home screen structure, action paths, launcher-size label and theme-editor controls.
- [x] Rebuild the home screen with a stronger visual hierarchy, useful quick actions and responsive themed surfaces.
- [x] Replace the incorrect 1 KB launcher-size value with the requested 15.3 MB display.
- [x] Improve the theme editor with clearer grouped appearance controls while preserving existing saved themes.
- [x] Run TypeScript-only verification and commit/push the home, storage and theme-editor refresh to GitHub main.

# Revert unified workspace redesign

- [x] Revert commit 9cd0fd2 only, returning to stable commit c245236 while preserving prior Home, theme-editor, performance and launch repairs.
- [x] Verify the restored revision and GitHub main synchronization.

---

# Instance Studio import and visual refresh

- [x] Audit the current Instance Studio creation, install/import and empty-library states against the requested interaction contract.
- [x] Remove the duplicate «Найти модпаки» search field and action from the import flow while retaining native .mrpack/.zip selection and external-launcher import.
- [x] Redesign the choice, custom-instance and empty states with round themed surfaces and clear keyboard-accessible actions without changing version or loader selection.
- [x] Run TypeScript-only verification and commit/push the targeted Instance Studio refresh to GitHub main.

---

# Empty library background correction

- [x] Remove the large light/raised empty-state panel and retain a compact themed call to action on the normal library background.
- [x] Run TypeScript-only verification and commit/push the empty-library background correction to GitHub main.

---

# Per-instance RAM settings persistence

- [x] Trace why the memory shown in instance settings is not persisted or passed to Java for every Minecraft profile.
- [x] Persist per-instance minimum RAM, maximum RAM and custom JVM arguments through the settings save path.
- [x] Ensure launch diagnostics and Java Xmx/Xms use the saved values rather than stale 4096 MB defaults.
- [x] Run TypeScript-only verification and commit/push the per-instance RAM repair to GitHub main.

---

# Empty deleted-content trash

- [x] Add a confirmed «Удалить всё» action that permanently clears only the deleted-content trash of the selected instance.
- [x] Refresh the deleted-content list and leave active instance files, worlds, settings and other instances untouched.
- [x] Run TypeScript-only verification and commit/push the deleted-content bulk delete to GitHub main.

---

# Modrinth App performance parity

- [x] Compare Portal Launcher JVM, Java, memory and launch arguments against documented Modrinth App behavior for the same modpack.
- [x] Remove launcher-specific runtime choices that can cause lower FPS or severe stutter than Modrinth App.
- [x] Expose the exact effective Java, Xms, Xmx and safe JVM flags in the launch diagnostic without exposing tokens.
- [x] Run TypeScript-only verification and commit/push the Modrinth App parity fix to GitHub main.

---

# Java runtime management refresh

- [x] Audit existing managed Java discovery, download, validation and native file-picker commands for Java 8, 17, 21 and 25.
- [x] Preserve or extend safe version-specific Java detection and installation actions without changing current Minecraft launch compatibility.
- [x] Redesign the Java settings area as version cards with path, status, «Установить рекомендуемую», «Найти» and «Выбрать файл» actions.
- [x] Run TypeScript-only verification and commit/push the Java runtime management refresh to GitHub main.

---

# Per-mod update repair

- [x] Trace the individual update button from the Content interface to the update procedure and compatibility lookup.
- [x] Fix file-name/project matching and version/loader compatibility for updating one mod without touching other content.
- [x] Localize the button as «Обновить» / «Обновляю…» and refresh the item after a successful update.
- [x] Run TypeScript-only verification and commit/push the per-mod update repair to GitHub main.

---

# Clickable CurseForge API portal link

- [x] Make the console.curseforge.com guidance link clickable in the CurseForge API-key settings without exposing or changing the key.
- [x] Run TypeScript-only verification and commit/push the clickable CurseForge portal link to GitHub main.

---

# Smooth platform switch and missing loader profiles

- [x] Trace the default-platform switch animation and remove visual artifacts without changing Discover platform selection.
- [x] Trace why existing NeoForge, Forge, Quilt, LabyMod and OptiFine instances report a missing loader profile at launch.
- [x] Repair exact loader-profile detection and automatic installation for the affected loader/version combinations.
- [x] Run TypeScript-only verification and commit/push the platform-switch and loader-profile repairs to GitHub main.

---

# Prefer installed Java and clarify runtime status

- [x] Audit Java discovery order so a compatible user-installed 64-bit runtime is used before managed Java is downloaded.
- [x] Prevent redundant managed Java downloads when a matching local runtime is already available.
- [x] Replace the misleading «Выбрана» runtime-card badge with the unified «Установлено» status.
- [x] Run TypeScript-only verification and commit/push the Java preference and status repair to GitHub main.

---

# Loader installer Java compatibility

- [x] Trace why NeoForge installation uses Oracle javapath instead of a validated Java 21 runtime.
- [x] Require an exact 64-bit Java version for Forge, NeoForge, Quilt and Fabric installers; prepare managed Java only when no compatible runtime exists.
- [x] Report a direct Java-version/architecture issue when a loader installer cannot start safely.
- [x] Run TypeScript-only verification and commit/push the loader-installer Java repair to GitHub main.

---

# Modpack icon recovery

- [x] Trace Modrinth, CurseForge and local .mrpack icon metadata from import through persisted instance state to the library card.
- [x] Persist and recover a valid modpack icon with a safe fallback when the remote image is temporarily unavailable.
- [x] Refresh the library card after icon recovery, run TypeScript-only verification and push the fix to GitHub main.

---

# Complete loader runtime repair

- [x] Audit all Forge, NeoForge, Quilt, Fabric, OptiFine and LabyMod setup paths for direct or indirect fallback to Oracle javapath.
- [x] Route all supported loader installers through one validated exact-version 64-bit Java resolver.
- [x] Repair loader-profile recovery and produce localized actionable errors instead of raw installer-path failures.
- [x] Run TypeScript-only verification and commit/push the complete loader runtime repair to GitHub main.

---

# Supported instance cores only

- [x] Remove OptiFine and LabyMod from Studio creation, core filters and navigation choices.
- [x] Preserve existing imported OptiFine/LabyMod instance folders and their files without offering new creation paths.
- [x] Run TypeScript-only verification and commit/push the supported-core-only update to GitHub main.

---

# Regression investigation: non-working flows and Minecraft performance

- [ ] Identify the exact remaining non-working launcher flows reported after the supported-core update.
- [ ] Investigate Minecraft in-game performance regression without changing JVM limits or deleting existing instances.
- [x] Restore managed Portal Launcher Java as the automatic runtime preference while retaining installed Java as a no-download fallback.
- [x] Run TypeScript-only verification for the managed-Java preference repair.
- [ ] Apply verified regression fixes, run TypeScript-only verification, and push the result to GitHub main.

---

# Loader Java-path stabilization and critical subsystem isolation

- [ ] Keep Modrinth, CurseForge, Java management and loader installers unchanged during unrelated feature work.
- [x] Compare managed-Java selection between normal game launch and Forge, NeoForge, Fabric and Quilt installers.
- [x] Make Fabric and NeoForge installers use the same version-derived managed Java resolver as Forge and Quilt.
- [x] Remove only a confirmed Java-path divergence while preserving existing instances, loader profiles, mod directories and platform sources.
- [x] Run TypeScript-only verification and push the isolated stabilization repair to GitHub main.
