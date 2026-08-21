# NeoForge duplicate-module evidence

The supplied Portal Launcher NeoForge 1.21.1 log stops during module-layer creation after detecting both the NeoForge-provided client artifact (`_1._21._1`) and a second `minecraft` module. The error names the overlapping package `net.minecraft.client.main`.

An independent launcher report records the same NeoForge 21.1.x symptom: a launcher loads the Minecraft JAR twice as `minecraft` and `_1._21._1`, producing a Java `ResolutionException` before normal mod loading begins.

Source: https://github.com/ZalithLauncher/ZalithLauncher2/issues/1325

Scope of the repair: preserve the vanilla client JAR for Forge, Fabric and Quilt; exclude it only when the resolved NeoForge launch profile already explicitly supplies `net.neoforged:neoforge:<build>:client`.
