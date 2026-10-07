use serde::{Deserialize, Serialize};
use std::io::Read;
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct BedrockInstallResult {
    pub installed: Vec<String>, // человекочитаемые описания того, что и куда легло
}

/// %LOCALAPPDATA%\Packages\<PackageFamilyName>\LocalState\games\com.mojang
/// `family` — это то, что хранится в instance.modLoaderVersion: полный AUMID
/// вида "Microsoft.MinecraftUWP_8wekyb3d8bbwe!App" — берём часть до "!".
fn com_mojang_dir(family: &str) -> Result<PathBuf, String> {
    #[cfg(target_os = "windows")]
    {
        let pkg_family = family.split('!').next().unwrap_or(family);
        let local =
            std::env::var("LOCALAPPDATA").map_err(|_| "LOCALAPPDATA не найден".to_string())?;
        let dir = PathBuf::from(local)
            .join("Packages")
            .join(pkg_family)
            .join("LocalState")
            .join("games")
            .join("com.mojang");
        // Здесь намеренно НЕ создаём папку. Это устаревший путь, и
        // install_targets добавляет его в цели только если он уже существует.
        // Если бы мы создавали его здесь, проверка «а существует ли он» всегда
        // была бы истинной и старый путь попадал бы в установку всегда.
        Ok(dir)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = family;
        Err("Bedrock content is only supported on Windows.".into())
    }
}

/// Тип пака по modules[].type в его manifest.json — это то, чем сама Mojang
/// определяет, куда пак нужно класть, а не наше собственное предположение.
fn target_subfolder_for_manifest(manifest: &serde_json::Value) -> &'static str {
    let types: Vec<String> = manifest["modules"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|m| m["type"].as_str().map(|s| s.to_lowercase()))
                .collect()
        })
        .unwrap_or_default();
    if types.iter().any(|t| t == "skin_pack") {
        "skin_packs"
    } else if types.iter().any(|t| t == "resources") {
        "resource_packs"
    } else if types
        .iter()
        .any(|t| t == "data" || t == "javascript" || t == "script")
    {
        "behavior_packs"
    } else {
        "behavior_packs"
    } // по умолчанию — аддон/поведение, самый частый случай
}

fn safe_dir_name(name: &str) -> String {
    name.chars()
        .map(|c| if "\\/:*?\"<>|".contains(c) { '_' } else { c })
        .collect::<String>()
        .trim()
        .to_string()
}

/// Настоящий корень данных Bedrock, а не устаревшего UWP-пакета.
///
/// Мы годами писали в %LOCALAPPDATA%\Packages\<family>\LocalState\games\com.mojang
/// и считали это правильным путём. Ошибка была в доказательстве: папка там
/// существовала, но её создавали мы сами при установке, а не игра. Реально
/// Bedrock (не-UWP сборка) читает
/// %APPDATA%\Minecraft Bedrock\Users\<user>\games\com.mojang,
/// причём пакы живут в Users\Shared, а миры и их активации — в папке
/// конкретного пользователя.
fn bedrock_users_root() -> Result<PathBuf, String> {
    let roaming = std::env::var("APPDATA").map_err(|_| "APPDATA не найден".to_string())?;
    Ok(PathBuf::from(roaming)
        .join("Minecraft Bedrock")
        .join("Users"))
}

/// Все com.mojang современной Bedrock: общий для паков и персональные.
/// Возвращает (общий, список персональных).
fn modern_com_mojang_dirs() -> Result<(PathBuf, Vec<PathBuf>), String> {
    let users = bedrock_users_root()?;
    let shared = users.join("Shared").join("games").join("com.mojang");
    let mut personal = vec![];
    if let Ok(entries) = std::fs::read_dir(&users) {
        for entry in entries.flatten() {
            if !entry.path().is_dir() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if name.eq_ignore_ascii_case("shared") {
                continue;
            }
            personal.push(entry.path().join("games").join("com.mojang"));
        }
    }
    Ok((shared, personal))
}

/// Куда класть пак: современный общий путь — основной. Устаревший UWP-путь
/// добавляем, только если он уже существует, чтобы не плодить папки у тем, кто
/// давно перешёл на новую сборку.
fn install_targets(family: &str) -> Result<Vec<PathBuf>, String> {
    let (shared, personal) = modern_com_mojang_dirs()?;
    let mut targets = vec![shared];
    for dir in personal {
        targets.push(dir);
    }
    let legacy = com_mojang_dir(family)?;
    if legacy.exists() {
        targets.push(legacy);
    }
    for dir in &targets {
        std::fs::create_dir_all(dir)
            .map_err(|e| format!("Не удалось создать {}: {e}", dir.display()))?;
    }
    Ok(targets)
}

