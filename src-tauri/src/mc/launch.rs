//! Реальный запуск Minecraft: сборка classpath и аргументов из version.json,
//! подстановка placeholder'ов, quickPlay (мир/сервер), стрим логов в UI и
//! перехват краша с предложением отправить лог в Grok.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use sha2::{Digest, Sha256};
use tauri::Emitter;

use super::install::{
    collect_libraries, download_file, http, install_version, natives_dir, resolve_version, rules_allow,
    version_jar_path,
};
use crate::auth::msa;
use crate::commands::version_manager::{assets_dir, libraries_dir, mc_base_dir};

lazy_static::lazy_static! {
    /// instance_id -> pid
    pub static ref RUNNING: Arc<Mutex<HashMap<String, u32>>> = Arc::new(Mutex::new(HashMap::new()));
    /// instance_id -> последние строки лога
    pub static ref LOGS: Arc<Mutex<HashMap<String, Vec<String>>>> = Arc::new(Mutex::new(HashMap::new()));
    /// сборки, запуск которых нужно прервать при следующей проверке
    /// (до того как появился реальный процесс/PID для kill_instance)
    pub static ref CANCELLED: Arc<Mutex<std::collections::HashSet<String>>> = Arc::new(Mutex::new(std::collections::HashSet::new()));
}

const MAX_LOG_LINES: usize = 2000;
const ELYBY_INJECTOR_URL: &str = "https://github.com/yushijinhun/authlib-injector/releases/download/v1.2.8/authlib-injector-1.2.8.jar";
const ELYBY_INJECTOR_SHA256: &str = "9c7f4343e6c82034958ffb48c14a2cb0c85928be7283103ce17da00c6d5a7b10";

/// Downloads the official authlib-injector only when an Ely.by account starts Java.
/// It is a JVM agent, so Minecraft and its libraries remain untouched.
async fn ensure_elyby_injector(client: &reqwest::Client) -> Result<PathBuf, String> {
    let path = mc_base_dir().join("injectors").join("authlib-injector-1.2.8.jar");
    let valid = std::fs::read(&path).ok().map(|bytes| {
        format!("{:x}", Sha256::digest(&bytes)) == ELYBY_INJECTOR_SHA256
    }).unwrap_or(false);
    if !valid {
        std::fs::create_dir_all(path.parent().ok_or("Invalid injector directory")?)
            .map_err(|e| format!("Create Ely.by injector folder: {e}"))?;
        let temp = path.with_extension("jar.part");
        download_file(client, ELYBY_INJECTOR_URL, &temp, None).await?;
        let bytes = std::fs::read(&temp).map_err(|e| format!("Read Ely.by injector: {e}"))?;
        let digest = format!("{:x}", Sha256::digest(&bytes));
        if digest != ELYBY_INJECTOR_SHA256 {
            let _ = std::fs::remove_file(&temp);
            return Err("The downloaded Ely.by authlib-injector failed its SHA-256 check.".to_string());
        }
        std::fs::rename(&temp, &path).map_err(|e| format!("Save Ely.by injector: {e}"))?;
    }
    Ok(path)
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
pub struct LaunchResult {
    pub success: bool,
    pub pid: Option<u32>,
    pub message: String,
    pub command: String,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct QuickPlay {
    /// Папка мира внутри saves (singleplayer)
    pub world: Option<String>,
    /// Адрес сервера (multiplayer)
    pub server: Option<String>,
}

pub fn instances_root() -> PathBuf {
    mc_base_dir().join("instances")
}

/// Папка данных сборки — у каждой сборки своя файловая система.
pub fn instance_game_dir(instance_id: &str) -> PathBuf {
    instances_root().join(instance_id).join(".minecraft")
}

fn sep() -> &'static str {
    if cfg!(windows) {
        ";"
    } else {
        ":"
    }
}

fn replace_all(template: &str, vars: &HashMap<String, String>) -> String {
    let mut out = template.to_string();
    for (k, v) in vars {
        out = out.replace(&format!("${{{k}}}"), v);
    }
    out
}

/// Разворачивает массив аргументов version.json (строки или {rules, value}).
fn expand_args(
    list: Option<&Vec<serde_json::Value>>,
    vars: &HashMap<String, String>,
    features: &[&str],
) -> Vec<String> {
    let mut out = Vec::new();
    let Some(list) = list else { return out };
    for item in list {
        if let Some(s) = item.as_str() {
            out.push(replace_all(s, vars));
            continue;
        }
        let rules = item["rules"].as_array().cloned();
        if !rules_allow(rules.as_ref(), features) {
            continue;
        }
        match &item["value"] {
            serde_json::Value::String(s) => out.push(replace_all(s, vars)),
            serde_json::Value::Array(arr) => {
                for v in arr {
                    if let Some(s) = v.as_str() {
                        out.push(replace_all(s, vars));
                    }
                }
            }
            _ => {}
        }
    }
    out
}

fn build_classpath(version: &serde_json::Value, mc_id: &str) -> Vec<String> {
    let mut cp: Vec<String> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();

    for lib in collect_libraries(version) {
        if lib.native {
            continue;
        }
        let p = lib.path.to_string_lossy().to_string();
        // одна библиотека на group:artifact — берём первую (профиль загрузчика впереди)
        let key = lib
            .path
            .parent()
            .and_then(|p| p.parent())
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| p.clone());
        // ВАЖНО: сначала проверяем exists(), потом seen.insert(key).
        // Раньше было наоборот — seen.insert(key) выполнялся первым за счёт
        // short-circuit && и "занимал" слот group:artifact, даже если файл
        // библиотеки ещё не скачан. В результате, если предпочтительная
        // версия библиотеки (например, из профиля Fabric, который идёт
        // первым в списке) отсутствовала на диске, её отсутствующий путь
        // блокировал добавление уже скачанной vanilla-версии той же
        // библиотеки — она пропускалась молча. Итог: classpath собирался
        // неполным, Minecraft падал с ClassNotFoundException/NoClassDefFoundError
        // именно на сборках с загрузчиками (Fabric/Forge/Quilt).
        if lib.path.exists() && seen.insert(key) {
            cp.push(p);
        }
    }
    let jar = version_jar_path(mc_id);
    if jar.exists() {
        cp.push(jar.to_string_lossy().to_string());
    }
    cp
}

