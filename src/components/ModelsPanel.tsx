import { inspectEngine } from "../lib/core";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  CircleHelp,
  Download,
  FolderOpen,
  LoaderCircle,
  Pause,
  ShieldCheck,
} from "lucide-react";
import { chooseModelFolder } from "../lib/hardware";
import {
  desktopModelsAvailable,
  downloadModels,
  formatBytes,
  getModelPlan,
  getModelStatus,
  modelOperationActive,
  pauseModels,
  openModelLicense,
  verifyModels,
  type ModelPlan,
  type ModelStatus,
} from "../lib/models";
import { Mark } from "./Brand";

export default function ModelsPanel() {
  const desktop = desktopModelsAvailable();
  const [plan, setPlan] = useState<ModelPlan | null>(null);
  const [status, setStatus] = useState<ModelStatus | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [pauseRequested, setPauseRequested] = useState(false);
  useEffect(() => {
    if (!desktop) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      let busy = false;
      try {
        const [nextPlan, nextStatus] = await Promise.all([
          getModelPlan(),
          getModelStatus(),
        ]);
        if (!cancelled) {
          setPlan(nextPlan);
          setStatus(nextStatus);
          busy = modelOperationActive(nextStatus);
          if (!modelOperationActive(nextStatus)) setPauseRequested(false);
        }
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
      // Live progress while preparing; an occasional check otherwise.
      if (!cancelled) timer = setTimeout(() => void poll(), busy ? 1000 : 4000);
    }
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [desktop]);
  async function action(fn: () => Promise<void>) {
    setPending(true);
    setError("");
    try {
      await fn();
      setStatus(await getModelStatus());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }
  async function choose() {
    await action(async () => {
      const folder = await chooseModelFolder();
      if (folder) await verifyModels(folder);
    });
  }
  const active = modelOperationActive(status);
  const verified = status?.modelsVerified === true;
  const shortOfSpace =
    plan?.freeBytes != null && plan.freeBytes < plan.requiredFreeBytes;
  const percent = status?.totalBytes
    ? Math.min(
        100,
        Math.floor((status.completedBytes / status.totalBytes) * 100),
      )
    : 0;
  const retryVerify =
    (status?.phase === "paused" ||
      status?.phase === "failed" ||
      status?.phase === "unverified") &&
    status.operation === "verify" &&
    !!status.modelRoot;
  const downloading = status?.operation === "download";
  const label = verified
    ? "Ready"
    : status?.phase === "unverified"
      ? "Needs a check"
      : active
        ? downloading
          ? "Downloading"
          : "Checking"
        : status?.phase === "paused"
          ? "Paused"
          : status?.phase === "failed"
            ? "Needs attention"
            : "Not downloaded";
  return (
    <div className="models-panel">
      <div className="model-card">
        <div className="model-symbol">
          <Mark />
        </div>
        <section>
          <h3>Music models</h3>
          <p>
            {plan
              ? `${formatBytes(plan.totalBytes)} · needed once`
              : "Needed once"}
          </p>
        </section>
        <span className={`pill${verified ? " pill-ready" : ""}`}>{label}</span>
      </div>
      {!desktop ? (
        <div className="notice">
          <CircleHelp size={17} />
          <p>Open the Aulo app to download the music models.</p>
        </div>
      ) : (
        <>
          {(active ||
            status?.phase === "paused" ||
            status?.phase === "failed") && (
            <div
              className={`download-progress ${status?.phase === "failed" ? "download-failed" : ""}`}
              aria-live="polite"
            >
              <div className="progress-heading">
                <span>
                  {active ? (
                    <LoaderCircle size={17} className="spin" />
                  ) : (
                    <Download size={17} />
                  )}
                  {status?.phase === "verifying" || status?.phase === "checking"
                    ? "Checking the music models"
                    : status?.phase === "retrying"
                      ? "Reconnecting…"
                      : status?.phase === "paused"
                        ? "Paused"
                        : status?.phase === "failed"
                          ? "Something went wrong"
                          : "Downloading the music models"}
                </span>
                <strong>{percent}%</strong>
              </div>
              <progress
                aria-label="Model preparation progress"
                max={100}
                value={percent}
              />
              <p>{status?.message}</p>
              {active && (
                <button
                  className="text-button"
                  disabled={pending || pauseRequested}
                  onClick={() =>
                    void action(async () => {
                      await pauseModels();
                      setPauseRequested(true);
                    })
                  }
                >
                  <Pause size={14} />
                  {pauseRequested ? "Pausing…" : "Pause"}
                </button>
              )}
            </div>
          )}
          {verified && (
            <div className="models-ready" role="status">
              <CheckCircle2 size={18} />
              <p>{status?.message || "Music models are ready."}</p>
            </div>
          )}
          {retryVerify && (
            <button
              className="primary"
              disabled={pending}
              onClick={() =>
                void action(() => verifyModels(status!.modelRoot!))
              }
            >
              <ShieldCheck size={16} />
              Check the music models
            </button>
          )}
          {!active && !verified && plan && !retryVerify && (
            <div className="download-consent">
              <dl>
                <div>
                  <dt>Download size</dt>
                  <dd>{formatBytes(plan.totalBytes)}</dd>
                </div>
                <div>
                  <dt>Free space needed</dt>
                  <dd>{formatBytes(plan.requiredFreeBytes)}</dd>
                </div>
              </dl>
              <label className="license-consent">
                <input
                  type="checkbox"
                  checked={accepted}
                  onChange={(e) => setAccepted(e.target.checked)}
                />
                <span>
                  I agree to the music models’{" "}
                  <a
                    href={plan.licenseUrl}
                    onClick={(event) => {
                      event.preventDefault();
                      void openModelLicense().catch((e) => setError(String(e)));
                    }}
                  >
                    {plan.license} license
                  </a>
                  , which allows non-commercial use only.
                </span>
              </label>
              {shortOfSpace && (
                <p className="error" role="alert">
                  There isn’t enough free space. Free up some space, or choose a
                  folder that already has the music models.
                </p>
              )}
              <button
                className="primary"
                disabled={!accepted || pending || shortOfSpace}
                onClick={() => void action(() => downloadModels(accepted))}
              >
                <Download size={16} />
                {status?.phase === "paused" && status.operation === "download"
                  ? "Resume download"
                  : status?.phase === "failed" &&
                      status.operation === "download"
                    ? "Try again"
                    : "Download music models"}
              </button>
              <details className="storage-details">
                <summary>Where they’re saved</summary>
                <p>{plan.destination}</p>
              </details>
            </div>
          )}
          {!active && (
            <button
              className="folder-row"
              disabled={pending}
              onClick={() => void choose()}
            >
              <FolderOpen size={19} />
              <span>
                <strong>
                  {verified
                    ? "Use a different folder"
                    : "Already have the music models?"}
                </strong>
                <small>
                  Choose their folder. Aulo checks them and changes nothing.
                </small>
              </span>
              <ArrowRight size={17} />
            </button>
          )}
          {!status && !error && (
            <p className="helper">
              <LoaderCircle size={13} className="spin" /> Looking for the music
              models…
            </p>
          )}
          <EngineNote />
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** Only speaks up when the music engine itself needs attention. */
function EngineNote() {
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    inspectEngine().then(
      (status) => {
        if (active && !status.generationReady) setMessage(status.message);
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, []);
  return message ? (
    <div className="notice">
      <CircleHelp size={17} />
      <p>{message}</p>
    </div>
  ) : null;
}
