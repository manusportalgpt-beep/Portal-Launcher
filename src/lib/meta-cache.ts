import { invoke } from '@/lib/invoke-shim';

/**
 * CDN Cache Entry (stored in .meta.json files)
 */
export interface CdnCacheEntry {
  url: string;
  local_path: string;
  etag?: string;
  last_modified?: string;
  cached_at: number;
  expires_at: number;
}

/**
 * Feed Item (news, updates, activity)
 */
export interface FeedItem {
  id: string;
  title: string;
  content: string;
  image_url?: string;
  source: 'modrinth' | 'curseforge' | 'launcher';
  created_at: number;
  read: boolean;
}

/**
 * Cache Statistics
 */
export interface CacheStats {
  cdn_modrinth: { files: number; size_bytes: number; size_mb: number };
  cdn_curseforge: { files: number; size_bytes: number; size_mb: number };
  modrinth_packs: { files: number; size_bytes: number; size_mb: number };
  modrinth_modpacks: { files: number; size_bytes: number; size_mb: number };
  feed: { files: number; size_bytes: number; size_mb: number };
}

/**
 * Cache a CDN file (Modrinth/CurseForge icon, thumbnail, etc.)
 */
export async function cacheCdnFile(
  provider: 'modrinth' | 'curseforge',
  url: string,
  data: Uint8Array,
  etag?: string,
  last_modified?: string
): Promise<string> {
  return invoke<string>('cache_cdn_file', {
    provider,
    url,
    data: Array.from(data),
    etag,
    last_modified,
  });
}

/**
 * Get cached CDN file path (returns null if expired or not found)
 */
export async function getCachedCdnFile(
  provider: 'modrinth' | 'curseforge',
  url: string
): Promise<string | null> {
  const result = await invoke<string | null>('get_cached_cdn_file', {
    provider,
    url,
  });
  return result;
}

/**
 * Add item to feed
 */
export async function addFeedItem(
  title: string,
  content: string,
  imageUrl?: string,
  source: 'modrinth' | 'curseforge' | 'launcher' = 'launcher'
): Promise<string> {
  return invoke<string>('add_feed_item', {
    title,
    content,
    image_url: imageUrl,
    source,
  });
}

/**
 * Get all feed items (newest first)
 */
export async function getFeedItems(): Promise<FeedItem[]> {
  return invoke<FeedItem[]>('get_feed_items');
}

/**
 * Mark feed item as read
 */
export async function markFeedItemRead(itemId: string): Promise<void> {
  return invoke<void>('mark_feed_item_read', { item_id: itemId });
}

/**
 * Clean expired CDN cache entries
 */
export async function cleanCdnCache(
  provider?: 'modrinth' | 'curseforge'
): Promise<number> {
  return invoke<number>('clean_cdn_cache', {
    provider: provider || null,
  });
}

/**
 * Get cache statistics for all directories
 */
export async function getCacheStats(): Promise<CacheStats> {
  return invoke<CacheStats>('get_cache_stats');
}
