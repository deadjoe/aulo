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
      try {
        const [nextPlan, nextStatus] = await Promise.all([
          getModelPlan(),
          getModelStatus(),
        ]);
        if (!cancelled) {
          setPlan(nextPlan);
          setStatus(nextStatus);
          if (!modelOperationActive(nextStatus)) setPauseRequested(false);
        }
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
      if (!cancelled) timer = setTimeout(() => void poll(), 1000);
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
  const label = verified
    ? "Verified"
    : status?.phase === "unverified"
      ? "Check needed"
      : active
        ? "Preparing"
        : status?.phase === "paused"
          ? "Paused"
          : "Not prepared";
  return (
    <div className="models-panel">
      <div className="model-card">
        <div className="model-symbol">
          <Mark />
        </div>
        <section>
          <h3>Music models</h3>
          <p>For YUE2 // GROOVE</p>
        </section>
        <span className="pill">{label}</span>
      </div>
      <div className="model-details">
        <span>
          {plan
            ? `${formatBytes(plan.totalBytes)} · ${plan.fileCount} files`
            : "Verified, versioned model files"}
        </span>
        <span>{verified ? "Checksums match" : "Checked before use"}</span>
      </div>
      {!desktop ? (
        <div className="notice">
          <CircleHelp size={17} />
          <p>
            Open the desktop app to prepare music models. This browser preview
            does not inspect local folders or download model files.
          </p>
        </div>
      ) : (
        <>
          {status?.modelRoot && (
            <div className="model-location">
              <FolderOpen size={15} />
              <span>{status.modelRoot}</span>
            </div>
          )}
          {active ||
          status?.phase === "paused" ||
          status?.phase === "failed" ||
          verified ? (
            <div
              className={`download-progress ${status?.phase === "failed" ? "download-failed" : ""}`}
              aria-live="polite"
            >
              <div className="progress-heading">
                <span>
                  {verified ? (
                    <CheckCircle2 size={17} />
                  ) : active ? (
                    <LoaderCircle size={17} className="spin" />
                  ) : (
                    <Download size={17} />
                  )}
                  {verified
                    ? "Models checked and ready to reuse"
                    : status?.phase === "verifying"
                      ? "Checking model integrity"
                      : status?.phase === "retrying"
                        ? "Reconnecting…"
                        : status?.phase === "paused"
                          ? "Preparation paused"
                          : status?.phase === "failed"
                            ? "Let’s get this back on track"
                            : "Preparing your music models"}
                </span>
                <strong>{percent}%</strong>
              </div>
              <progress
                aria-label="Model preparation progress"
                max={100}
                value={percent}
              />
              <p>{status?.message}</p>
              {status?.currentFile && <small>{status.currentFile}</small>}
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
                  {pauseRequested ? "Pausing…" : "Pause preparation"}
                </button>
              )}
            </div>
          ) : null}
          {!active && (
            <button
              className="folder-row"
              disabled={pending}
              onClick={() => void choose()}
            >
              <FolderOpen size={20} />
              <span>
                <strong>
                  {verified
                    ? "Use a different model folder"
                    : "Already have the models?"}
                </strong>
                <small>
                  Choose your models folder. We’ll verify it without changing
                  files.
                </small>
              </span>
              <ArrowRight size={17} />
            </button>
          )}
          {retryVerify && (
            <button
              className="secondary"
              disabled={pending}
              onClick={() =>
                void action(() => verifyModels(status!.modelRoot!))
              }
            >
              <ShieldCheck size={15} />
              Verify saved folder
            </button>
          )}
          {!active && !verified && plan && (
            <div className="download-consent">
              <p>
                {status?.phase === "paused" && status.operation === "download"
                  ? "Resume your download. Existing files will be checked first."
                  : "Or let Aulo download its own copy."}
              </p>
              <dl>
                <div>
                  <dt>Download</dt>
                  <dd>{formatBytes(plan.totalBytes)} total</dd>
                </div>
                <div>
                  <dt>Free space needed</dt>
                  <dd>
                    {formatBytes(plan.requiredFreeBytes)} including reserve
                  </dd>
                </div>
              </dl>
              <details className="storage-details">
                <summary>Storage location</summary>
                <p>{plan.destination}</p>
              </details>
              <label className="license-consent">
                <input
                  type="checkbox"
                  checked={accepted}
                  onChange={(e) => setAccepted(e.target.checked)}
                />
                <span>
                  I have reviewed the{" "}
                  <a
                    href={plan.licenseUrl}
                    onClick={(event) => {
                      event.preventDefault();
                      void openModelLicense().catch((e) => setError(String(e)));
                    }}
                  >
                    {plan.license} model license
                  </a>{" "}
                  (non-commercial) and want to download these files from Hugging
                  Face.
                </span>
              </label>
              {shortOfSpace && (
                <p className="error" role="alert">
                  There isn’t enough free space. Free up storage, or choose
                  existing models.
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
                    ? "Retry download"
                    : "Download music models"}
              </button>
            </div>
          )}
          {!status && !error && (
            <p className="helper">
              <LoaderCircle size={13} className="spin" /> Checking model
              storage…
            </p>
          )}
        </>
      )}
      <div className="runtime-status">
        <CircleHelp size={16} />
        <p>
          <strong>Music engine: not installed yet.</strong>{" "}
          {verified
            ? "Your models are verified, but music generation is not available until the engine is installed and tested."
            : "Model preparation does not install the music engine. You can explore the workspace at any time."}
        </p>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
