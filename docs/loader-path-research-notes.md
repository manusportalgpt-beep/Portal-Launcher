# Loader Path Research Notes

## Forge 1.21.x

The official Forge documentation lists a 64-bit Java 21 JDK/JVM for the 1.21.x line and recommends Eclipse Temurin. This aligns with Portal Launcher’s managed Temurin 21 selection for modern Minecraft.

Source: https://docs.minecraftforge.net/en/1.21.x/gettingstarted/

## Quilt Client

The official Quilt client guide says the Universal installer requires Java 17 or later, recommends Eclipse Adoptium, instructs users to close the Minecraft Launcher, select the Client tab and desired versions, and notes that a profile is generated when profile generation remains enabled. It confirms that the installer profile lives in the launcher’s shared metadata while mods are placed in the game directory selected for that installation.

Source: https://quiltmc.org/en/install/client/

## NeoForge Client

The official NeoForge client guide requires the installer to run in **Install client** mode and explains that it creates a NeoForge launcher run option. It then recommends creating a custom launcher profile and assigning a separate game directory outside the standard `.minecraft` folder. This confirms the two-layer model used by Portal Launcher: shared profile/version metadata for the installer and a separate per-instance game directory for the user’s data.

Source: https://docs.neoforged.net/user/docs/client/

## Vanilla Launcher Source Note

The current Minecraft Help URL returned only its site shell through the available extractor, so it was not used as implementation evidence. Vanilla requirements are instead verified against Portal Launcher’s existing version-manifest, version JSON, client JAR, libraries, assets and native installation flow, which runs before loader profile resolution.

## Forge Profile Store Behavior

The Forge project’s own issue discussion confirms that the client installer writes its generated Forge profile into `launcher_profiles.json` and fails early when that file is absent. It also confirms that the Forge version files may still be usable through a manually created launcher profile once the installer can complete. This supports creating a minimal shared profile store before running a Forge-family installer, never treating a per-instance game directory as the installer’s launcher base.

Source: https://github.com/MinecraftForge/MinecraftForge/issues/8186

## Portal Launcher Path Mapping

| Layer | Portal Launcher behavior | Scope |
|---|---|---|
| Shared Vanilla cache | Validates the requested vanilla `version.json`, then downloads/verifies the client JAR, libraries, assets and natives through the configured Minecraft CDN mirror. | Vanilla, Forge, NeoForge, Quilt |
| Shared launcher profile store | Creates `launcher_profiles.json` only in the managed shared Minecraft root when a Forge-family/Quilt installer needs a launcher base. | Forge, NeoForge, Quilt |
| Installer profile/version files | Lets the installer write loader version metadata into the shared `versions` tree, then resolves that profile against the verified vanilla parent. | Forge, NeoForge, Quilt |
| Per-instance game directory | Keeps mods, worlds, configs, resource packs, shader packs, screenshots and logs outside the shared launcher profile store. | All supported Java instance types |

The launch path now prepares the shared Vanilla layer *before* Forge or NeoForge profile resolution can invoke an installer. Quilt’s explicit installer command likewise targets the shared launcher root, while runtime resolution continues to use Quilt’s official profile metadata and the instance keeps its own game directory.

Fabric and Bedrock are intentionally outside this change. Modrinth, CurseForge and Java heap/performance settings were not edited.
