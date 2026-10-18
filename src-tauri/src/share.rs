//! Share a finished song through the operating system's own share sheet, the
//! way a file is shared from Finder or File Explorer. Aulo prepares a copy in a
//! format every phone and chat app plays, named after the song, and hands it to
//! the system: AirDrop, Messages, Mail and installed apps on macOS; Nearby
//! Sharing, Mail and installed apps on Windows.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Deserialize;
use tauri::Manager;

use crate::audio::Tags;
use crate::songs::{export_audio, finished_audio, AudioFormat, SongService};

/// Where the share sheet points from, in the page's CSS pixels.
#[derive(Clone, Copy, Debug, Deserialize)]
pub struct Anchor {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// M4A plays everywhere Apple devices go; Windows has no AAC encoder Aulo may
/// rely on, so it shares MP3, which every device plays.
const SHARE_FORMAT: AudioFormat = if cfg!(target_os = "macos") {
    AudioFormat::M4a
} else {
    AudioFormat::Mp3
};

/// A file name people will see when the song arrives: the song's title.
pub fn file_name(title: &str, extension: &str) -> String {
    let clean: String = title
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => ' ',
            c if c.is_control() => ' ',
            c => c,
        })
        .collect();
    let clean = clean.split_whitespace().collect::<Vec<_>>().join(" ");
    let clean = clean.trim_matches('.').trim();
    let stem: String = if clean.is_empty() {
        "Aulo song".into()
    } else {
        clean.chars().take(80).collect()
    };
    format!("{}.{extension}", stem.trim())
}

/// Marks a shared copy made with its title and cover written in.
const TAGGED: &str = ".tagged";

/// Prepare the shared copy, reusing it while the song and its name are unchanged.
/// Only the most recently shared song is kept.
pub fn prepare(
    root: &Path,
    id: &str,
    source: &Path,
    name: &str,
    tags: &Tags,
) -> Result<PathBuf, String> {
    let folder = root.join(id);
    let target = folder.join(name);
    let fresh = match (fs::metadata(&target), fs::metadata(source)) {
        (Ok(copy), Ok(original)) => {
            copy.len() > 0
                && copy.modified().ok() >= original.modified().ok()
                && folder.join(TAGGED).exists()
        }
        _ => false,
    };
    if let Ok(entries) = fs::read_dir(root) {
        for entry in entries.flatten() {
            if entry.file_name() != id {
                let _ = fs::remove_dir_all(entry.path());
            }
        }
    }
    if fresh {
        return Ok(target);
    }
    let _ = fs::remove_dir_all(&folder);
    fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    export_audio(source, SHARE_FORMAT, &target, tags)?;
    let _ = fs::write(folder.join(TAGGED), b"");
    Ok(target)
}

#[tauri::command]
pub async fn share_song(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    service: tauri::State<'_, SongService>,
    id: String,
    title: String,
    anchor: Anchor,
    cover: Option<Vec<u8>>,
) -> Result<(), String> {
    let source = finished_audio(&app, &service, &id)?;
    let tags = Tags {
        title: title.clone(),
        cover: cover.filter(|png| crate::audio::valid_cover(png)),
    };
    let root = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("share");
    let name = file_name(&title, SHARE_FORMAT.extension());
    let path =
        tauri::async_runtime::spawn_blocking(move || prepare(&root, &id, &source, &name, &tags))
            .await
            .map_err(|e| e.to_string())?
            .map_err(|_| "The song could not be prepared for sharing.".to_string())?;
    present(&app, window, path, title, anchor)
}

#[cfg(target_os = "macos")]
fn present(
    app: &tauri::AppHandle,
    window: tauri::WebviewWindow,
    path: PathBuf,
    _title: String,
    anchor: Anchor,
) -> Result<(), String> {
    use std::cell::RefCell;

    use objc2::rc::Retained;
    use objc2::AnyThread;
    use objc2_app_kit::{NSSharingServicePicker, NSView};
    use objc2_foundation::{NSArray, NSPoint, NSRect, NSRectEdge, NSSize, NSString, NSURL};

    thread_local! {
        // The picker must outlive the call that shows it.
        static PICKER: RefCell<Option<Retained<NSSharingServicePicker>>> = const { RefCell::new(None) };
    }

    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let shown = (|| {
            let view = window.ns_view().map_err(|e| e.to_string())?;
            // SAFETY: Tauri hands back the window's live web view, and we are on the main thread.
            let view: &NSView = unsafe { &*view.cast::<NSView>() };
            let url = NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()));
            let items = NSArray::from_retained_slice(&[Retained::into_super(url)]);
            // SAFETY: the items are file URLs, which the share picker accepts.
            let picker = unsafe {
                NSSharingServicePicker::initWithItems(
                    NSSharingServicePicker::alloc(),
                    Retained::cast_unchecked::<NSArray>(items).as_ref(),
                )
            };
            let bounds = view.bounds();
            let y = if view.isFlipped() {
                anchor.y
            } else {
                bounds.size.height - anchor.y - anchor.height
            };
            let rect = NSRect::new(
                NSPoint::new(anchor.x, y),
                NSSize::new(anchor.width.max(1.0), anchor.height.max(1.0)),
            );
            picker.showRelativeToRect_ofView_preferredEdge(rect, view, NSRectEdge::MaxY);
            PICKER.with(|slot| *slot.borrow_mut() = Some(picker));
            Ok(())
        })();
        let _ = tx.send(shown);
    })
    .map_err(|e| e.to_string())?;
    rx.recv()
        .map_err(|e| e.to_string())?
        .map_err(|_: String| "Sharing could not be opened.".into())
}