/// Заглушка-обёртка удалена: и установка, и чтение, и удаление работают через
/// install_targets / all_com_mojang_dirs.

/// Существующие каталоги com.mojang: общий, персональные и устаревший UWP.
/// Без family, потому что для чтения и удаления он не нужен.
fn all_com_mojang_dirs() -> Result<Vec<PathBuf>, String> {
    let (shared, personal) = modern_com_mojang_dirs()?;
    let mut dirs = vec![shared];
    dirs.extend(personal);
    Ok(dirs.into_iter().filter(|d| d.exists()).collect())
}

/// Кладёт запись в ту корзину, к которой относится пак. Отдельная функция
/// нужна, чтобы не держать две изменяемые ссылки на один Vec в структуре
/// данных — компилятор такое не пропускает (E0499).
fn behaviour_or_resource_push(
    is_behaviour: bool,
    behaviour: &mut Vec<WorldPackRef>,
    resources: &mut Vec<WorldPackRef>,
    entry: WorldPackRef,
) {
    if is_behaviour {
        behaviour.push(entry);
    } else {
        resources.push(entry);
    }
}

/// Запись активации пака в мире. Формат — тот же, что Bedrock пишет сама:
/// ```json
/// { "pack_id": "…", "subpack": "…", "version": [1, 1, 24] }
/// ```
#[derive(Serialize, Deserialize, Debug, Clone)]
struct WorldPackRef {
    #[serde(rename = "pack_id")]
    pack_id: String,
    #[serde(rename = "subpack", skip_serializing_if = "Option::is_none", default)]
    subpack: Option<String>,
    #[serde(rename = "version")]
    version: Vec<i64>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct BedrockActivationResult {
    pub packs: usize,
    pub worlds: usize,
    pub updated: Vec<String>,
    pub failed: Vec<String>,
}

/// Все миры во всех корнях Bedrock. Отдельная функция, потому что и включение,
/// и выключение обходят их одинаково.
fn collect_worlds() -> Vec<PathBuf> {
    let mut worlds = vec![];
    for dir in all_com_mojang_dirs().unwrap_or_default() {
        let worlds_dir = dir.join("minecraftWorlds");
        let Ok(entries) = std::fs::read_dir(&worlds_dir) else {
            continue;
        };
        for entry in entries.flatten() {
            // level.dat — признак настоящего мира; папки без него игнорируем.
            if entry.path().join("level.dat").is_file() {
                worlds.push(entry.path());
            }
        }
    }
    worlds
}

/// Выключает пакы во всех мирах: убирает из world_*_packs.json те записи,
/// чей UUID совпадает с установленными паками. Записи, сделанные руками в
/// самой игре, остаются нетронутыми.
///
/// Пустой список не пишем: Minecraft ждёт отсутствие файла для «ничего не
/// включено», а не пустой массив — иначе мир потеряет настройку.
#[tauri::command]
pub async fn disable_all_bedrock_packs() -> Result<BedrockActivationResult, String> {
    let (behaviour, resources) = collect_pack_refs()?;
    let known_ids: std::collections::HashSet<String> = behaviour
        .iter()
        .chain(resources.iter())
        .map(|p| p.pack_id.clone())
        .collect();
    let mut result = BedrockActivationResult {
        packs: known_ids.len(),
        worlds: 0,
        updated: vec![],
        failed: vec![],
    };

    for world in collect_worlds() {
        result.worlds += 1;
        let name = world
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        for file in ["world_behavior_packs.json", "world_resource_packs.json"] {
            let path = world.join(file);
            let Ok(text) = std::fs::read_to_string(&path) else {
                continue;
            };
            let Ok(mut items) = serde_json::from_str::<Vec<WorldPackRef>>(&text) else {
                continue;
            };
            let before = items.len();
            items.retain(|item| !known_ids.contains(&item.pack_id));
            if items.len() == before {
                continue;
            }
            if items.is_empty() {
                match std::fs::remove_file(&path) {
                    Ok(()) => result.updated.push(format!("{name}/{file} (очищен)")),
                    Err(e) => result.failed.push(format!("{name}/{file}: {e}")),
                }
                continue;
            }
            match serde_json::to_string_pretty(&items) {
                Ok(out) => match std::fs::write(&path, out) {
                    Ok(()) => result.updated.push(format!("{name}/{file}")),
                    Err(e) => result.failed.push(format!("{name}/{file}: {e}")),
                },
                Err(e) => result.failed.push(format!("{name}/{file}: {e}")),
            }
        }
    }
    Ok(result)
}

#[tauri::command]
pub async fn activate_all_bedrock_packs() -> Result<BedrockActivationResult, String> {
    activate_packs_on_disk()
}

/// Читает UUID всех установленных паков, разложенных по типу.
///
/// Файл на диске — источник истины: UUID берётся из его manifest.json, а не
/// из того, что ставили мы. Так это работает и с паками, установленными руками.
///
/// Параллельно с этим переименовывает папки, названные не по UUID: такие
/// остаются от старых установок, Minecraft их не видит, и каждый следующий
/// запуск лаунчера добавлял бы ещё одну копию того же пака.
fn collect_pack_refs() -> Result<(Vec<WorldPackRef>, Vec<WorldPackRef>), String> {
    let mut behaviour: Vec<WorldPackRef> = vec![];
    let mut resources: Vec<WorldPackRef> = vec![];
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();

    for dir in all_com_mojang_dirs()? {
        // Раньше здесь был массив пар ("поле", &mut bucket), и в нём
        // skin_packs и resource_packs ссылались на один и тот же Vec — две
        // изменяемые ссылки на `resources` одновременно компилятор не даёт
        // (E0499). Поэтому перебираем только строки и выбираем корзину в теле
        // цикла, а не держа две ссылки в структуре данных.
        for kind in ["behavior_packs", "resource_packs", "skin_packs"] {
            let Ok(entries) = std::fs::read_dir(dir.join(kind)) else {
                continue;
            };
            for entry in entries.flatten() {
                if !entry.path().is_dir() {
                    continue;
                }
                let manifest_path = entry.path().join("manifest.json");
                let Ok(text) = std::fs::read_to_string(&manifest_path) else {
                    continue;
                };
                let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) else {
                    continue;
                };
                let Some(pack_id) = json["header"]["uuid"]
                    .as_str()
                    .map(str::trim)
                    .filter(|v| !v.is_empty())
                    .map(String::from)
                else {
                    continue;
                };
                let version = json["header"]["version"]
                    .as_array()
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|v| v.as_i64())
                            .collect::<Vec<i64>>()
                    })
                    .filter(|v| !v.is_empty())
                    .unwrap_or_else(|| vec![1, 0, 0]);
                // Ключ дедупликации считаем до перемещения pack_id в структуру.
                // skin_packs и resource_packs попадают в один и тот же файл
                // world_resource_packs.json, поэтому дедуплицируем их вместе.
                let is_behaviour = kind == "behavior_packs";
                let guard = format!(
                    "{}{pack_id}",
                    if is_behaviour { "behavior:" } else { "resources:" }
                );
                if !seen.insert(guard) {
                    continue;
                }
                behaviour_or_resource_push(is_behaviour, &mut behaviour, &mut resources, WorldPackRef {
                    pack_id: pack_id.clone(),
                    subpack: None,
                    version,
                });
                // Если папка названа не по UUID, поднимаем её: Minecraft читает
                // только <uuid>\. Старую копию удаляем, чтобы не плодить дубли.
                if let Some(wrong) = entry.file_name().to_str() {
                    if wrong != pack_id {
                        let target = entry.path().with_file_name(&pack_id);
                        if !target.exists() && std::fs::rename(&entry.path(), &target).is_ok() {
                            // После переименования drop_stale_copies в
                            // extract_mcpack больше не найдёт старых копий.
                        } else if target.exists() {
                            std::fs::remove_dir_all(&entry.path()).ok();
                        }
                    }
                }
            }
        }
    }

    Ok((behaviour, resources))
}

