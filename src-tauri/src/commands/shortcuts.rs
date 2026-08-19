//! Desktop shortcuts for launching one Portal Launcher instance directly.
use std::path::{Path, PathBuf};

const PORTAL_LAUNCHER_ICON_ICO: &[u8] = include_bytes!("../../icons/icon.ico");

fn shortcut_id_from_args() -> Option<String> {
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        if arg == "--portal-launch-instance" || arg == "--launch-instance" {
            let value = args.next()?.trim().to_string();
            if !value.is_empty() {
                return Some(value);
            }
        }
    }
    None
}

#[tauri::command]
pub fn get_startup_launch_instance() -> Option<String> {
    shortcut_id_from_args()
}

fn desktop_dir() -> Result<PathBuf, String> {
    #[cfg(windows)]
    {
        let output = crate::utils::create_hidden_command("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", "[Environment]::GetFolderPath('Desktop')"])
            .output()
            .map_err(|e| format!("Не удалось определить рабочий стол: {e}"))?;
        let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !path.is_empty() {
            return Ok(PathBuf::from(path));
        }
        if let Ok(profile) = std::env::var("USERPROFILE") {
            return Ok(PathBuf::from(profile).join("Desktop"));
        }
    }
    #[cfg(not(windows))]
    {
        if let Ok(home) = std::env::var("HOME") {
            let desktop = PathBuf::from(&home).join("Desktop");
            if desktop.is_dir() {
                return Ok(desktop);
            }
            return Ok(PathBuf::from(home).join("Desktop"));
        }
    }
    Err("Не удалось определить папку рабочего стола.".to_string())
}

