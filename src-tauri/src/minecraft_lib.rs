/// minecraft_lib — ядро для реального запуска Minecraft.
/// Связывает instances, loaders (Forge/Fabric/NeoForge/Quilt), OAuth/Xbox профиль,
/// аргументы JVM и игры, а также управляет папками модов и зависимостями.

pub mod oauth;

// Экспортируем публичные типы из oauth для использования в commands/auth.rs
pub use oauth::{McProfile, DeviceCodeResponse, load_auth};
pub use oauth::McProfile as AuthMcProfile;

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

// ─────────────────────────────────────────────────────────────────────────────
// 1. Модели данных
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthProfile {
    pub uuid: String,
    pub username: String,
    pub access_token: String,
    pub refresh_token: String,
    pub xuid: Option<String>,
    pub skin_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstanceConfig {
    pub id: String,
    pub name: String,
    pub mc_version: String,
    pub loader: String,          // vanilla, fabric, forge, neoforge, quilt
    pub loader_version: String,
    pub min_ram: u32,
    pub max_ram: u32,
    pub java_path: String,
    pub custom_jvm_args: String,
    pub mods: Vec<InstanceMod>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstanceMod {
    pub id: String,
    pub name: String,
    pub version: String,
    pub source: String,
    pub enabled: bool,
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Загрузка профилей и инстансов
// ─────────────────────────────────────────────────────────────────────────────

pub fn load_auth_profile() -> Option<AuthProfile> {
    let path = mc_base_dir().join("auth.json");

    if !path.exists() { 
        log::warn!("⚠️ auth.json not found at: {:?}", path);
        return None; 
    }
    
    let data = std::fs::read_to_string(&path).ok()?;
    let json: serde_json::Value = serde_json::from_str(&data).ok()?;

    let username = json["username"].as_str().unwrap_or("Player").to_string();
    let uuid = json["uuid"].as_str().unwrap_or("00000000-0000-0000-0000-000000000000").to_string();
    let access_token = json["access_token"].as_str().unwrap_or("").to_string();
    let refresh_token = json["refresh_token"].as_str().unwrap_or("").to_string();
    let xuid = json["xuid"].as_str().map(String::from);
    let skin_url = json["skin_url"].as_str().map(String::from);

    log::info!("✅ Auth loaded: username={}, uuid={}, token_len={}", username, uuid, access_token.len());

    Some(AuthProfile {
        uuid,
        username,
        access_token,
        refresh_token,
        xuid,
        skin_url,
    })
}

pub fn load_instance_config(instance_id: &str) -> Option<InstanceConfig> {
    let path = mc_base_dir().join("instances").join(instance_id).join("instance.json");
    if !path.exists() { 
        log::warn!("⚠️ Instance config not found at: {:?}", path);
        return None; 
    }
    let data = std::fs::read_to_string(&path).ok()?;
    serde_json::from_str(&data).ok()
}

pub fn mc_base_dir() -> PathBuf {
    crate::commands::version_manager::mc_base_dir()
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Разрешение загрузчиков (Loader Resolver)
// ─────────────────────────────────────────────────────────────────────────────

pub enum LoaderType {
    Vanilla,
    Fabric,
    Forge,
    NeoForge,
    Quilt,
}

impl PartialEq for LoaderType {
    fn eq(&self, other: &Self) -> bool {
        matches!((self, other),
            (LoaderType::Vanilla, LoaderType::Vanilla) |
            (LoaderType::Fabric, LoaderType::Fabric) |
            (LoaderType::Forge, LoaderType::Forge) |
            (LoaderType::NeoForge, LoaderType::NeoForge) |
            (LoaderType::Quilt, LoaderType::Quilt)
        )
    }
}

impl Eq for LoaderType {}

impl LoaderType {
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "fabric" => LoaderType::Fabric,
            "forge" => LoaderType::Forge,
            "neoforge" => LoaderType::NeoForge,
            "quilt" => LoaderType::Quilt,
            _ => LoaderType::Vanilla,
        }
    }

    /// Возвращает основной класс (main class) для данного загрузчика
    pub fn main_class(&self) -> &'static str {
        match self {
            LoaderType::Vanilla => "net.minecraft.client.main.Main",
            LoaderType::Fabric => "net.fabricmc.loader.impl.launch.knot.KnotClient",
            LoaderType::Forge => "net.minecraftforge.userdev.FMLUserdevClientLaunchProvider",
            LoaderType::NeoForge => "net.neoforged.userdev.UserdevLaunchProvider",
            LoaderType::Quilt => "org.quiltmc.loader.impl.launch.knot.KnotClient",
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Построение аргументов запуска (8 обязательных + доп)
// ─────────────────────────────────────────────────────────────────────────────

pub struct LaunchArgs {
    pub java_path: String,
    pub jvm_args: Vec<String>,
    pub classpath: Vec<String>,
    pub main_class: String,
    pub game_args: Vec<String>,
    pub use_jar: bool,  // true для vanilla (использовать -jar), false для loader'ов (использовать -cp)
    pub jar_path: String,  // путь к main jar для -jar
}

/// Строит полный набор аргументов для запуска Minecraft через minecraft_lib
pub fn build_launch_args(
    instance: &InstanceConfig,
    auth: &AuthProfile,
    versions_dir: &Path,
    libraries_dir: &Path,
    assets_dir: &Path,
    instance_dir: &Path,
) -> Result<LaunchArgs, String> {
    let loader = LoaderType::from_str(&instance.loader);
    let mc_minor: u32 = instance.mc_version.split('.').nth(1).unwrap_or("0").parse().unwrap_or(0);

    // 1. JVM аргументы (память, кодировка, пути)
    let natives_path = versions_dir.join(&instance.mc_version).join("natives");
    let mut jvm_args = vec![
        format!("-Xms{}m", instance.min_ram),
        format!("-Xmx{}m", instance.max_ram),
        format!("-Djava.library.path={}", natives_path.to_string_lossy()),
        "-Dfile.encoding=UTF-8".to_string(),
        "-Dminecraft.launcher.brand=PortalLauncher".to_string(),
    ];

    // OpenGL / LWJGL флаги для старых версий
    if mc_minor <= 12 {
        jvm_args.push("-Dorg.lwjgl.opengl.Display.allowSoftwareOpenGL=true".to_string());
        jvm_args.push("-Dorg.lwjgl.util.Debug=false".to_string());
    }

    // Кастомные JVM аргументы из инстанса
    if !instance.custom_jvm_args.is_empty() {
        jvm_args.extend(instance.custom_jvm_args.split_whitespace().map(|s| s.to_string()));
    }

    // 2. Classpath (библиотеки + загрузчик + моды)
    let mut classpath = build_classpath(&instance.mc_version, versions_dir, libraries_dir)?;
    
    // Добавляем jar загрузчика (правильные имена для каждого типа)
    if loader != LoaderType::Vanilla {
        if let Some(loader_jar) = find_loader_jar(&instance, libraries_dir) {
            log::info!("🔧 Using loader: {}", loader_jar.display());
            classpath.push(loader_jar.to_string_lossy().to_string());
        } else {
            log::warn!("⚠️ Loader jar not found for {}", instance.loader);
        }
    }

    // Добавляем моды из папки mods
    let mods_dir = instance_dir.join(".minecraft").join("mods");
    if mods_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&mods_dir) {
            for entry in entries.flatten() {
                if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) { continue; }
                if entry.path().extension().map(|e| e == "jar" || e == "zip" || e == "mod").unwrap_or(false) {
                    classpath.push(entry.path().to_string_lossy().to_string());
                }
            }
        }
    }

    // 3. Главный класс
    let main_class = loader.main_class().to_string();

    // 4. Игровые аргументы (8 обязательных по запросу пользователя)
    let uuid_clean = auth.uuid.replace("-", "");
    let is_offline = auth.access_token.is_empty() || auth.access_token == "0";
    let effective_uuid = if is_offline { offline_uuid(&auth.username) } else { uuid_clean };
    let effective_token = if is_offline { "0".to_string() } else { auth.access_token.clone() };
    // Версии <1.13 не понимают user_type=msa — серверы требуют "mojang".
    let mc_minor: u32 = instance.mc_version.split('.').nth(1).and_then(|m| m.parse().ok()).unwrap_or(20);
    let user_type = if is_offline { "legacy" } else if mc_minor < 13 { "mojang" } else { "msa" };
    
    let asset_index = determine_asset_index(&instance.mc_version, versions_dir, assets_dir)?;
    let resource_path = assets_dir.to_string_lossy().to_string();

    let mut game_args = vec![
        "--username".to_string(), auth.username.clone(),
        "--version".to_string(), instance.mc_version.clone(),
        "--gameDir".to_string(), instance_dir.join(".minecraft").to_string_lossy().to_string(),
        "--assetsDir".to_string(), resource_path,
        "--assetIndex".to_string(), asset_index,
        "--uuid".to_string(), effective_uuid,
        "--accessToken".to_string(), effective_token,
        "--userType".to_string(), user_type.to_string(),
    ];

    // Добавляем XUID для MSA
    if !is_offline {
        if let Some(xuid) = &auth.xuid {
            game_args.push("--xuid".to_string());
            game_args.push(xuid.clone());
        } else {
            game_args.push("--xuid".to_string());
            game_args.push("0".to_string());
        }
        game_args.push("--clientId".to_string());
        game_args.push("PortalLauncher".to_string());
        
        // Добавляем skin URL если есть
        if let Some(skin_url) = &auth.skin_url {
            game_args.push("--skinUrl".to_string());
            game_args.push(skin_url.clone());
        }
    }

    log::info!("🔑 Using auth: username={}, uuid={}, token_len={}, is_offline={}", 
        auth.username, auth.uuid, auth.access_token.len(), is_offline);

    // Определяем, использовать -jar (vanilla) или -cp (loader'ы)
    let use_jar = loader == LoaderType::Vanilla;
    let jar_path = if use_jar {
        versions_dir.join(&instance.mc_version).join(format!("{}.jar", &instance.mc_version))
            .to_string_lossy().to_string()
    } else {
        String::new()
    };

    // Определяем Java path — ИСПОЛЬЗУЕМ из инстанса, а не хардкод!
    let effective_java_path = if !instance.java_path.is_empty() && std::path::Path::new(&instance.java_path).exists() {
        instance.java_path.clone()
    } else {
        "java".to_string()
    };

    Ok(LaunchArgs {
        java_path: effective_java_path,
        jvm_args,
        classpath,
        main_class,
        game_args,
        use_jar,
        jar_path,
    })
}
    
/// Рекурсивно ищет файлы в директории
fn find_files_recursive(dir: &Path, pattern: &str) -> Vec<PathBuf> {
    let mut results = Vec::new();
    
    if !dir.exists() {
        return results;
    }
    
    // Ищем в текущей директории
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_lowercase();
            let path = entry.path();
            
            if name.contains(pattern) && path.extension().map(|e| e == "jar").unwrap_or(false) {
                results.push(path.clone());
            }
            
            // Рекурсивно ищем в поддиректориях
            if path.is_dir() {
                results.extend(find_files_recursive(&path, pattern));
            }
        }
    }
    
    results
}

