import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  Bot,
  HardDrive,
  Info,
  LoaderCircle,
  Music2,
  Sparkles,
  X,
} from "lucide-react";
import Dialog from "./Dialog";
import ModelsPanel from "./ModelsPanel";
import {
  desktopModelsAvailable,
  getModelStatus,
  modelOperationActive,
  openModelLicense,
  removeModels,
  verifyModels,
  type ModelStatus,
} from "../lib/models";
import {
  engineMemory,
  formatSize,
  getSettings,
  releaseEngine,
  saveReport,
  storageUsage,
  updateSettings,
  DEFAULT_SETTINGS,
  type EngineMemory,
  type Settings,
  type StorageUsage,
} from "../lib/settings";
import { appVersion, deleteSongs, type Song } from "../lib/songs";

type Section = "creating" | "storage" | "models" | "assistant" | "about";

const SECTIONS: [Section, string, ReactNode][] = [
  ["creating", "Creating", <Sparkles key="c" size={17} />],
  ["storage", "Storage", <HardDrive key="s" size={17} />],
  ["models", "Music models", <Music2 key="m" size={17} />],
  ["assistant", "AI assistant", <Bot key="a" size={17} />],
  ["about", "Help & About", <Info key="i" size={17} />],
];

const problem = (error: unknown, fallback: string) =>
  typeof error === "string" ? error : fallback;

/** Repeats `load` while the section is open. */
function usePolling<T>(load: () => Promise<T>, every: number) {
  const [value, setValue] = useState<T | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const run = () =>
      load()
        .then((v) => active && setValue(v))
        .catch(() => undefined)
        .finally(() => {
          if (active) timer = setTimeout(run, every);
        });
    void run();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [load, every, tick]);
  return [value, () => setTick((t) => t + 1)] as const;
}

function Row({
  title,
  detail,
  children,
}: {
  title: string;
  detail?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="settings-row">
      <div>
        <strong>{title}</strong>
        {detail && <p>{detail}</p>}
      </div>
      {children}
    </div>
  );
}

