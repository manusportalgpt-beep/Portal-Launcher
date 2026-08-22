# Liquid Glass accessibility notes

The Glassmorphism preset uses a dedicated functional material layer for navigation, controls and content surfaces instead of merely changing button radii. The material remains visibly translucent over the selected background, combines blur with neutral white edge highlights and keeps text on contrast-safe theme tokens. It also provides a black/white base choice and disables blur for `prefers-reduced-transparency`.

Implementation boundaries confirmed on 2026-08-22: navigation planes such as the Sidebar and Notch Panel are cohesive elevated glass objects; content space stays open so the background remains visible; menus and active controls use a denser variant for legibility; and text/icons use stable high-contrast tokens rather than inheriting background color. Avoiding glass-on-glass stacks limits visual noise while allowing panels to reveal the background underneath.

Sources consulted on 2026-08-22:

- Apple Developer, [Adopting Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass) — adaptable presentation and reduced-transparency preferences.
- Apple Developer, [Meet Liquid Glass — WWDC25](https://developer.apple.com/videos/play/wwdc2025/219/) — navigation as a distinct floating layer, rounded concentric geometry, contextual material depth and adaptive legibility.
- Axess Lab, [Glassmorphism Meets Accessibility](https://axesslab.com/glassmorphism-meets-accessibility-can-frosted-glass-be-inclusive/) — recommends WCAG-level contrast for text and essential controls.
- Nielsen Norman Group, [Glassmorphism: Definition and Best Practices](https://www.nngroup.com/articles/glassmorphism/) — accessibility constraints for translucent materials.
