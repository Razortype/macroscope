use keyring::Entry;
use crate::error::AppError;

const SERVICE: &str = "com.orkunkurul.macroscope";

/// Maps a keyring error to AppError, distinguishing explicit user denial
/// (errSecUserCanceled -128, errSecAuthFailed -25293) from other failures.
fn classify(e: keyring::Error) -> AppError {
    let denied = match &e {
        keyring::Error::PlatformFailure(src) | keyring::Error::NoStorageAccess(src) => {
            let s = src.to_string();
            // The security-framework Display shows either the OS message or "error code {n}".
            // Match both paths: numeric code always appears in the fallback string.
            s.contains("-128") || s.contains("-25293")
        }
        _ => false,
    };
    if denied {
        AppError::KeychainDenied
    } else {
        AppError::Keychain(e.to_string())
    }
}

pub fn keychain_set(account: &str, secret: &str) -> Result<(), AppError> {
    Entry::new(SERVICE, account)
        .map_err(|e| AppError::Keychain(e.to_string()))?
        .set_password(secret)
        .map_err(classify)
}

pub fn keychain_get(account: &str) -> Result<Option<String>, AppError> {
    let entry = Entry::new(SERVICE, account)
        .map_err(|e| AppError::Keychain(e.to_string()))?;
    match entry.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(classify(e)),
    }
}

pub fn keychain_delete(account: &str) -> Result<(), AppError> {
    let entry = Entry::new(SERVICE, account)
        .map_err(|e| AppError::Keychain(e.to_string()))?;
    match entry.delete_password() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(classify(e)),
    }
}

pub fn keychain_has(account: &str) -> Result<bool, AppError> {
    let entry = Entry::new(SERVICE, account)
        .map_err(|e| AppError::Keychain(e.to_string()))?;
    match entry.get_password() {
        Ok(_) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(e) => Err(classify(e)),
    }
}

// Per-provider account key constants
pub const ACCOUNT_ANTHROPIC: &str = "anthropic_api_key";
pub const ACCOUNT_OPENAI: &str = "openai_api_key";
pub const ACCOUNT_GEMINI: &str = "gemini_api_key";
