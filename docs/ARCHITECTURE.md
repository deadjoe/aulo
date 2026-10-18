# Architecture

## Current foundation

```text
React interface
  Setup guide / create panel / library / player / settings
        |
        +-- Tauri commands: hardware inspection / model preparation / engine probe
        +-- Song service: queue / progress events / works / cancel
        |       +-- Private Python bridge -- installed GROOVE adapter
        +-- Asset protocol: library/*/audio.flac (playback only)
        +-- Native dialog: user-selected folder

Future integration boundary
  Desktop interface      Agent adapter
         |                    |
         +-- Local application service --+
             jobs / events / works        |
                              YUE2 // GROOVE
                              YuE2 / GGUF
```

`src/lib/songs.ts` is the UI's contract with the native song service, and `src/lib/core.ts` covers engine inspection. The service runs one song at a time through the private bridge and emits `song-updated` events. Runtime distribution is not implemented. See [engine integration](ENGINE.md).

`src/lib/hardware.ts` separates native observations from provisional eligibility. Native inspection performs no downloads, model loading, or environment modification. On Windows, `nvidia-smi` has a five-second timeout; memory from multiple devices is never summed. Failure to detect a GPU means unknown rather than a CPU fallback.

Works are stored in an application-owned library with atomic record writes and startup reconciliation. Backup and migration policies remain future work.

## Organising songs

Each song belongs to one workspace (My Workspace by default, chosen with Save to when creating) and can appear in any number of playlists. Workspaces and playlists live in `<app-data>/library/collections.json`, replaced atomically; `src-tauri/src/collections.rs` owns the rules (My Workspace always exists and is never archived, names are cleaned and unique among workspaces, playlists skip duplicates and drop songs that go to the Trash). Lists share one panel (`LibraryPanel`) with search, filters, sort, List/Waveform/Grid layouts, multi-select with Shift ranges, and batch actions with shortcuts (⌘P playlist, ⌘U queue, ⌘S workspace, ⌘⌫ Trash). Deleting asks first everywhere. Move to Trash puts songs in Aulo's own Trash (a `trashedMs` mark on the record), from where they can be restored or deleted; deleting sends the song folder to the system trash. Deleting a workspace moves its songs to My Workspace. The Library has Songs, Playlists, Workspaces and History (every song created, newest first, including unfinished ones) tabs and a Trash view. The player offers a queue panel (queued songs first, then the library order), the song menu, and a vertical volume control with mute. Waveform peaks are computed natively from the FLAC once, streaming through the file without holding the song in memory and at most two songs at a time, and cached beside it as `waveform.json`; the interface asks only for songs scrolled into view.

## Model preparation

`src-tauri/src/models.rs` owns the pinned catalog, downloads, checksums, and saved locations. UI components use typed commands in `src/lib/models.ts`; they never receive an arbitrary URL-download primitive. Network transfers run on a worker thread. An in-process guard and an OS file lock prevent concurrent preparation of shared storage.

Managed files use `.part` staging and SHA-256 verification before promotion. The downloader accepts a valid matching HTTP range or safely restarts on a full response. Bounded requests and retries allow pause and offline recovery; pausing a pending request can take up to its 30-second timeout. Saved locations are atomically replaced. On restart, a saved success becomes unverified, not ready. User-selected files are only read and hashed.

The model manifest targets the existing core version but does not prove packaged-runtime compatibility. Its hashes cover source checkpoints, tokenizer, configuration, and model notices. It does not install Python or execute model repository code. A separate runtime package and smoke test are required before enabling generation.

## Core integration

Use the existing UI-independent `yue2_groove.adapter` through Aulo's thin process bridge. The Gradio runtime includes UI-facing errors and process-global task state and is not imported. No GROOVE changes are required for the initial adapter path. Aulo must not depend on Gradio routes or duplicate inference logic.

The future service owns model lifetime, a single GPU job queue, cancellation, progress, and artifact persistence. UI and agent clients share that service so they cannot independently load duplicate models or bypass the queue. Long operations return job identifiers; clients inspect events/status without holding a single blocking tool call open.

Use a pinned engine version and a versioned capability handshake. The service reports readiness only after runtime/model validation. Hardware recommendations alone cannot grant readiness.

## Desktop lifecycle and distribution

The Tauri host will own the child process lifecycle and recover from crashes. The packaged runtime must not depend on users having Python, Git, or build tools. macOS and Windows need separate tested artifacts. Application, runtime, and model versions may download independently but must obey a tested compatibility manifest.

Do not update a loaded engine while a job is running. Keep the previous working runtime until the replacement passes health checks. Store models and works outside the application bundle. Signing, update verification, and rollback remain future implementation work.

## Settings

`SettingsPanel` has five sections: Creating, Storage, Music models, AI assistant and Help & About. Choices are saved to `<app-data>/settings.json` (`src-tauri/src/settings.rs`) and applied at once: "Between songs" sets whether the engine is unloaded 10 minutes after the last song or kept until Aulo quits, and "Free up memory now" unloads it when no song is being made. Songs that have been in Aulo's Trash longer than the chosen period are deleted when the library loads and when the setting changes, the same way as deleting by hand. Removing the music models deletes only Aulo's own `models` folder and its record; a folder the person chose is left untouched. The problem report (`src-tauri/src/support.rs`) holds versions, the computer's specification, model and engine state, song counts and the end of the engine log, with every line of lyrics, styles and titles removed. A system notification is shown when a song finishes or fails while Aulo is in the background.

## AI agent connection

Reserved as an independent integration. A later settings flow may connect an existing compatible local agent through MCP or a CLI adapter. It must use the same job and work contracts as the UI and explicitly disclose any external data transfer. This preview reads no agent configuration and makes no agent requests.

## Visual direction

A night studio: warm graphite surfaces, a peach-to-coral gradient reserved for the things people press, and generated cover art as the one expressive element. Covers are drawn on the computer (`src/lib/cover.ts`): the style picks one of nine compositions and its colours (a synthwave grid for electronic music, hills for folk, mist for lo-fi, a record for jazz and soul, shards for rock, confetti for pop, mountains for cinematic, a sunburst for tropical, blocks for hip hop), and the song id varies the rest, so a song always has the same cover. Downloads (MP3, M4A, FLAC) and shared files carry the song title and the cover as a PNG; WAV stays plain. Display type is Bricolage Grotesque and interface type is Figtree, both SIL Open Font License fonts bundled with the app (no network fonts). Colours, type and controls live as tokens at the top of `src/styles.css`.

The layout follows Suno's logged-in Create page (navigation, create panel, library, bottom player) while excluding social feeds, credits, subscriptions, and public sharing. The first-run guide uses the same surfaces and a cover-art hero. Copy is written for people with no technical background: no model, engine, file or version names appear in normal use, and every error says what to do next.

The workspace starts honestly empty, with no seeded songs or simulated progress. The title bar stays native. Below 1100 px the navigation collapses to icons; below 1000 px the first-run hero is hidden; below 820 px the create panel stacks above the library. Dialogs trap focus, Escape closes them, and reduced motion is respected.
