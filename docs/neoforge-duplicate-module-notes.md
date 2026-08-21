# NeoForge duplicate-module evidence

The supplied Portal Launcher NeoForge 1.21.1 log stops during module-layer creation after detecting both the NeoForge-provided client artifact (`_1._21._1`) and a second `minecraft` module. The error names the overlapping package `net.minecraft.client.main`.

An independent launcher report records the same NeoForge 21.1.x symptom: a launcher loads the Minecraft JAR twice as `minecraft` and `_1._21._1`, producing a Java `ResolutionException` before normal mod loading begins.

Source: https://github.com/ZalithLauncher/ZalithLauncher2/issues/1325

The official NeoForge 21.1.99 `version.json` has the profile id `neoforge-21.1.99`, inherits from `1.21.1`, and uses the bootstrap launcher. Its 1.21+ installer processors generate the patched client artifact, so that artifact is not required to appear as a normal `libraries` Maven coordinate in the resolved profile.

Scope of the repair: preserve the vanilla client JAR for Forge, Fabric and Quilt; exclude it for resolved NeoForge 21.x profile ids, and retain the explicit Maven-coordinate check as a fallback for other NeoForge profile layouts.