#[cfg(target_os = "windows")]
fn present(
    app: &tauri::AppHandle,
    window: tauri::WebviewWindow,
    path: PathBuf,
    title: String,
    _anchor: Anchor,
) -> Result<(), String> {
    use std::cell::RefCell;

    use windows::core::{factory, AgileReference, Interface, HSTRING};
    use windows::ApplicationModel::DataTransfer::{DataRequestedEventArgs, DataTransferManager};
    use windows::Foundation::TypedEventHandler;
    use windows::Storage::{IStorageItem, StorageFile};
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::Shell::IDataTransferManagerInterop;

    thread_local! {
        // One share request handler per window at a time.
        static HANDLER: RefCell<Option<(DataTransferManager, i64)>> = const { RefCell::new(None) };
    }

    let failed = |_| "Sharing could not be opened.".to_string();
    let item = StorageFile::GetFileFromPathAsync(&HSTRING::from(path.as_path()))
        .and_then(|op| op.join())
        .and_then(|file| file.cast::<IStorageItem>())
        .and_then(|item| AgileReference::new(&item))
        .map_err(failed)?;
    let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let shown = (|| -> windows::core::Result<()> {
            let hwnd = HWND(hwnd as *mut core::ffi::c_void);
            let interop = factory::<DataTransferManager, IDataTransferManagerInterop>()?;
            // SAFETY: the window handle belongs to Aulo's live main window.
            let manager: DataTransferManager = unsafe { interop.GetForWindow(hwnd)? };
            HANDLER.with(|slot| {
                if let Some((old, token)) = slot.borrow_mut().take() {
                    let _ = old.RemoveDataRequested(token);
                }
            });
            let token = manager.DataRequested(&TypedEventHandler::new(
                move |_, args: windows::core::Ref<DataRequestedEventArgs>| {
                    if let Some(args) = args.as_ref() {
                        let data = args.Request()?.Data()?;
                        data.Properties()?
                            .SetTitle(&HSTRING::from(title.as_str()))?;
                        let items: windows_collections::IIterable<IStorageItem> =
                            vec![Some(item.resolve()?)].into();
                        data.SetStorageItemsReadOnly(&items)?;
                    }
                    Ok(())
                },
            ))?;
            HANDLER.with(|slot| *slot.borrow_mut() = Some((manager, token)));
            // SAFETY: as above.
            unsafe { interop.ShowShareUIForWindow(hwnd) }
        })();
        let _ = tx.send(shown);
    })
    .map_err(|e| e.to_string())?;
    rx.recv().map_err(|e| e.to_string())?.map_err(failed)
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn present(
    _app: &tauri::AppHandle,
    _window: tauri::WebviewWindow,
    path: PathBuf,
    _title: String,
    _anchor: Anchor,
) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    _app.opener()
        .reveal_item_in_dir(path)
        .map_err(|_| "Sharing could not be opened.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_names_are_the_song_title_and_safe_everywhere() {
        assert_eq!(file_name("Night Drive", "m4a"), "Night Drive.m4a");
        assert_eq!(file_name("AC/DC: \"Live\"?", "mp3"), "AC DC Live.mp3");
        assert_eq!(file_name("  ...  ", "mp3"), "Aulo song.mp3");
        assert_eq!(file_name("城市 夜晚", "m4a"), "城市 夜晚.m4a");
        assert!(file_name(&"x".repeat(300), "mp3").len() <= 84);
    }

    #[test]
    fn prepared_copies_are_reused_and_only_the_latest_is_kept() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("share");
        let source = dir.path().join("audio.flac");
        fs::write(&source, b"fLaC").unwrap();
        fs::create_dir_all(root.join("old")).unwrap();
        fs::write(root.join("old").join("Old.m4a"), b"x").unwrap();
        let folder = root.join("song");
        fs::create_dir_all(&folder).unwrap();
        fs::write(folder.join("Song.m4a"), b"ready").unwrap();
        fs::write(folder.join(TAGGED), b"").unwrap();
        let path = prepare(&root, "song", &source, "Song.m4a", &Tags::default()).unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"ready");
        assert!(!root.join("old").exists());
    }
}