fn required_java(version: &serde_json::Value) -> u32 {
    version["javaVersion"]["majorVersion"]
        .as_u64()
        .unwrap_or_else(|| {
            let id = version["id"].as_str().unwrap_or("1.20");
            let parts: Vec<u64> = id.split('.').filter_map(|part| part.parse::<u64>().ok()).collect();
            // Minecraft 26.x uses Java 25 (class-file major version 69).
            if parts.first().copied().unwrap_or(1) >= 26 {
                25
            } else {
                let minor = parts.get(1).copied().unwrap_or(20);
                if minor <= 16 { 8 } else if minor == 17 { 16 } else if minor <= 20 { 17 } else { 21 }
            }
        }) as u32
}

// ─────────────────────────────────────────────────────────────────────────────
// Основная команда запуска
// ─────────────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn launch_instance(
    app: tauri::AppHandle,
    instance_id: String,
    quick_play: Option<QuickPlay>,
    username: Option<String>,
    uuid: Option<String>,
    access_token: Option<String>,
    provider: Option<String>,
) -> Result<LaunchResult, String> {
    if instance_id.trim().is_empty() {
        return Err("Не выбрана сборка для запуска.".into());
    }
    if RUNNING.lock().unwrap().contains_key(&instance_id) {
        return Err("Эта сборка уже запущена.".into());
    }

    let instance = crate::minecraft_lib::load_instance_config(&instance_id)
        .ok_or_else(|| format!("Сборка {instance_id} не найдена."))?;

    // Сбрасываем возможный "хвост" отмены от предыдущей попытки запуска.
    CANCELLED.lock().unwrap().remove(&instance_id);
    let check_cancelled = || -> Result<(), String> {
        if CANCELLED.lock().unwrap().remove(&instance_id) {
            Err("Запуск отменён.".to_string())
        } else {
            Ok(())
        }
    };

    let status = |stage: &str, msg: &str| {
        app.emit(
            "launch-status",
            serde_json::json!({ "instance_id": &instance_id, "status": stage, "message": msg }),
        )
        .ok();
    };

    // 1. Аккаунт — берём тот, что реально выбран в интерфейсе (Microsoft/Ely.by/
    // офлайн, хранится во фронтенде через authStore), а НЕ из отдельного
    // auth/msa.rs хранилища, в которое фронтенд никогда не пишет. Раньше это
    // означало, что запуск ВСЕГДА шёл как анонимный "Player", независимо от
    // того, что показывал интерфейс.
    status("auth", "Проверяю аккаунт…");
    let (final_username, final_uuid, token, user_type) = match (username, uuid, access_token) {
        (Some(u), Some(id), Some(tok)) if !u.is_empty() && !id.is_empty() => {
            if tok.is_empty() {
                (u, id, "0".to_string(), "legacy".to_string())
            } else {
                (u, id, tok, "msa".to_string())
            }
        }
        _ => {
            // Резервный вариант — старая система (если когда-либо была настроена).
            let account = msa::ensure_fresh_token(&app).await;
            match account {
                Some(a) if !a.access_token.is_empty() => (a.username, a.uuid, a.access_token, "msa".to_string()),
                Some(a) => (a.username, a.uuid, "0".to_string(), "legacy".to_string()),
                None => ("Player".to_string(), msa::offline_uuid("Player"), "0".to_string(), "legacy".to_string()),
            }
        }
    };
    let username = final_username;
    let uuid = final_uuid;
    // Main UI paths pass `provider` explicitly. Quick-play paths may not, so only
    // fall back to the saved profile when it is the same account UUID.
    let is_elyby = provider.as_deref() == Some("elyby") || (
        provider.is_none() && msa::load_account()
            .map(|saved| saved.provider.as_deref() == Some("elyby") && saved.uuid == uuid)
            .unwrap_or(false)
    );
    let xuid = String::new();

    // 2. Разрешаем версию (с загрузчиком) и ставим всё нужное.
    // Если обязательных файлов ещё нет, первый вызов только подготавливает
    // окружение. Пользователь запускает Minecraft отдельной кнопкой после
    // завершения загрузки.
    // resolve_version validates the shared vanilla/profile cache before it is
    // reused. A mismatched loader profile is discarded and fetched again here,
    // while per-instance mods, worlds and settings stay untouched.
    status("resolve", "Проверяю Minecraft и совместимость загрузчика…");
    let client = http();
    let mut prepared_only = !version_jar_path(&instance.mc_version).exists()
        || !natives_dir(&instance.mc_version).exists();
    let (version, profile_id) = resolve_version(
        &client,
        &instance.mc_version,
        &instance.loader,
        &instance.loader_version,
    )
    .await?;
    let asset_index_ready = version["assetIndex"]["id"].as_str()
        .map(|id| assets_dir().join("indexes").join(format!("{id}.json")).exists())
        .unwrap_or(true);
    prepared_only = prepared_only
        || !asset_index_ready
        || collect_libraries(&version).iter().any(|lib| !lib.path.exists());

    status("install", "Проверяю и докачиваю файлы игры…");
    check_cancelled()?;
    install_version(&app, &version, &profile_id, &instance.mc_version).await?;

    // 3. Java
    status("java", "Ищу Java…");
    let java_major = required_java(&version);
    let java_path = if !instance.java_path.is_empty() && Path::new(&instance.java_path).exists()
        && crate::commands::jvm::run_java(&instance.java_path)
            .map(|info| info.major_version >= java_major && !info.architecture.eq_ignore_ascii_case("x86"))
            .unwrap_or(false) {
        instance.java_path.clone()
    } else {
        let found = crate::commands::jvm::find_java(java_major);
        let found_ok = crate::commands::jvm::run_java(&found)
            .map(|info| info.major_version >= java_major && !info.architecture.eq_ignore_ascii_case("x86"))
            .unwrap_or(false);
        if !found_ok {
            prepared_only = true;
            status("java", &format!("Скачиваю Java {java_major}…"));
            crate::commands::jvm::download_java(app.clone(), java_major)
                .await
                .map_err(|e| format!("Java {java_major} недоступна: {e}"))?
        } else {
            found
        }
    };

    // 4. Пути сборки (своя файловая система на каждую сборку)
    let game_dir = instance_game_dir(&instance_id);
    for sub in [
        "mods", "config", "saves", "resourcepacks", "shaderpacks",
        "screenshots", "logs", "crash-reports", "datapacks",
    ] {
        std::fs::create_dir_all(game_dir.join(sub)).ok();
    }

    let mc_id = version["id"].as_str().unwrap_or(&instance.mc_version).to_string();
    // install_version всегда распаковывает natives в versions/<vanilla version>/natives.
    // Fabric/Quilt profile ID здесь использовать нельзя: JVM получает пустую
    // папку и LWJGL падает с "Failed to locate library: lwjgl.dll".
    let natives = natives_dir(&instance.mc_version);
    let has_lwjgl_dll = || std::fs::read_dir(&natives)
        .ok()
        .into_iter()
        .flatten()
        .any(|entry| entry.ok().map(|entry| entry.file_name().to_string_lossy().eq_ignore_ascii_case("lwjgl.dll")).unwrap_or(false));
    // Старые попытки могли оставить natives в пути loader-профиля или оборвать
    // распаковку. Восстанавливаем папку до запуска, а не передаём LWJGL пустой путь.
    if !has_lwjgl_dll() {
        prepared_only = true;
        status("natives", "Восстанавливаю native-библиотеки LWJGL…");
        let _ = std::fs::remove_dir_all(&natives);
        install_version(&app, &version, &profile_id, &instance.mc_version).await?;
        if !has_lwjgl_dll() {
            return Err(format!(
                "Не удалось подготовить lwjgl.dll в {}. Переустановите версию и повторите запуск.",
                natives.display()
            ));
        }
    }

    // ВАЖНО: client.jar (ванильный клиент, от которого зависит Fabric/Forge/
    // Quilt) build_classpath раньше добавлял только "если файл есть" — если
    // его почему-то не было (оборванная закачка, старый инстанс с версии до
    // фикса пути), classpath собирался БЕЗ игры вообще, и уже сам Fabric
    // падал с невнятным "Minecraft game provider couldn't locate the game".
    // Проверяем и докачиваем здесь явно, чтобы ошибка (если будет) была
    // понятной, а не крипто-сообщением из чужого загрузчика.
    let client_jar = crate::mc::install::version_jar_path(&instance.mc_version);
    if !client_jar.exists() {
        prepared_only = true;
        log::warn!("client.jar отсутствует ({}), докачиваю повторно", client_jar.display());
        install_version(&app, &version, &profile_id, &instance.mc_version).await?;
        if !client_jar.exists() {
            return Err(format!(
                "Не удалось скачать client.jar для версии {} — проверьте подключение к интернету и попробуйте переустановить версию.",
                instance.mc_version
            ));
        }
    }

    // Диагностика перед сборкой classpath: библиотеки, которые version.json
    // ожидает, но которых физически нет на диске (оборванная закачка и т.п.).
    // Раньше они просто молча пропускались, и игра падала с непонятным
    // ClassNotFoundException без единой подсказки, чего не хватает.
    let missing: Vec<String> = collect_libraries(&version)
        .into_iter()
        .filter(|lib| !lib.native && !lib.path.exists())
        .map(|lib| lib.path.to_string_lossy().to_string())
        .collect();
    if !missing.is_empty() {
        prepared_only = true;
        log::warn!("Отсутствуют библиотеки ({}): {:#?}", missing.len(), missing);
        status("install", &format!("Докачиваю недостающие файлы ({})...", missing.len()));
        // Одна повторная попытка докачать перед сборкой classpath.
        install_version(&app, &version, &profile_id, &instance.mc_version).await?;
    }

    let classpath = build_classpath(&version, &instance.mc_version);
    if classpath.is_empty() {
        return Err("Classpath пуст — файлы игры повреждены. Переустановите версию.".into());
    }
    let still_missing: Vec<String> = collect_libraries(&version)
        .into_iter()
        .filter(|lib| !lib.native && !lib.path.exists())
        .map(|lib| lib.path.to_string_lossy().to_string())
        .collect();
    if !still_missing.is_empty() {
        return Err(format!(
            "Не удалось докачать {} файл(ов), нужных для запуска:\n{}\nПроверьте подключение к интернету и переустановите версию/загрузчик.",
            still_missing.len(),
            still_missing.join("\n")
        ));
    }
    if prepared_only {
        let message = "Minecraft подготовлен. Нажмите Launch ещё раз, чтобы запустить игру.";
        status("prepared", message);
        app.emit("instance-prepared", serde_json::json!({
            "instance_id": &instance_id,
            "message": message,
        })).ok();
        return Ok(LaunchResult {
            success: true,
            pid: None,
            message: message.to_string(),
            command: String::new(),
        });
    }

    let classpath_str = classpath.join(sep());

    let asset_index = version["assetIndex"]["id"]
        .as_str()
        .or(version["assets"].as_str())
        .unwrap_or("legacy")
        .to_string();

    let mut vars: HashMap<String, String> = HashMap::new();
    vars.insert("auth_player_name".into(), username.clone());
    vars.insert("version_name".into(), mc_id.clone());
    vars.insert("game_directory".into(), game_dir.to_string_lossy().to_string());
    vars.insert("assets_root".into(), assets_dir().to_string_lossy().to_string());
    vars.insert("game_assets".into(), assets_dir().join("virtual").join("legacy").to_string_lossy().to_string());
    vars.insert("assets_index_name".into(), asset_index.clone());
    vars.insert("auth_uuid".into(), uuid.replace('-', ""));
    vars.insert("auth_access_token".into(), token.clone());
    vars.insert("auth_session".into(), format!("token:{token}:{}", uuid.replace('-', "")));
    vars.insert("auth_xuid".into(), xuid.clone());
    vars.insert("clientid".into(), "PortalLauncher".into());
    vars.insert("user_type".into(), user_type.clone());
    vars.insert("user_properties".into(), "{}".into());
    vars.insert(
        "version_type".into(),
        version["type"].as_str().unwrap_or("release").to_string(),
    );
    vars.insert("natives_directory".into(), natives.to_string_lossy().to_string());
    vars.insert("launcher_name".into(), "PortalLauncher".into());
    vars.insert("launcher_version".into(), env!("CARGO_PKG_VERSION").into());
    vars.insert("classpath".into(), classpath_str.clone());
    vars.insert("classpath_separator".into(), sep().into());
    vars.insert("library_directory".into(), libraries_dir().to_string_lossy().to_string());
    vars.insert("resolution_width".into(), "1280".into());
    vars.insert("resolution_height".into(), "720".into());

    let features: Vec<&str> = vec![];

    // 5. JVM аргументы
    // Respect the per-instance RAM selection. The launcher used to force every
    // process to report exactly eight CPU cores and to use an undersized thread
    // stack. That can throttle chunk work or trigger severe stutter in modpacks
    // which were previously smooth, especially on hardware with a different
    // core layout. Let the JVM detect the real processor count instead.
    let min_ram = instance.min_ram.max(512);
    let max_ram = instance.max_ram.max(min_ram);
    let mut jvm_args: Vec<String> = vec![
        "-Dfile.encoding=UTF-8".into(),
        "-Dstdout.encoding=UTF-8".into(),
        "-Dstderr.encoding=UTF-8".into(),
        "-Dminecraft.launcher.brand=PortalLauncher".into(),
        format!("-Dminecraft.launcher.version={}", env!("CARGO_PKG_VERSION")),
    ];

    if is_elyby {
        status("auth", "Подключаю Ely.by authentication agent…");
        let injector = ensure_elyby_injector(&client).await?;
        jvm_args.push(format!("-javaagent:{}=ely.by", injector.to_string_lossy()));
    }

    let from_json = expand_args(version["arguments"]["jvm"].as_array(), &vars, &features);
    if from_json.is_empty() {
        // Старые версии (<1.13) не содержат arguments.jvm
        jvm_args.push("-cp".into());
        jvm_args.push(classpath_str.clone());
    } else {
        jvm_args.extend(from_json);
    }
    // Явно добавляем оба пути ПОСЛЕ аргументов version.json: последний
    // system property побеждает, поэтому Fabric и современные snapshots
    // всегда получают реальную папку с lwjgl.dll.
    jvm_args.push(format!("-Djava.library.path={}", natives.to_string_lossy()));
    jvm_args.push(format!("-Dorg.lwjgl.librarypath={}", natives.to_string_lossy()));

    if let Some(file) = version["logging"]["client"]["file"]["id"].as_str() {
        let cfg = assets_dir().join("log_configs").join(file);
        if cfg.exists() {
            if let Some(arg) = version["logging"]["client"]["argument"].as_str() {
                jvm_args.push(arg.replace("${path}", &cfg.to_string_lossy()));
            }
        }
    }
    if !instance.custom_jvm_args.trim().is_empty() {
        let mut ignored_heap_flags = Vec::new();
        let custom_args = instance.custom_jvm_args.split_whitespace().filter_map(|arg| {
            let normalized = arg.to_ascii_lowercase();
            let overrides_heap = normalized.starts_with("-xms")
                || normalized.starts_with("-xmx")
                || normalized.starts_with("-xx:initialheapsize=")
                || normalized.starts_with("-xx:minheapsize=")
                || normalized.starts_with("-xx:maxheapsize=");
            if overrides_heap {
                ignored_heap_flags.push(arg.to_string());
                None
            } else {
                Some(arg.to_string())
            }
        });
        jvm_args.extend(custom_args);
        if !ignored_heap_flags.is_empty() {
            log::warn!(
                "Игнорирую JVM-параметры памяти из поля аргументов ({:?}); используется значение из Настройки → Minecraft: Xms={} MiB, Xmx={} MiB",
                ignored_heap_flags,
                min_ram,
                max_ram,
            );
        }
    }
    // These flags must be last among JVM options: Java accepts the last heap
    // switch, and an old custom/profile argument such as -Xmx4096M otherwise
    // silently wins over the value selected in Settings → Minecraft.
    jvm_args.push(format!("-Xms{min_ram}m"));
    jvm_args.push(format!("-Xmx{max_ram}m"));

    let main_class = version["mainClass"]
        .as_str()
        .unwrap_or("net.minecraft.client.main.Main")
        .to_string();

    // 6. Игровые аргументы
    let mut game_args = expand_args(version["arguments"]["game"].as_array(), &vars, &features);
    if game_args.is_empty() {
        if let Some(legacy) = version["minecraftArguments"].as_str() {
            game_args = replace_all(legacy, &vars)
                .split_whitespace()
                .map(String::from)
                .collect();
        }
    }

    // Quilt 0.29+ reads the game directory from the launcher arguments. Some
    // generated/custom profiles omit it, leaving Quilt's gameDir null even
    // though the process current directory is correct. Add the canonical
    // argument once, without duplicating a value supplied by version metadata.
    if !game_args.iter().any(|arg| arg == "--gameDir") {
        game_args.push("--gameDir".into());
        game_args.push(game_dir.to_string_lossy().to_string());
    }

    // quickPlay — вход в мир/сервер прямо из лаунчера
    let minor: u32 = instance
        .mc_version
        .split('.')
        .nth(1)
        .and_then(|m| m.parse().ok())
        .unwrap_or(20);
    if let Some(qp) = quick_play.as_ref() {
        if let Some(world) = qp.world.as_ref().filter(|w| !w.is_empty()) {
            if minor >= 20 {
                game_args.push("--quickPlaySingleplayer".into());
                game_args.push(world.clone());
            }
        }
        if let Some(server) = qp.server.as_ref().filter(|s| !s.is_empty()) {
            if minor >= 20 {
                game_args.push("--quickPlayMultiplayer".into());
                game_args.push(server.clone());
            } else {
                let (host, port) = match server.split_once(':') {
                    Some((h, p)) => (h.to_string(), p.to_string()),
                    None => (server.clone(), "25565".to_string()),
                };
                game_args.push("--server".into());
                game_args.push(host);
                game_args.push("--port".into());
                game_args.push(port);
            }
        }
    }

    // 7. Собираем команду
    check_cancelled()?;
    let mut cmd = crate::utils::create_hidden_command(&java_path);
    cmd.current_dir(&game_dir);
    cmd.args(&jvm_args);
    if !jvm_args.iter().any(|a| a == "-cp" || a == "-classpath") {
        cmd.arg("-cp").arg(&classpath_str);
    }
    cmd.arg(&main_class);
    cmd.args(&game_args);
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let detected_threads = std::thread::available_parallelism()
        .map(|count| count.get())
        .unwrap_or(0);
    log::info!(
        "Конфигурация производительности Minecraft: Java >= {}, Xms={} MiB, Xmx={} MiB, CPU={} (автоопределение JVM)",
        java_major,
        min_ram,
        max_ram,
        if detected_threads > 0 { detected_threads.to_string() } else { "неизвестно".to_string() },
    );

    let printable = format!(
        "{java_path} {} -cp <{} entries> {main_class} {}",
        jvm_args.join(" "),
        classpath.len(),
        game_args
            .iter()
            .map(|a| if a == &token { "<token>".to_string() } else { a.clone() })
            .collect::<Vec<_>>()
            .join(" ")
    );
    log::info!("Launch: {printable}");

    status("starting", "Запускаю Minecraft…");
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Не удалось запустить Java ({java_path}): {e}"))?;
    let pid = child.id();
    RUNNING.lock().unwrap().insert(instance_id.clone(), pid);
    LOGS.lock().unwrap().insert(instance_id.clone(), Vec::new());

    // 8. Стрим логов
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let log_file = std::fs::OpenOptions::new()
        .create(true).truncate(true).write(true)
        .open(game_dir.join("logs").join("latest.log"))
        .ok()
        .map(|file| Arc::new(Mutex::new(file)));
    // The launcher exposes exactly one visible log session for each process.
    // Emit this only after the new process exists and latest.log was truncated,
    // so open log panes clear their previous run before the first new line.
    app.emit(
        "game-log-session",
        serde_json::json!({ "instance_id": &instance_id, "pid": pid }),
    ).ok();
    status("running", "Minecraft запущен");
    for (stream, is_err) in [(stdout.map(|s| Box::new(s) as Box<dyn std::io::Read + Send>), false)]
        .into_iter()
        .chain([(stderr.map(|s| Box::new(s) as Box<dyn std::io::Read + Send>), true)])
    {
        let Some(stream) = stream else { continue };
        let app2 = app.clone();
        let id2 = instance_id.clone();
        let log_file2 = log_file.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stream);
            for line in reader.lines().map_while(Result::ok) {
                push_log(&id2, &line);
                if let Some(file) = &log_file2 {
                    if let Ok(mut file) = file.lock() { let _ = writeln!(file, "{}", line); }
                }
                app2.emit(
                    "game-log",
                    serde_json::json!({
                        "source": "minecraft",
                        "instance_id": &id2,
                        "pid": pid,
                        "stream": if is_err { "stderr" } else { "stdout" },
                        "line": line,
                        "level": if is_err { "error" } else { detect_level(&line) },
                    }),
                )
                .ok();
            }
        });
    }

    // 9. Ожидание завершения + перехват краша
    let app3 = app.clone();
    let id3 = instance_id.clone();
    let game_dir3 = game_dir.clone();
    let version_label = instance.mc_version.clone();
    let loader_label = instance.loader.clone();
    std::thread::spawn(move || {
        let status = child.wait();
        RUNNING.lock().unwrap().remove(&id3);
        let code = status.as_ref().map(|s| s.code().unwrap_or(-1)).unwrap_or(-1);
        let logs = LOGS.lock().unwrap().get(&id3).cloned().unwrap_or_default();
        let tail = logs
            .iter()
            .rev()
            .take(400)
            .rev()
            .cloned()
            .collect::<Vec<_>>()
            .join("\n");

        app3.emit(
            "game-exited",
            serde_json::json!({ "instance_id": &id3, "code": code }),
        )
        .ok();
        app3.emit(
            "launch-status",
            serde_json::json!({
                "instance_id": &id3,
                "status": if code == 0 { "stopped" } else { "error" },
                "message": if code == 0 { "Игра закрыта".to_string() } else { format!("Minecraft завершился с кодом {code}") },
            }),
        )
        .ok();

        if code != 0 {
            let crash_report = latest_crash_report(&game_dir3);
            app3.emit(
                "game-crashed",
                serde_json::json!({
                    "instance_id": &id3,
                    "exit_code": code,
                    "mc_version": version_label,
                    "loader": loader_label,
                    "log": tail,
                    "crash_report": crash_report,
                }),
            )
            .ok();
        }
    });

    Ok(LaunchResult {
        success: true,
        pid: Some(pid),
        message: format!("Minecraft {} запущен (PID {pid})", instance.mc_version),
        command: printable,
    })
}

