import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleHelp,
  Cpu,
  Download,
  HardDrive,
  Laptop,
  LoaderCircle,
  Music2,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { assessHardware, detectHardware, type Hardware } from "../lib/hardware";
import { Brand, Mark } from "./Brand";
import ModelsPanel from "./ModelsPanel";

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
  const assessment = assessHardware(hardware);
  async function check() {
    setChecking(true);
    setError("");
    try {
      setHardware(await detectHardware());
    } catch {
      setError("We could not finish the computer check. Please try again.");
    } finally {
      setChecking(false);
    }
  }
  useEffect(() => {
    if (step === 1) void check();
  }, [step]);
  return (
    <div className="setup-shell">
      <header className="setup-header">
        <Brand />
        <span className="quiet-badge">
          DESIGN PREVIEW <span>0.1</span>
        </span>
      </header>
      <div className="setup-layout">
        <aside className="setup-story">
          <div className="story-art">
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <div className="orbit orbit-three" />
            <Mark large />
            <span className="art-caption">
              A LITTLE SPACE FOR SOMETHING NEW
            </span>
          </div>
          <div className="story-copy">
            <span className="eyebrow">MADE HERE. MADE YOURS.</span>
            <h1>
              Your next song
              <br />
              starts at home.
            </h1>
            <p>
              A little inspiration. Your own computer.
              <br />A whole world of music.
            </p>
          </div>
          <div className="story-footer">
            <ShieldCheck size={16} /> A workspace on your computer
          </div>
        </aside>
        <main className="setup-main">
          <ol className="stepper" aria-label="Setup progress">
            {["Welcome", "Your computer", "Music essentials"].map(
              (label, i) => (
                <li
                  key={label}
                  className={i === step ? "current" : i < step ? "done" : ""}
                  aria-current={i === step ? "step" : undefined}
                >
                  <span>{i < step ? <Check size={13} /> : `0${i + 1}`}</span>
                  {label}
                </li>
              ),
            )}
          </ol>
          <div className="setup-content" key={step}>
            {step === 0 && (
              <>
                <span className="section-icon">
                  <Sparkles size={23} />
                </span>
                <span className="eyebrow">WELCOME TO AULO</span>
                <h2>Make room for your music.</h2>
                <p className="lead">
                  Let’s get your own little music studio ready.
                  <br />
                  We’ll take care of the complicated parts.
                </p>
                <div className="welcome-features">
                  <div>
                    <span>
                      <Laptop />
                    </span>
                    <section>
                      <h3>A setup that fits your computer</h3>
                      <p>
                        We check your hardware and find the right starting
                        point.
                      </p>
                    </section>
                  </div>
                  <div>
                    <span>
                      <Download />
                    </span>
                    <section>
                      <h3>The essentials, all in one place</h3>
                      <p>A guided home for your music engine and models.</p>
                    </section>
                  </div>
                  <div>
                    <span>
                      <Music2 />
                    </span>
                    <section>
                      <h3>More creating. Less configuring.</h3>
                      <p>
                        One workspace for your ideas, songs, and new versions.
                      </p>
                    </section>
                  </div>
                </div>
                <div className="notice">
                  <CircleHelp size={17} />
                  <p>
                    Aulo checks your computer and prepares the music models
                    once. After that, everything runs on this computer.
                  </p>
                </div>
              </>
            )}
            {step === 1 && (
              <>
                <span className="section-icon">
                  <Cpu size={23} />
                </span>
                <span className="eyebrow">A GOOD START</span>
                <h2>
                  {checking
                    ? "Getting to know your computer."
                    : assessment.title}
                </h2>
                <p className="lead">
                  {checking
                    ? "Checking the essentials. No settings to figure out."
                    : assessment.description}
                </p>
                {checking ? (
                  <div className="checking">
                    <LoaderCircle className="spin" /> Checking your computer…
                  </div>
                ) : (
                  <div className="hardware-grid">
                    <div>
                      <Cpu />
                      <span>Processor</span>
                      <strong>
                        {hardware?.chip || "Desktop check needed"}
                      </strong>
                    </div>
                    <div>
                      <Laptop />
                      <span>Memory</span>
                      <strong>
                        {hardware
                          ? `${Math.round(hardware.memoryGiB)} GB`
                          : "Not available in browser"}
                      </strong>
                    </div>
                    <div>
                      <HardDrive />
                      <span>Available storage</span>
                      <strong>
                        {hardware?.freeDiskGiB != null
                          ? `${Math.floor(hardware.freeDiskGiB)} GB`
                          : "Not verified"}
                      </strong>
                    </div>
                    <div>
                      <Sparkles />
                      <span>Graphics</span>
                      <strong>
                        {hardware?.gpu ||
                          (hardware?.platform === "macos" &&
                          hardware.arch === "aarch64"
                            ? "Apple integrated graphics"
                            : "Not verified")}
                      </strong>
                    </div>
                  </div>
                )}
                <div className="notice">
                  <ShieldCheck size={17} />
                  <p>
                    These checks stay on your computer. Hardware eligibility
                    does not mean the music engine is installed or ready.
                  </p>
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
                <span className="section-icon">
                  <Download size={23} />
                </span>
                <span className="eyebrow">YOUR MUSIC ESSENTIALS</span>
                <h2>A home for the possibilities.</h2>
                <p className="lead">
                  Download your music models, or reuse the ones you already
                  have. We’ll check the files for you.
                </p>
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
            <div>
              {step > 0 && (
                <button
                  className="text-button"
                  onClick={() => {
                    setError("");
                    setStep(step - 1);
                  }}
                >
                  <ArrowLeft size={16} /> Back
                </button>
              )}
            </div>
            <button
              className="primary"
              disabled={checking}
              onClick={() => (step < 2 ? setStep(step + 1) : onExplore())}
            >
              {step === 0
                ? "Let’s get started"
                : step === 1
                  ? "Continue"
                  : "Explore the workspace"}
              <ArrowRight size={17} />
            </button>
          </footer>
          <p className="setup-footnote">
            {step === 2
              ? "Exploring does not mark your music engine as ready."
              : "Your ideas deserve a place of their own."}
          </p>
        </main>
      </div>
    </div>
  );
}
