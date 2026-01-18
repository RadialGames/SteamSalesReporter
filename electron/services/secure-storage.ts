// Secure storage for API key using Electron's safeStorage
import { app, safeStorage } from 'electron';
import fs from 'fs';
import path from 'path';

const KEY_FILE = 'api-key.enc';

function getKeyFilePath(): string {
  return path.join(app.getPath('userData'), KEY_FILE);
}

export function getApiKey(): string | null {
  const keyPath = getKeyFilePath();
  
  if (!fs.existsSync(keyPath)) {
    return null;
  }
  
  try {
    const encryptedData = fs.readFileSync(keyPath);
    
    if (!safeStorage.isEncryptionAvailable()) {
      // Fallback: store unencrypted (not recommended for production)
      return encryptedData.toString('utf8');
    }
    
    return safeStorage.decryptString(encryptedData);
  } catch (error) {
    console.error('Failed to read API key:', error);
    return null;
  }
}

export function setApiKey(key: string): void {
  const keyPath = getKeyFilePath();
  
  try {
    let dataToStore: Buffer;
    
    if (safeStorage.isEncryptionAvailable()) {
      dataToStore = safeStorage.encryptString(key);
    } else {
      // Fallback: store unencrypted (not recommended for production)
      console.warn('Safe storage not available, storing key unencrypted');
      dataToStore = Buffer.from(key, 'utf8');
    }
    
    fs.writeFileSync(keyPath, dataToStore);
  } catch (error) {
    console.error('Failed to save API key:', error);
    throw error;
  }
}

export function deleteApiKey(): void {
  const keyPath = getKeyFilePath();
  
  if (fs.existsSync(keyPath)) {
    fs.unlinkSync(keyPath);
  }
}
