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
