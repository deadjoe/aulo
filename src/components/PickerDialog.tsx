import { useState } from "react";
import { Check, Plus, X } from "lucide-react";
import Dialog from "./Dialog";

export interface PickerItem {
  id: string;
  name: string;
  detail: string;
  current?: boolean;
}

/** Choose one item from a list, or name a new one, for "Move to…" and "Add to…". */
export default function PickerDialog({
  title,
  items,
  newLabel,
  onPick,
  onCreate,
  onClose,
}: {
  title: string;
  items: PickerItem[];
  newLabel: string;
  onPick: (id: string) => void;
  onCreate: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    setError("");
    try {
      await onCreate(name);
    } catch (e) {
      setError(typeof e === "string" ? e : "That name can’t be used.");
      setBusy(false);
    }
  }
  return (
    <Dialog onClose={onClose}>
      <div className="picker">
        <header>
          <h2 id="modal-title">{title}</h2>
          <button className="icon-button" aria-label="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        {naming ? (
          <form
            className="picker-new"
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <input
              autoFocus
              aria-label="Name"
              placeholder="Name"
              maxLength={60}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button
              className="primary"
              type="submit"
              disabled={busy || !name.trim()}
            >
              Create
            </button>
          </form>
        ) : (
          <button
            className="picker-row picker-add"
            onClick={() => setNaming(true)}
          >
            <span className="picker-icon">
              <Plus size={18} />
            </span>
            <strong>{newLabel}</strong>
          </button>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="picker-list">
          {items.map((item) => (
            <button
              key={item.id}
              className="picker-row"
              disabled={item.current}
              onClick={() => onPick(item.id)}
            >
              <span>
                <strong>{item.name}</strong>
                <small>{item.detail}</small>
              </span>
              {item.current && <Check size={17} />}
            </button>
          ))}
        </div>
      </div>
    </Dialog>
  );
}