fn push_log(instance_id: &str, line: &str) {
    let mut map = LOGS.lock().unwrap();
    let entry = map.entry(instance_id.to_string()).or_default();
    entry.push(line.to_string());
    if entry.len() > MAX_LOG_LINES {
        let drop = entry.len() - MAX_LOG_LINES;
        entry.drain(0..drop);
    }
}

fn detect_level(line: &str) -> &'static str {
    let u = line.to_uppercase();
    if u.contains("FATAL") {
        "fatal"
    } else if u.contains("ERROR") || u.contains("EXCEPTION") {
        "error"
    } else if u.contains("WARN") {
        "warn"
    } else {
        "info"
    }
}

fn latest_crash_report(game_dir: &Path) -> Option<String> {
    let dir = game_dir.join("crash-reports");
    let mut newest: Option<(std::time::SystemTime, PathBuf)> = None;
    for entry in std::fs::read_dir(dir).ok()?.flatten() {
        let meta = entry.metadata().ok()?;
        let modified = meta.modified().ok()?;
        if newest.as_ref().map(|(t, _)| modified > *t).unwrap_or(true) {
            newest = Some((modified, entry.path()));
        }
    }
    let (_, path) = newest?;
    let content = std::fs::read_to_string(path).ok()?;
    Some(content.chars().take(24_000).collect())
}