fn safe_file_stem(name: &str) -> String {
    let mut value = name
        .chars()
        .map(|c| if matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') { '_' } else { c })
        .collect::<String>()
        .trim()
        .to_string();
    if value.is_empty() {
        value = "Portal Launcher".to_string();
    }
    value.chars().take(100).collect()
}

fn ps_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn shortcut_icon_dir() -> Result<PathBuf, String> {
    let dir = crate::commands::dirs::base_dir().join("shortcut-icons");
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Не удалось подготовить папку иконок ярлыков: {e}"))?;
    Ok(dir)
}

/// Wrap a PNG payload in a minimal PNG-backed ICO container for Windows shortcuts.
fn write_png_ico(png_path: &Path, ico_path: &Path) -> Result<bool, String> {
    let png = match std::fs::read(png_path) {
        Ok(bytes) if bytes.len() > 32 && bytes.starts_with(b"\x89PNG\r\n\x1a\n") => bytes,
        _ => return Ok(false),
    };
    let width = u32::from_be_bytes([png[16], png[17], png[18], png[19]]).clamp(1, 256);
    let height = u32::from_be_bytes([png[20], png[21], png[22], png[23]]).clamp(1, 256);
    let mut ico = Vec::with_capacity(22 + png.len());
    ico.extend_from_slice(&0u16.to_le_bytes());
    ico.extend_from_slice(&1u16.to_le_bytes());
    ico.extend_from_slice(&1u16.to_le_bytes());
    ico.push(if width >= 256 { 0 } else { width as u8 });
    ico.push(if height >= 256 { 0 } else { height as u8 });
    ico.extend_from_slice(&[0, 0]);
    ico.extend_from_slice(&1u16.to_le_bytes());
    ico.extend_from_slice(&32u16.to_le_bytes());
    ico.extend_from_slice(&(png.len() as u32).to_le_bytes());
    ico.extend_from_slice(&22u32.to_le_bytes());
    ico.extend_from_slice(&png);
    std::fs::write(ico_path, ico).map_err(|e| format!("Не удалось сохранить иконку сборки: {e}"))?;
    Ok(true)
}

/// Saves an already assembled ICO data URL produced from an instance cover.
/// The frontend renders every Windows size before sending it, so Explorer does
/// not need to blur one small source image on the desktop.
fn write_data_url_ico(data_url: &str, ico_path: &Path) -> Result<bool, String> {
    let Some((header, encoded)) = data_url.split_once(',') else { return Ok(false) };
    if !header.starts_with("data:image/") || !header.contains("base64") {
        return Ok(false);
    }
    use base64::Engine as _;
    let bytes = match base64::engine::general_purpose::STANDARD.decode(encoded) {
        Ok(bytes) if bytes.len() > 22 && bytes.len() <= 8 * 1024 * 1024 => bytes,
        _ => return Ok(false),
    };
    // 0, 0, 1, 0 is the ICO header. Reject unrelated data before writing it.
    if bytes.get(0..4) != Some(&[0, 0, 1, 0]) {
        return Ok(false);
    }
    std::fs::write(ico_path, bytes).map_err(|e| format!("Не удалось сохранить иконку сборки: {e}"))?;
    Ok(true)
}

#[tauri::command]
pub fn create_instance_shortcut(
    instance_id: String,
    instance_name: String,
    icon_ico_data_url: Option<String>,
) -> Result<String, String> {
    if instance_id.trim().is_empty() {
        return Err("Не указана сборка для ярлыка.".to_string());
    }
    let desktop = desktop_dir()?;
    std::fs::create_dir_all(&desktop).map_err(|e| format!("Рабочий стол недоступен: {e}"))?;
    let label = safe_file_stem(&instance_name);
    let executable = std::env::current_exe().map_err(|e| format!("Не удалось определить Portal Launcher.exe: {e}"))?;
    let instance_icon = crate::mc::launch::instance_game_dir(&instance_id).join("icon.png");
    let shortcut_icon = shortcut_icon_dir()?.join(format!("{}.ico", safe_file_stem(&instance_id)));
    let legacy_desktop_icon = desktop.join(format!("{label}.ico"));
    let has_instance_icon = icon_ico_data_url
        .as_deref()
        .and_then(|data| write_data_url_ico(data, &shortcut_icon).ok())
        .unwrap_or(false)
        || write_png_ico(&instance_icon, &shortcut_icon).unwrap_or(false);
    if !has_instance_icon {
        std::fs::write(&shortcut_icon, PORTAL_LAUNCHER_ICON_ICO)
            .map_err(|e| format!("Не удалось сохранить иконку Portal Launcher: {e}"))?;
    }

    #[cfg(windows)]
    {
        let shortcut_path = desktop.join(format!("{label}.lnk"));
        let icon_path = if has_instance_icon {
            shortcut_icon.to_string_lossy().to_string()
        } else {
            executable.to_string_lossy().to_string()
        };
        let script = format!(
            "$ws=New-Object -ComObject WScript.Shell;$s=$ws.CreateShortcut({});$s.TargetPath={};$s.Arguments={};$s.WorkingDirectory={};$s.IconLocation=({},0);$s.Description={};$s.Save()",
            ps_quote(&shortcut_path.to_string_lossy()),
            ps_quote(&executable.to_string_lossy()),
            ps_quote(&format!("--portal-launch-instance {}", instance_id)),
            ps_quote(executable.parent().unwrap_or(Path::new(".")).to_string_lossy().as_ref()),
            ps_quote(&icon_path),
            ps_quote(&format!("Запустить сборку {} напрямую через Portal Launcher", instance_name)),
        );
        let output = crate::utils::create_hidden_command("powershell")
            .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", &script])
            .output()
            .map_err(|e| format!("Не удалось создать ярлык: {e}"))?;
        if !output.status.success() || !shortcut_path.exists() {
            let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(if detail.is_empty() { "Windows не создал ярлык.".to_string() } else { detail });
        }
        // Older versions placed helper ICO files beside the .lnk. Explorer
        // showed them as a second desktop object and opened the ICO in Paint.
        let _ = std::fs::remove_file(&legacy_desktop_icon);
        if let Ok(entries) = std::fs::read_dir(&desktop) {
            for entry in entries.flatten() {
                let path = entry.path();
                let is_ico = path.extension().and_then(|ext| ext.to_str()).map(|ext| ext.eq_ignore_ascii_case("ico")).unwrap_or(false);
                let is_launcher_icon = path.file_stem().and_then(|stem| stem.to_str()).map(|stem| stem == label || stem.starts_with("Portal Launcher")).unwrap_or(false);
                if is_ico && is_launcher_icon { let _ = std::fs::remove_file(path); }
            }
        }
        return Ok(shortcut_path.to_string_lossy().to_string());
    }

    #[cfg(target_os = "macos")]
    {
        let shortcut_path = desktop.join(format!("{label}.command"));
        let text = format!("#!/bin/sh\nexec \\\"{}\\\" --portal-launch-instance \\\"{}\\\"\n", executable.to_string_lossy(), instance_id);
        std::fs::write(&shortcut_path, text).map_err(|e| format!("Не удалось записать ярлык: {e}"))?;
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&shortcut_path, std::fs::Permissions::from_mode(0o755)).ok();
        return Ok(shortcut_path.to_string_lossy().to_string());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let shortcut_path = desktop.join(format!("{label}.desktop"));
        let exec = format!("{} --portal-launch-instance {}", executable.to_string_lossy().replace(' ', "\\ "), instance_id.replace(' ', "\\ "));
        let content = format!("[Desktop Entry]\nType=Application\nName={}\nComment=Launch Minecraft instance with Portal Launcher\nExec={}\nTerminal=false\nCategories=Game;\n", instance_name.replace('\n', " "), exec);
        std::fs::write(&shortcut_path, content).map_err(|e| format!("Не удалось записать ярлык: {e}"))?;
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&shortcut_path, std::fs::Permissions::from_mode(0o755)).ok();
        return Ok(shortcut_path.to_string_lossy().to_string());
    }
}