/// Та же логика без обёртки команды: используется при запуске игры, чтобы
/// «включить всё сразу» происходило по клику «Запустить».
pub fn activate_packs_on_disk() -> Result<BedrockActivationResult, String> {
    // Собираем уникальные UUID по типу пака. Файл на диске — источник истины,
    // поэтому истина читается из его manifest.json, а не из того, что мы
    // ставили: так работает и с паками, установленными вручную.
    let (behaviour, resources) = collect_pack_refs()?;
    let pack_count = behaviour.len() + resources.len();
    let mut result = BedrockActivationResult {
        packs: pack_count,
        worlds: 0,
        updated: vec![],
        failed: vec![],
    };
    if pack_count == 0 {
        return Ok(result);
    }

    for world in collect_worlds() {
        result.worlds += 1;
        let name = world
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        for (file, wanted) in [
            ("world_behavior_packs.json", &behaviour),
            ("world_resource_packs.json", &resources),
        ] {
            if wanted.is_empty() {
                continue;
            }
            let path = world.join(file);
            // Сохраняем то, что уже включено: наш список не должен стирать
            // пак, включённый вручную в самой игре.
            let mut merged = std::fs::read_to_string(&path)
                .ok()
                .and_then(|text| serde_json::from_str::<Vec<WorldPackRef>>(&text).ok())
                .unwrap_or_default();
            let mut added = 0usize;
            for pack in wanted {
                let already = merged
                    .iter()
                    .any(|item| item.pack_id == pack.pack_id && item.subpack == pack.subpack);
                if already {
                    continue;
                }
                merged.push(pack.clone());
                added += 1;
            }
            if added == 0 {
                continue;
            }
            match serde_json::to_string_pretty(&merged) {
                Ok(text) => match std::fs::write(&path, text) {
                    Ok(()) => result.updated.push(format!("{name}/{file} (+{added})")),
                    Err(e) => result.failed.push(format!("{name}/{file}: {e}")),
                },
                Err(e) => result.failed.push(format!("{name}/{file}: {e}")),
            }
        }
    }

    Ok(result)
}