fn request_stop(app: tauri::AppHandle, instance_id: String) -> Result<(), String> {
    let pid = RUNNING
        .lock()
        .unwrap()
        .get(&instance_id)
        .copied()
        .ok_or("Сборка не запущена")?;
    let app2 = app.clone();
    let id2 = instance_id.clone();
    std::thread::spawn(move || {
        #[cfg(windows)]
        let result = crate::utils::create_hidden_command("taskkill")
            .args(["/PID", &pid.to_string(), "/F", "/T"])
            .output()
            .map(|_| ());
        #[cfg(not(windows))]
        let result = crate::utils::create_hidden_command("kill")
            .args(["-9", &pid.to_string()])
            .output()
            .map(|_| ());

        RUNNING.lock().unwrap().remove(&id2);
        let (status, message) = match result {
            Ok(()) => ("stopped", "Игра остановлена".to_string()),
            Err(error) => ("error", format!("Не удалось остановить игру: {error}")),
        };
        app2.emit(
            "launch-status",
            serde_json::json!({ "instance_id": &id2, "status": status, "message": message }),
        ).ok();
        app2.emit(
            "game-exited",
            serde_json::json!({ "instance_id": &id2, "code": -1, "stopped_by_launcher": true }),
        ).ok();
    });
    Ok(())
}

