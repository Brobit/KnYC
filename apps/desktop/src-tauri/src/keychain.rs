//! API keys in the OS keychain (macOS Keychain, Windows Credential Manager, Secret Service on
//! Linux). settings.json only holds the entry name (`provider.keyRef`, design/03-data-model.md).
//! A key goes in from the Settings screen and never comes back out to the frontend: it only gets
//! a masked hint to show which key is saved.

const SERVICE: &str = "io.github.brobit.knyc";

/// Where secrets live. The OS keychain in the app, memory in tests (CI has no Secret Service).
pub trait SecretStore {
    fn set(&self, key_ref: &str, secret: &str) -> Result<(), String>;
    /// None when there is no such entry.
    fn get(&self, key_ref: &str) -> Result<Option<String>, String>;
    /// Deleting a missing entry is not an error.
    fn delete(&self, key_ref: &str) -> Result<(), String>;
}

pub struct OsKeychain;

impl OsKeychain {
    fn entry(key_ref: &str) -> Result<keyring::Entry, String> {
        keyring::Entry::new(SERVICE, key_ref).map_err(|e| format!("keychain unavailable: {e}"))
    }
}

impl SecretStore for OsKeychain {
    fn set(&self, key_ref: &str, secret: &str) -> Result<(), String> {
        Self::entry(key_ref)?
            .set_password(secret)
            .map_err(|e| format!("could not save the key: {e}"))
    }

    fn get(&self, key_ref: &str) -> Result<Option<String>, String> {
        match Self::entry(key_ref)?.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(format!("could not read the key: {e}")),
        }
    }

    fn delete(&self, key_ref: &str) -> Result<(), String> {
        match Self::entry(key_ref)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(format!("could not delete the key: {e}")),
        }
    }
}

/// Same rule as other KnYC ids: lowercase letters, digits and dashes.
fn check_key_ref(key_ref: &str) -> Result<(), String> {
    let valid = !key_ref.is_empty()
        && key_ref.len() <= 64
        && !key_ref.starts_with('-')
        && key_ref
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
    if valid {
        Ok(())
    } else {
        Err(format!("invalid keychain entry name: {key_ref:?}"))
    }
}

/// "sk-ant-api03-…Q4mA" → "sk-ant-••••••••Q4mA": the provider prefix and the last 4 characters,
/// enough to recognise a key without revealing it. Short keys show nothing.
pub fn mask(secret: &str) -> String {
    const DOTS: &str = "••••••••";
    let chars: Vec<char> = secret.chars().collect();
    if chars.len() < 16 {
        return DOTS.to_string();
    }
    let head: String = chars[..8].iter().collect();
    let prefix = head.rfind('-').map_or("", |i| &head[..=i]);
    let tail: String = chars[chars.len() - 4..].iter().collect();
    format!("{prefix}{DOTS}{tail}")
}

pub fn save(store: &impl SecretStore, key_ref: &str, secret: &str) -> Result<String, String> {
    check_key_ref(key_ref)?;
    let secret = secret.trim();
    if secret.is_empty() {
        return Err("the key is empty".into());
    }
    store.set(key_ref, secret)?;
    Ok(mask(secret))
}

pub fn hint(store: &impl SecretStore, key_ref: &str) -> Result<Option<String>, String> {
    check_key_ref(key_ref)?;
    Ok(store.get(key_ref)?.map(|secret| mask(&secret)))
}

pub fn remove(store: &impl SecretStore, key_ref: &str) -> Result<(), String> {
    check_key_ref(key_ref)?;
    store.delete(key_ref)
}

// Keychain calls can block (Secret Service over D-Bus, a macOS unlock prompt): async commands
// keep them off the main thread.

/// Saves the key and returns its masked hint.
#[tauri::command]
pub async fn keychain_set(key_ref: String, secret: String) -> Result<String, String> {
    save(&OsKeychain, &key_ref, &secret)
}

/// The masked hint of a saved key, or None when there is none.
#[tauri::command]
pub async fn keychain_hint(key_ref: String) -> Result<Option<String>, String> {
    hint(&OsKeychain, &key_ref)
}

#[tauri::command]
pub async fn keychain_delete(key_ref: String) -> Result<(), String> {
    remove(&OsKeychain, &key_ref)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::collections::HashMap;

    #[derive(Default)]
    struct MemoryStore(RefCell<HashMap<String, String>>);

    impl SecretStore for MemoryStore {
        fn set(&self, key_ref: &str, secret: &str) -> Result<(), String> {
            self.0.borrow_mut().insert(key_ref.into(), secret.into());
            Ok(())
        }
        fn get(&self, key_ref: &str) -> Result<Option<String>, String> {
            Ok(self.0.borrow().get(key_ref).cloned())
        }
        fn delete(&self, key_ref: &str) -> Result<(), String> {
            self.0.borrow_mut().remove(key_ref);
            Ok(())
        }
    }

    const KEY: &str = "sk-ant-api03-abcdefghijklmnopQ4mA";

    #[test]
    fn masks_keys() {
        assert_eq!(mask(KEY), "sk-ant-••••••••Q4mA");
        assert_eq!(mask("AIzaSyA1234567890abcdWXYZ"), "••••••••WXYZ");
        assert_eq!(mask("short"), "••••••••");
    }

    #[test]
    fn saves_reads_back_and_deletes() {
        let store = MemoryStore::default();
        assert_eq!(hint(&store, "anthropic").unwrap(), None);
        assert_eq!(
            save(&store, "anthropic", &format!("  {KEY}\n")).unwrap(),
            "sk-ant-••••••••Q4mA"
        );
        assert_eq!(store.get("anthropic").unwrap().as_deref(), Some(KEY));
        assert_eq!(
            hint(&store, "anthropic").unwrap().as_deref(),
            Some("sk-ant-••••••••Q4mA")
        );
        remove(&store, "anthropic").unwrap();
        assert_eq!(hint(&store, "anthropic").unwrap(), None);
        remove(&store, "anthropic").unwrap();
    }

    #[test]
    fn refuses_bad_names_and_empty_keys() {
        let store = MemoryStore::default();
        for bad in ["", "Anthropic", "a/b", "-x", &"a".repeat(65)] {
            assert!(save(&store, bad, KEY).is_err(), "{bad:?}");
        }
        assert!(save(&store, "openai", "   ").is_err());
        assert!(store.0.borrow().is_empty());
    }

    /// The real OS keychain. Ignored by default (CI Linux has no Secret Service); run it on each
    /// OS with `cargo test -p knyc -- --ignored os_keychain`.
    #[test]
    #[ignore]
    fn os_keychain_round_trip() {
        let key_ref = "knyc-test-entry";
        save(&OsKeychain, key_ref, KEY).unwrap();
        assert_eq!(OsKeychain.get(key_ref).unwrap().as_deref(), Some(KEY));
        remove(&OsKeychain, key_ref).unwrap();
        assert_eq!(OsKeychain.get(key_ref).unwrap(), None);
    }
}