/// Извлекает один .mcpack в нужную подпапку com.mojang.
///
/// Раньше manifest.json искался строго в корне архива, и любой .mcpack с
/// вложенной структурой (а такие встречаются на CurseForge постоянно) отвергался
/// с «не валидный Bedrock-пак». Теперь, как и в extract_mcaddon, допускается
/// Удаляет папки того же пакета, названные не по UUID: такие остаются от
/// старых установок и от дубликатов, и Minecraft показывает каждый отдельно.
/// Сопоставляем по header.uuid внутри manifest.json, а не по имени папки.
fn drop_stale_copies(parent: &std::path::Path, uuid: &str) {
    let Ok(entries) = std::fs::read_dir(parent) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        if entry.file_name().to_string_lossy() == uuid {
            continue;
        }
        let manifest_path = path.join("manifest.json");
        let Ok(text) = std::fs::read_to_string(&manifest_path) else {
            continue;
        };
        let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) else {
            continue;
        };
        let same = json["header"]["uuid"]
            .as_str()
            .map(|value| value.trim() == uuid)
            .unwrap_or(false);
        if same {
            std::fs::remove_dir_all(&path).ok();
        }
    }
}

/// .mcpack — zip, в корне которого лежит manifest.json пакета. Встречается
/// и вариант с одной вложенной папкой: если в корне манифеста нет, ищем
/// `<папка>/manifest.json` и вытаскиваем содержимое этой папки.
fn extract_mcpack(
    bytes: &[u8],
    com_mojang: &PathBuf,
    fallback_name: &str,
) -> Result<String, String> {
    let reader = std::io::Cursor::new(bytes);
    let mut archive =
        zip::ZipArchive::new(reader).map_err(|e| format!("Не читается .mcpack: {e}"))?;

    // Ищем манифест: сначала в корне, иначе — в первой же вложенной папке.
//
// Пробуем корень ОТДЕЛЬНЫМ match и сразу выходим из него. Раньше поиск вложенного
// манифеста был прямо в ветке Err того же match, и временный Result<ZipFile>
// от archive.by_name удерживал изменяемую ссылку до конца match — вложенный
// by_index давал E0499. Теперь к моменту второго поиска заимствование уже
// завершено.
let root_manifest: Option<serde_json::Value> = match archive.by_name("manifest.json") {
        Ok(mut f) => {
            let mut s = String::new();
            f.read_to_string(&mut s).map_err(|e| e.to_string())?;
            Some(serde_json::from_str(&s).map_err(|e| format!("manifest.json битый: {e}"))?)
        }
        Err(_) => None,
    };

    let mut root_prefix = String::new();
    let manifest: serde_json::Value = match root_manifest {
        Some(value) => value,
        None => {
            let prefix = (0..archive.len())
                .find_map(|i| {
                    let entry = archive.by_index(i).ok()?;
                    let name = entry.name().to_string();
                    if entry.is_dir() || !name.ends_with("manifest.json") {
                        return None;
                    }
                    match name.rfind('/') {
                        Some(pos) if pos > 0 => Some(name[..=pos].to_string()),
                        _ => None,
                    }
                })
                .ok_or("В .mcpack нет manifest.json — это не валидный Bedrock-пак".to_string())?;
            let mut f = archive
                .by_name(&format!("{prefix}manifest.json"))
                .map_err(|e| format!("Не читается manifest.json: {e}"))?;
            let mut s = String::new();
            f.read_to_string(&mut s).map_err(|e| e.to_string())?;
            root_prefix = prefix;
            serde_json::from_str(&s).map_err(|e| format!("manifest.json битый: {e}"))?
        }
    };

    let subfolder = target_subfolder_for_manifest(&manifest);
    let pack_name = manifest["header"]["name"].as_str().unwrap_or(fallback_name);
    // Minecraft Bedrock ждёт папку, названную по UUID пакета из
    // header.uuid, и никак иначе. Раньше мы называли её по header.name —
    // то есть «TACZ Behavior v1.0.3 …». Такие папки игра просто не видит,
    // хотя файлы на диске лежат и установка отчитывается успехом.
    let pack_uuid = manifest["header"]["uuid"].as_str().unwrap_or("").trim().to_string();
    let dir_name = if pack_uuid.is_empty() {
        // UUID обязателен, но если его нет — лучше хоть что-то, чем отказ.
        safe_dir_name(pack_name)
    } else {
        pack_uuid.clone()
    };
    let sub_dir = com_mojang.join(&subfolder);
    if !pack_uuid.is_empty() {
        drop_stale_copies(&sub_dir, &pack_uuid);
    }
    let out_dir = sub_dir.join(&dir_name);
    std::fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        if entry.is_dir() {
            continue;
        }
        // При вложенной структуре в out_dir тащим только содержимое этой папки.
        let relative = if root_prefix.is_empty() {
            entry.name().to_string()
        } else if let Some(stripped) = entry.name().strip_prefix(&root_prefix) {
            stripped.to_string()
        } else {
            continue;
        };
        if relative.is_empty() {
            continue;
        }
        let out_path = out_dir.join(&relative);
        if let Some(p) = out_path.parent() {
            std::fs::create_dir_all(p).ok();
        }
        let mut outf = std::fs::File::create(&out_path).map_err(|e| e.to_string())?;
        std::io::copy(&mut entry, &mut outf).map_err(|e| e.to_string())?;
    }

    Ok(format!("{pack_name} → {subfolder}/{dir_name}"))
}

