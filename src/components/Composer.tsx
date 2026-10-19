import { useState } from "react";
import {
  Bookmark,
  ChevronDown,
  Eraser,
  Info,
  Music2,
  LoaderCircle,
  Trash2,
  Undo2,
  WandSparkles,
} from "lucide-react";
import { FullScreenLyrics, LyricsToolbar } from "./LyricsTools";
import SavedPopover from "./SavedPopover";
import { saveText } from "../lib/saved";
import { useUndo } from "../lib/useUndo";
import {
  addSection,
  addStyle,
  lengthNote,
  SECTIONS,
  styleIdeas,
} from "../lib/composer";
import type { CreationStatus, SongRequest, Vocal } from "../lib/songs";

type Mode = "simple" | "advanced";
function initialMode(): Mode {
  try {
    return localStorage.getItem("aulo.mode.v1") === "advanced"
      ? "advanced"
      : "simple";
  } catch {
    return "simple";
  }
}

function Switch({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className="switch-row"
      onClick={() => onChange(!checked)}
    >
      {label}
      <span className={checked ? "switch on" : "switch"} />
    </button>
  );
}

function Level({
  label,
  hint,
  value,
  onChange,
  low,
  high,
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (value: number) => void;
  low: string;
  high: string;
}) {
  const id = `level-${label.toLowerCase().replace(/\s/g, "-")}`;
  return (
    <div className="option-row level">
      <label htmlFor={id} title={hint}>
        {label}
      </label>
      <input
        id={id}
        type="range"
        min={0}
        max={100}
        step={5}
        value={value}
        aria-valuetext={`${value}%`}
        style={{ "--fill": `${value}%` } as React.CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <output htmlFor={id}>{value}%</output>
      <small>
        <span>{low}</span>
        <span>{high}</span>
      </small>
    </div>
  );
}

export default function Composer({
  request,
  onChange,
  status,
  creating,
  onCreate,
  onOpenSetup,
  onClear,
  saveTo,
  onNotify,
}: {
  request: SongRequest;
  onChange: (request: SongRequest) => void;
  status: CreationStatus | null;
  creating: boolean;
  onCreate: () => void;
  onOpenSetup: () => void;
  onClear: () => void;
  /** The "Save to" control, provided by the app. */
  saveTo: React.ReactNode;
  /** Short messages for the person (saved, couldn't save). */
  onNotify: (text: string) => void;
}) {
  const [mode, setModeState] = useState<Mode>(initialMode);
  const [moreOpen, setMoreOpen] = useState(true);
  const [fullScreen, setFullScreen] = useState(false);
  const set = (changes: Partial<SongRequest>) =>
    onChange({ ...request, ...changes });
  const lyricsHistory = useUndo(request.lyrics, (lyrics) => set({ lyrics }));
  const styleHistory = useUndo(request.style, (style) => set({ style }));
  const lyricsTools = {
    lyrics: request.lyrics,
    history: lyricsHistory,
    onError: onNotify,
  };
  function setMode(next: Mode) {
    setModeState(next);
    try {
      localStorage.setItem("aulo.mode.v1", next);
    } catch {
      /* Mode memory is a convenience. */
    }
  }
  const missing = !request.style.trim()
    ? "Describe the sound you want."
    : !request.instrumental && !request.lyrics.trim()
      ? "Add lyrics, or switch on Instrumental."
      : "";
  const ready = status?.ready === true;
  const canCreate = ready && !missing && !creating;
  const ideas = styleIdeas(0, request.style);
  const lengthWarning = request.instrumental
    ? null
    : lengthNote(request.lyrics, status?.maxSongSeconds);

  const lyricsCard = (
    <section className="field-card lyrics-card">
      <header>
        <label htmlFor="lyrics">Lyrics</label>
        {mode === "advanced" && !request.instrumental && (
          <LyricsToolbar
            {...lyricsTools}
            onFullScreen={() => setFullScreen(true)}
          />
        )}
      </header>
      <textarea
        id="lyrics"
        value={request.instrumental ? "" : request.lyrics}
        disabled={request.instrumental}
        placeholder={
          request.instrumental
            ? "Instrumental songs have no lyrics."
            : "Write the words you want sung.\n\nTip: label parts like [Verse] and [Chorus] to shape the song."
        }
        onChange={(e) => lyricsHistory.type(e.target.value)}
        onKeyDown={lyricsHistory.onKeyDown}
      />
      {lengthWarning && (
        <p className="helper length-note" role="status">
          <Info size={14} /> {lengthWarning}
        </p>
      )}
      {mode === "advanced" && !request.instrumental && (
        <span className="section-buttons" aria-label="Add a section">
          {SECTIONS.map((section) => (
            <button
              key={section}
              type="button"
              onClick={() =>
                lyricsHistory.replace(addSection(request.lyrics, section))
              }
            >
              + {section}
            </button>
          ))}
        </span>
      )}
    </section>
  );

  return (
    <section className="composer" aria-label="Create a song">
      <div className="composer-top">
        <div className="mode-switch" role="tablist" aria-label="Creation mode">
          {(["simple", "advanced"] as const).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              className={mode === m ? "selected" : ""}
              onClick={() => setMode(m)}
            >
              {m === "simple" ? "Simple" : "Advanced"}
            </button>
          ))}
        </div>
      </div>
      <div className="composer-scroll">
        {status && !status.ready && (
          <div className="readiness" role="status">
            <p>{status.message}</p>
            {(status.blocker === "models" || status.blocker === "engine") && (
              <button className="secondary" onClick={onOpenSetup}>
                Finish setup
              </button>
            )}
          </div>
        )}
        {mode === "simple" ? (
          <>
            <section className="field-card describe-card">
              <label htmlFor="style">Song description</label>
              <textarea
                id="style"
                value={request.style}
                placeholder="A hopeful indie pop song with jangly guitars and a big singalong chorus"
                onChange={(e) => set({ style: e.target.value })}
              />
              <div className="chip-row">
                {ideas.slice(0, 4).map((idea) => (
                  <button
                    key={idea}
                    type="button"
                    className="chip"
                    onClick={() =>
                      set({ style: addStyle(request.style, idea) })
                    }
                  >
                    {idea}
                  </button>
                ))}
              </div>
            </section>
            <Switch
              label="Instrumental"
              checked={request.instrumental}
              onChange={(instrumental) => set({ instrumental })}
            />
            {!request.instrumental && lyricsCard}
          </>
        ) : (
          <>
            {lyricsCard}
            <Switch
              label="Instrumental"
              checked={request.instrumental}
              onChange={(instrumental) => set({ instrumental })}
            />
            <section className="field-card styles-card">
              <header>
                <label htmlFor="style">Styles</label>
                <span
                  className="field-tools"
                  role="toolbar"
                  aria-label="Styles tools"
                >
                  <SavedPopover
                    kind="styles"
                    onPick={(saved) => styleHistory.replace(saved.text)}
                    onError={onNotify}
                  />
                  <button
                    type="button"
                    className="tool-button"
                    aria-label="Undo changes"
                    title="Undo changes"
                    disabled={!styleHistory.canUndo}
                    onClick={styleHistory.undo}
                  >
                    <Undo2 size={17} />
                  </button>
                  <button
                    type="button"
                    className="tool-button"
                    aria-label="Save styles"
                    title="Save styles"
                    disabled={!request.style.trim()}
                    onClick={() =>
                      void saveText(
                        "styles",
                        request.style,
                        request.title,
                      ).then(
                        () => onNotify("Saved to your styles."),
                        (e: unknown) =>
                          onNotify(
                            typeof e === "string"
                              ? e
                              : "These styles couldn’t be saved.",
                          ),
                      )
                    }
                  >
                    <Bookmark size={16} />
                  </button>
                  <button
                    type="button"
                    className="tool-button"
                    aria-label="Clear styles"
                    title="Clear styles"
                    disabled={!request.style}
                    onClick={() => styleHistory.replace("")}
                  >
                    <Eraser size={16} />
                  </button>
                </span>
              </header>
              <textarea
                id="style"
                value={request.style}
                placeholder="dreamy indie pop, warm analog synths, female vocal, 92 bpm"
                onChange={(e) => styleHistory.type(e.target.value)}
                onKeyDown={styleHistory.onKeyDown}
              />
            </section>
            <section className="field-card more-card">
              <button
                type="button"
                className="more-toggle"
                aria-expanded={moreOpen}
                onClick={() => setMoreOpen(!moreOpen)}
              >
                <ChevronDown size={16} />
                More options
              </button>
              {moreOpen && (
                <div className="more-options">
                  {!request.instrumental && (
                    <div className="option-row">
                      <span id="voice-label">Voice</span>
                      <div
                        className="segmented"
                        role="radiogroup"
                        aria-labelledby="voice-label"
                      >
                        {(
                          [
                            ["auto", "Auto"],
                            ["female", "Female"],
                            ["male", "Male"],
                          ] as [Vocal, string][]
                        ).map(([value, label]) => (
                          <button
                            key={value}
                            type="button"
                            role="radio"
                            aria-checked={request.vocal === value}
                            className={
                              request.vocal === value ? "selected" : ""
                            }
                            onClick={() => set({ vocal: value })}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <Level
                    label="Weirdness"
                    hint="How adventurous each take is. Higher values surprise you more."
                    low="Safe"
                    high="Wild"
                    value={request.weirdness}
                    onChange={(weirdness) => set({ weirdness })}
                  />
                  <Level
                    label="Style influence"
                    hint="How closely the song follows your styles and lyrics."
                    low="Loose"
                    high="Strict"
                    value={request.styleInfluence}
                    onChange={(styleInfluence) => set({ styleInfluence })}
                  />
                </div>
              )}
            </section>
            <label className="title-field">
              <Music2 size={16} />
              <input
                aria-label="Song title"
                placeholder="Song title (optional)"
                maxLength={120}
                value={request.title}
                onChange={(e) => set({ title: e.target.value })}
              />
            </label>
          </>
        )}
        {request.instrumental && (
          <p className="soft-note">
            Aulo asks for no vocals. The music model can still add a little
            humming now and then.
          </p>
        )}
      </div>
      {saveTo}
      <footer className="composer-actions">
        <button
          className="clear-button"
          aria-label="Clear the form"
          title="Clear the form"
          disabled={!request.style && !request.lyrics && !request.title}
          onClick={onClear}
        >
          <Trash2 size={17} />
        </button>
        <button
          className="create-button"
          aria-label="Create song"
          disabled={!canCreate}
          title={!ready ? status?.message : missing || undefined}
          onClick={onCreate}
        >
          {creating ? (
            <LoaderCircle size={18} className="spin" />
          ) : (
            <WandSparkles size={18} />
          )}
          Create
        </button>
      </footer>
      {ready && missing && <p className="composer-hint">{missing}</p>}
      {fullScreen && (
        <FullScreenLyrics
          {...lyricsTools}
          onDone={() => setFullScreen(false)}
        />
      )}
    </section>
  );
}
