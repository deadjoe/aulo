import { useCallback, useEffect, useState } from "react";
import {
  ArrowRight,
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
import EngineStatus from "./components/EngineStatus";
import Composer from "./components/Composer";
import SongList from "./components/SongList";
import Player, { usePlayer } from "./components/Player";
import { Brand } from "./components/Brand";
import { loadComposer, saveComposer } from "./lib/composer";
import {
  cancelSong,
  createSong,
  creationStatus,
  deleteSong,
  displayTitle,
  listSongs,
  onSongUpdated,
  updateSong,
  type CreationStatus,
  type Song,
  type SongRequest,
} from "./lib/songs";

type Page = "create" | "library";
type Modal =
  { kind: "settings" } | { kind: "agent" } | { kind: "delete"; song: Song };

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
  const [songs, setSongs] = useState<Song[]>([]);
  const [request, setRequest] = useState<SongRequest>(loadComposer);
  const [status, setStatus] = useState<CreationStatus | null>(null);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState("");
  const player = usePlayer(songs);

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
    listSongs().then(setSongs, () =>
      setMessage("Your songs could not be loaded. Reopen Aulo to try again."),
    );
    const stop = onSongUpdated((song) =>
      setSongs((list) => {
        const index = list.findIndex((s) => s.id === song.id);
        if (index < 0) return [song, ...list];
        const next = [...list];
        next[index] = song;
        return next;
      }),
    );
    window.addEventListener("focus", refreshStatus);
    return () => {
      stop();
      window.removeEventListener("focus", refreshStatus);
    };
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
    try {
      const song = await createSong(request);
      setSongs((list) =>
        list.some((s) => s.id === song.id) ? list : [song, ...list],
      );
      setMessage(`Creating “${displayTitle(song.request)}”.`);
    } catch (error) {
      setMessage(problem(error, "This song could not be started."));
      refreshStatus();
    } finally {
      setCreating(false);
    }
  }
  const act = (action: Promise<void>, fallback: string) =>
    action.catch((error: unknown) => setMessage(problem(error, fallback)));

  if (!explored)
    return <SetupWizard onExplore={explore} initialStep={setupStep} />;

  const list = (
    <SongList
      songs={songs}
      heading={page === "create" ? "My workspace" : "Library"}
      current={player.current?.id ?? null}
      playing={player.playing}
      onPlay={(song) => player.toggle(song)}
      onFavorite={(song) =>
        void act(
          updateSong(song.id, { favorite: !song.favorite }),
          "This change could not be saved.",
        )
      }
      onCancel={(song) =>
        void act(cancelSong(song.id), "This song could not be stopped.")
      }
      onReuse={(song) => {
        setRequest(song.request);
        setPage("create");
        setMessage("The song's settings are back in the create panel.");
      }}
      onRename={(song, title) =>
        void act(
          updateSong(song.id, { title }),
          "The new title could not be saved.",
        )
      }
      onDelete={(song) => setModal({ kind: "delete", song })}
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
            onClick={() => setPage("create")}
          >
            <WandSparkles />
            Create
          </button>
          <button
            className={page === "library" ? "active" : ""}
            aria-current={page === "library" ? "page" : undefined}
            onClick={() => setPage("library")}
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
      <div className={`workspace ${page}`}>
        {page === "create" && (
          <Composer
            request={request}
            onChange={setRequest}
            status={status}
            creating={creating}
            onCreate={() => void create()}
            onOpenSetup={openSetup}
          />
        )}
        {list}
      </div>
      <Player
        player={player}
        onFavorite={(song) =>
          void act(
            updateSong(song.id, { favorite: !song.favorite }),
            "This change could not be saved.",
          )
        }
      />
      {message && (
        <div className="toast" role="status">
          <Check size={17} />
          <span>{message}</span>
          <button
            className="icon-button"
            aria-label="Dismiss message"
            onClick={() => setMessage("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {modal?.kind === "delete" && (
        <Dialog onClose={() => setModal(null)}>
          <h2 id="modal-title">Delete “{displayTitle(modal.song.request)}”?</h2>
          <p>The song and its audio are removed from this computer.</p>
          <div className="dialog-actions">
            <button className="secondary" onClick={() => setModal(null)}>
              Keep it
            </button>
            <button
              className="danger-button"
              onClick={() => {
                const song = modal.song;
                setModal(null);
                void deleteSong(song.id).then(
                  () =>
                    setSongs((list) => list.filter((s) => s.id !== song.id)),
                  (error: unknown) =>
                    setMessage(
                      problem(error, "This song could not be deleted."),
                    ),
                );
              }}
            >
              Delete song
            </button>
          </div>
        </Dialog>
      )}
      {(modal?.kind === "settings" || modal?.kind === "agent") && (
        <Dialog onClose={() => setModal(null)}>
          <header>
            <span className="section-icon">
              {modal.kind === "agent" ? <Link2 /> : <Settings2 />}
            </span>
            <button
              className="icon-button"
              aria-label="Close dialog"
              onClick={() => setModal(null)}
            >
              <X />
            </button>
          </header>
          <h2 id="modal-title">
            {modal.kind === "agent"
              ? "Your assistant, your music."
              : "Settings"}
          </h2>
          <p>
            {modal.kind === "agent"
              ? "Connect an AI agent you already use to help shape ideas and work with your music. This independent integration is planned for a later release."
              : "Your songs are saved on this computer, in Aulo's own data folder. Nothing is uploaded."}
          </p>
          {modal.kind === "settings" && <EngineStatus />}
          {modal.kind === "agent" && (
            <div className="notice">
              <CircleHelp size={17} />
              <p>
                No agent is connected. Aulo does not read agent settings or send
                your lyrics anywhere.
              </p>
            </div>
          )}
          {modal.kind === "settings" && (
            <button
              className="primary"
              onClick={() => {
                setModal(null);
                openSetup();
              }}
            >
              Open setup guide <ArrowRight size={16} />
            </button>
          )}
          <button className="text-button" onClick={() => setModal(null)}>
            Back to my workspace
          </button>
        </Dialog>
      )}
    </div>
  );
}
