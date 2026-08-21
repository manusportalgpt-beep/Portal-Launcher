# NeoForge Error Screenshot Notes

The first two overlapping fragments show a failed automatic installation for **NeoForge 1.21.1**. The visible diagnostic reports host resolution/connectivity failures while attempting the installation, including `libraries.minecraft.net`, `launchermeta.mojang.com`, and `piston-meta.mojang.com`.

The same line also reports that the target instance directory does not yet contain a Minecraft launcher profile and ends with a generic installation failure. This is consistent with the installer continuing to profile-resolution work despite unavailable prerequisite metadata. The corrective implementation should detect unreachable prerequisite metadata early, present the concrete network stage to the user, and not issue a secondary misleading missing-profile failure.

The final fragment additionally confirms `sessionserver.mojang.com` as another failed host and shows that a Java 21 runtime was found. Therefore the visible failure is not the managed Java version; it is prerequisite Mojang metadata connectivity followed by profile work that cannot succeed without that metadata.

## Official installation sequence

The NeoForged client installation guide says to close the Minecraft Launcher, run the installer in **Install client** mode, then reopen the launcher so that a NeoForged run option appears. It recommends using a separate game directory through a custom launcher profile for a modded instance. Portal Launcher must therefore create and use its shared launcher-compatible metadata/profile base before invoking the official installer; a per-instance game directory is not a substitute for that base. Source: https://docs.neoforged.net/user/docs/client/
