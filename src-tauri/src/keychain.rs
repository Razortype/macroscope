use keyring::Entry;
use crate::error::AppError;

const SERVICE: &str = "com.orkunkurul.macroscope";

pub fn keychain_set(account: &str, secret: &str) -> Result<(), AppError> {
    Entry::new(SERVICE, account)
        .map_err(|e| AppError::Keychain(e.to_string()))?
        .set_password(secret)
        .map_err(|e| AppError::Keychain(e.to_string()))
}

pub fn keychain_get(account: &str) -> Result<Option<String>, AppError> {
    let entry = Entry::new(SERVICE, account)
        .map_err(|e| AppError::Keychain(e.to_string()))?;
    match entry.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(AppError::Keychain(e.to_string())),
    }
}

pub fn keychain_delete(account: &str) -> Result<(), AppError> {
    let entry = Entry::new(SERVICE, account)
        .map_err(|e| AppError::Keychain(e.to_string()))?;
    match entry.delete_password() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(AppError::Keychain(e.to_string())),
    }
}

pub fn keychain_has(account: &str) -> Result<bool, AppError> {
    let entry = Entry::new(SERVICE, account)
        .map_err(|e| AppError::Keychain(e.to_string()))?;
    match entry.get_password() {
        Ok(_) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(e) => Err(AppError::Keychain(e.to_string())),
    }
}

// Per-provider account key constants
pub const ACCOUNT_ANTHROPIC: &str = "anthropic_api_key";
pub const ACCOUNT_OPENAI: &str = "openai_api_key";
pub const ACCOUNT_GEMINI: &str = "gemini_api_key";
