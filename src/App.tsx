import { useCallback, useEffect, useState } from "react";
import {
  Check,
  ChevronRight,
  CircleHelp,
  Library,
  Link2,
  Play,
  Settings2,
  WandSparkles,
  X,
} from "lucide-react";
import SetupWizard from "./components/SetupWizard";
import Dialog from "./components/Dialog";
import PreparationBadge from "./components/PreparationBadge";
import SettingsDialog from "./components/SettingsDialog";
import Composer from "./components/Composer";
import LibraryPanel from "./components/LibraryPanel";
import CollectionsView from "./components/CollectionsView";
import PickerDialog from "./components/PickerDialog";
import SaveToMenu from "./components/SaveToMenu";
import SongDetail from "./components/SongDetail";
import type { SongActions } from "./components/SongMenu";
import DownloadDialog from "./components/DownloadDialog";
import Player, { usePlayer } from "./components/Player";
import { Brand } from "./components/Brand";
import { EMPTY_REQUEST, loadComposer, saveComposer } from "./lib/composer";
import { useLibrary, useMessage } from "./lib/useLibrary";
import {
  addToPlaylist,
  archiveWorkspace,
  cancelSong,
  createPlaylist,
  createWorkspace,
  creationStatus,
  DEFAULT_WORKSPACE,
  deletePlaylist,
  displayTitle,
  moveSongs,
  removeFromPlaylist,
  renamePlaylist,
  renameWorkspace,
  revealSong,
  trashSongs,
  updateSong,
  type CreationStatus,
  type Song,
  type SongRequest,
} from "./lib/songs";

type Page = "create" | "library";
type Modal = { kind: "settings" } | { kind: "agent" };
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
  const { message, undo, notify, dismiss } = useMessage();
  const { songs, collections, start, remove } = useLibrary(explored, notify);
  const [workspaceId, setWorkspaceId] = useState(() =>
    remembered("aulo.workspace.v1", DEFAULT_WORKSPACE),
  );
  const [saveTo, setSaveTo] = useState(workspaceId);
  const [browsing, setBrowsing] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [libraryTab, setLibraryTab] = useState<"songs" | "playlists">("songs");
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
    onPlaylist: (list) => setPicker({ kind: "playlist", songs: list }),
    onQueue: (list) => {
      player.enqueue(list);
      notify(`${titleOf(list)} will play next.`);
    },
    onMove: (list) => setPicker({ kind: "workspace", songs: list }),
    onTrash: (list) =>
      void trashSongs(list.map((s) => s.id)).then(
        (moved) => {
          remove(moved);
          if (openId && moved.includes(openId)) setOpenId(null);
          notify(`Moved ${titleOf(list)} to the Trash.`);
        },
        (error: unknown) =>
          notify(
            problem(error, "These songs could not be moved to the Trash."),
          ),
      ),
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

  let right;
  if (page === "create" && browsing)
    right = (
      <main className="library" aria-label="Workspaces">
        <header className="library-head">
          <nav className="crumbs">
            <span>Workspaces</span>
          </nav>
        </header>
        <CollectionsView
          kind="workspace"
          rows={workspaceRows}
          currentId={workspace.id}
          showArchived={showArchived}
          onToggleArchived={() => setShowArchived(!showArchived)}
          onOpen={openWorkspace}
          onCreate={async (name) => {
            const created = await createWorkspace(name);
            openWorkspace(created.id);
          }}
          onRename={(id, name) => renameWorkspace(id, name)}
          onArchive={(id, archived) =>
            void act(
              archiveWorkspace(id, archived).then(() => {
                if (archived && id === workspace.id)
                  openWorkspace(DEFAULT_WORKSPACE);
                notify(
                  archived ? "Workspace archived." : "Workspace restored.",
                );
              }),
              "The workspace could not be changed.",
            )
          }
        />
      </main>
    );
  else if (page === "create")
    right = (
      <LibraryPanel
        songs={songs.filter((s) => s.workspace === workspace.id)}
        viewKey={`workspace-${workspace.id}`}
        header={
          <nav className="crumbs" aria-label="Workspace">
            <button onClick={() => setBrowsing(true)}>Workspaces</button>
            <ChevronRight size={16} />
            <span>{workspace.name}</span>
          </nav>
        }
        emptyTitle={
          workspace.id === DEFAULT_WORKSPACE
            ? "Your songs will live here"
            : `${workspace.name} is empty`
        }
        emptyText={
          workspace.id === DEFAULT_WORKSPACE
            ? "Describe a sound, add your words, and press Create."
            : "Create a song here, or move songs in from another workspace."
        }
        actions={actions}
        list={listProps}
      />
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
  } else {
    const tabs = (
      <div className="tabs" role="tablist" aria-label="Library">
        {(["songs", "playlists"] as const).map((tab) => (
          <button
            key={tab}
            role="tab"
            aria-selected={libraryTab === tab}
            className={libraryTab === tab ? "selected" : ""}
            onClick={() => {
              setLibraryTab(tab);
              setPlaylistId(null);
            }}
          >
            {tab === "songs" ? "Songs" : "Playlists"}
          </button>
        ))}
      </div>
    );
    right =
      libraryTab === "songs" ? (
        <LibraryPanel
          songs={songs}
          viewKey="library"
          header={tabs}
          emptyTitle="Your songs will live here"
          emptyText="Every song you make appears in your library."
          emptyAction={createButton}
          actions={actions}
          list={listProps}
        />
      ) : (
        <main className="library" aria-label="Playlists">
          <header className="library-head">{tabs}</header>
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
            onDelete={(id) =>
              void act(
                deletePlaylist(id).then(() => notify("Playlist deleted.")),
                "The playlist could not be deleted.",
              )
            }
          />
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
            }}
          >
            <Library />
            Library
            {songs.length > 0 && <span className="count">{songs.length}</span>}
          </button>
        </nav>
        <div className="nav-bottom">
          <PreparationBadge onOpen={openSetup} />
          <button onClick={() => setModal({ kind: "agent" })}>
            <Link2 />
            AI connection
          </button>
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
        onFavorite={favorite}
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
        <SettingsDialog
          onClose={() => setModal(null)}
          onOpenSetup={openSetup}
          onError={(text) => notify(text)}
        />
      )}
      {modal?.kind === "agent" && (
        <Dialog onClose={() => setModal(null)}>
          <header>
            <span className="section-icon">
              <Link2 size={21} />
            </span>
            <button
              className="icon-button"
              aria-label="Close"
              onClick={() => setModal(null)}
            >
              <X size={18} />
            </button>
          </header>
          <h2 id="modal-title">Bring your AI assistant</h2>
          <p>
            Soon you’ll be able to connect an AI assistant you already use, so
            it can help write lyrics and shape songs with you in Aulo.
          </p>
          <div className="notice">
            <CircleHelp size={17} />
            <p>
              Nothing is connected yet, and Aulo doesn’t send your lyrics
              anywhere.
            </p>
          </div>
        </Dialog>
      )}
    </div>
  );
}
