import { useCallback, useEffect, useState } from "react";
import {
  Check,
  ChevronRight,
  Library,
  Play,
  Settings2,
  Trash2,
  WandSparkles,
  X,
} from "lucide-react";
import SetupWizard from "./components/SetupWizard";
import PreparationBadge from "./components/PreparationBadge";
import SettingsPanel from "./components/SettingsPanel";
import Composer from "./components/Composer";
import LibraryPanel from "./components/LibraryPanel";
import CollectionsView from "./components/CollectionsView";
import PickerDialog from "./components/PickerDialog";
import SaveToMenu from "./components/SaveToMenu";
import ConfirmDialog from "./components/ConfirmDialog";
import TrashView from "./components/TrashView";
import SongDetail from "./components/SongDetail";
import type { SongActions } from "./components/SongMenu";
import DownloadDialog from "./components/DownloadDialog";
import Player, { usePlayer } from "./components/Player";
import { Brand } from "./components/Brand";
import { EMPTY_REQUEST, loadComposer, saveComposer } from "./lib/composer";
import { useLibrary, useMessage } from "./lib/useLibrary";
import {
  DEFAULT_SETTINGS,
  getSettings,
  notifyInBackground,
  prepareNotifications,
  type Settings,
} from "./lib/settings";
import {
  addToPlaylist,
  archiveWorkspace,
  cancelSong,
  createPlaylist,
  createWorkspace,
  creationStatus,
  DEFAULT_WORKSPACE,
  deletePlaylist,
  deleteSongs,
  deleteWorkspace,
  displayTitle,
  moveSongs,
  removeFromPlaylist,
  renamePlaylist,
  renameWorkspace,
  revealSong,
  shareSong,
  trashSongs,
  updateSong,
  type CreationStatus,
  type Song,
  type SongRequest,
} from "./lib/songs";

type Page = "create" | "library";
type Modal = { kind: "settings" };
type LibraryTab = "songs" | "playlists" | "workspaces" | "history";
interface Confirmation {
  title: string;
  body: string;
  confirm: string;
  run: () => void;
}
type Picker =
  { kind: "playlist"; songs: Song[] } | { kind: "workspace"; songs: Song[] };

function remembered(key: string, fallback: string) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* a convenience only */
  }
}
const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function initialView() {
  try {
    return localStorage.getItem("aulo.explored.v1") === "true";
  } catch {
    return false;
  }
}
const problem = (error: unknown, fallback: string) =>
  typeof error === "string" && error.length < 200 ? error : fallback;

