/**
 * Type-safe Tauri command bridge.
 * Falls back to mock data when running in browser (not inside Tauri).
 */

const isTauri = () =>
  typeof window !== 'undefined' &&
  ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauri()) {
    const { invoke: tauriInvoke } = await import('@/lib/invoke-shim');
    return tauriInvoke<T>(cmd, args);
  }
  console.warn(`[tauri-bridge] browser mock: ${cmd}`, args);
  return mockResponse(cmd, args) as T;
}

function mockResponse(cmd: string, _args?: Record<string, unknown>): unknown {
  switch (cmd) {
    case 'start_device_code_flow':
      return { device_code:'MOCK_DEVICE_CODE', user_code:'PORTAL-MOCK', verification_uri:'https://microsoft.com/link', expires_in:900, interval:5 };
    case 'poll_for_token': return null;
    case 'get_java_info': return [{ path:'javaw.exe', version:'21.0.2', arch:'x64', vendor:'Microsoft' }];
    case 'launch_instance': return { pid: 99999 };
    case 'get_installed_versions': return [];
    case 'get_available_versions': return [
      { id:'1.21.1', version_type:'release', release_time:'2024-08-08', url:'', sha1:'', installed:false },
      { id:'1.20.1', version_type:'release', release_time:'2023-06-12', url:'', sha1:'', installed:false },
    ];
    case 'get_instances': return [];
    case 'create_instance': return { id:'mock-id', name:'Mock Instance', description:'', mc_version:'1.20.1', loader:'vanilla', loader_version:'', min_ram:1024, max_ram:4096, java_path:'', custom_jvm_args:'', play_time_minutes:0, last_played:null, created_at:new Date().toISOString(), icon:null, mods:[] };
    case 'search_modrinth': return { hits:[], total_hits:0, offset:0, limit:20 };
    case 'search_curseforge': return { data:[], pagination:{ total_count:0 } };
    case 'search_mods': return { hits:[], total_hits:0 };
    case 'get_friends': return [];
    case 'get_messages': return [];
    case 'send_message': return { id:`msg-${Date.now()}`, timestamp:new Date().toISOString() };
    case 'list_audio_devices': return { inputs:['Default Microphone'], outputs:['Default Speaker'] };
    case 'get_current_skin': return null;
    case 'get_all': return {};
    case 'get_stored_refresh_token': return null;
    case 'poll_signaling': return null;
    case 'poll_ice_candidates': return [];
    case 'start_voice_message_upload': return { url:'', duration_ms:0 };
    default: return null;
  }
}

// ── Auth ──────────────────────────────────────────────────────────────────────
export interface DeviceCodeResponse {
  device_code: string; user_code: string; verification_uri: string;
  expires_in: number; interval: number;
}
export interface McProfile {
  uuid: string; username: string; skin_url?: string;
  access_token: string; refresh_token: string; expires_in: number;
}
export const tauriAuth = {
  startDeviceCodeFlow: () => invoke<DeviceCodeResponse>('start_device_code_flow'),
  pollForToken: (deviceCode: string) => invoke<McProfile | null>('poll_for_token', { device_code: deviceCode }),
  refreshToken: (refreshToken: string) => invoke<McProfile>('refresh_token', { refresh_token: refreshToken }),
};

// ── Token Store ───────────────────────────────────────────────────────────────
export const tauriTokens = {
  store: (uuid: string, accessToken: string, refreshToken: string, expiresAt: number) =>
    invoke<void>('store_tokens', { uuid, access_token: accessToken, refresh_token: refreshToken, expires_at: expiresAt }),
  getRefresh: (uuid: string) => invoke<string | null>('get_stored_refresh_token', { uuid }),
  delete: (uuid: string) => invoke<void>('delete_stored_tokens', { uuid }),
};

