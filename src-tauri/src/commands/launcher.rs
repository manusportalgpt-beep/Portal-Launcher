use serde::Deserialize;
use std::process::Command;

#[derive(Deserialize)]
pub struct LaunchRequest {
    pub instance_id: String,
    pub instance_dir: Option<String>,
}

/// Запускает инстанс через внешний CLI (lighty-launcher) при наличии.
/// В идеале CLI будет установлен локально (npm install -g lighty-launcher)
/// или доступен через `npx lighty-launcher`.
#[tauri::command]
pub async fn launch_with_lighty(req: LaunchRequest) -> Result<String, String> {
    // Сформируем команду: npx lighty-launcher launch --instance <path>
    let mut args = vec!["lighty-launcher", "launch"];
    args.push("--instance");
    args.push(&req.instance_id);

    // Если указан путь к директории инстанса, добавим
    if let Some(dir) = req.instance_dir.as_ref() {
        args.push("--path");
        args.push(dir);
    }

    // Попытка вызвать через npx (если CLI не установлен глобально)
    let status = crate::utils::create_hidden_command("npx")
        .args(&args)
        .status()
        .map_err(|e| format!("Failed to spawn lighty via npx: {}", e))?;

    if status.success() {
        Ok("launched".to_string())
    } else {
        Err(format!("lighty-launcher exited with code: {}", status.code().unwrap_or(-1)))
    }
}

#[tauri::command]
pub async fn lighty_available() -> bool {
    // Проверяем, доступен ли глобальный бинарник `lighty-launcher` или `npx`
    if which::which("lighty-launcher").is_ok() {
        return true;
    }
    if which::which("npx").is_ok() {
        return true;
    }
    false
}
