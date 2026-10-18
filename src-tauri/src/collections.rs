//! Workspaces and playlists: how people organise their songs.
//!
//! A song lives in exactly one workspace (My Workspace unless moved); playlists are
//! ordered lists that can hold any song, more than once across playlists. Both are
//! kept in `<library>/collections.json`, replaced atomically on every change.
use serde::{Deserialize, Serialize};
use std::{fs, path::Path};

pub const DEFAULT_WORKSPACE: &str = "default";
const FILE: &str = "collections.json";
const MAX_NAME: usize = 60;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub created_ms: u64,
    #[serde(default)]
    pub archived: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Playlist {
    pub id: String,
    pub name: String,
    pub created_ms: u64,
    #[serde(default)]
    pub song_ids: Vec<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Collections {
    #[serde(default)]
    pub workspaces: Vec<Workspace>,
    #[serde(default)]
    pub playlists: Vec<Playlist>,
}

fn clean_name(name: &str) -> Result<String, String> {
    let name = name.split_whitespace().collect::<Vec<_>>().join(" ");
    if name.is_empty() {
        return Err("Give it a name.".into());
    }
    if name.chars().count() > MAX_NAME {
        return Err(format!("Names can be up to {MAX_NAME} characters."));
    }
    Ok(name)
}

impl Collections {
    /// My Workspace always exists, comes first and is never archived.
    fn normalized(mut self) -> Self {
        self.workspaces.retain(|w| !w.id.is_empty());
        match self
            .workspaces
            .iter()
            .position(|w| w.id == DEFAULT_WORKSPACE)
        {
            Some(index) => {
                let mut default = self.workspaces.remove(index);
                default.archived = false;
                self.workspaces.insert(0, default);
            }
            None => self.workspaces.insert(
                0,
                Workspace {
                    id: DEFAULT_WORKSPACE.into(),
                    name: "My Workspace".into(),
                    created_ms: 0,
                    archived: false,
                },
            ),
        }
        self
    }

    pub fn load(root: &Path) -> Self {
        fs::read(root.join(FILE))
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Collections>(&bytes).ok())
            .unwrap_or_default()
            .normalized()
    }

    pub fn save(&self, root: &Path) -> Result<(), String> {
        fs::create_dir_all(root).map_err(|e| e.to_string())?;
        let mut tmp = tempfile::NamedTempFile::new_in(root).map_err(|e| e.to_string())?;
        serde_json::to_writer_pretty(&mut tmp, self).map_err(|e| e.to_string())?;
        tmp.as_file().sync_all().map_err(|e| e.to_string())?;
        tmp.persist(root.join(FILE))
            .map_err(|e| e.error.to_string())?;
        Ok(())
    }

    pub fn has_workspace(&self, id: &str) -> bool {
        self.workspaces.iter().any(|w| w.id == id)
    }

    pub fn create_workspace(
        &mut self,
        id: String,
        name: &str,
        now: u64,
    ) -> Result<Workspace, String> {
        let name = clean_name(name)?;
        if self
            .workspaces
            .iter()
            .any(|w| w.name.eq_ignore_ascii_case(&name))
        {
            return Err("A workspace with that name already exists.".into());
        }
        let workspace = Workspace {
            id,
            name,
            created_ms: now,
            archived: false,
        };
        self.workspaces.push(workspace.clone());
        Ok(workspace)
    }

    pub fn rename_workspace(&mut self, id: &str, name: &str) -> Result<(), String> {
        let name = clean_name(name)?;
        if self
            .workspaces
            .iter()
            .any(|w| w.id != id && w.name.eq_ignore_ascii_case(&name))
        {
            return Err("A workspace with that name already exists.".into());
        }
        let workspace = self
            .workspaces
            .iter_mut()
            .find(|w| w.id == id)
            .ok_or("Unknown workspace.")?;
        workspace.name = name;
        Ok(())
    }

    pub fn set_archived(&mut self, id: &str, archived: bool) -> Result<(), String> {
        if id == DEFAULT_WORKSPACE {
            return Err("My Workspace can’t be archived.".into());
        }
        let workspace = self
            .workspaces
            .iter_mut()
            .find(|w| w.id == id)
            .ok_or("Unknown workspace.")?;
        workspace.archived = archived;
        Ok(())
    }

    pub fn delete_workspace(&mut self, id: &str) -> Result<(), String> {
        if id == DEFAULT_WORKSPACE {
            return Err("My Workspace can’t be deleted.".into());
        }
        let before = self.workspaces.len();
        self.workspaces.retain(|w| w.id != id);
        if before == self.workspaces.len() {
            return Err("Unknown workspace.".into());
        }
        Ok(())
    }

    pub fn create_playlist(
        &mut self,
        id: String,
        name: &str,
        now: u64,
    ) -> Result<Playlist, String> {
        let playlist = Playlist {
            id,
            name: clean_name(name)?,
            created_ms: now,
            song_ids: Vec::new(),
        };
        self.playlists.insert(0, playlist.clone());
        Ok(playlist)
    }

    fn playlist(&mut self, id: &str) -> Result<&mut Playlist, String> {
        self.playlists
            .iter_mut()
            .find(|p| p.id == id)
            .ok_or_else(|| "Unknown playlist.".to_string())
    }

    pub fn rename_playlist(&mut self, id: &str, name: &str) -> Result<(), String> {
        let name = clean_name(name)?;
        self.playlist(id)?.name = name;
        Ok(())
    }

    pub fn delete_playlist(&mut self, id: &str) -> Result<(), String> {
        let before = self.playlists.len();
        self.playlists.retain(|p| p.id != id);
        if before == self.playlists.len() {
            return Err("Unknown playlist.".into());
        }
        Ok(())
    }

    /// Append songs in order, skipping any already in the playlist; returns how many were added.
    pub fn add_to_playlist(&mut self, id: &str, songs: &[String]) -> Result<usize, String> {
        let playlist = self.playlist(id)?;
        let mut added = 0;
        for song in songs {
            if !playlist.song_ids.contains(song) {
                playlist.song_ids.push(song.clone());
                added += 1;
            }
        }
        Ok(added)
    }

    pub fn remove_from_playlist(&mut self, id: &str, songs: &[String]) -> Result<(), String> {
        self.playlist(id)?
            .song_ids
            .retain(|song| !songs.contains(song));
        Ok(())
    }

    /// Songs that no longer exist leave every playlist.
    pub fn forget_songs(&mut self, songs: &[String]) {
        for playlist in &mut self.playlists {
            playlist.song_ids.retain(|song| !songs.contains(song));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn my_workspace_always_exists_first_and_is_never_archived() {
        let dir = tempfile::tempdir().unwrap();
        let loaded = Collections::load(dir.path());
        assert_eq!(loaded.workspaces[0].id, DEFAULT_WORKSPACE);
        assert_eq!(loaded.workspaces[0].name, "My Workspace");

        let mut stored = Collections::default();
        stored.workspaces.push(Workspace {
            id: "rock".into(),
            name: "Rock".into(),
            created_ms: 1,
            archived: false,
        });
        stored.workspaces.push(Workspace {
            id: DEFAULT_WORKSPACE.into(),
            name: "Mine".into(),
            created_ms: 0,
            archived: true,
        });
        stored.save(dir.path()).unwrap();
        let loaded = Collections::load(dir.path());
        assert_eq!(loaded.workspaces[0].id, DEFAULT_WORKSPACE);
        assert!(!loaded.workspaces[0].archived);
        assert_eq!(loaded.workspaces[0].name, "Mine");
        let mut loaded = loaded;
        assert!(loaded.set_archived(DEFAULT_WORKSPACE, true).is_err());
    }

    #[test]
    fn workspace_names_are_cleaned_and_unique() {
        let mut c = Collections::default().normalized();
        let w = c
            .create_workspace("a".into(), "  Late   night  ", 5)
            .unwrap();
        assert_eq!(w.name, "Late night");
        assert!(c.create_workspace("b".into(), "late NIGHT", 6).is_err());
        assert!(c.create_workspace("c".into(), "   ", 6).is_err());
        assert!(c.create_workspace("d".into(), &"x".repeat(61), 6).is_err());
        assert!(c.rename_workspace("a", "My Workspace").is_err());
        c.rename_workspace("a", "Late night drives").unwrap();
        c.set_archived("a", true).unwrap();
        assert!(c.workspaces[1].archived);
        assert!(c.delete_workspace(DEFAULT_WORKSPACE).is_err());
        c.delete_workspace("a").unwrap();
        assert_eq!(c.workspaces.len(), 1);
        assert!(c.delete_workspace("a").is_err());
    }

    #[test]
    fn playlists_keep_order_skip_duplicates_and_forget_trashed_songs() {
        let mut c = Collections::default().normalized();
        let p = c.create_playlist("p".into(), "Road trip", 1).unwrap();
        let songs = ["s1".to_string(), "s2".to_string()];
        assert_eq!(c.add_to_playlist(&p.id, &songs).unwrap(), 2);
        assert_eq!(
            c.add_to_playlist(&p.id, &["s2".into(), "s3".into()])
                .unwrap(),
            1
        );
        assert_eq!(c.playlists[0].song_ids, ["s1", "s2", "s3"]);
        c.remove_from_playlist(&p.id, &["s1".into()]).unwrap();
        c.forget_songs(&["s3".into()]);
        assert_eq!(c.playlists[0].song_ids, ["s2"]);
        c.rename_playlist(&p.id, "Summer").unwrap();
        c.delete_playlist(&p.id).unwrap();
        assert!(c.playlists.is_empty());
        assert!(c.delete_playlist(&p.id).is_err());
    }

    #[test]
    fn a_damaged_file_still_yields_my_workspace() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join(FILE), b"{broken").unwrap();
        assert_eq!(Collections::load(dir.path()).workspaces.len(), 1);
    }
}