// ── Skins ─────────────────────────────────────────────────────────────────────
export interface SkinInfo { url: string; variant: string; texture_id: string }
export const tauriSkins = {
  getCurrent: (accessToken: string) => invoke<SkinInfo | null>('get_current_skin', { access_token: accessToken }),
  upload: (accessToken: string, path: string, variant: 'classic' | 'slim') =>
    invoke<void>('upload_skin', { access_token: accessToken, path, variant }),
  uploadBytes: (accessToken: string, data: number[], variant: 'classic' | 'slim') =>
    invoke<void>('upload_skin_bytes', { access_token: accessToken, data, variant }),
};

// ── Minecraft ─────────────────────────────────────────────────────────────────
export interface LaunchResult { pid: number }
export const tauriMinecraft = {
  launch: (instanceId: string, accessToken: string, uuid: string, username: string, serverAddress?: string) =>
    invoke<LaunchResult>('launch_instance', { instance_id: instanceId, access_token: accessToken, uuid, username, server_address: serverAddress }),
  kill: (pid: number) => invoke<void>('kill_instance', { pid }),
};

// ── Versions ──────────────────────────────────────────────────────────────────
export interface McVersion { id: string; version_type: string; release_time: string; url: string; sha1: string; installed: boolean }
export const tauriVersions = {
  getInstalled: () => invoke<McVersion[]>('get_installed_versions'),
  getAvailable: (includeSnapshots?: boolean) => invoke<McVersion[]>('get_available_versions', { include_snapshots: includeSnapshots }),
  download: (versionId: string) => invoke<void>('download_minecraft_version', { version_id: versionId }),
};

// ── Loaders ───────────────────────────────────────────────────────────────────
export interface LoaderInstallResult { success: boolean; loader: string; version: string; message: string }
export const tauriLoaders = {
  installFabric: (mcVersion: string, loaderVersion: string, instanceDir: string) =>
    invoke<LoaderInstallResult>('install_fabric', { mc_version: mcVersion, loader_version: loaderVersion, instance_dir: instanceDir }),
  installForge: (mcVersion: string, forgeVersion: string, instanceDir: string) =>
    invoke<LoaderInstallResult>('install_forge', { mc_version: mcVersion, forge_version: forgeVersion, instance_dir: instanceDir }),
  installQuilt: (mcVersion: string, loaderVersion: string, instanceDir: string) =>
    invoke<LoaderInstallResult>('install_quilt', { mc_version: mcVersion, loader_version: loaderVersion, instance_dir: instanceDir }),
};

// ── Instances ─────────────────────────────────────────────────────────────────
export interface InstanceMod { id: string; name: string; version: string; source: string; enabled: boolean }
export interface Instance {
  id: string; name: string; description: string; mc_version: string; loader: string;
  loader_version: string; min_ram: number; max_ram: number; java_path: string;
  custom_jvm_args: string; play_time_minutes: number; last_played: string | null;
  created_at: string; icon: string | null; mods: InstanceMod[];
}
export const tauriInstances = {
  getAll: () => invoke<Instance[]>('get_instances'),
  create: (p: { name: string; description: string; mcVersion: string; loader: string; loaderVersion: string; minRam: number; maxRam: number }) =>
    invoke<Instance>('create_instance', { name: p.name, description: p.description, mcVersion: p.mcVersion, loader: p.loader, loaderVersion: p.loaderVersion, minRam: p.minRam, maxRam: p.maxRam }),
  update: (id: string, updates: Partial<Instance>) => invoke<Instance>('update_instance', { id, updates }),
  delete: (id: string) => invoke<void>('delete_instance', { id }),
  duplicate: (id: string, newName: string) => invoke<Instance>('duplicate_instance', { id, new_name: newName }),
  openFolder: (id: string) => invoke<void>('open_instance_folder', { id }),
};

