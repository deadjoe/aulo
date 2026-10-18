import { useState } from "react";
import { Check, LoaderCircle, X } from "lucide-react";
import Dialog from "./Dialog";
import {
  displayTitle,
  exportSong,
  type AudioFormat,
  type Song,
} from "../lib/songs";

const isMac =
  typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent);

const FORMATS: { id: AudioFormat; label: string; note: string }[] = [
  ...(isMac
    ? [
        {
          id: "m4a" as const,
          label: "M4A",
          note: "Small and clear, best for Apple devices",
        },
      ]
    : []),
  { id: "mp3", label: "MP3", note: "Plays everywhere" },
  {
    id: "wav",
    label: "WAV",
    note: "Uncompressed, for video and music editing",
  },
  { id: "flac", label: "FLAC", note: "Lossless, exactly as Aulo made it" },
];
const KEY = "aulo.download-format.v1";

function rememberedFormat(): AudioFormat {
  try {
    const saved = localStorage.getItem(KEY);
    const match = FORMATS.find((f) => f.id === saved);
    if (match) return match.id;
  } catch {
    /* Remembering the format is a convenience. */
  }
  return FORMATS[0].id;
}

export default function DownloadDialog({
  song,
  onClose,
  onDone,
}: {
  song: Song;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [format, setFormat] = useState<AudioFormat>(rememberedFormat);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const title = displayTitle(song.request);

  async function download() {
    setError("");
    try {
      localStorage.setItem(KEY, format);
    } catch {
      /* ignore */
    }
    setSaving(true);
    try {
      // Aulo opens the save window itself; false means it was cancelled.
      if (await exportSong(song.id, format, title)) onDone("Downloaded.");
      else setSaving(false);
    } catch (e) {
      setError(
        typeof e === "string" && e.length < 200
          ? e
          : "The song could not be saved.",
      );
      setSaving(false);
    }
  }

  return (
    <Dialog onClose={saving ? () => {} : onClose}>
      <div className="download-dialog">
        <button
          className="round-button dialog-close"
          aria-label="Close"
          disabled={saving}
          onClick={onClose}
        >
          <X size={18} />
        </button>
        <h2 id="modal-title">
          Download
          <span>“{title}”</span>
        </h2>
        <div className="format-list" role="radiogroup" aria-label="Format">
          {FORMATS.map((f) => (
            <button
              key={f.id}
              role="radio"
              aria-checked={format === f.id}
              className={format === f.id ? "selected" : ""}
              disabled={saving}
              onClick={() => setFormat(f.id)}
            >
              <span>
                <strong>{f.label}</strong>
                <small>{f.note}</small>
              </span>
              {format === f.id && <Check size={18} />}
            </button>
          ))}
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button
          className="download-button"
          disabled={saving}
          onClick={() => void download()}
        >
          {saving ? (
            <>
              <LoaderCircle size={18} className="spin" />
              Saving…
            </>
          ) : (
            "Download"
          )}
        </button>
      </div>
    </Dialog>
  );
}
