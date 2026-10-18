import { useCallback, useEffect, useState } from "react";
import {
  Check,
  CircleHelp,
  Library,
  Link2,
  Settings2,
  WandSparkles,
  X,
} from "lucide-react";
import SetupWizard from "./components/SetupWizard";
import Dialog from "./components/Dialog";
import PreparationBadge from "./components/PreparationBadge";
import SettingsDialog from "./components/SettingsDialog";
import Composer from "./components/Composer";
import SongList from "./components/SongList";
import SongDetail from "./components/SongDetail";
import type { SongActions } from "./components/SongMenu";
import DownloadDialog from "./components/DownloadDialog";
import Player, { usePlayer } from "./components/Player";
import { Brand } from "./components/Brand";
import { EMPTY_REQUEST, loadComposer, saveComposer } from "./lib/composer";
import { useLibrary, useMessage } from "./lib/useLibrary";
import {
  cancelSong,
  creationStatus,
  displayTitle,
  revealSong,
  trashSong,
  updateSong,
  type CreationStatus,
  type Song,
  type SongRequest,
} from "./lib/songs";

type Page = "create" | "library";
type Modal = { kind: "settings" } | { kind: "agent" };

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
  const { songs, start, remove } = useLibrary(explored, notify);
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
      await start(request);
      setOpenId(null);
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

  const actions: SongActions = {
    onAnotherVersion: (song) =>
      void start({ ...song.request }).then(
        () => notify("A new version is on its way."),
        (error: unknown) =>
          notify(problem(error, "A new version could not be started.")),
      ),
    onReuse: (song) => {
      setRequest(song.request);
      setOpenId(null);
      setPage("create");
    },
    onRename: (song) => setRenaming(song.id),
    onDownload: (song) => setDownloading(song),
    onReveal: (song) =>
      void act(revealSong(song.id), "The song's folder could not be opened."),
    onQueue: (song) => {
      player.enqueue(song);
      notify(`“${displayTitle(song.request)}” plays next.`);
    },
    onTrash: (song) =>
      void trashSong(song.id).then(
        () => {
          remove(song.id);
          if (openId === song.id) setOpenId(null);
          notify("Moved to the Trash.");
        },
        (error: unknown) =>
          notify(problem(error, "This song could not be moved to the Trash.")),
      ),
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

  const list = (
    <SongList
      songs={songs}
      heading={page === "create" ? "My workspace" : "Library"}
      current={player.current?.id ?? null}
      playing={player.playing}
      renaming={renaming}
      onRenamed={renamed}
      onPlay={(song) => player.toggle(song)}
      onOpen={(song) => setOpenId(song.id)}
      onFavorite={favorite}
      onCancel={(song) =>
        void act(cancelSong(song.id), "This song could not be stopped.")
      }
      onRetry={(song) =>
        void start({ ...song.request }).catch((error: unknown) =>
          notify(problem(error, "This song could not be started.")),
        )
      }
      actions={actions}
      emptyAction={
        page === "library" ? (
          <button className="secondary" onClick={() => setPage("create")}>
            Create a song
          </button>
        ) : undefined
      }
    />
  );

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
              onClear={() => {
                const previous = request;
                setRequest(EMPTY_REQUEST);
                notify("Cleared.", () => setRequest(previous));
              }}
            />
          )
        )}
        {!openSong && list}
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
