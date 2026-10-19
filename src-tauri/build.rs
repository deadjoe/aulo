use std::path::Path;
use std::process::Command;

/// One line of `git` output, or nothing when git or the repository is not there (a
/// source archive, for example).
fn git(args: &[&str]) -> Option<String> {
    let out = Command::new("git").args(args).output().ok()?;
    out.status
        .success()
        .then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// Records which commit Aulo is built from, so the About panels and problem reports
/// can name it: `AULO_COMMIT` (short hash, may be empty), `AULO_MODIFIED` (uncommitted
/// changes to tracked files) and `AULO_RELEASE` (the commit carries this version's tag).
fn record_build() {
    let version = std::env::var("CARGO_PKG_VERSION").unwrap_or_default();
    let commit = git(&["rev-parse", "--short=7", "HEAD"]).unwrap_or_default();
    let modified = git(&["status", "--porcelain", "--untracked-files=no"])
        .is_some_and(|changes| !changes.is_empty());
    let tag = format!("v{version}");
    let tagged = git(&["tag", "--points-at", "HEAD"])
        .is_some_and(|tags| tags.lines().any(|t| t == tag))
        || std::env::var("GITHUB_REF").is_ok_and(|r| r == format!("refs/tags/{tag}"));
    println!("cargo:rustc-env=AULO_COMMIT={commit}");
    println!("cargo:rustc-env=AULO_MODIFIED={modified}");
    println!("cargo:rustc-env=AULO_RELEASE={}", tagged && !modified);

    // Build again when the commit or the tags change. Uncommitted edits are noticed on
    // the next such change; release builds come from a fresh checkout anyway.
    println!("cargo:rerun-if-env-changed=GITHUB_REF");
    if let Some(dir) = git(&["rev-parse", "--absolute-git-dir"]) {
        let dir = Path::new(&dir);
        let mut watched = vec![
            dir.join("HEAD"),
            dir.join("packed-refs"),
            dir.join("refs/tags"),
        ];
        if let Some(branch) = git(&["symbolic-ref", "-q", "HEAD"]) {
            watched.push(dir.join(branch));
        }
        for path in watched.into_iter().filter(|p| p.exists()) {
            println!("cargo:rerun-if-changed={}", path.display());
        }
    }
}

fn main() {
    record_build();
    tauri_build::build()
}
