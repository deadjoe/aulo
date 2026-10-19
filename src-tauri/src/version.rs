//! Which Aulo this is: the release number and the commit it was built from, shown the
//! same way in the app menu's About panel, Settings › Help & About and problem reports.

/// The release number, such as "0.8.0" (the one the installers carry).
pub const NUMBER: &str = env!("CARGO_PKG_VERSION");
/// The commit's short hash, or empty when the build had no git repository.
pub const COMMIT: &str = env!("AULO_COMMIT");
const MODIFIED: &str = env!("AULO_MODIFIED");
const RELEASE: &str = env!("AULO_RELEASE");

/// The number as people see it: "0.8.0" for a release built from its version tag,
/// "0.8.0-dev" for every other build.
pub fn number() -> String {
    label(NUMBER, RELEASE == "true")
}

/// What follows the number in parentheses: "7db2b63", or "7db2b63, modified" when the
/// build had uncommitted changes. None without a commit.
pub fn build() -> Option<String> {
    detail(COMMIT, MODIFIED == "true")
}

/// The whole version, such as "0.8.0 (7db2b63)".
pub fn display() -> String {
    full(&number(), build().as_deref())
}

fn label(number: &str, release: bool) -> String {
    if release {
        number.to_string()
    } else {
        format!("{number}-dev")
    }
}

fn detail(commit: &str, modified: bool) -> Option<String> {
    match (commit.is_empty(), modified) {
        (true, _) => None,
        (false, false) => Some(commit.to_string()),
        (false, true) => Some(format!("{commit}, modified")),
    }
}

fn full(number: &str, build: Option<&str>) -> String {
    match build {
        Some(build) => format!("{number} ({build})"),
        None => number.to_string(),
    }
}

#[tauri::command]
pub fn app_version() -> String {
    display()
}

/// The standard menus, with an About panel that names the build:
/// "Version 0.8.0 (7db2b63)".
#[cfg(target_os = "macos")]
pub fn menu<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<tauri::menu::Menu<R>> {
    use tauri::menu::{AboutMetadata, MenuItemKind, PredefinedMenuItem};
    let menu = tauri::menu::Menu::default(app)?;
    if let Some(MenuItemKind::Submenu(app_menu)) = menu.items()?.into_iter().next() {
        let about = AboutMetadata {
            name: Some(app.package_info().name.clone()),
            // macOS shows `version` after "Version" and `short_version` in parentheses.
            version: Some(number()),
            short_version: build(),
            ..Default::default()
        };
        app_menu.remove_at(0)?;
        app_menu.insert(&PredefinedMenuItem::about(app, None, Some(about))?, 0)?;
    }
    Ok(menu)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_release_shows_its_number_and_commit() {
        assert_eq!(
            full(&label("0.8.0", true), detail("7db2b63", false).as_deref()),
            "0.8.0 (7db2b63)"
        );
    }

    #[test]
    fn other_builds_say_they_are_not_a_release() {
        assert_eq!(
            full(&label("0.8.0", false), detail("7db2b63", true).as_deref()),
            "0.8.0-dev (7db2b63, modified)"
        );
        assert_eq!(
            full(&label("0.8.0", false), detail("", false).as_deref()),
            "0.8.0-dev"
        );
    }

    #[test]
    fn this_build_names_its_commit() {
        assert!(display().starts_with(NUMBER));
        if !COMMIT.is_empty() {
            assert!(display().contains(COMMIT));
        }
    }
}