/// .mcaddon — zip, где на верхнем уровне лежат ОДНА ИЛИ НЕСКОЛЬКО папок,
/// каждая — по сути отдельный .mcpack (behavior+resource обычно вместе).
fn extract_mcaddon(
    bytes: &[u8],
    com_mojang: &PathBuf,
    fallback_name: &str,
) -> Result<Vec<String>, String> {
    let reader = std::io::Cursor::new(bytes);
    let mut outer =
        zip::ZipArchive::new(reader).map_err(|e| format!("Не читается .mcaddon: {e}"))?;

    // Собираем список подпапок верхнего уровня, содержащих manifest.json
    let mut top_dirs: Vec<String> = vec![];
    for i in 0..outer.len() {
        let name = outer
            .by_index(i)
            .map_err(|e| e.to_string())?
            .name()
            .to_string();
        if let Some(idx) = name.find('/') {
            let top = &name[..idx];
            if name.ends_with("manifest.json")
                && name.matches('/').count() == 1
                && !top_dirs.contains(&top.to_string())
            {
                top_dirs.push(top.to_string());
            }
        }
    }

    if top_dirs.is_empty() {
        // Нет вложенных папок — возможно, это на самом деле одиночный .mcpack
        // с расширением .mcaddon. Пробуем как один пак.
        return extract_mcpack(bytes, com_mojang, fallback_name).map(|s| vec![s]);
    }

    let mut results = vec![];
    for top in &top_dirs {
        let manifest: serde_json::Value = {
            let mut f = outer
                .by_name(&format!("{top}/manifest.json"))
                .map_err(|e| e.to_string())?;
            let mut s = String::new();
            f.read_to_string(&mut s).map_err(|e| e.to_string())?;
            serde_json::from_str(&s).map_err(|e| format!("manifest.json в {top} битый: {e}"))?
        };
        let subfolder = target_subfolder_for_manifest(&manifest);
        let pack_name = manifest["header"]["name"].as_str().unwrap_or(top);
        let dir_name = safe_dir_name(pack_name);
        let out_dir = com_mojang.join(subfolder).join(&dir_name);
        std::fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;

        let prefix = format!("{top}/");
        let entry_names: Vec<String> = (0..outer.len())
            .filter_map(|i| outer.by_index(i).ok().map(|e| e.name().to_string()))
            .filter(|n| n.starts_with(&prefix) && !n.ends_with('/'))
            .collect();
        for name in entry_names {
            let mut entry = outer.by_name(&name).map_err(|e| e.to_string())?;
            let rel = &name[prefix.len()..];
            let out_path = out_dir.join(rel);
            if let Some(p) = out_path.parent() {
                std::fs::create_dir_all(p).ok();
            }
            let mut outf = std::fs::File::create(&out_path).map_err(|e| e.to_string())?;
            std::io::copy(&mut entry, &mut outf).map_err(|e| e.to_string())?;
        }
        results.push(format!("{pack_name} → {subfolder}/{dir_name}"));
    }
    Ok(results)
}