function Choice<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: [T, string][];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map(([option, text]) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          className={value === option ? "selected" : ""}
          onClick={() => onChange(option)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

/** A confirmation inside Settings, so no second dialog opens over it. */
function Confirm({
  title,
  body,
  confirm,
  busy,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirm: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="settings-confirm" role="alertdialog" aria-label={title}>
      <strong>{title}</strong>
      <p>{body}</p>
      <div className="dialog-actions">
        <button className="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button className="danger-button" onClick={onConfirm} disabled={busy}>
          {busy && <LoaderCircle size={15} className="spin" />}
          {confirm}
        </button>
      </div>
    </div>
  );
}

function CreatingSection({
  settings,
  onChange,
  notify,
  warn,
}: {
  settings: Settings;
  onChange: (next: Settings) => void;
  notify: (text: string) => void;
  warn: (text: string) => void;
}) {
  const desktop = desktopModelsAvailable();
  const load = useCallback(
    () =>
      desktop
        ? engineMemory()
        : Promise.resolve<EngineMemory>({ loaded: false, busy: false }),
    [desktop],
  );
  const [memory, refresh] = usePolling(load, 3000);
  const [freeing, setFreeing] = useState(false);
  return (
    <>
      <Row
        title="Tell me when a song is ready"
        detail="A notification when a song finishes while you’re in another app."
      >
        <button
          type="button"
          role="switch"
          aria-checked={settings.notifyWhenDone}
          aria-label="Tell me when a song is ready"
          className={settings.notifyWhenDone ? "switch on" : "switch"}
          onClick={() =>
            onChange({ ...settings, notifyWhenDone: !settings.notifyWhenDone })
          }
        />
      </Row>
      <Row
        title="Between songs"
        detail={
          settings.keepReady === "faster"
            ? "Aulo stays ready until you quit, so your next song starts sooner. It keeps using a lot of memory meanwhile."
            : "Aulo gives its memory back 10 minutes after your last song. The next song then takes a little longer to start."
        }
      >
        <Choice
          label="Between songs"
          value={settings.keepReady}
          options={[
            ["saveMemory", "Save memory"],
            ["faster", "Start faster"],
          ]}
          onChange={(keepReady) => onChange({ ...settings, keepReady })}
        />
      </Row>
      {memory?.loaded && !memory.busy && (
        <Row
          title="Aulo is holding memory"
          detail="It’s staying ready for your next song."
        >
          <button
            className="secondary small"
            disabled={freeing}
            onClick={() => {
              setFreeing(true);
              void releaseEngine()
                .then(() => notify("Memory freed."))
                .catch((e: unknown) =>
                  warn(problem(e, "Memory couldn’t be freed right now.")),
                )
                .finally(() => {
                  setFreeing(false);
                  refresh();
                });
            }}
          >
            Free up memory now
          </button>
        </Row>
      )}
    </>
  );
}

function StorageSection({
  settings,
  onChange,
  songs,
  onDeleted,
  notify,
  warn,
}: {
  settings: Settings;
  onChange: (next: Settings) => void;
  songs: Song[];
  onDeleted: (ids: string[]) => void;
  notify: (text: string) => void;
  warn: (text: string) => void;
}) {
  const desktop = desktopModelsAvailable();
  const load = useCallback(
    () =>
      desktop ? storageUsage() : Promise.reject(new Error("Not available")),
    [desktop],
  );
  const [usage, refresh] = usePolling<StorageUsage>(load, 10000);
  const [confirming, setConfirming] = useState(false);
  const [emptying, setEmptying] = useState(false);
  const trashed = songs.filter((s) => s.trashedMs != null);
  const count = (n: number) => `${n} ${n === 1 ? "song" : "songs"}`;
  if (!desktop)
    return <p className="settings-note">Available in the Aulo app.</p>;
  return (
    <>
      <Row title="Songs" detail={usage ? count(usage.songs) : "Measuring…"}>
        <span className="settings-value">
          {usage ? formatSize(usage.songsBytes) : ""}
        </span>
      </Row>
      <Row title="Trash" detail={usage ? count(usage.trash) : "Measuring…"}>
        <span className="settings-value">
          {usage ? formatSize(usage.trashBytes) : ""}
        </span>
        <button
          className="secondary small"
          disabled={trashed.length === 0}
          onClick={() => setConfirming(true)}
        >
          Empty Trash
        </button>
      </Row>
      {confirming && (
        <Confirm
          title={`Delete ${count(trashed.length)} for good?`}
          body="They go to your computer’s trash and leave Aulo. This can’t be undone in Aulo."
          confirm="Empty Trash"
          busy={emptying}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setEmptying(true);
            const ids = trashed.map((s) => s.id);
            void deleteSongs(ids)
              .then((deleted) => {
                onDeleted(deleted);
                const left = ids.length - deleted.length;
                if (left === 0) notify("The Trash is empty.");
                else warn(`${count(left)} couldn’t be deleted. Try again.`);
              })
              .catch((e: unknown) => {
                warn(problem(e, "Some songs couldn’t be deleted."));
              })
              .finally(() => {
                setEmptying(false);
                setConfirming(false);
                refresh();
              });
          }}
        />
      )}
      <Row
        title="Empty the Trash automatically"
        detail="Songs left in the Trash are deleted after the time you choose."
      >
        <Choice
          label="Empty the Trash automatically"
          value={settings.emptyTrashAfterDays === 30 ? "30" : "never"}
          options={[
            ["never", "Never"],
            ["30", "After 30 days"],
          ]}
          onChange={(v) =>
            onChange({
              ...settings,
              emptyTrashAfterDays: v === "30" ? 30 : null,
            })
          }
        />
      </Row>
      <Row
        title="Music models"
        detail={
          usage?.modelsElsewhere
            ? "In a folder you chose."
            : "What Aulo needs to make music."
        }
      >
        <span className="settings-value">
          {usage ? formatSize(usage.modelsBytes) : ""}
        </span>
      </Row>
      <Row
        title="Free space on this computer"
        detail={
          usage?.freeBytes != null && usage.freeBytes < 10e9
            ? "Space is running low. Songs need room to be saved."
            : undefined
        }
      >
        <span
          className={`settings-value${
            usage?.freeBytes != null && usage.freeBytes < 10e9 ? " low" : ""
          }`}
        >
          {usage?.freeBytes != null ? formatSize(usage.freeBytes) : ""}
        </span>
      </Row>
    </>
  );
}

