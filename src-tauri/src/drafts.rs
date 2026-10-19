//! Saved lyrics and saved styles: the person's own writing, kept so it can be
//! picked again. Stored in `<app-data>/saved.json`, replaced atomically.

use crate::Held;
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};

use serde::{Deserialize, Serialize};
use tauri::Manager;

const FILE: &str = "saved.json";
/// Oldest entries leave once a list is this long.
const LIMIT: usize = 200;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Lyrics,
    Styles,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Saved {
    pub id: String,
    /// A song title, or empty to let the interface name it by its first line.
    pub title: String,
    pub text: String,
    pub saved_ms: u64,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(default)]
pub struct SavedFile {
    pub lyrics: Vec<Saved>,
    pub styles: Vec<Saved>,
}

impl SavedFile {
    fn list_mut(&mut self, kind: Kind) -> &mut Vec<Saved> {
        match kind {
            Kind::Lyrics => &mut self.lyrics,
            Kind::Styles => &mut self.styles,
        }
    }

    pub fn list(&self, kind: Kind) -> &[Saved] {
        match kind {
            Kind::Lyrics => &self.lyrics,
            Kind::Styles => &self.styles,
        }
    }

    /// Keep `text` at the top of its list. Saving the same words again only moves
    /// them up (and names them, if they had no name yet).
    pub fn remember(
        &mut self,
        kind: Kind,
        title: &str,
        text: &str,
        now: u64,
        id: impl FnOnce() -> String,
    ) -> Result<Saved, String> {
        let text = text.trim();
        let title: String = title.trim().chars().take(120).collect();
        if text.is_empty() {
            return Err("There’s nothing to save yet.".into());
        }
        if matches!(kind, Kind::Lyrics) && text.chars().count() > 16_000 {
            return Err("That’s too long to save.".into());
        }
        let list = self.list_mut(kind);
        let entry = match list.iter().position(|s| s.text == text) {
            Some(index) => {
                let mut existing = list.remove(index);
                existing.saved_ms = now;
                if existing.title.is_empty() {
                    existing.title = title;
                }
                existing
            }
            None => Saved {
                id: id(),
                title,
                text: text.to_string(),
                saved_ms: now,
            },
        };
        list.insert(0, entry.clone());
        list.truncate(LIMIT);
        Ok(entry)
    }

    pub fn forget(&mut self, kind: Kind, id: &str) -> bool {
        let list = self.list_mut(kind);
        let before = list.len();
        list.retain(|s| s.id != id);
        list.len() < before
    }
}

pub fn load(base: &Path) -> SavedFile {
    fs::read(base.join(FILE))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

pub fn save(base: &Path, saved: &SavedFile) -> Result<(), String> {
    fs::create_dir_all(base).map_err(|e| e.to_string())?;
    let mut tmp = tempfile::NamedTempFile::new_in(base).map_err(|e| e.to_string())?;
    serde_json::to_writer(&mut tmp, saved).map_err(|e| e.to_string())?;
    tmp.as_file().sync_all().map_err(|e| e.to_string())?;
    tmp.persist(base.join(FILE))
        .map_err(|e| e.error.to_string())?;
    Ok(())
}

#[derive(Default)]
pub struct SavedStore(Mutex<Option<SavedFile>>);

fn base(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    crate::data_dir(app)
}

const NOT_SAVED: &str =
    "Aulo couldn’t save that. Make sure your disk has free space, then try again.";

/// Run `f` on the saved lists and write them back; nothing changes if writing fails.
fn change<T>(
    app: &tauri::AppHandle,
    f: impl FnOnce(&mut SavedFile) -> Result<T, String>,
) -> Result<T, String> {
    let base = base(app)?;
    let store = app.state::<SavedStore>();
    let mut current = store.0.held();
    let mut next = current.clone().unwrap_or_else(|| load(&base));
    let result = f(&mut next)?;
    save(&base, &next).map_err(|_| NOT_SAVED.to_string())?;
    *current = Some(next);
    Ok(result)
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
}

/// Keep what a song was made from; used when a song is created. Failures are quiet.
pub fn remember_song(app: &tauri::AppHandle, title: &str, lyrics: &str, style: &str) {
    let _ = change(app, |saved| {
        if !lyrics.trim().is_empty() {
            let _ = saved.remember(Kind::Lyrics, title, lyrics, now_ms(), new_id);
        }
        if !style.trim().is_empty() {
            let _ = saved.remember(Kind::Styles, title, style, now_ms(), new_id);
        }
        Ok(())
    });
}

fn new_id() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}

