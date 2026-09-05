# Launcher performance contract

The JVM command assembled in `src-tauri/src/mc/launch.rs` owns the launcher's
performance baseline. Keep these rules intact when changing launch arguments:

- keep the real CPU count visible to Minecraft; never hard-code a processor count;
- keep the adaptive heap policy: settings provide `Xmx`, while `Xms` is not forced;
- keep the launcher-owned G1GC, parallel reference processing, GC pause target,
  and `DisableExplicitGC` flags;
- custom instance JVM arguments must not override the launcher's heap or baseline
  performance flags.
- GPU selection is delegated to the operating system: Windows registers the
  actual Java executable as high-performance, while Linux launches through
  PRIME (`DRI_PRIME=1`) and adds NVIDIA offload variables only when the NVIDIA
  kernel driver is present. Do not hard-code a GPU vendor or a device index.

These settings are part of the runtime contract for NeoForge, Forge, Fabric, and
Quilt instances. Change them only with a measured regression test on the same
modpack and Minecraft version.