/// .mcworld — zip с level.dat и т.п. в корне, целиком копируется в minecraftWorlds/<name>/.
fn extract_mcworld(
    bytes: &[u8],
    com_mojang: &PathBuf,
    fallback_name: &str,
) -> Result<String, String> {
    let reader = std::io::Cursor::new(bytes);
    let mut archive =
        zip::ZipArchive::new(reader).map_err(|e| format!("Не читается .mcworld: {e}"))?;
    let dir_name = safe_dir_name(fallback_name);
    let out_dir = com_mojang.join("minecraftWorlds").join(&dir_name);
    std::fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        if entry.is_dir() {
            continue;
        }
        let out_path = out_dir.join(entry.name());
        if let Some(p) = out_path.parent() {
            std::fs::create_dir_all(p).ok();
        }
        let mut outf = std::fs::File::create(&out_path).map_err(|e| e.to_string())?;
        std::io::copy(&mut entry, &mut outf).map_err(|e| e.to_string())?;
    }
    Ok(format!("{fallback_name} → minecraftWorlds/{dir_name}"))
}

/// Скачивает контент с CurseForge и ставит его в правильную папку com.mojang
/// для указанного (по AUMID) установленного издания Bedrock.
#[tauri::command]
pub async fn install_bedrock_content(
    family: String,
    download_url: String,
    file_name: String,
) -> Result<BedrockInstallResult, String> {
    let targets = install_targets(&family)?;
    // Раньше файл качался ровно по одному адресу, и если основной хост CDN
    // отдавал 403 или 404, установка падала. У CurseForge три зеркала одного
    // хранилища, поэтому перебираем их по очереди — как уже сделано для
    // Java-файлов в curseforge.rs.
    let hosts = [
        "edge.curseforgecdn.com",
        "edge.forgecdn.net",
        "mediafilez.forgecdn.net",
    ];
    let mut urls: Vec<String> = Vec::new();
    for host in hosts {
        let swapped = download_url
            .replacen("edge.curseforgecdn.com", host, 1)
            .replacen("edge.forgecdn.net", host, 1)
            .replacen("mediafilez.forgecdn.net", host, 1);
        urls.push(swapped);
    }
    if !urls.iter().any(|u| u == &download_url) {
        urls.insert(0, download_url.clone());
    }

    let mut bytes: Option<Vec<u8>> = None;
    let mut last_err = String::new();
    for url in urls {
        match reqwest::get(&url).await {
            Ok(resp) if resp.status().is_success() => match resp.bytes().await {
                Ok(b) => {
                    bytes = Some(b.to_vec());
                    break;
                }
                Err(e) => last_err = format!("чтение ответа: {e}"),
            },
            Ok(resp) => last_err = format!("HTTP {}", resp.status()),
            Err(e) => last_err = format!("{e}"),
        }
    }
    let bytes = match bytes {
        Some(b) => b,
        None => {
            return Err(format!(
                "Не удалось скачать файл ни с одного зеркала CurseForge: {last_err}"
            ))
        }
    };

    let lower = file_name.to_lowercase();
    let base_name = file_name
        .trim_end_matches(".mcpack")
        .trim_end_matches(".mcaddon")
        .trim_end_matches(".mcworld")
        .trim_end_matches(".zip")
        .to_string();

// Раскладываем по всем целям: общий каталог Bedrock, персональные каталоги
    // и, если он ещё есть, устаревший UWP-путь. Раньше писали ровно в одну
    // папку, и именно поэтому игра ничего не видела.
    let mut installed: Vec<String> = vec![];
    for com_mojang in &targets {
        let placed = if lower.ends_with(".mcworld") {
            vec![extract_mcworld(&bytes, com_mojang, &base_name)?]
        } else if lower.ends_with(".mcaddon") {
            extract_mcaddon(&bytes, com_mojang, &base_name)?
        } else if lower.ends_with(".mcpack") || lower.ends_with(".zip") {
            vec![extract_mcpack(&bytes, com_mojang, &base_name)?]
        } else {
            return Err(format!(
                "Неизвестный формат файла Bedrock-контента: {file_name}"
            ));
        };
        installed.extend(placed);
    }

    Ok(BedrockInstallResult { installed })
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct BedrockContentEntry {
    pub name: String,
    /// Имя папки на диске (= header.uuid). Удалять надо по нему, а не по
    /// отображаемому имени, поэтому держим отдельно.
    pub dir: String,
    pub kind: String, // "behavior_packs" | "resource_packs" | "skin_packs"
}

/// Список уже установленного Bedrock-контента (сканирует папки на диске —
/// это не наша выдумка, а то же самое место, куда сама игра кладёт паки).
#[tauri::command]
pub async fn list_bedrock_content() -> Result<Vec<BedrockContentEntry>, String> {
    // family больше не нужен: пак ищут по всем корням Bedrock, иначе список
    // показывал бы пустоту при новом расположении данных.
    let mut out = vec![];
    let mut seen = std::collections::HashSet::new();
    for com_mojang in all_com_mojang_dirs()? {
        for kind in ["behavior_packs", "resource_packs", "skin_packs"] {
            let dir = com_mojang.join(kind);
            let Ok(entries) = std::fs::read_dir(&dir) else {
                continue;
            };
            for e in entries.flatten() {
                if !e.path().is_dir() {
                    continue;
                }
                let Some(dir_name) = e.file_name().to_str().map(|s| s.to_string()) else {
                    continue;
                };
                if !seen.insert(format!("{kind}/{dir_name}")) {
                    continue;
                }
                // Показываем человекочитаемое имя из manifest.json: после
                // перехода на UUID-папки имя папки больше ничего не значит
                // для человека. Если манифеста нет — отдаём имя папки как есть.
                let manifest_path = e.path().join("manifest.json");
                let name = std::fs::read_to_string(&manifest_path)
                    .ok()
                    .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
                    .and_then(|json| {
                        json["header"]["name"].as_str().map(|s| s.trim().to_string())
                    })
                    .filter(|value| !value.is_empty())
                    .unwrap_or_else(|| dir_name.clone());
                out.push(BedrockContentEntry {
                    name,
                    dir: dir_name,
                    kind: kind.to_string(),
                });
            }
        }
    }
    Ok(out)
}

#[tauri::command]
pub async fn remove_bedrock_content(
    kind: String,
    name: String,
) -> Result<(), String> {
    // Удаляем по имени папки во всех известных корнях Bedrock: раньше команда
    // принимала family и трогала только устаревший UWP-путь, поэтому удаление
    // из нового расположения было невозможно.
    let mut removed = 0usize;
    let mut last_err = String::new();
    for dir in all_com_mojang_dirs().unwrap_or_default() {
        let target = dir.join(&kind).join(&name);
        if target.is_dir() {
            match std::fs::remove_dir_all(&target) {
                Ok(()) => removed += 1,
                Err(e) => last_err = format!("{}: {e}", target.display()),
            }
        }
    }
    if removed > 0 {
        Ok(())
    } else if last_err.is_empty() {
        Err(format!("Папка {kind}/{name} не найдена ни в одном каталоге Bedrock"))
    } else {
        Err(format!("Не удалось удалить: {last_err}"))
    }
}


