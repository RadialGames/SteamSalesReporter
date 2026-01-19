use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use rand::Rng;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use thiserror::Error;

const KEYS_FILE: &str = "api-keys.enc";
const KEY_FILE: &str = ".encryption-key";

#[derive(Error, Debug)]
pub enum StorageError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Encryption error: {0}")]
    Encryption(String),
    #[error("Decryption error: {0}")]
    Decryption(String),
    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
}

pub struct SecureStorage {
    data_dir: PathBuf,
    encryption_key: [u8; 32],
}

impl SecureStorage {
    pub fn new(data_dir: &Path) -> Result<Self, StorageError> {
        let key_path = data_dir.join(KEY_FILE);
        
        let encryption_key = if key_path.exists() {
            // Load existing key
            let key_b64 = fs::read_to_string(&key_path)?;
            let key_bytes = BASE64
                .decode(key_b64.trim())
                .map_err(|e| StorageError::Decryption(e.to_string()))?;
            
            let mut key = [0u8; 32];
            if key_bytes.len() != 32 {
                return Err(StorageError::Decryption("Invalid key length".to_string()));
            }
            key.copy_from_slice(&key_bytes);
            key
        } else {
            // Generate new key
            let mut key = [0u8; 32];
            rand::thread_rng().fill(&mut key);
            
            // Save key
            let key_b64 = BASE64.encode(key);
            fs::write(&key_path, key_b64)?;
            
            key
        };
        
        Ok(SecureStorage {
            data_dir: data_dir.to_path_buf(),
            encryption_key,
        })
    }
    
    fn get_keys_path(&self) -> PathBuf {
        self.data_dir.join(KEYS_FILE)
    }
    
    fn encrypt(&self, plaintext: &str) -> Result<String, StorageError> {
        let cipher = Aes256Gcm::new_from_slice(&self.encryption_key)
            .map_err(|e| StorageError::Encryption(e.to_string()))?;
        
        // Generate random nonce
        let mut nonce_bytes = [0u8; 12];
        rand::thread_rng().fill(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);
        
        // Encrypt
        let ciphertext = cipher
            .encrypt(nonce, plaintext.as_bytes())
            .map_err(|e| StorageError::Encryption(e.to_string()))?;
        
        // Combine nonce + ciphertext and encode as base64
        let mut combined = nonce_bytes.to_vec();
        combined.extend(ciphertext);
        
        Ok(BASE64.encode(combined))
    }
    
    fn decrypt(&self, encrypted: &str) -> Result<String, StorageError> {
        let cipher = Aes256Gcm::new_from_slice(&self.encryption_key)
            .map_err(|e| StorageError::Decryption(e.to_string()))?;
        
        // Decode base64
        let combined = BASE64
            .decode(encrypted)
            .map_err(|e| StorageError::Decryption(e.to_string()))?;
        
        if combined.len() < 12 {
            return Err(StorageError::Decryption("Invalid encrypted data".to_string()));
        }
        
        // Split nonce and ciphertext
        let (nonce_bytes, ciphertext) = combined.split_at(12);
        let nonce = Nonce::from_slice(nonce_bytes);
        
        // Decrypt
        let plaintext = cipher
            .decrypt(nonce, ciphertext)
            .map_err(|e| StorageError::Decryption(e.to_string()))?;
        
        String::from_utf8(plaintext)
            .map_err(|e| StorageError::Decryption(e.to_string()))
    }
    
    fn read_stored_keys(&self) -> Result<HashMap<String, String>, StorageError> {
        let keys_path = self.get_keys_path();
        
        if !keys_path.exists() {
            return Ok(HashMap::new());
        }
        
        let encrypted = fs::read_to_string(&keys_path)?;
        if encrypted.trim().is_empty() {
            return Ok(HashMap::new());
        }
        
        let json_str = self.decrypt(&encrypted)?;
        let keys: HashMap<String, String> = serde_json::from_str(&json_str)?;
        
        Ok(keys)
    }
    
    fn write_stored_keys(&self, keys: &HashMap<String, String>) -> Result<(), StorageError> {
        let json_str = serde_json::to_string(keys)?;
        let encrypted = self.encrypt(&json_str)?;
        
        fs::write(self.get_keys_path(), encrypted)?;
        
        Ok(())
    }
    
    /// Get a specific API key value by ID
    pub fn get_api_key(&self, id: &str) -> Result<Option<String>, StorageError> {
        let keys = self.read_stored_keys()?;
        Ok(keys.get(id).cloned())
    }
    
    /// Add a new API key
    pub fn add_api_key(&self, id: &str, key: &str) -> Result<(), StorageError> {
        let mut keys = self.read_stored_keys()?;
        keys.insert(id.to_string(), key.to_string());
        self.write_stored_keys(&keys)
    }
    
    /// Delete an API key
    pub fn delete_api_key(&self, id: &str) -> Result<(), StorageError> {
        let mut keys = self.read_stored_keys()?;
        keys.remove(id);
        self.write_stored_keys(&keys)
    }
    
    /// Delete all API keys
    pub fn delete_all_keys(&self) -> Result<(), StorageError> {
        let keys_path = self.get_keys_path();
        if keys_path.exists() {
            fs::remove_file(keys_path)?;
        }
        Ok(())
    }
}
