# Clean mode: design principles for Portal Launcher

## Source studied

The Clean mode direction is informed by the design-principle catalogue at `killaislop.com`, interpreted for a Minecraft launcher rather than copied as a visual template.

## Adopted rules

1. Use a flat, deliberately selected base surface and one restrained Portal accent. Do not use decorative indigo-violet gradients, surface gradients, ambient glows, or text gradients.
2. Build hierarchy with scale, weight, contrast, and whitespace. Do not use decorative serif italics, highlighted words, repeated uppercase kickers, or marketing-style full-sentence display copy.
3. Use one practical sans-serif UI face consistently. Content should be concise, specific, and action-oriented.
4. Keep controls structurally honest: a border or a filled surface only when it represents an interactive boundary. Avoid nested cards, glassmorphism, excessive rounding, oversized shadows, and colored icon tiles.
5. Use actual icons without same-color translucent wrappers. Reserve badges for genuine metadata or state, not decoration.
6. Space by relationship: compact title-to-description groups; visibly separate unrelated panels. Use a restrained scale such as 4/8/16/32/64 pixels instead of repeating the same spacing token everywhere.
7. Use short, interruptible opacity/transform transitions only. No springy hover, wobbling spinner, or decorative motion.
8. Preserve theme compatibility: Clean mode changes composition and tokens while retaining accessibility, localization, keyboard navigation, platform identity, and existing launcher behavior.

## Portal Launcher application plan

The first Clean mode increment will define flat surface tokens, thin utility borders, modest radius levels, a high-contrast action hierarchy, plain navigation icons, and an onboarding layout based on one primary action plus direct secondary paths. It must not modify Java selection, loader installers, Modrinth, CurseForge, instance files, or network behavior.

## Full skill audit (2026-08-21)

Source: `https://github.com/yetone/kill-ai-slop/tree/main/skill` and its dependency-free scanner.

The scanner reviewed 88 active project files and reported 20 tell groups / 957 code-level hits. The count is intentionally treated as a triage map, not a literal backlog: it includes legitimate progress indicators, real links, code editors, theme customization controls, and the optional pixel theme.

The confirmed system-level problems to remove from the active Portal Launcher UI are atmospheric and surface gradients, glass/backdrop-blur panels, colored glow shadows, oversized and nested rounded cards, same-hue alert boxes, decorative icon tiles, all-caps kickers, decorative badges, default Inter/Space Grotesk hierarchy, and transform-heavy hover treatment. The retained intentional elements are functional progress bars, real source links, status information, code typography inside actual file/log editors, the user-selected pixel theme, and original Minecraft/project artwork.

The redesign follows the skill's six principles: decide before decorating; one accent and one voice; hierarchy through scale and space; subtract first; specific copy; and decoration only when it communicates state or action. Existing themes remain the source of colors, but their surfaces must follow the same flat, hairline, small-radius composition.

The post-change scanner reported 19 groups / 937 raw hits. Remaining code-level hits are largely intentional or need component-by-component visual judgment: genuine progress/status indicators, real text links, file/log code typography, user-selectable Pixel mode, original project art and a legacy sidebar that is not mounted by the active shell. The active shared system no longer uses gradient headline text, global glow, glass panes, large elevation, decorative shell orbs, transform hover, or the stock Inter/Space Grotesk pairing.
