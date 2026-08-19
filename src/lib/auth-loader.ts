import { invoke } from '@/lib/invoke-shim';
import { useAuthStore, type UserProfile } from '@/stores/authStore';

/**
 * Load auth from Rust (auth.json) and populate zustand store.
 * Called once on app startup.
 */
export async function loadAuthFromRust(): Promise<boolean> {
  try {
    console.log('🔄 Loading auth from Rust...');
    
    // Try auto_refresh_if_needed (refreshes token if needed)
    const profile = await invoke<any | null>('auto_refresh_if_needed');
    
    if (profile && profile.uuid && profile.username) {
      console.log('✅ Auth loaded from Rust:', profile.username);
      
      useAuthStore.getState().addAccount({
        uuid: profile.uuid,
        username: profile.username,
        skinUrl: profile.skin_url ?? undefined,
        avatarUrl: `https://mc-heads.net/head/${profile.uuid}/64`,
        accessToken: profile.access_token,
        refreshToken: profile.refresh_token,
        tokenExpiry: Date.now() + (profile.expires_in ?? 86400) * 1000,
      });
      
      return true;
    }
    
    console.log('ℹ️ No auth found in Rust auth.json');
    return false;
  } catch (err: any) {
    console.log('ℹ️ Auto auth load skipped (dev mode or no auth):', err?.message);
    return false;
  }
}

/**
 * Debug: check if auth.json exists and what it contains
 */
export async function debugAuthInfo(): Promise<any> {
  try {
    return await invoke<any>('debug_auth_info');
  } catch (err: any) {
    console.error('Failed to debug auth:', err);
    return null;
  }
}
