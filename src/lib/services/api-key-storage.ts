// API key storage operations for browser mode
// Uses localStorage for persistence

import type { ApiKeyInfo } from './types';

// Storage keys
const API_KEYS_STORAGE_KEY = 'steam_api_keys'; // JSON array of ApiKeyInfo
const API_KEY_VALUES_PREFIX = 'steam_api_key_'; // Individual key values: steam_api_key_{id}
const HIGHWATERMARK_PREFIX = 'highwatermark_'; // Per-key highwatermarks: highwatermark_{id}

// Helper to generate UUID
function generateId(): string {
  return crypto.randomUUID();
}

// Helper to get last 4 chars of key for display
function getKeyHash(key: string): string {
  return key.slice(-4);
}

export async function getAllApiKeys(): Promise<ApiKeyInfo[]> {
  const stored = localStorage.getItem(API_KEYS_STORAGE_KEY);
  if (!stored) return [];
  try {
    const parsed = JSON.parse(stored);
    // Ensure we always return an array
    if (!Array.isArray(parsed)) {
      console.warn('API keys storage was not an array, resetting');
      return [];
    }
    return parsed as ApiKeyInfo[];
  } catch {
    return [];
  }
}

export async function getApiKey(id: string): Promise<string | null> {
  return localStorage.getItem(`${API_KEY_VALUES_PREFIX}${id}`);
}

export async function addApiKey(key: string, displayName?: string): Promise<ApiKeyInfo> {
  const id = generateId();
  const keyInfo: ApiKeyInfo = {
    id,
    displayName,
    keyHash: getKeyHash(key),
    createdAt: Date.now(),
  };

  // Store the key value
  localStorage.setItem(`${API_KEY_VALUES_PREFIX}${id}`, key);

  // Add to keys list
  let keys = await getAllApiKeys();
  // Ensure keys is an array (defensive check)
  if (!Array.isArray(keys)) {
    console.warn('getAllApiKeys did not return an array, creating new array');
    keys = [];
  }
  keys.push(keyInfo);
  localStorage.setItem(API_KEYS_STORAGE_KEY, JSON.stringify(keys));

  return keyInfo;
}

export async function updateApiKeyName(id: string, displayName: string): Promise<void> {
  const keys = await getAllApiKeys();
  if (!Array.isArray(keys)) throw new Error('API keys storage corrupted');

  const keyIndex = keys.findIndex((k) => k.id === id);
  if (keyIndex === -1) throw new Error('API key not found');

  keys[keyIndex].displayName = displayName;
  localStorage.setItem(API_KEYS_STORAGE_KEY, JSON.stringify(keys));
}

export async function deleteApiKey(id: string): Promise<void> {
  // Remove the key value
  localStorage.removeItem(`${API_KEY_VALUES_PREFIX}${id}`);
  // Remove the highwatermark
  localStorage.removeItem(`${HIGHWATERMARK_PREFIX}${id}`);

  // Remove from keys list
  const keys = await getAllApiKeys();
  const filtered = keys.filter((k) => k.id !== id);
  localStorage.setItem(API_KEYS_STORAGE_KEY, JSON.stringify(filtered));
}

// Highwatermark management
export async function getHighwatermark(apiKeyId: string): Promise<number> {
  const stored = localStorage.getItem(`${HIGHWATERMARK_PREFIX}${apiKeyId}`);
  return stored ? parseInt(stored, 10) : 0;
}

export async function setHighwatermark(apiKeyId: string, value: number): Promise<void> {
  localStorage.setItem(`${HIGHWATERMARK_PREFIX}${apiKeyId}`, value.toString());
}

export function clearHighwatermark(apiKeyId: string): void {
  localStorage.removeItem(`${HIGHWATERMARK_PREFIX}${apiKeyId}`);
}

export function clearAllApiKeyStorage(): void {
  // This is used during clearAllData
  localStorage.removeItem(API_KEYS_STORAGE_KEY);
}

export { API_KEY_VALUES_PREFIX, HIGHWATERMARK_PREFIX };
