// Tauri API client for CLI management

import { invoke } from '@tauri-apps/api/core';

// Check if running in Tauri
function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

// Helper to handle Tauri errors gracefully
async function safeInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  console.log(`[Tauri] Checking if Tauri is available...`);
  if (!isTauri()) {
    const error = 'Tauri APIs are only available in the Tauri application. Please run `npm run dev` to start the Tauri app.';
    console.error(`[Tauri] ${error}`);
    throw new Error(error);
  }
  console.log(`[Tauri] Invoking command: ${command}`, args);
  try {
    const result = await invoke<T>(command, args);
    console.log(`[Tauri] Command ${command} succeeded:`, result);
    return result;
  } catch (error) {
    let errorMsg = 'Unknown Tauri error';
    if (error instanceof Error && error.message) errorMsg = error.message;
    else if (typeof error === 'string') errorMsg = error;
    else if (error && typeof error === 'object' && 'message' in error) {
      const m = (error as { message: unknown }).message;
      if (typeof m === 'string') errorMsg = m;
    } else if (error != null) errorMsg = String(error);
    console.error(`[Tauri] Command ${command} failed:`, errorMsg, error);
    throw new Error(errorMsg);
  }
}

// ==================== CLI Status ====================

export interface CliStatus {
  installed: boolean;
  version: string | null;
  databaseExists: boolean;
}

export async function getCliStatus(): Promise<CliStatus> {
  const result = await safeInvoke<{ installed: boolean; version: string | null; database_exists: boolean }>('get_cli_status');
  // Transform snake_case from Rust to camelCase for TypeScript
  return {
    installed: result.installed,
    version: result.version,
    databaseExists: result.database_exists,
  };
}

// ==================== CLI Download ====================

export async function downloadCli(): Promise<{ success: boolean; path: string }> {
  const path = await safeInvoke<string>('download_cli');
  return { success: true, path };
}

// ==================== CLI Init ====================

export async function initCli(apiKey: string): Promise<{ success: boolean }> {
  await safeInvoke('init_cli', { apiKey });
  return { success: true };
}

// ==================== CLI Fetch ====================

export async function fetchData(options: { force?: boolean } = {}): Promise<{ success: boolean }> {
  await safeInvoke('fetch_data', { force: options.force || false });
  return { success: true };
}

// ==================== Delete Database ====================

export async function deleteDatabase(): Promise<{ success: boolean }> {
  await safeInvoke('delete_database');
  return { success: true };
}

