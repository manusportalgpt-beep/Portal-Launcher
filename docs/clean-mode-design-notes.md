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
