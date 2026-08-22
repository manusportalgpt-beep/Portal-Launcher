# Liquid Glass accessibility notes

The Glassmorphism preset uses blur only on material surfaces and keeps text on the normal theme text tokens. It also provides a black/white base choice and disables blur for `prefers-reduced-transparency`. This follows the practical guidance that users may choose a preferred Liquid Glass appearance or reduce transparency, and that essential text should retain sufficient contrast.

Sources consulted on 2026-08-22:

- Apple Developer, [Adopting Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass) — adaptable presentation and reduced-transparency preferences.
- Axess Lab, [Glassmorphism Meets Accessibility](https://axesslab.com/glassmorphism-meets-accessibility-can-frosted-glass-be-inclusive/) — recommends WCAG-level contrast for text and essential controls.
- Nielsen Norman Group, [Glassmorphism: Definition and Best Practices](https://www.nngroup.com/articles/glassmorphism/) — accessibility constraints for translucent materials.