export default function App() {
  const [explored, setExplored] = useState(initialView);
  const [setupStep, setSetupStep] = useState(0);
  const [page, setPage] = useState<Page>("create");
  const [modal, setModal] = useState<Modal | null>(null);
  const [request, setRequest] = useState<SongRequest>(loadComposer);
  const [status, setStatus] = useState<CreationStatus | null>(null);
  const [creating, setCreating] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  useEffect(() => {
    getSettings().then(setSettings, () => undefined);
  }, []);
  // Settings opens with ⌘, on macOS and Ctrl+, elsewhere, as in other apps.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "," && (e.metaKey || e.ctrlKey) && explored) {
        e.preventDefault();
        setModal({ kind: "settings" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [explored]);
  const { message, undo, notify, dismiss } = useMessage();
  const {
    songs: allSongs,
    collections,
    start,
    remove,
  } = useLibrary(explored, notify, (notice) => {
    if (settings.notifyWhenDone) void notifyInBackground(notice);
  });
  // Songs in Aulo's Trash only appear in the Trash.
  const songs = allSongs.filter((s) => !s.trashedMs);
  const trashed = allSongs.filter((s) => s.trashedMs);
  const [workspaceId, setWorkspaceId] = useState(() =>
    remembered("aulo.workspace.v1", DEFAULT_WORKSPACE),
  );
  const [saveTo, setSaveTo] = useState(workspaceId);
  const [browsing, setBrowsing] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [libraryTab, setLibraryTab] = useState<LibraryTab>("songs");
  const [libraryWorkspace, setLibraryWorkspace] = useState<string | null>(null);
  const [showTrash, setShowTrash] = useState(false);
  const [confirming, setConfirming] = useState<Confirmation | null>(null);

  const [playlistId, setPlaylistId] = useState<string | null>(null);
  const [picker, setPicker] = useState<Picker | null>(null);
  const liveWorkspaces = collections.workspaces.filter((w) => !w.archived);
  const workspace =
    liveWorkspaces.find((w) => w.id === workspaceId) ?? liveWorkspaces[0];
  const saveToWorkspace =
    liveWorkspaces.find((w) => w.id === saveTo) ?? workspace;
  const playlist = collections.playlists.find((p) => p.id === playlistId);
  function openWorkspace(id: string) {
    setWorkspaceId(id);
    setSaveTo(id);
    remember("aulo.workspace.v1", id);
    setBrowsing(false);
  }
  const [openId, setOpenId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<Song | null>(null);
  const player = usePlayer(songs);

  const openSong = songs.find((s) => s.id === openId) ?? null;

  const refreshStatus = useCallback(() => {
    creationStatus().then(setStatus, () =>
      setStatus({
        ready: false,
        blocker: "engine",
        message:
          "Aulo could not check the music engine. Reopen Aulo to try again.",
      }),
    );
  }, []);

  useEffect(() => {
    if (!explored) return;
    refreshStatus();
    window.addEventListener("focus", refreshStatus);
    return () => window.removeEventListener("focus", refreshStatus);
  }, [explored, refreshStatus]);

  useEffect(() => saveComposer(request), [request]);

  function explore() {
    try {
      localStorage.setItem("aulo.explored.v1", "true");
    } catch {
      /* The session remains usable without persistence. */
    }
    setExplored(true);
  }
  function openSetup() {
    setSetupStep(2);
    setExplored(false);
  }
  async function create() {
    setCreating(true);
    void prepareNotifications(settings).catch(() => undefined);
    // A short, visible acknowledgement on the button, like a press.
    const settle = new Promise((resolve) => window.setTimeout(resolve, 700));
    try {
      await start(request, saveToWorkspace.id);
      setOpenId(null);
      if (saveToWorkspace.id !== workspace.id)
        notify(`Creating in ${saveToWorkspace.name}.`);
    } catch (error) {
      notify(problem(error, "This song could not be started."));
      refreshStatus();
    } finally {
      await settle;
      setCreating(false);
    }
  }
  const act = (action: Promise<void>, fallback: string) =>
    action.catch((error: unknown) => notify(problem(error, fallback)));

  if (!explored)
    return <SetupWizard onExplore={explore} initialStep={setupStep} />;

  const songsIn = (ids: string[]) =>
    ids
      .map((id) => songs.find((s) => s.id === id))
      .filter((s): s is Song => s !== undefined);
  // Songs by id, including those in the Trash.
  const anySongsIn = (ids: string[]) =>
    ids
      .map((id) => allSongs.find((s) => s.id === id))
      .filter((s): s is Song => s !== undefined);
  /** Take songs out of the Trash and say exactly what came back. */
  const restore = (list: Song[]) =>
    void trashSongs(
      list.map((s) => s.id),
      false,
    ).then(
      (back) => {
        const left = list.length - back.length;
        notify(
          left === 0
            ? `Restored ${titleOf(list)}.`
            : back.length === 0
              ? "These songs couldn’t be restored. Try again."
              : `Restored ${titleOf(anySongsIn(back))}. ${count(left, "song")} couldn’t be restored; try again.`,
        );
      },
      (error: unknown) =>
        notify(problem(error, "These songs could not be restored.")),
    );
  const titleOf = (list: Song[]) =>
    list.length === 1
      ? `“${displayTitle(list[0].request)}”`
      : count(list.length, "song");

  const actions: SongActions = {
    onAnotherVersion: (song) =>
      void start({ ...song.request }, song.workspace).then(
        () => notify("A new version is on its way."),
        (error: unknown) =>
          notify(problem(error, "A new version could not be started.")),
      ),
    onReuse: (song) => {
      setRequest(song.request);
      setSaveTo(song.workspace);
      setOpenId(null);
      setPage("create");
    },
    onRename: (song) => setRenaming(song.id),
    onDownload: (song) => setDownloading(song),
    onReveal: (song) =>
      void act(revealSong(song.id), "The song's folder could not be opened."),
    onShare: (song, from) => {
      const title = displayTitle(song.request);
      const box = from.getBoundingClientRect();
      // Preparing the copy is quick once, then instant; say so only if it lingers.
      let told = false;
      const slow = window.setTimeout(() => {
        told = true;
        notify(`Getting “${title}” ready to share…`);
      }, 600);
      return shareSong(song.id, title, {
        x: box.left,
        y: box.top,
        width: box.width,
        height: box.height,
      }).then(
        () => {
          window.clearTimeout(slow);
          if (told) dismiss();
        },
        (error: unknown) => {
          window.clearTimeout(slow);
          notify(problem(error, "Sharing could not be opened."));
        },
      );
    },
    onPlaylist: (list) => setPicker({ kind: "playlist", songs: list }),
    onQueue: (list) => {
      player.enqueue(list);
      notify(`${titleOf(list)} will play next.`);
    },
    onMove: (list) => setPicker({ kind: "workspace", songs: list }),
    onTrash: (list) =>
      setConfirming({
        title: `Move ${titleOf(list)} to the Trash?`,
        body: "You can restore songs from the Trash in your Library until you delete them.",
        confirm: "Move to Trash",
        run: () =>
          void trashSongs(list.map((s) => s.id)).then(
            (moved) => {
              if (openId && moved.includes(openId)) setOpenId(null);
              const left = list.length - moved.length;
              notify(
                left === 0
                  ? `Moved ${titleOf(list)} to the Trash.`
                  : `Moved ${titleOf(anySongsIn(moved))} to the Trash. ${count(left, "song")} couldn’t be moved; try again.`,
                moved.length ? () => restore(anySongsIn(moved)) : null,
              );
            },
            (error: unknown) =>
              notify(
                problem(error, "These songs could not be moved to the Trash."),
              ),
          ),
      }),
    onRemoveFromPlaylist: playlist
      ? (list) =>
          void act(
            removeFromPlaylist(
              playlist.id,
              list.map((s) => s.id),
            ),
            "The playlist could not be changed.",
          )
      : undefined,
  };
  const renamed = (song: Song, title: string | null) => {
    setRenaming(null);
    if (title)
      void act(
        updateSong(song.id, { title }),
        "The new title could not be saved.",
      );
  };
  const favorite = (song: Song) =>
    void act(
      updateSong(song.id, { favorite: !song.favorite }),
      "This change could not be saved.",
    );
  const listProps = {
    current: player.current?.id ?? null,
    playing: player.playing,
    progress: player.progress,
    renaming,
    onRenamed: renamed,
    onPlay: (song: Song) => player.toggle(song),
    onSeek: (song: Song, fraction: number) => player.seekTo(song, fraction),
    onOpen: (song: Song) => setOpenId(song.id),
    onFavorite: favorite,
    onCancel: (song: Song) =>
      void act(cancelSong(song.id), "This song could not be stopped."),
    onRetry: (song: Song) =>
      void start({ ...song.request }, song.workspace).catch((error: unknown) =>
        notify(problem(error, "This song could not be started.")),
      ),
  };
  const createButton = (
    <button className="secondary" onClick={() => setPage("create")}>
      Create a song
    </button>
  );
  const workspaceRows = collections.workspaces.map((w) => ({
    ...w,
    fixed: w.id === DEFAULT_WORKSPACE,
    songs: songs.filter((s) => s.workspace === w.id),
  }));

  const confirmDeleteWorkspace = (id: string) => {
    const target = collections.workspaces.find((w) => w.id === id);
    if (!target) return;
    const n = songs.filter((s) => s.workspace === id).length;
    setConfirming({
      title: `Delete ${target.name}?`,
      body: n
        ? `Its ${count(n, "song")} will move to My Workspace.`
        : "This workspace is empty.",
      confirm: "Delete workspace",
      run: () =>
        void act(
          deleteWorkspace(id).then(() => {
            if (id === workspace.id) openWorkspace(DEFAULT_WORKSPACE);
            if (id === libraryWorkspace) setLibraryWorkspace(null);
            notify(`Deleted ${target.name}.`);
          }),
          "The workspace could not be deleted.",
        ),
    });
  };
  const workspacesView = (onOpen: (id: string) => void, currentId?: string) => (
    <CollectionsView
      kind="workspace"
      rows={workspaceRows}
      currentId={currentId}
      showArchived={showArchived}
      onToggleArchived={() => setShowArchived(!showArchived)}
      onOpen={onOpen}
      onCreate={async (name) => {
        const created = await createWorkspace(name);
        onOpen(created.id);
      }}
      onRename={(id, name) => renameWorkspace(id, name)}
      onArchive={(id, archived) =>
        void act(
          archiveWorkspace(id, archived).then(() => {
            if (archived && id === workspace.id)
              openWorkspace(DEFAULT_WORKSPACE);
            notify(archived ? "Workspace archived." : "Workspace restored.");
          }),
          "The workspace could not be changed.",
        )
      }
      onDelete={confirmDeleteWorkspace}
    />
  );
  const workspacePanel = (
    target: (typeof collections.workspaces)[number],
    crumbs: React.ReactNode,
  ) => (
    <LibraryPanel
      songs={songs.filter((s) => s.workspace === target.id)}
      viewKey={`workspace-${target.id}`}
      header={crumbs}
      emptyTitle={
        target.id === DEFAULT_WORKSPACE
          ? "Your songs will live here"
          : `${target.name} is empty`
      }
      emptyText={
        target.id === DEFAULT_WORKSPACE
          ? "Describe a sound, add your words, and press Create."
          : "Create a song here, or move songs in from another workspace."
      }
      actions={actions}
      list={listProps}
    />
  );

  let right;
  if (page === "create" && browsing)
    right = (
      <main className="library" aria-label="Workspaces">
        <header className="library-head">
          <nav className="crumbs">
            <span>Workspaces</span>
          </nav>
        </header>
        {workspacesView(openWorkspace, workspace.id)}
      </main>
    );
  else if (page === "create")
    right = workspacePanel(
      workspace,
      <nav className="crumbs" aria-label="Workspace">
        <button onClick={() => setBrowsing(true)}>Workspaces</button>
        <ChevronRight size={16} />
        <span>{workspace.name}</span>
      </nav>,
    );
  else {
    const libraryHead = (
      <div className="library-title">
        <div className="library-title-row">
          <h1>{showTrash ? "Trash" : "Library"}</h1>
          <button
            className={`tool-pill${showTrash ? " selected" : ""}`}
            aria-pressed={showTrash}
            onClick={() => setShowTrash(!showTrash)}
          >
            <Trash2 size={15} />
            Trash{trashed.length > 0 && ` (${trashed.length})`}
          </button>
        </div>
        {!showTrash && (
          <div className="tabs" role="tablist" aria-label="Library">
            {(
              [
                ["songs", "Songs"],
                ["playlists", "Playlists"],
                ["workspaces", "Workspaces"],
                ["history", "History"],
              ] as [LibraryTab, string][]
            ).map(([tab, label]) => (
              <button
                key={tab}
                role="tab"
                aria-selected={libraryTab === tab}
                className={libraryTab === tab ? "selected" : ""}
                onClick={() => {
                  setLibraryTab(tab);
                  setPlaylistId(null);
                  setLibraryWorkspace(null);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
    );
    const shownWorkspace = collections.workspaces.find(
      (w) => w.id === libraryWorkspace,
    );
    if (showTrash)
      right = (
        <main className="library" aria-label="Trash">
          <header className="library-head">{libraryHead}</header>
          <TrashView
            songs={trashed}
            onRestore={restore}
            onDelete={(list) =>
              setConfirming({
                title: `Delete ${titleOf(list)} for good?`,
                body: "They will be removed from Aulo. This can’t be undone in Aulo.",
                confirm: "Delete",
                run: () =>
                  void act(
                    deleteSongs(list.map((s) => s.id)).then((gone) => {
                      // Only what really went leaves the Trash view.
                      remove(gone);
                      const left = list.length - gone.length;
                      notify(
                        left === 0
                          ? `Deleted ${titleOf(list)}.`
                          : gone.length === 0
                            ? "These songs couldn’t be deleted. Try again."
                            : `Deleted ${titleOf(anySongsIn(gone))}. ${count(left, "song")} couldn’t be deleted; try again.`,
                      );
                    }),
                    "Some songs could not be deleted.",
                  ),
              })
            }
          />
        </main>
      );
    else if (libraryTab === "playlists" && playlist) {
      const inPlaylist = songsIn(playlist.songIds);
      const playable = inPlaylist.filter(
        (s) => s.state === "completed" && s.audioPath,
      );
      right = (
        <LibraryPanel
          songs={inPlaylist}
          viewKey={`playlist-${playlist.id}`}
          header={
            <>
              <nav className="crumbs" aria-label="Playlist">
                <button onClick={() => setPlaylistId(null)}>Playlists</button>
                <ChevronRight size={16} />
                <span>{playlist.name}</span>
              </nav>
              <button
                className="primary small"
                disabled={!playable.length}
                onClick={() => player.playAll(playable)}
              >
                <Play size={15} fill="currentColor" /> Play all
              </button>
            </>
          }
          emptyTitle="This playlist is empty"
          emptyText="Choose “Add to playlist” on any song to add it here."
          actions={actions}
          list={listProps}
        />
      );
    } else if (libraryTab === "workspaces" && shownWorkspace)
      right = workspacePanel(
        shownWorkspace,
        <nav className="crumbs" aria-label="Workspace">
          <button onClick={() => setLibraryWorkspace(null)}>Workspaces</button>
          <ChevronRight size={16} />
          <span>{shownWorkspace.name}</span>
        </nav>,
      );
    else if (libraryTab === "songs" || libraryTab === "history")
      right = (
        <LibraryPanel
          songs={
            libraryTab === "songs"
              ? songs
              : // Every song made, newest first, including ones that didn't finish.
                [...songs].sort((a, b) => b.createdMs - a.createdMs)
          }
          viewKey={libraryTab === "songs" ? "library" : "history"}
          header={libraryHead}
          ordered={libraryTab === "history"}
          emptyTitle={
            libraryTab === "songs"
              ? "Your songs will live here"
              : "Nothing created yet"
          }
          emptyText={
            libraryTab === "songs"
              ? "Every song you make appears in your library."
              : "Every song you create shows up here, newest first."
          }
          emptyAction={libraryTab === "songs" ? createButton : undefined}
          actions={actions}
          list={listProps}
        />
      );
    else
      right = (
        <main className="library" aria-label={libraryTab}>
          <header className="library-head">{libraryHead}</header>
          {libraryTab === "workspaces" ? (
            workspacesView(setLibraryWorkspace)
          ) : (
            <CollectionsView
              kind="playlist"
              rows={collections.playlists.map((p) => ({
                ...p,
                songs: songsIn(p.songIds),
              }))}
              onOpen={setPlaylistId}
              onCreate={async (name) => {
                const created = await createPlaylist(name, []);
                setPlaylistId(created.id);
              }}
              onRename={(id, name) => renamePlaylist(id, name)}
              onDelete={(id) => {
                const target = collections.playlists.find((p) => p.id === id);
                setConfirming({
                  title: `Delete ${target?.name ?? "this playlist"}?`,
                  body: "The songs stay in your library.",
                  confirm: "Delete playlist",
                  run: () =>
                    void act(
                      deletePlaylist(id).then(() =>
                        notify("Playlist deleted."),
                      ),
                      "The playlist could not be deleted.",
                    ),
                });
              }}
            />
          )}
        </main>
      );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <nav aria-label="Main navigation">
          <button
            className={page === "create" ? "active" : ""}
            aria-current={page === "create" ? "page" : undefined}
            onClick={() => {
              setPage("create");
              setOpenId(null);
              setBrowsing(false);
            }}
          >
            <WandSparkles />
            Create
          </button>
          <button
            className={page === "library" ? "active" : ""}
            aria-current={page === "library" ? "page" : undefined}
            onClick={() => {
              setPage("library");
              setOpenId(null);
              setShowTrash(false);
            }}
          >
            <Library />
            Library
            {songs.length > 0 && <span className="count">{songs.length}</span>}
          </button>
        </nav>
        <div className="nav-bottom">
          <PreparationBadge onOpen={openSetup} />
          <button onClick={() => setModal({ kind: "settings" })}>
            <Settings2 />
            Settings
          </button>
        </div>
      </aside>
      <div className={`workspace ${openSong ? "detail" : page}`}>
        {openSong ? (
          <SongDetail
            song={openSong}
            playing={player.playing}
            current={player.current?.id === openSong.id}
            renaming={renaming === openSong.id}
            onRenamed={renamed}
            onBack={() => setOpenId(null)}
            onPlay={(song) => player.toggle(song)}
            onFavorite={favorite}
            actions={actions}
          />
        ) : (
          page === "create" && (
            <Composer
              request={request}
              onChange={setRequest}
              status={status}
              creating={creating}
              onCreate={() => void create()}
              onOpenSetup={openSetup}
              saveTo={
                <SaveToMenu
                  options={liveWorkspaces.map((w) => ({
                    id: w.id,
                    name: w.name,
                    songs: songs.filter((s) => s.workspace === w.id).length,
                  }))}
                  selected={saveToWorkspace.id}
                  onSelect={setSaveTo}
                  onCreate={async (name) => {
                    const created = await createWorkspace(name);
                    setSaveTo(created.id);
                  }}
                />
              }
              onClear={() => {
                const previous = request;
                setRequest(EMPTY_REQUEST);
                notify("Cleared.", () => setRequest(previous));
              }}
            />
          )
        )}
        {!openSong && right}
      </div>
      <Player
        player={player}
        actions={actions}
        onOpen={(song) => setOpenId(song.id)}
      />
      {message && (
        <div className="toast" role="status">
          <Check size={17} />
          <span>{message}</span>
          {undo && (
            <button
              className="toast-action"
              onClick={() => {
                undo();
                dismiss();
              }}
            >
              Undo
            </button>
          )}
          <button
            className="icon-button"
            aria-label="Dismiss message"
            onClick={dismiss}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {confirming && (
        <ConfirmDialog
          title={confirming.title}
          body={confirming.body}
          confirm={confirming.confirm}
          onConfirm={confirming.run}
          onClose={() => setConfirming(null)}
        />
      )}
      {picker && (
        <PickerDialog
          title={
            picker.kind === "playlist"
              ? `Add ${titleOf(picker.songs)} to a playlist`
              : `Move ${titleOf(picker.songs)} to a workspace`
          }
          newLabel={
            picker.kind === "playlist" ? "New playlist" : "New workspace"
          }
          items={
            picker.kind === "playlist"
              ? collections.playlists.map((p) => ({
                  id: p.id,
                  name: p.name,
                  detail: count(p.songIds.length, "song"),
                }))
              : liveWorkspaces.map((w) => ({
                  id: w.id,
                  name: w.name,
                  detail: count(
                    songs.filter((s) => s.workspace === w.id).length,
                    "song",
                  ),
                  current: picker.songs.every((s) => s.workspace === w.id),
                }))
          }
          onClose={() => setPicker(null)}
          onPick={(id) => {
            const current = picker;
            setPicker(null);
            const ids = current.songs.map((s) => s.id);
            const name =
              current.kind === "playlist"
                ? collections.playlists.find((p) => p.id === id)?.name
                : liveWorkspaces.find((w) => w.id === id)?.name;
            void act(
              (current.kind === "playlist"
                ? addToPlaylist(id, ids).then(() => undefined)
                : moveSongs(ids, id)
              ).then(() =>
                notify(
                  current.kind === "playlist"
                    ? `Added ${titleOf(current.songs)} to ${name}.`
                    : `Moved ${titleOf(current.songs)} to ${name}.`,
                ),
              ),
              "That change could not be saved.",
            );
          }}
          onCreate={async (name) => {
            const current = picker;
            if (current.kind === "playlist") {
              await createPlaylist(
                name,
                current.songs.map((s) => s.id),
              );
              notify(`Added ${titleOf(current.songs)} to ${name.trim()}.`);
            } else {
              const created = await createWorkspace(name);
              await moveSongs(
                current.songs.map((s) => s.id),
                created.id,
              );
              notify(`Moved ${titleOf(current.songs)} to ${created.name}.`);
            }
            setPicker(null);
          }}
        />
      )}
      {downloading && (
        <DownloadDialog
          song={downloading}
          onClose={() => setDownloading(null)}
          onDone={(text) => {
            setDownloading(null);
            notify(text);
          }}
        />
      )}
      {modal?.kind === "settings" && (
        <SettingsPanel
          songs={allSongs}
          onClose={() => setModal(null)}
          onDeleted={remove}
          onSettingsChanged={setSettings}
          notify={notify}
        />
      )}
    </div>
  );
}