/// Находит jar файл загрузчика для инстанса
fn find_loader_jar(
    instance: &InstanceConfig,
    libraries_dir: &Path,
) -> Option<PathBuf> {
    let loader = LoaderType::from_str(&instance.loader);
    
    // Ищем loader jar рекурсивно
    let pattern = match loader {
        LoaderType::Fabric => "fabric-loader",
        LoaderType::Forge => "forge",
        LoaderType::NeoForge => "neoforge",
        LoaderType::Quilt => "quilt-loader",
        LoaderType::Vanilla => return None,
    };
    
    let matches = find_files_recursive(libraries_dir, pattern);
    
    if !matches.is_empty() {
        // Возвращаем первый найденный jar (обычно это правильный)
        Some(matches[0].clone())
    } else {
        None
    }
}
    
fn build_classpath(version: &str, versions_dir: &Path, libraries_dir: &Path) -> Result<Vec<String>, String> {
    let mut cp = Vec::new();
    
    // Добавляем main Minecraft jar
    let version_jar = versions_dir.join(version).join(format!("{}.jar", version));
    if version_jar.exists() {
        cp.push(version_jar.to_string_lossy().to_string());
    } else {
        return Err(format!("Minecraft jar not found: {:?}", version_jar));
    }
    
    // Парсим version.json для сбора библиотек
    let version_json = versions_dir.join(version).join(format!("{}.json", version));
    if version_json.exists() {
        if let Ok(data) = std::fs::read_to_string(&version_json) {
            if let Ok(vj) = serde_json::from_str::<serde_json::Value>(&data) {
                if let Some(libraries) = vj["libraries"].as_array() {
                    for lib in libraries {
                        // Проверяем правила (rules) для определения, нужно ли добавлять библиотеку
                        if let Some(rules) = lib["rules"].as_array() {
                            let mut include = true;
                            let mut has_os_rule = false;
                            
                            for rule in rules {
                                let action = rule["action"].as_str().unwrap_or("allow");
                                
                                if let Some(os) = rule["os"].as_object() {
                                    has_os_rule = true;
                                    let os_name = os.get("name").and_then(|n| n.as_str()).unwrap_or("");
                                    
                                    #[cfg(target_os = "windows")]
                                    let is_current_os = os_name == "windows";
                                    #[cfg(target_os = "macos")]
                                    let is_current_os = os_name == "osx";
                                    #[cfg(target_os = "linux")]
                                    let is_current_os = os_name == "linux";
                                    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
                                    let is_current_os = false;
                                    
                                    if is_current_os {
                                        include = action == "allow";
                                    } else if !os_name.is_empty() {
                                        // Правило для другой ОС - игнорируем
                                    }
                                }
                            }
                            
                            // Если нет правил для текущей ОС, включаем библиотеку по умолчанию
                            if !has_os_rule {
                                include = true;
                            }
                            
                            if !include {
                                continue;
                            }
                        }
                        
                        // Получаем path из downloads.artifact
                        if let Some(downloads) = lib["downloads"].as_object() {
                            if let Some(artifact) = downloads.get("artifact").and_then(|a| a.as_object()) {
                                if let Some(path) = artifact.get("path").and_then(|p| p.as_str()) {
                                    let lib_path = libraries_dir.join(path);
                                    if lib_path.exists() {
                                        cp.push(lib_path.to_string_lossy().to_string());
                                    }
                                    continue;
                                }
                            }
                            
                            // Проверяем classifiers (для natives)
                            if let Some(classifiers) = downloads.get("classifiers").and_then(|c| c.as_object()) {
                                #[cfg(target_os = "windows")]
                                let classifier_name = "natives-windows";
                                #[cfg(target_os = "macos")]
                                let classifier_name = "natives-macos";
                                #[cfg(target_os = "linux")]
                                let classifier_name = "natives-linux";
                                #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
                                let classifier_name = "";
                                
                                if let Some(nat) = classifiers.get(classifier_name).and_then(|n| n.as_object()) {
                                    if let Some(path) = nat.get("path").and_then(|p| p.as_str()) {
                                        let lib_path = libraries_dir.join(path);
                                        if lib_path.exists() {
                                            cp.push(lib_path.to_string_lossy().to_string());
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    
    log::info!("📦 Classpath: {} entries (version jar: {}, libs: {})", 
        cp.len(), version_jar.exists(), cp.len().saturating_sub(1));
    
    Ok(cp)
}

fn determine_asset_index(version: &str, versions_dir: &Path, _assets_dir: &Path) -> Result<String, String> {
    // БЕРЁМ asset index ID из version.json
    let version_json = versions_dir.join(version).join(format!("{}.json", version));
    if version_json.exists() {
        if let Ok(data) = std::fs::read_to_string(&version_json) {
            if let Ok(vj) = serde_json::from_str::<serde_json::Value>(&data) {
                // Minecraft 1.6+ использует assetIndex
                if let Some(asset_index) = vj["assetIndex"].as_object() {
                    if let Some(id) = asset_index.get("id").and_then(|i| i.as_str()) {
                        log::info!("✅ Asset index from version.json: {}", id);
                        return Ok(id.to_string());
                    }
                }
                // Старые версии используют просто "assets"
                if let Some(old_assets) = vj["assets"].as_str() {
                    log::info!("✅ Old asset index from version.json: {}", old_assets);
                    return Ok(old_assets.to_string());
                }
            }
        }
    }
    
    // Fallback - используем ID версии
    log::warn!("⚠️ Asset index not found in version.json, using version ID as fallback");
    Ok(version.to_string())
}

fn offline_uuid(username: &str) -> String {
    use sha1::{Sha1, Digest};
    let input = format!("OfflinePlayer:{}", username);
    let full = Sha1::digest(input.as_bytes());
    let mut b = [0u8; 16];
    b.copy_from_slice(&full[..16]);
    b[6] = (b[6] & 0x0f) | 0x50;
    b[8] = (b[8] & 0x3f) | 0x80;
    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        b[0],b[1],b[2],b[3], b[4],b[5], b[6],b[7], b[8],b[9],
        b[10],b[11],b[12],b[13],b[14],b[15]
    )
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Управление зависимостями и модами
// ─────────────────────────────────────────────────────────────────────────────

pub fn scan_mods(instance_dir: &Path) -> Vec<InstanceMod> {
    let mods_dir = instance_dir.join(".minecraft").join("mods");
    let mut mods = Vec::new();
    if !mods_dir.exists() { return mods; }

    if let Ok(entries) = std::fs::read_dir(&mods_dir) {
        for entry in entries.flatten() {
            if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) { continue; }
            let fname = entry.file_name().to_string_lossy().to_string();
            if fname.ends_with(".jar") || fname.ends_with(".zip") {
                mods.push(InstanceMod {
                    id: fname.clone(),
                    name: fname.trim_end_matches(".jar").trim_end_matches(".zip").to_string(),
                    version: "local".to_string(),
                    source: "local".to_string(),
                    enabled: true,
                });
            }
        }
    }
    mods
}

pub fn sync_mods_to_instance(instance: &mut InstanceConfig, instance_dir: &Path) -> Result<(), String> {
    let mods_dir = instance_dir.join(".minecraft").join("mods");
    std::fs::create_dir_all(&mods_dir).map_err(|e| e.to_string())?;
    
    // Сканируем моды и обновляем список
    instance.mods = scan_mods(instance_dir);
    Ok(())
}