#[tauri::command]
pub fn kill_instance(app: tauri::AppHandle, instance_id: String) -> Result<(), String> {
    request_stop(app, instance_id)
}

/// Прерывает запуск, который ещё не успел создать реальный процесс
/// (идёт скачивание/подготовка) — kill_instance тут не поможет, PID ещё
/// не существует. Если процесс уже есть, попутно убиваем и его.
#[tauri::command]
pub fn cancel_launch(app: tauri::AppHandle, instance_id: String) -> Result<(), String> {
    CANCELLED.lock().unwrap().insert(instance_id.clone());
    if RUNNING.lock().unwrap().contains_key(&instance_id) {
        let _ = request_stop(app, instance_id);
    }
    Ok(())
}

#[tauri::command]
pub fn get_running_instances() -> Vec<String> {
    RUNNING.lock().unwrap().keys().cloned().collect()
}

#[tauri::command]
pub fn get_game_logs(instance_id: String) -> Vec<String> {
    if let Some(logs) = LOGS.lock().unwrap().get(&instance_id).cloned() {
        if !logs.is_empty() { return logs; }
    }
    let path = instance_game_dir(&instance_id).join("logs").join("latest.log");
    std::fs::read_to_string(path)
        .map(|content| content.lines().map(ToString::to_string).collect())
        .unwrap_or_default()
}
