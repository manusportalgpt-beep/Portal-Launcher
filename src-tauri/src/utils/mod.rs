// Utility helpers for encryption, paths, logging, and platform detection

use std::process::Command;

/// Windows-only flag that stops a spawned console process (cmd, powershell,
/// java installers, loader installers, etc.) from popping up a visible
/// black terminal window. On every other OS this is a no-op passthrough.
///
/// Use this instead of `Command::new(...)` for ANY process the launcher
/// spawns in the background — the user should never see a terminal flash
/// on screen just because we ran `powershell`/`cmd`/`java -jar installer.jar`.
#[cfg(target_os = "windows")]
pub fn create_hidden_command<S: AsRef<std::ffi::OsStr>>(program: S) -> Command {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    let mut cmd = Command::new(program);
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

#[cfg(not(target_os = "windows"))]
pub fn create_hidden_command<S: AsRef<std::ffi::OsStr>>(program: S) -> Command {
    Command::new(program)
}
