// API key storage operations
// Metadata stored in Dexie, key values stored in localStorage (browser) or secure storage (Tauri)

import { v4 as uuidv4 } from 'uuid';
import type { ApiKeyInfo } from './types';
import {
  getAllApiKeys as getAllApiKeysFromDb,
  addApiKeyMetadata,
  updateApiKeyName as updateApiKeyNameInDb,
  deleteApiKeyMetadata,
} from '$lib/db/api-keys';
import { isTauri } from '$lib/utils/tauri';
import { invoke } from '@tauri-apps/api/core';
import { setState, getState, deleteState } from '$lib/db/data-state';

// Storage keys for browser mode
const API_KEY_VALUES_PREFIX = 'steam_api_key_'; // Individual key values: steam_api_key_{id}

// Helper to generate UUID
function generateId(): string {
  return uuidv4();
}

// Helper to get last 4 chars of key for display
function getKeyHash(key: string): string {
  return key.slice(-4);
}

export async function getAllApiKeys(): Promise<ApiKeyInfo[]> {
  // Metadata is now stored in Dexie
  return getAllApiKeysFromDb();
}

export async function getApiKey(id: string): Promise<string | null> {
  if (isTauri()) {
    // Use Tauri secure storage
    try {
      return await invoke('get_api_key', { id });
    } catch {
      return null;
    }
  } else {
    // Use localStorage for browser mode
    return localStorage.getItem(`${API_KEY_VALUES_PREFIX}${id}`);
  }
}

export async function addApiKey(key: string, displayName?: string): Promise<ApiKeyInfo> {
  const id = generateId();
  const keyInfo: ApiKeyInfo = {
    id,
    displayName,
    keyHash: getKeyHash(key),
    createdAt: Date.now(),
  };

  console.log(`[addApiKey] Adding API key with id: ${id}, displayName: ${displayName || 'none'}`);

  // Store the key value
  if (isTauri()) {
    // Use Tauri secure storage
    await invoke('add_api_key', { key, displayName: displayName || null });
    console.log(`[addApiKey] Stored key value in Tauri secure storage`);
  } else {
    // Use localStorage for browser mode
    localStorage.setItem(`${API_KEY_VALUES_PREFIX}${id}`, key);
    console.log(`[addApiKey] Stored key value in localStorage with key: ${API_KEY_VALUES_PREFIX}${id}`);
  }

  // Store metadata in database
  try {
    await addApiKeyMetadata(keyInfo);
    console.log(`[addApiKey] Stored metadata in database successfully`);
  } catch (error) {
    console.error('[addApiKey] Failed to store metadata in database:', error);
    // Clean up localStorage/Tauri storage if database write failed
    if (isTauri()) {
      try {
        await invoke('delete_api_key', { id });
      } catch {
        // Ignore cleanup errors
      }
    } else {
      localStorage.removeItem(`${API_KEY_VALUES_PREFIX}${id}`);
    }
    throw error;
  }

  return keyInfo;
}

export async function updateApiKeyName(id: string, displayName: string): Promise<void> {
  // Update metadata in Dexie
  await updateApiKeyNameInDb(id, displayName);

  // Also update in Tauri if needed (Tauri stores display name separately)
  if (isTauri()) {
    try {
      await invoke('update_api_key_name', { id, displayName });
    } catch (error) {
      console.warn('Failed to update API key name in Tauri:', error);
    }
  }
}

export async function deleteApiKey(id: string): Promise<void> {
  // Remove the key value
  if (isTauri()) {
    await invoke('delete_api_key', { id });
  } else {
    localStorage.removeItem(`${API_KEY_VALUES_PREFIX}${id}`);
  }

  // Remove the highwatermark
  await clearHighwatermark(id);

  // Remove metadata from Dexie
  await deleteApiKeyMetadata(id);
}

// Highwatermark management
// Store highwatermarks in Dexie data_state for consistency
const HIGHWATERMARK_KEY_PREFIX = 'highwatermark:';

export async function getHighwatermark(apiKeyId: string): Promise<number> {
  const key = `${HIGHWATERMARK_KEY_PREFIX}${apiKeyId}`;
  const value = await getState(key);
  return value ? parseInt(value, 10) : 0;
}

export async function setHighwatermark(apiKeyId: string, value: number): Promise<void> {
  const key = `${HIGHWATERMARK_KEY_PREFIX}${apiKeyId}`;
  await setState(key, value.toString());
}

export async function clearHighwatermark(apiKeyId: string): Promise<void> {
  const key = `${HIGHWATERMARK_KEY_PREFIX}${apiKeyId}`;
  await deleteState(key);
}

export function clearAllApiKeyStorage(): void {
  // Clear all API key values from localStorage (browser mode)
  // Metadata is stored in Dexie and will be cleared by wipeAllData
  const keys = Object.keys(localStorage);
  for (const key of keys) {
    if (key.startsWith(API_KEY_VALUES_PREFIX)) {
      localStorage.removeItem(key);
    }
  }
}

export { API_KEY_VALUES_PREFIX };
