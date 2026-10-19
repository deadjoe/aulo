import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Cpu,
  HardDrive,
  LoaderCircle,
  MemoryStick,
  MonitorSmartphone,
  ShieldCheck,
} from "lucide-react";
import { assessHardware, detectHardware, type Hardware } from "../lib/hardware";
import { getModelStatus, desktopModelsAvailable } from "../lib/models";
import {
  creationStatus,
  prepareEngine,
  type CreationStatus,
} from "../lib/songs";
import { Brand } from "./Brand";
import CoverArt from "./CoverArt";
import ModelsPanel from "./ModelsPanel";

const STEPS = ["Welcome", "Your computer", "Music models"];

function graphicsLabel(hardware: Hardware | null) {
  if (hardware?.gpu) return hardware.gpu;
  if (hardware?.platform === "macos" && hardware.arch === "aarch64")
    return "Built into your Mac";
  return hardware ? "Not found" : null;
}

export default function SetupWizard({
  onExplore,
  initialStep = 0,
}: {
  onExplore: () => void;
  initialStep?: number;
}) {
  const [step, setStep] = useState(initialStep);
  const [hardware, setHardware] = useState<Hardware | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [modelsReady, setModelsReady] = useState(false);
  // Whether songs can actually be made: models, engine and computer together.
  const [creation, setCreation] = useState<CreationStatus | null>(null);
  const assessment = assessHardware(hardware);

  async function check() {
    setChecking(true);
    setError("");
    try {
      setHardware(await detectHardware());
    } catch {
      setError("The check didn’t finish. Try again.");
    } finally {
      setChecking(false);
    }
  }
  useEffect(() => {
    if (step === 1) void check();
  }, [step]);
  // The last step's main action depends on whether the models are ready.
  useEffect(() => {
    if (step !== 2 || !desktopModelsAvailable()) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = () =>
      getModelStatus()
        .then((s) => {
          if (!stopped) setModelsReady(s.modelsVerified);
        })
        .catch(() => undefined)
        .finally(() => {
          if (!stopped) timer = setTimeout(poll, 2000);
        });
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [step]);

  // The one question that matters: can Aulo create here? The computer can rule
  // that out before the models are even downloaded.
  useEffect(() => {
    if (step !== 2 || !desktopModelsAvailable()) {
      setCreation(null);
      return;
    }
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = () =>
      creationStatus()
        .then((s) => {
          if (stopped) return;
          setCreation(s);
          if (!s.ready) timer = setTimeout(poll, 3000);
        })
        .catch(() => {
          if (!stopped) timer = setTimeout(poll, 3000);
        });
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [step, modelsReady]);
  const canCreate = modelsReady && creation?.ready === true;
  const unsupported = creation?.blocker === "unsupported";
  const preparing = modelsReady && creation?.blocker === "preparing";
  const blocked =
    unsupported ||
    (modelsReady &&
      creation?.ready === false &&
      creation.blocker !== "models" &&
      creation.blocker !== "preparing");
  const finalTitle = canCreate
    ? "You’re all set"
    : blocked
      ? "Aulo can’t make songs here yet"
      : modelsReady
        ? "Getting ready…"
        : "Get the music models";
  // Readying the models for this computer's engine happens once, right here.
  useEffect(() => {
    if (!preparing) return;
    let active = true;
    setError("");
    prepareEngine().catch(
      (e: unknown) =>
        active &&
        setError(
          typeof e === "string"
            ? e
            : "Aulo couldn’t get the music models ready.",
        ),
    );
    return () => {
      active = false;
    };
  }, [preparing]);
  const finalLead = canCreate
    ? "The music models are ready. Time to make your first song."
    : unsupported
      ? `${creation?.message} You can still look around.`
      : blocked
        ? "The music models are ready, but this computer can’t make songs with Aulo yet. You can still look around."
        : preparing
          ? "Aulo is getting the music models ready for this computer. This happens once and takes a minute or two."
          : modelsReady
            ? "The music models are ready. Aulo is checking that it can make music on this computer."
            : "Aulo needs its music models once to make songs. They stay on this computer.";

  const facts: [React.ReactNode, string, string | null | undefined][] = [
    [<Cpu key="c" size={18} />, "Chip", hardware?.chip],
    [
      <MemoryStick key="m" size={18} />,
      "Memory",
      hardware ? `${Math.round(hardware.memoryGiB)} GB` : null,
    ],
    [
      <HardDrive key="d" size={18} />,
      "Free space",
      hardware?.freeDiskGiB != null
        ? `${Math.floor(hardware.freeDiskGiB)} GB`
        : null,
    ],
    [
      <MonitorSmartphone key="g" size={18} />,
      "Graphics",
      graphicsLabel(hardware),
    ],
  ];

  return (
    <div className="setup">
      <aside className="setup-hero" aria-hidden="true">
        <Brand />
        <div className="hero-covers">
          <CoverArt
            id="aulo-hero-one"
            style="synthwave night drive"
            size="lg"
          />
          <CoverArt id="aulo-hero-two" style="warm acoustic folk" size="lg" />
          <CoverArt id="aulo-hero-three" style="dreamy lo-fi" size="lg" />
        </div>
        <p className="hero-line">
          Your songs,
          <br />
          made on your computer
        </p>
      </aside>
      <main className="setup-panel">
        <div className="setup-brand">
          <Brand />
        </div>
        <ol className="steps" aria-label="Setup progress">
          {STEPS.map((label, i) => (
            <li
              key={label}
              className={i === step ? "current" : i < step ? "done" : ""}
              aria-current={i === step ? "step" : undefined}
            >
              <span className="step-dot">
                {i < step && <Check size={11} strokeWidth={3} />}
              </span>
              {label}
            </li>
          ))}
        </ol>
        <div className="setup-content" key={step}>
          {step === 0 && (
            <>
              <h1>Make music on your own computer</h1>
              <p className="lead">
                Describe a sound, add your words, and Aulo writes and sings the
                song. Your songs never leave this computer.
              </p>
              <ul className="welcome-list">
                <li>
                  <span>
                    <Cpu size={18} />
                  </span>
                  <div>
                    <strong>A quick look at your computer</strong>
                    <p>Aulo checks that it can make music here.</p>
                  </div>
                </li>
                <li>
                  <span>
                    <HardDrive size={18} />
                  </span>
                  <div>
                    <strong>The music models, once</strong>
                    <p>About 7.8 GB, downloaded a single time.</p>
                  </div>
                </li>
                <li>
                  <span>
                    <ShieldCheck size={18} />
                  </span>
                  <div>
                    <strong>Then just create</strong>
                    <p>No account, no settings, nothing to configure.</p>
                  </div>
                </li>
              </ul>
            </>
          )}
          {step === 1 && (
            <>
              <h1>
                {checking ? "Looking at your computer…" : assessment.title}
              </h1>
              <p className="lead">
                {checking
                  ? "This only takes a moment."
                  : assessment.description}
              </p>
              <div className="hardware-grid">
                {facts.map(([icon, label, value]) => (
                  <div key={label}>
                    {icon}
                    <span>{label}</span>
                    <strong>
                      {checking ? (
                        <LoaderCircle size={15} className="spin" />
                      ) : (
                        value || "Checked in the app"
                      )}
                    </strong>
                  </div>
                ))}
              </div>
              {!checking && (
                <button className="text-button" onClick={() => void check()}>
                  Check again
                </button>
              )}
            </>
          )}
          {step === 2 && (
            <>
              <h1>{finalTitle}</h1>
              <p className="lead">{finalLead}</p>
              <ModelsPanel />
            </>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer className="setup-actions">
          {step > 0 ? (
            <button
              className="text-button"
              onClick={() => {
                setError("");
                setStep(step - 1);
              }}
            >
              <ArrowLeft size={16} /> Back
            </button>
          ) : (
            <span />
          )}
          {step < 2 ? (
            <button
              className="primary"
              disabled={checking}
              onClick={() => setStep(step + 1)}
            >
              {step === 0 ? "Get started" : "Continue"}
              <ArrowRight size={17} />
            </button>
          ) : canCreate ? (
            <button className="primary" onClick={onExplore}>
              Start creating
              <ArrowRight size={17} />
            </button>
          ) : (
            <button className="secondary" onClick={onExplore}>
              Look around first
            </button>
          )}
        </footer>
      </main>
    </div>
  );
}
