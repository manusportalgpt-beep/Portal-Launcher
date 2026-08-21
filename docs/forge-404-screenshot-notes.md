# Forge 404 Screenshot Notes

## Verified from the supplied screenshot

The instance is labeled **Forge 61.2.0 · Minecraft 1.21.1**. The terminal error says the launcher could not obtain a valid Forge installer JAR because the Forge server returned **HTTP 404 Not Found**. The corrupted/non-JAR cached file was removed, and the clean retry still did not produce a valid archive.

This is an artifact URL/version-resolution failure before Java launches the installer. It is not a Modrinth, CurseForge, Java heap, or game performance failure.

## Official Forge mapping

The official Forge downloads page for **Minecraft 1.21.1** lists the current compatible branch as **52.1.x** (latest shown as 52.1.16 and recommended as 52.1.0). The screenshot’s requested **61.2.0** belongs to the later 1.21.11 Forge branch, so the constructed `1.21.1-61.2.0` Maven artifact correctly returns HTTP 404 because it does not exist.

Source: https://files.minecraftforge.net/net/minecraftforge/forge/index_1.21.1.html
