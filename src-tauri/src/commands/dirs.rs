/// dirs.rs — единая точка для всех директорий лаунчера.
/// Делегирует в version_manager, который является canonical source.
pub use super::version_manager::{
    mc_base_dir as base_dir,
    versions_dir,
    libraries_dir,
    assets_dir,
    assets_meta_dir,
    assets_cache_dir,
    versions_meta_dir,
    versions_cache_dir,
    libraries_meta_dir,
    libraries_cache_dir,
    meta_dir,
    meta_cdn_modrinth_dir,
    meta_cdn_curseforge_dir,
    meta_modrinth_packs_dir,
    meta_modrinth_modpacks_dir,
    meta_feed_dir,
};

/// Java base directory
pub fn java_dir() -> std::path::PathBuf {
    let p = base_dir().join("java");
    std::fs::create_dir_all(&p).ok();
    std::fs::create_dir_all(p.join("meta")).ok();
    std::fs::create_dir_all(p.join("cache")).ok();
    p
}

/// Create ALL directories at once (called on app startup)
pub fn ensure_all_dirs() {
    let _ = base_dir();
    let _ = versions_dir();
    let _ = libraries_dir();
    let _ = assets_dir();
    let _ = java_dir();
    let _ = meta_dir();
    let _ = meta_cdn_modrinth_dir();
    let _ = meta_cdn_curseforge_dir();
    let _ = meta_modrinth_packs_dir();
    let _ = meta_modrinth_modpacks_dir();
    let _ = meta_feed_dir();
    log::info!("✅ All launcher directories created/verified");
}
