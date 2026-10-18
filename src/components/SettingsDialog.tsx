import { useEffect, useState } from "react";
import { FolderOpen, HardDrive, Music2, Sparkles, X } from "lucide-react";
import Dialog from "./Dialog";
import { inspectEngine, type EngineStatus } from "../lib/core";
import {
  desktopModelsAvailable,
  getModelStatus,
  type ModelStatus,
} from "../lib/models";
import { revealLibrary, appVersion } from "../lib/songs";

function Row({
  icon,
  title,
  detail,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="settings-row">
      <span className="settings-icon">{icon}</span>
      <div>
        <strong>{title}</strong>
        <p>{detail}</p>
      </div>
      {action}
    </div>
  );
}

export default function SettingsDialog({
  onClose,
  onOpenSetup,
  onError,
}: {
  onClose: () => void;
  onOpenSetup: () => void;
  onError: (message: string) => void;
}) {
  const desktop = desktopModelsAvailable();
  const [models, setModels] = useState<ModelStatus | null>(null);
  const [engine, setEngine] = useState<EngineStatus | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    if (desktop) {
      getModelStatus().then(
        (s) => active && setModels(s),
        () => undefined,
      );
      appVersion().then(
        (v) => active && setVersion(v),
        () => undefined,
      );
    }
    inspectEngine().then(
      (s) => active && setEngine(s),
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [desktop]);

  const modelsDetail = !desktop
    ? "Available in the Aulo app."
    : !models
      ? "Checking…"
      : models.modelsVerified
        ? "Ready on this computer."
        : models.phase === "unverified"
          ? "Aulo needs to check them again."
          : models.phase === "paused"
            ? "Download paused."
            : "Not downloaded yet.";

  return (
    <Dialog onClose={onClose}>
      <div className="settings">
        <header>
          <h2 id="modal-title">Settings</h2>
          <button
            className="icon-button"
            aria-label="Close settings"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        <Row
          icon={<HardDrive size={18} />}
          title="Music models"
          detail={modelsDetail}
          action={
            <button
              className="secondary small"
              onClick={() => {
                onClose();
                onOpenSetup();
              }}
            >
              {models?.modelsVerified ? "Manage" : "Set up"}
            </button>
          }
        />
        <Row
          icon={<Sparkles size={18} />}
          title="Music engine"
          detail={engine?.message ?? "Checking…"}
        />
        <Row
          icon={<Music2 size={18} />}
          title="Your songs"
          detail="Saved on this computer. Nothing is uploaded."
          action={
            desktop ? (
              <button
                className="secondary small"
                onClick={() =>
                  void revealLibrary().catch(() =>
                    onError("The songs folder couldn’t be opened."),
                  )
                }
              >
                <FolderOpen size={15} />
                Show
              </button>
            ) : undefined
          }
        />
        {version && <p className="settings-version">Aulo {version}</p>}
      </div>
    </Dialog>
  );
}