function ModelsSection({
  notify,
  warn,
}: {
  notify: (text: string) => void;
  warn: (text: string) => void;
}) {
  const desktop = desktopModelsAvailable();
  const load = useCallback(
    () =>
      desktop ? getModelStatus() : Promise.reject(new Error("Not available")),
    [desktop],
  );
  const [status, refresh] = usePolling<ModelStatus>(load, 2000);
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  if (!desktop)
    return <p className="settings-note">Available in the Aulo app.</p>;
  const ready =
    status?.modelsVerified && !modelOperationActive(status) && !removing;
  const license = (
    <p className="settings-note">
      The music models are licensed under{" "}
      <a
        href="https://creativecommons.org/licenses/by-nc/4.0/"
        onClick={(e) => {
          e.preventDefault();
          void openModelLicense().catch(() => undefined);
        }}
      >
        CC BY-NC 4.0
      </a>
      , which allows non-commercial use only. Keep that in mind before you sell
      or publish songs you make.
    </p>
  );
  if (!ready)
    return (
      <>
        {removing || status?.phase === "removing" ? (
          <p className="settings-note">
            <LoaderCircle size={15} className="spin" /> Removing the music
            models…
          </p>
        ) : (
          <ModelsPanel />
        )}
        {license}
      </>
    );
  return (
    <>
      <Row title="Ready on this computer" detail="Aulo can make songs.">
        <button
          className="secondary small"
          onClick={() =>
            void verifyModels(status!.modelRoot!)
              .then(refresh)
              .catch((e: unknown) =>
                warn(problem(e, "The check couldn’t start.")),
              )
          }
        >
          Check files
        </button>
      </Row>
      <p className="settings-note">
        Check files if songs stop working. It takes about a minute and changes
        nothing.
      </p>
      {license}
      <Row
        title="Remove the music models"
        detail={`Frees about ${formatSize(status?.totalBytes ?? 0)}. You can download them again at any time.`}
      >
        <button
          className="secondary small danger"
          onClick={() => setConfirming(true)}
        >
          Remove
        </button>
      </Row>
      {confirming && (
        <Confirm
          title="Remove the music models?"
          body="Aulo can’t make songs until you download them again. Your songs stay as they are."
          confirm="Remove"
          busy={removing}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setRemoving(true);
            void removeModels()
              .then(({ keptFolder }) =>
                notify(
                  keptFolder
                    ? "Aulo stopped using your models folder. The folder itself was left as it is."
                    : "The music models were removed.",
                ),
              )
              .catch((e: unknown) =>
                warn(problem(e, "The music models couldn’t be removed.")),
              )
              .finally(() => {
                setRemoving(false);
                setConfirming(false);
                refresh();
              });
          }}
        />
      )}
    </>
  );
}

function AssistantSection() {
  return (
    <>
      <p className="settings-lead">
        Later you’ll be able to connect an AI assistant you already use, so it
        can help write lyrics and shape songs with you in Aulo.
      </p>
      <Row
        title="Not available yet"
        detail="Nothing is connected to Aulo, and your lyrics aren’t sent anywhere."
      />
    </>
  );
}

const CREDITS: [string, string][] = [
  [
    "YuE2",
    "The music model, by the Multimodal Art Projection team. Code Apache 2.0; model weights CC BY-NC 4.0.",
  ],
  ["YUE2 // GROOVE", "The music engine Aulo runs. Apache 2.0."],
  ["PyTorch", "Machine learning library. BSD license."],
  ["LAME", "MP3 encoding. LGPL."],
  ["Tauri", "The desktop app framework. MIT / Apache 2.0."],
  ["Bricolage Grotesque, Figtree", "Typefaces. SIL Open Font License."],
];