#[tauri::command]
pub fn list_saved(app: tauri::AppHandle, kind: Kind) -> Result<Vec<Saved>, String> {
    let base = base(&app)?;
    let store = app.state::<SavedStore>();
    let mut current = store.0.held();
    let file = current.get_or_insert_with(|| load(&base));
    Ok(file.list(kind).to_vec())
}

#[tauri::command]
pub fn save_text(
    app: tauri::AppHandle,
    kind: Kind,
    title: String,
    text: String,
) -> Result<Saved, String> {
    change(&app, |saved| {
        saved.remember(kind, &title, &text, now_ms(), new_id)
    })
}

#[tauri::command]
pub fn delete_saved(app: tauri::AppHandle, kind: Kind, id: String) -> Result<(), String> {
    change(&app, |saved| {
        saved.forget(kind, &id);
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids() -> impl FnMut() -> String {
        let mut n = 0;
        move || {
            n += 1;
            format!("id{n}")
        }
    }

    #[test]
    fn saving_the_same_words_moves_them_up_instead_of_repeating() {
        let mut saved = SavedFile::default();
        let mut id = ids();
        saved
            .remember(Kind::Lyrics, "", "[Verse]\nOne", 1, &mut id)
            .unwrap();
        saved
            .remember(Kind::Lyrics, "", "[Verse]\nTwo", 2, &mut id)
            .unwrap();
        let again = saved
            .remember(Kind::Lyrics, "Sunday", "  [Verse]\nOne \n", 3, &mut id)
            .unwrap();
        assert_eq!(again.id, "id1");
        assert_eq!(again.title, "Sunday");
        let texts: Vec<_> = saved.lyrics.iter().map(|s| s.text.as_str()).collect();
        assert_eq!(texts, ["[Verse]\nOne", "[Verse]\nTwo"]);
        assert!(saved.styles.is_empty());
    }

    #[test]
    fn empty_or_oversized_text_is_refused_and_lists_stay_bounded() {
        let mut saved = SavedFile::default();
        let mut id = ids();
        assert!(saved.remember(Kind::Styles, "", "   ", 1, &mut id).is_err());
        assert!(saved
            .remember(Kind::Lyrics, "", &"x".repeat(16_001), 1, &mut id)
            .is_err());
        for i in 0..(LIMIT + 5) {
            saved
                .remember(Kind::Styles, "", &format!("style {i}"), i as u64, &mut id)
                .unwrap();
        }
        assert_eq!(saved.styles.len(), LIMIT);
        assert_eq!(saved.styles[0].text, format!("style {}", LIMIT + 4));
    }

    #[test]
    fn long_styles_are_saved_without_truncation() {
        let dir = tempfile::tempdir().unwrap();
        let mut saved = SavedFile::default();
        let text = "warm piano, ".repeat(200);
        saved.remember(Kind::Styles, "", &text, 1, ids()).unwrap();
        save(dir.path(), &saved).unwrap();
        let loaded = load(dir.path());
        assert_eq!(loaded.styles[0].text, text.trim());
    }

    #[test]
    fn forgetting_and_storage_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let mut saved = SavedFile::default();
        let mut id = ids();
        saved
            .remember(Kind::Lyrics, "A", "la la", 1, &mut id)
            .unwrap();
        saved
            .remember(Kind::Styles, "A", "folk", 1, &mut id)
            .unwrap();
        save(dir.path(), &saved).unwrap();
        let mut loaded = load(dir.path());
        assert_eq!(loaded, saved);
        assert!(loaded.forget(Kind::Lyrics, "id1"));
        assert!(!loaded.forget(Kind::Lyrics, "id1"));
        assert_eq!(loaded.lyrics.len(), 0);
        fs::write(dir.path().join(FILE), b"{broken").unwrap();
        assert_eq!(load(dir.path()), SavedFile::default());
    }
}