// ── Mods ──────────────────────────────────────────────────────────────────────
export interface ModrinthMod {
  project_id: string; title: string; description: string; author: string; downloads: number;
  follows: number; icon_url?: string; categories: string[]; versions: string[];
  game_versions: string[]; loaders: string[]; date_modified: string; color?: number; slug: string;
}
export interface ModrinthSearchResult { hits: ModrinthMod[]; total_hits: number; offset: number; limit: number }
export interface CurseforgeMod {
  id: number; name: string; summary: string; authors: { name: string }[]; download_count: number;
  thumbs_up_count: number; logo?: { thumbnail_url: string }; categories: { name: string }[];
  latest_files_indexes: { game_version: string; mod_loader_type: number }[]; date_modified: string; slug: string;
}
export interface CurseforgeSearchResult { data: CurseforgeMod[]; pagination: { total_count: number } }
export interface InstalledMod { id: string; name: string; version: string; version_id?: string; source: string; enabled: boolean; file_name: string; file_size: number; mod_type?: string; author?: string | null; icon_url?: string | null; update_available?: boolean; latest_version?: string | null; latest_download_url?: string | null }

export const tauriMods = {
  searchModrinth: (p: { query: string; limit?: number; offset?: number; categories?: string[]; versions?: string[]; loaders?: string[]; sort?: string }) =>
    invoke<ModrinthSearchResult>('search_modrinth', p),
  searchCurseforge: (p: { query: string; limit?: number; offset?: number; category_id?: number; game_version?: string; mod_loader_type?: number; api_key: string }) =>
    invoke<CurseforgeSearchResult>('search_curseforge', p),
  install: (p: { instance_id: string; download_url: string; file_name: string; mod_id: string; mod_name: string; mod_version: string; version_id?: string; source: string; mod_type?: string; project_id?: string; author?: string | null; icon_url?: string | null }) =>
    invoke<InstalledMod[]>('install_mod', p),
  getForInstance: (instanceId: string) => invoke<InstalledMod[]>('get_instance_mods', { instance_id: instanceId }),
  toggle: (instanceId: string, fileName: string, enabled: boolean) =>
    invoke<void>('toggle_mod', { instance_id: instanceId, file_name: fileName, enabled }),
  remove: (instanceId: string, fileName: string) =>
    invoke<void>('remove_mod', { instance_id: instanceId, file_name: fileName }),
};

// ── Java ──────────────────────────────────────────────────────────────────────
export interface JavaInfo { path: string; version: string; arch: string; vendor: string }
export const tauriJava = {
  detect: () => invoke<JavaInfo[]>('get_java_info'),
};

// ── Audio ─────────────────────────────────────────────────────────────────────
export interface AudioDevices { inputs: string[]; outputs: string[] }
export const tauriAudio = {
  listDevices: () => invoke<AudioDevices>('list_audio_devices'),
};

// ── Files ─────────────────────────────────────────────────────────────────────
export const tauriFiles = {
  openFolder: (path: string) => invoke<void>('open_folder', { path }),
  readBytes: (path: string) => invoke<number[]>('read_file_bytes', { path }),
  writeBytes: (path: string, data: number[]) => invoke<void>('write_file_bytes', { path, data }),
};

// ── Settings ──────────────────────────────────────────────────────────────────
export const tauriSettings = {
  getAll: () => invoke<Record<string, unknown>>('get_all'),
  set: (key: string, value: unknown) => invoke<void>('set_setting', { key, value }),
  saveAll: (settings: Record<string, unknown>) => invoke<void>('save_all_settings', { settings }),
};

  // ── Auth Persistence (used by Minecraft launch) ──────────────────────────────
  export const tauriAuthPersist = {
    saveAuthInfo: (username: string, uuid: string, accessToken: string, refreshToken: string, expiresAt: number) =>
      invoke<void>('save_auth_info', { username, uuid, accessToken, refreshToken, expiresAt }),
    getAuthInfo: () => invoke<{ username: string; uuid: string; access_token: string; refresh_token: string; expires_at: number } | null>('get_auth_info_cmd'),
  };