function AboutSection({
  notify,
  warn,
}: {
  notify: (text: string) => void;
  warn: (text: string) => void;
}) {
  const desktop = desktopModelsAvailable();
  const [version, setVersion] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!desktop) return;
    let active = true;
    appVersion().then(
      (v) => active && setVersion(v),
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [desktop]);
  return (
    <>
      <Row title="Aulo" detail={version ? `Version ${version}` : undefined} />
      <Row
        title="Problem report"
        detail="If something isn’t working, save a report and send it to whoever helps you. It describes Aulo, this computer and how your recent songs went. It has none of your songs, lyrics, styles, titles or your name, and Aulo never sends it anywhere."
      >
        <button
          className="secondary small"
          disabled={!desktop || saving}
          onClick={() => {
            setSaving(true);
            void saveReport()
              .then((saved) => {
                if (saved) notify("Problem report saved.");
              })
              .catch((e: unknown) =>
                warn(problem(e, "The report couldn’t be saved.")),
              )
              .finally(() => setSaving(false));
          }}
        >
          Save report…
        </button>
      </Row>
      <details className="settings-credits">
        <summary>Thanks and licenses</summary>
        <dl>
          {CREDITS.map(([name, text]) => (
            <div key={name}>
              <dt>{name}</dt>
              <dd>{text}</dd>
            </div>
          ))}
        </dl>
      </details>
    </>
  );
}

export default function SettingsPanel({
  songs,
  onClose,
  onDeleted,
  onSettingsChanged,
  notify,
  warn,
  initialSection = "creating",
}: {
  songs: Song[];
  onClose: () => void;
  onDeleted: (ids: string[]) => void;
  onSettingsChanged: (settings: Settings) => void;
  notify: (text: string) => void;
  warn: (text: string) => void;
  initialSection?: Section;
}) {
  const [section, setSection] = useState<Section>(initialSection);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  useEffect(() => {
    let active = true;
    getSettings().then(
      (s) => active && setSettings(s),
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, []);
  const change = (next: Settings) => {
    const previous = settings;
    setSettings(next);
    if (!desktopModelsAvailable()) return;
    updateSettings(next).then(onSettingsChanged, (e: unknown) => {
      setSettings(previous);
      warn(problem(e, "Your settings couldn’t be saved."));
    });
  };
  const title = SECTIONS.find(([id]) => id === section)![1];
  return (
    <Dialog onClose={onClose}>
      <div className="settings-panel">
        <nav aria-label="Settings sections">
          <h2 id="modal-title">Settings</h2>
          {SECTIONS.map(([id, label, icon]) => (
            <button
              key={id}
              className={id === section ? "active" : ""}
              aria-current={id === section ? "page" : undefined}
              onClick={() => setSection(id)}
            >
              {icon}
              {label}
            </button>
          ))}
        </nav>
        <section aria-labelledby="settings-section-title">
          <header>
            <h3 id="settings-section-title">{title}</h3>
            <button
              className="icon-button"
              aria-label="Close settings"
              onClick={onClose}
            >
              <X size={18} />
            </button>
          </header>
          <div className="settings-body">
            {section === "creating" && (
              <CreatingSection
                settings={settings}
                onChange={change}
                notify={notify}
                warn={warn}
              />
            )}
            {section === "storage" && (
              <StorageSection
                settings={settings}
                onChange={change}
                songs={songs}
                onDeleted={onDeleted}
                notify={notify}
                warn={warn}
              />
            )}
            {section === "models" && (
              <ModelsSection notify={notify} warn={warn} />
            )}
            {section === "assistant" && <AssistantSection />}
            {section === "about" && (
              <AboutSection notify={notify} warn={warn} />
            )}
          </div>
        </section>
      </div>
    </Dialog>
  );
}
