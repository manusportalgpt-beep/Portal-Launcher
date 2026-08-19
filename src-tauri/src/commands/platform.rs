//! Windows platform probes: Developer Mode state and installed Bedrock packages.
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DeveloperModeState {
    /// Windows "Developer Mode" (AllowDevelopmentWithoutDevLicense) is enabled.
    pub enabled: bool,
    /// Sideloading of unsigned appx packages is allowed.
    pub sideload: bool,
    /// Host OS is Windows (Bedrock is Windows-only).
    pub windows: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct BedrockPackage {
    pub name: String,
    pub display_name: String,
    pub version: String,
    pub family: String,
    pub preview: bool,
}

#[cfg(target_os = "windows")]
fn read_dword(path: &str, name: &str) -> Option<u32> {
    use std::process::Command;
    let out = crate::utils::create_hidden_command("reg")
        .args(["query", path, "/v", name])
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&out.stdout).to_string();
    let token = text
        .split_whitespace()
        .rev()
        .find(|t| t.starts_with("0x"))?;
    u32::from_str_radix(token.trim_start_matches("0x"), 16).ok()
}

/// Reads the real Windows Developer Mode flags from the registry.
#[tauri::command]
pub async fn get_developer_mode() -> Result<DeveloperModeState, String> {
    #[cfg(target_os = "windows")]
    {
        const KEY: &str = r"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock";
        let enabled = read_dword(KEY, "AllowDevelopmentWithoutDevLicense").unwrap_or(0) == 1;
        let sideload = read_dword(KEY, "AllowAllTrustedApps").unwrap_or(0) == 1;
        return Ok(DeveloperModeState { enabled, sideload, windows: true });
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(DeveloperModeState { enabled: false, sideload: false, windows: false })
    }
}

/// Opens the Windows "For developers" settings page so the user can flip the switch.
#[tauri::command]
pub async fn open_developer_mode_settings() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        crate::utils::create_hidden_command("cmd")
            .args(["/C", "start", "", "ms-settings:developers"])
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("Developer Mode is a Windows-only setting.".into())
    }
}

/// Реально ВКЛЮЧАЕТ Windows Developer Mode (не просто открывает настройки).
/// HKLM недоступен для записи обычному пользовательскому процессу — это
/// ограничение самой Windows, а не наше. Единственный легитимный способ —
/// попросить пользователя подтвердить powershell-действие через стандартный
/// диалог UAC (тот же механизм, которым пользуется сам апплет "Параметры").
#[tauri::command]
pub async fn enable_developer_mode() -> Result<DeveloperModeState, String> {
    #[cfg(target_os = "windows")]
    {
        const KEY: &str = r"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock";
        let ps_script = format!(
            "Start-Process reg -ArgumentList 'add \"{KEY}\" /v AllowDevelopmentWithoutDevLicense /t REG_DWORD /d 1 /f' -Verb RunAs -Wait"
        );
        let status = crate::utils::create_hidden_command("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", &ps_script])
            .status()
            .map_err(|e| format!("Не удалось запросить права администратора: {e}"))?;
        if !status.success() {
            return Err("Включение Developer Mode отменено, либо не хватило прав администратора.".into());
        }
        std::thread::sleep(std::time::Duration::from_millis(400));
        return get_developer_mode().await;
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("Developer Mode is a Windows-only setting.".into())
    }
}

/// Lists every Minecraft Bedrock (UWP) package installed on this machine.
#[tauri::command]
pub async fn list_bedrock_versions() -> Result<Vec<BedrockPackage>, String> {
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        // ВАЖНО: раньше AppID собирался вручную как "<family>!App" — это
        // угадывание неверно для части Minecraft UWP-пакетов (у Preview,
        // например, суффикс другой). Get-StartApps отдаёт РЕАЛЬНЫЙ AUMID
        // (family+AppId уже вместе), который гарантированно открывается
        // через shell:appsFolder — гадать больше не нужно.
        let script = "\
            $apps = Get-StartApps | Where-Object { $_.AppID -like 'Microsoft.Minecraft*' }; \
            $pkgs = Get-AppxPackage -Name 'Microsoft.Minecraft*'; \
            foreach ($a in $apps) { \
              $fam = ($a.AppID -split '!')[0]; \
              $pkg = $pkgs | Where-Object { $_.PackageFamilyName -eq $fam } | Select-Object -First 1; \
              Write-Output \"$($a.Name)|$($pkg.PackageFullName)|$($pkg.Version)|$($a.AppID)\" \
            }";
        let out = crate::utils::create_hidden_command("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", script])
            .output()
            .map_err(|e| format!("PowerShell error: {e}"))?;
        let text = String::from_utf8_lossy(&out.stdout).to_string();
        let mut list = vec![];
        for line in text.lines() {
            let parts: Vec<&str> = line.trim().split('|').collect();
            if parts.len() < 4 || parts[0].is_empty() { continue; }
            let name = parts[0].to_string();
            let preview = name.to_lowercase().contains("beta") || name.to_lowercase().contains("preview");
            list.push(BedrockPackage {
                display_name: if preview { "Minecraft Preview".into() } else { "Minecraft Bedrock".into() },
                name,
                version: parts[2].to_string(),
                family: parts[3].to_string(), // теперь это полный AUMID, не просто family name
                preview,
            });
        }
        return Ok(list);
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(vec![])
    }
}

/// Launches an installed Bedrock package (requires a licensed Microsoft account).
#[tauri::command]
pub async fn launch_bedrock(family: Option<String>) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        // `family` теперь - это уже ПОЛНЫЙ AUMID (family+AppId), полученный
        // через Get-StartApps в list_bedrock_versions — раньше здесь вручную
        // достраивался "!App", что было неверно для части пакетов и приводило
        // к "не удаётся найти shell:appsFolder\...!App".
        let target = match family {
            Some(f) if !f.is_empty() => format!("shell:appsFolder\\{}", f),
            _ => "minecraft://".to_string(),
        };
        crate::utils::create_hidden_command("explorer.exe")
            .arg(&target)
            .spawn()
            .map_err(|e| format!("Failed to launch Bedrock: {e}"))?;
        return Ok(());
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = family;
        Err("Minecraft Bedrock Edition is only available on Windows.".into())
    }
}
