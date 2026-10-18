import { useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  AudioLines,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  FolderOpen,
  Heart,
  Library,
  Link2,
  Music2,
  Play,
  Plus,
  Search,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Volume2,
  X,
} from "lucide-react";
import SetupWizard from "./components/SetupWizard";
import Dialog from "./components/Dialog";
import PreparationBadge from "./components/PreparationBadge";
import EngineStatus from "./components/EngineStatus";
import { Brand } from "./components/Brand";
import { loadDrafts, saveDrafts, type Draft } from "./lib/storage";
import { runtimeStatus } from "./lib/core";

type Page = "create" | "library" | "favorites";
function initialView() {
  try {
    return localStorage.getItem("aulo.explored.v1") === "true";
  } catch {
    return false;
  }
}
export default function App() {
  const [explored, setExplored] = useState(initialView);
  const [setupStep, setSetupStep] = useState(0);
  const [page, setPage] = useState<Page>("create");
  const [modal, setModal] = useState<"settings" | "agent" | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>(loadDrafts);
  const [title, setTitle] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [style, setStyle] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [instrumental, setInstrumental] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const selectedDraft = drafts.find((d) => d.id === selected);
  const visible = drafts.filter(
    (d) =>
      (page !== "favorites" || d.favorite) &&
      `${d.title} ${d.style} ${d.lyrics}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  function explore() {
    try {
      localStorage.setItem("aulo.explored.v1", "true");
    } catch {
      /* The session remains usable without persistence. */
    }
    setExplored(true);
  }
  function persist(next: Draft[]) {
    try {
      saveDrafts(next);
      setDrafts(next);
      return true;
    } catch {
      setMessage(
        "Your draft could not be saved. Local storage may be full or unavailable.",
      );
      return false;
    }
  }
  function save() {
    if (!style.trim() && !lyrics.trim()) {
      setMessage("Add a music style or some lyrics to save your idea.");
      return;
    }
    const draft: Draft = {
      id: crypto.randomUUID(),
      title: title.trim() || "Untitled idea",
      lyrics: instrumental ? "" : lyrics,
      style,
      created: new Date().toISOString(),
      favorite: false,
    };
    if (persist([draft, ...drafts])) {
      setSelected(draft.id);
      setMessage("Your idea is saved on this device.");
    }
  }
  function exportDraft(d: Draft) {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(d, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `${d.title.replace(/[^a-z0-9 _-]/gi, "").trim() || "aulo-draft"}.json`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  if (!explored)
    return <SetupWizard onExplore={explore} initialStep={setupStep} />;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <div className="nav-section">WORKSPACE</div>
        <nav aria-label="Main navigation">
          <button
            className={page === "create" ? "active" : ""}
            onClick={() => setPage("create")}
          >
            <Sparkles />
            Create
          </button>
          <button
            className={page === "library" ? "active" : ""}
            onClick={() => setPage("library")}
          >
            <Library />
            My music<span>{drafts.length || ""}</span>
          </button>
          <button
            className={page === "favorites" ? "active" : ""}
            onClick={() => setPage("favorites")}
          >
            <Heart />
            Favorites
          </button>
        </nav>
        <div className="sidebar-note">
          <div className="little-sun" />
          <p>
            A little space.
            <br />
            Endless possibilities.
          </p>
        </div>
        <div className="nav-bottom">
          <button onClick={() => setModal("agent")}>
            <Link2 />
            AI connection
            <span className="soon-dot" />
          </button>
          <button onClick={() => setModal("settings")}>
            <Settings2 />
            Settings
          </button>
          <div className="local-label">
            <span />
            Saved on this device
          </div>
        </div>
      </aside>
      <div className="app-main">
        <header className="topbar">
          <span>
            <span className="breadcrumb">Workspace</span>
            <ChevronRight size={14} />
            My workspace
          </span>
          <PreparationBadge
            onOpen={() => {
              setSetupStep(2);
              setExplored(false);
            }}
          />
        </header>
        <div className="workspace-body">
          {page === "create" && (
            <section className="composer" aria-label="Create a song">
              <div className="composer-heading">
                <h1>Make something yours.</h1>
                <p>A thought, a feeling, a first line.</p>
              </div>
              <div className="composer-scroll">
                <label className="field-label" htmlFor="song-title">
                  SONG TITLE <span>Optional</span>
                </label>
                <input
                  id="song-title"
                  className="title-input"
                  placeholder="Give your idea a name"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
                <div className="input-card">
                  <div className="card-heading">
                    <label htmlFor="lyrics">Lyrics</label>
                    <button
                      role="switch"
                      aria-checked={instrumental}
                      className="instrumental"
                      onClick={() => setInstrumental(!instrumental)}
                    >
                      Instrumental{" "}
                      <span className={instrumental ? "switch on" : "switch"} />
                    </button>
                  </div>
                  <textarea
                    id="lyrics"
                    disabled={instrumental}
                    placeholder={
                      instrumental
                        ? "Let the music do the talking."
                        : "Start with a line that means something.\n\nOr leave this empty for an instrumental."
                    }
                    value={lyrics}
                    onChange={(e) => setLyrics(e.target.value)}
                  />
                  <div className="card-bottom">
                    <span>Your words. Your way.</span>
                    <Music2 size={15} />
                  </div>
                </div>
                <div className="input-card style-card">
                  <label htmlFor="style">Music style</label>
                  <textarea
                    id="style"
                    placeholder="Warm piano, dreamy indie pop, a quiet Sunday morning…"
                    value={style}
                    onChange={(e) => setStyle(e.target.value)}
                  />
                  <div className="style-chips">
                    {["Warm piano", "Indie folk", "Cinematic"].map((s) => (
                      <button
                        key={s}
                        onClick={() =>
                          setStyle((v) => (v ? `${v}, ${s.toLowerCase()}` : s))
                        }
                      >
                        <Plus size={11} />
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
                <button
                  className="advanced-toggle"
                  aria-expanded={advanced}
                  onClick={() => setAdvanced(!advanced)}
                >
                  <SlidersHorizontal size={16} />
                  More creative control
                  <ChevronDown size={15} />
                </button>
                {advanced && (
                  <p className="helper advanced-copy">
                    Score editing and additional controls will appear here when
                    the music engine is connected. Aulo will choose the
                    technical settings for you.
                  </p>
                )}
                <div className="inspiration">
                  <span className="eyebrow">NEED A STARTING POINT?</span>
                  <button
                    onClick={() => {
                      setTitle("A slower Sunday");
                      setStyle(
                        "Intimate acoustic folk, warm piano, brushed drums, unhurried and hopeful",
                      );
                      setInstrumental(true);
                    }}
                  >
                    A soundtrack for a slower Sunday <ArrowRight size={15} />
                  </button>
                </div>
              </div>
              <footer className="composer-actions">
                <button
                  className="primary"
                  disabled
                  title={runtimeStatus.reason}
                >
                  <Sparkles size={17} />
                  Create song
                </button>
                <button className="secondary" onClick={save}>
                  <Plus size={16} />
                  Save idea
                </button>
                <small>
                  Music generation is not available in this preview.
                </small>
              </footer>
            </section>
          )}
          <main className="library">
            <header className="library-heading">
              <div>
                <span className="eyebrow">YOUR PERSONAL COLLECTION</span>
                <h2>
                  {page === "favorites"
                    ? "The ones you love."
                    : "Room for your next idea."}
                </h2>
              </div>
              <span className="count-badge">
                {drafts.length} {drafts.length === 1 ? "idea" : "ideas"}
              </span>
            </header>
            <div className="library-toolbar">
              <label className="search">
                <Search size={16} />
                <input
                  aria-label="Search your music"
                  placeholder="Find an idea…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <span className="sort-label">
                Newest first <ChevronDown size={13} />
              </span>
            </div>
            {visible.length === 0 ? (
              <div className="empty-library">
                <div className="record-art">
                  <div className="record-grooves" />
                  <div className="record-label">
                    <AudioLines size={28} />
                  </div>
                  <span className="record-glint" />
                </div>
                <span className="eyebrow">
                  {query ? "KEEP LOOKING" : "EVERY SONG STARTS SOMEWHERE"}
                </span>
                <h3>
                  {query
                    ? "No ideas match that search."
                    : page === "favorites"
                      ? "Keep your favorites close."
                      : "Something good is on its way."}
                </h3>
                <p>
                  {query
                    ? "Try another title, lyric, or style."
                    : page === "favorites"
                      ? "Tap the heart on any saved idea to find it here."
                      : "Save a lyric, capture a mood, make a little space\nfor the music only you would make."}
                </p>
                {query ? (
                  <button className="secondary" onClick={() => setQuery("")}>
                    Clear search
                  </button>
                ) : page !== "create" ? (
                  <button
                    className="secondary"
                    onClick={() => setPage("create")}
                  >
                    <Plus size={15} />
                    Start an idea
                  </button>
                ) : (
                  <div className="empty-caption">
                    <FolderOpen size={14} />
                    Your saved ideas will appear here
                  </div>
                )}
              </div>
            ) : (
              <div className="song-list">
                {visible.map((d, i) => (
                  <article
                    key={d.id}
                    className={`song-row ${selected === d.id ? "selected" : ""}`}
                  >
                    <button
                      className="song-select"
                      onClick={() => setSelected(d.id)}
                    >
                      <span className={`song-art art-${i % 3}`}>
                        <AudioLines />
                      </span>
                      <span className="song-copy">
                        <strong>{d.title}</strong>
                        <small>{d.style || "A new idea"}</small>
                        <span className="draft-tag">DRAFT · NO AUDIO YET</span>
                      </span>
                    </button>
                    <button
                      className={`icon-button ${d.favorite ? "loved" : ""}`}
                      aria-label={
                        d.favorite
                          ? `Remove ${d.title} from favorites`
                          : `Favorite ${d.title}`
                      }
                      onClick={() =>
                        persist(
                          drafts.map((item) =>
                            item.id === d.id
                              ? { ...item, favorite: !item.favorite }
                              : item,
                          ),
                        )
                      }
                    >
                      <Heart
                        size={17}
                        fill={d.favorite ? "currentColor" : "none"}
                      />
                    </button>
                  </article>
                ))}
              </div>
            )}
            <footer className="library-footer">
              <span className="tiny-mark">a.</span>
              <span>A workspace for your music. Nothing else.</span>
            </footer>
          </main>
          {selectedDraft && (
            <aside className="detail-panel">
              <header>
                <span className="eyebrow">YOUR IDEA</span>
                <button
                  className="icon-button"
                  aria-label="Close details"
                  onClick={() => setSelected(null)}
                >
                  <X size={18} />
                </button>
              </header>
              <div className="detail-art">
                <AudioLines size={58} />
              </div>
              <h2>{selectedDraft.title}</h2>
              <p>{selectedDraft.style}</p>
              <span className="pill">Draft · No audio</span>
              <div className="detail-actions">
                <button
                  className="secondary"
                  onClick={() => {
                    setTitle(`${selectedDraft.title} — variation`);
                    setLyrics(selectedDraft.lyrics);
                    setStyle(selectedDraft.style);
                    setInstrumental(!selectedDraft.lyrics);
                    setPage("create");
                    setMessage(
                      "Idea copied into the composer. Save it to keep a new variation.",
                    );
                  }}
                >
                  <Plus size={15} />
                  Variation
                </button>
                <button
                  className="icon-button"
                  aria-label="Export draft"
                  onClick={() => exportDraft(selectedDraft)}
                >
                  <ArrowDownToLine size={18} />
                </button>
              </div>
              <h3>Lyrics</h3>
              <pre>{selectedDraft.lyrics || "An instrumental idea."}</pre>
            </aside>
          )}
        </div>
      </div>
      <footer className="player">
        <div className="player-track">
          <span className="player-art">
            <Music2 size={19} />
          </span>
          <span>
            <strong>Your next favorite song</strong>
            <small>Generated audio will play here</small>
          </span>
        </div>
        <div className="player-controls">
          <button className="play-button" disabled aria-label="Play audio">
            <Play size={16} fill="currentColor" />
          </button>
          <span className="player-time">0:00</span>
          <div className="playback-line" />
          <span className="player-time">—:—</span>
        </div>
        <Volume2 size={17} className="player-volume" />
        <span className="player-offline">
          <span />
          LOCAL WORKSPACE
        </span>
      </footer>
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
      {modal && (
        <Dialog onClose={() => setModal(null)}>
          <header>
            <span className="section-icon">
              {modal === "agent" ? <Link2 /> : <Settings2 />}
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
            {modal === "agent"
              ? "Your assistant, your music."
              : "A little behind the scenes."}
          </h2>
          <p>
            {modal === "agent"
              ? "Connect an AI agent you already use to help shape ideas and work with your music. This independent integration is planned for a later release."
              : "Aulo is an early desktop preview. Drafts are stored locally in this app profile; they are not backed up automatically. Open the setup guide to prepare or verify music models."}
          </p>
          {modal === "settings" && <EngineStatus />}
          <div className="notice">
            <CircleHelp size={17} />
            <p>
              {modal === "agent"
                ? "No agent is connected. This preview does not access agent configurations or send your lyrics to external services."
                : "Hardware checks and model preparation are available in the desktop app. Generation and audio playback are not connected."}
            </p>
          </div>
          {modal === "settings" && (
            <button
              className="primary"
              onClick={() => {
                setModal(null);
                setSetupStep(2);
                setExplored(false);
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
