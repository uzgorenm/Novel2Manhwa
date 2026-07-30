"use client";

import Image from "next/image";
import { ChangeEvent, useMemo, useState } from "react";

type StudioShellProps = {
  user?: {
    name?: string | null;
    email?: string | null;
    picture?: string | null;
  } | null;
  authConfigured?: boolean;
};

type SourceMode = "upload" | "paste";
type RequestState = "idle" | "loading" | "success" | "error";
type GeneratedPanel = {
  id?: string;
  sequence?: number;
  narration?: string;
  dialogue?: string;
  balloonType?: string;
  imageUrl?: string | null;
  imageSource?: string;
};

const SAMPLE_MANUSCRIPT = `The lake had been silent for three hundred years.

Kael stood at the end of the drowned road, moonlight silvering the old stones beneath the water. Somewhere below, past the pillars and the weeds, a bell began to ring.

“The bell was never under the lake,” he whispered.

Mira tightened her grip on the lantern. “Then why can I hear it?”`;

const PROGRESS_STAGES = [
  { label: "Script", value: 100, status: "Complete" },
  { label: "Storyboard", value: 72, status: "Rendering" },
  { label: "Ink & color", value: 0, status: "Queued" },
];

function getInitials(user: StudioShellProps["user"]) {
  const source = user?.name || user?.email || "PF";
  const chunks = source.trim().split(/\s+|@/).filter(Boolean);
  return chunks
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

async function readResponse(response: Response) {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function bubbleCopy(value: string | undefined, fallback: string) {
  const copy = value?.trim() || fallback;
  return copy.length > 92 ? `${copy.slice(0, 89).trimEnd()}…` : copy;
}

export function StudioShell({
  user = null,
  authConfigured = true,
}: StudioShellProps) {
  const [sourceMode, setSourceMode] = useState<SourceMode>("paste");
  const [manuscript, setManuscript] = useState(SAMPLE_MANUSCRIPT);
  const [fileName, setFileName] = useState<string | null>(null);
  const [generatedPanels, setGeneratedPanels] = useState<GeneratedPanel[]>([]);
  const [creditsRemaining, setCreditsRemaining] = useState<number | null>(null);
  const [stylePreset, setStylePreset] = useState("Cinematic webtoon");
  const [generationState, setGenerationState] =
    useState<RequestState>("idle");
  const [billingState, setBillingState] = useState<
    "idle" | "checkout" | "portal"
  >("idle");
  const [message, setMessage] = useState(
    "Chapter settings are ready. Review the source, then generate.",
  );

  const wordCount = useMemo(() => {
    const count = manuscript.trim().split(/\s+/).filter(Boolean).length;
    return count.toLocaleString();
  }, [manuscript]);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!/\.(txt|md|rtf)$/i.test(file.name)) {
      setGenerationState("error");
      setMessage("Choose a TXT, Markdown, or RTF manuscript.");
      event.target.value = "";
      return;
    }

    try {
      const text = await file.text();
      if (!text.trim()) {
        throw new Error("That manuscript is empty.");
      }
      if (text.length > 60_000) {
        throw new Error(
          "This demo accepts up to 60,000 characters per chapter.",
        );
      }

      setManuscript(text);
      setFileName(file.name);
      setMessage(`${file.name} is loaded and ready to adapt.`);
      setGenerationState("idle");
    } catch (error) {
      setGenerationState("error");
      setMessage(
        error instanceof Error
          ? error.message
          : "The manuscript could not be read.",
      );
    }
  }

  async function handleGenerate() {
    setGenerationState("loading");
    setMessage("Breaking Chapter 12 into cinematic beats…");

    try {
      const requestKey =
        typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `chapter-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": requestKey,
        },
        body: JSON.stringify({
          title: "The Moon’s Exiled Heir",
          chapterTitle: "Chapter 12 · The Drowned Bell",
          manuscript,
          stylePreset,
        }),
      });
      const data = await readResponse(response);
      if (!response.ok) {
        throw new Error(
          (data.error as string) ||
            (data.message as string) ||
          "The chapter could not be queued.",
        );
      }

      const panels = Array.isArray(data.panels)
        ? data.panels.filter(
            (panel): panel is GeneratedPanel =>
              typeof panel === "object" && panel !== null,
          )
        : [];
      const entitlement =
        typeof data.entitlement === "object" && data.entitlement !== null
          ? (data.entitlement as Record<string, unknown>)
          : null;
      if (typeof entitlement?.creditsRemaining === "number") {
        setCreditsRemaining(entitlement.creditsRemaining);
      }
      setGeneratedPanels(panels);
      setGenerationState("success");
      setMessage(
        (data.summary as string) ||
          "Chapter 12 is ready. The storyboard has been saved to your project.",
      );
    } catch (error) {
      setGenerationState("error");
      setMessage(
        error instanceof Error
          ? error.message
          : "Something interrupted generation. Please try again.",
      );
    }
  }

  async function handleBilling(destination: "checkout" | "portal") {
    setBillingState(destination);
    setMessage(
      destination === "checkout"
        ? "Opening your secure upgrade page…"
        : "Opening your billing settings…",
    );

    try {
      const endpoint =
        destination === "checkout" ? "/api/checkout" : "/api/billing-portal";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          destination === "checkout"
            ? { plan: "starter" }
            : { returnPath: "/" },
        ),
      });
      const data = await readResponse(response);
      if (!response.ok) {
        throw new Error(
          (data.error as string) ||
            (data.message as string) ||
            "Billing is unavailable right now.",
        );
      }

      const destinationUrl =
        (data.url as string) ||
        (data.checkoutUrl as string) ||
        (data.portalUrl as string);
      if (!destinationUrl) {
        throw new Error("Billing did not return a destination.");
      }
      window.location.assign(destinationUrl);
    } catch (error) {
      setBillingState("idle");
      setMessage(
        error instanceof Error
          ? error.message
          : "Billing is unavailable right now. Please try again.",
      );
    }
  }

  const statusTone =
    generationState === "error"
      ? "status-error"
      : generationState === "success"
        ? "status-success"
        : "";
  const previewImageUrl =
    generatedPanels.find((panel) => panel.imageUrl)?.imageUrl ||
    "/demo-chapter-strip.png";
  const generatedCopy = generatedPanels
    .flatMap((panel) => [panel.dialogue, panel.narration])
    .filter((copy): copy is string => Boolean(copy?.trim()));
  const firstBubble = bubbleCopy(
    generatedCopy[0],
    "The bell was never under the lake.",
  );
  const secondBubble = bubbleCopy(
    generatedCopy[1],
    "Then why can I hear it?",
  );
  const liveGeneratedPanels = generatedPanels.filter(
    (panel) =>
      panel.imageSource === "openrouter" &&
      panel.imageUrl?.startsWith("data:image/"),
  );

  return (
    <div className="studio-shell">
      <aside className="project-rail" aria-label="Project navigation">
        <div className="rail-brand">
          <span className="brand-mark" aria-hidden="true">
            PF
          </span>
          <span className="brand-copy">
            <strong>PANELFORGE</strong>
            <small>From prose to panels.</small>
          </span>
        </div>

        <nav className="rail-nav" aria-label="Workspace">
          <a className="rail-link rail-link-active" href="#studio">
            <span aria-hidden="true">✦</span>
            <span>Studio</span>
          </a>
          <a className="rail-link" href="#storyboard">
            <span aria-hidden="true">▦</span>
            <span>Storyboards</span>
          </a>
          <a className="rail-link" href="#library">
            <span aria-hidden="true">◫</span>
            <span>Character vault</span>
          </a>
        </nav>

        <div className="rail-section">
          <div className="rail-section-heading">
            <span>Projects</span>
            <button type="button" aria-label="Create a new project">
              +
            </button>
          </div>
          <button className="project-item project-item-active" type="button">
            <span className="project-cover" aria-hidden="true">
              12
            </span>
            <span>
              <strong>The Moon’s Exiled Heir</strong>
              <small>Chapter 12 · In progress</small>
            </span>
          </button>
          <button className="project-item" type="button">
            <span className="project-cover project-cover-alt" aria-hidden="true">
              08
            </span>
            <span>
              <strong>Orchid &amp; Ash</strong>
              <small>Chapter 8 · Draft</small>
            </span>
          </button>
        </div>

        <div className="rail-footer">
          <div className="rail-user">
            <span className="user-avatar" aria-hidden="true">
              {getInitials(user)}
            </span>
            <span className="user-copy">
              <strong>{user?.name || user?.email || "Guest creator"}</strong>
              {user ? (
                <a href="/auth/logout">Sign out</a>
              ) : (
                <a href="/auth/login">Sign in to save</a>
              )}
            </span>
          </div>
        </div>
      </aside>

      <main className="studio-main" id="studio">
        <header className="studio-header">
          <div>
            <div className="header-kicker">
              <span className="live-dot" aria-hidden="true" />
              Project workspace
            </div>
            <h1>The Moon’s Exiled Heir</h1>
          </div>
          <div className="header-actions">
            {!user && (
              <>
                <span className="demo-mode">
                  {authConfigured ? "Guest mode" : "Demo mode"}
                </span>
                <a className="header-sign-in" href="/auth/login">
                  Sign in
                </a>
              </>
            )}
            <span className="chapter-pill">Chapter 12</span>
            <button
              className="icon-button"
              type="button"
              aria-label="Open project options"
            >
              ···
            </button>
          </div>
        </header>

        <div className="studio-content">
          <section className="source-column" aria-label="Chapter source">
            <div className="panel-heading">
              <div>
                <span className="step-label">01 · SOURCE</span>
                <h2>Build from your manuscript</h2>
                <p>
                  We preserve dialogue, pacing, and character intent while
                  adapting prose for vertical storytelling.
                </p>
              </div>
              <span className="word-badge">{wordCount} words</span>
            </div>

            <div className="source-tabs" role="tablist" aria-label="Source type">
              <button
                id="upload-tab"
                type="button"
                role="tab"
                aria-selected={sourceMode === "upload"}
                aria-controls="upload-panel"
                tabIndex={sourceMode === "upload" ? 0 : -1}
                onClick={() => setSourceMode("upload")}
              >
                Upload file
              </button>
              <button
                id="paste-tab"
                type="button"
                role="tab"
                aria-selected={sourceMode === "paste"}
                aria-controls="paste-panel"
                tabIndex={sourceMode === "paste" ? 0 : -1}
                onClick={() => setSourceMode("paste")}
              >
                Paste text
              </button>
            </div>

            <div
              id="upload-panel"
              className="source-panel upload-panel"
              role="tabpanel"
              aria-labelledby="upload-tab"
              hidden={sourceMode !== "upload"}
            >
              <input
                className="visually-hidden"
                id="manuscript-file"
                type="file"
                accept=".txt,.md,.rtf,text/plain,text/markdown"
                onChange={handleFileChange}
              />
              <label className="upload-dropzone" htmlFor="manuscript-file">
                <span className="upload-icon" aria-hidden="true">
                  ↑
                </span>
                <strong>{fileName || "Choose your manuscript"}</strong>
                <span>
                  {fileName
                    ? "Choose another file"
                    : "TXT, Markdown or RTF · up to 60,000 characters"}
                </span>
                <span className="file-cta">Browse files</span>
              </label>
            </div>

            <div
              id="paste-panel"
              className="source-panel paste-panel"
              role="tabpanel"
              aria-labelledby="paste-tab"
              hidden={sourceMode !== "paste"}
            >
              <label htmlFor="manuscript-text">Chapter manuscript</label>
              <textarea
                id="manuscript-text"
                value={manuscript}
                onChange={(event) => {
                  setManuscript(event.target.value);
                  setGenerationState("idle");
                }}
                rows={9}
                placeholder="Paste the prose you want to turn into panels…"
              />
              <div className="textarea-meta">
                <span>Dialogue detection on</span>
                <span>Autosaved locally</span>
              </div>
            </div>

            <div className="style-block">
              <div className="field-heading">
                <label htmlFor="style-preset">
                  <span className="step-label">02 · DIRECTION</span>
                  Style preset
                </label>
                <span>Optimized for vertical scroll</span>
              </div>
              <div className="select-wrap">
                <select
                  id="style-preset"
                  value={stylePreset}
                  onChange={(event) => setStylePreset(event.target.value)}
                >
                  <option>Cinematic webtoon</option>
                  <option>Romantic fantasy</option>
                  <option>High-contrast noir</option>
                  <option>Painterly action</option>
                </select>
              </div>
              <div className="style-chips" aria-label="Style qualities">
                <span>Moonlit palette</span>
                <span>Expressive close-ups</span>
                <span>Dynamic pacing</span>
              </div>
            </div>

            <div className="generation-card">
              <div className="generation-card-top">
                <div>
                  <span className="step-label">03 · PRODUCTION</span>
                  <h3>Chapter pipeline</h3>
                </div>
                <span className="pipeline-eta">~6 min</span>
              </div>

              <div className="progress-list">
                {PROGRESS_STAGES.map((stage) => (
                  <div className="progress-row" key={stage.label}>
                    <div className="progress-labels">
                      <span>{stage.label}</span>
                      <span>
                        {stage.status === "Queued"
                          ? stage.status
                          : `${stage.value}%`}
                      </span>
                    </div>
                    <div
                      className={`progress-track ${
                        stage.status === "Queued" ? "progress-queued" : ""
                      }`}
                      role="progressbar"
                      aria-label={stage.label}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={stage.value}
                    >
                      <span style={{ width: `${stage.value}%` }} />
                    </div>
                  </div>
                ))}
              </div>

              <button
                className="generate-button"
                type="button"
                disabled={
                  generationState === "loading" || !manuscript.trim()
                }
                onClick={handleGenerate}
              >
                <span aria-hidden="true">
                  {generationState === "loading" ? "◌" : "✦"}
                </span>
                {generationState === "loading"
                  ? "Preparing chapter…"
                  : "Generate chapter · 1 credit"}
              </button>
              <p
                className={`status-message ${statusTone}`}
                role="status"
                aria-live="polite"
              >
                {message}
              </p>
            </div>

            <div className="plan-card">
              <div>
                <span>STARTER PLAN</span>
                <strong>$19/mo · 6 chapters</strong>
                <small>
                  {creditsRemaining === null
                    ? "6 chapter credits included each month"
                    : `${creditsRemaining} chapter ${
                        creditsRemaining === 1 ? "credit" : "credits"
                      } remaining`}
                </small>
              </div>
              <div className="plan-actions">
                <button
                  className="upgrade-button"
                  type="button"
                  disabled={billingState !== "idle"}
                  onClick={() => handleBilling("checkout")}
                >
                  {billingState === "checkout" ? "Opening…" : "Upgrade"}
                </button>
                <button
                  className="manage-button"
                  type="button"
                  disabled={billingState !== "idle"}
                  onClick={() => handleBilling("portal")}
                >
                  Manage billing
                </button>
              </div>
            </div>
          </section>

          <section
            className="preview-column"
            id="storyboard"
            aria-label="Live storyboard preview"
          >
            <div className="preview-heading">
              <div>
                <span className="step-label">LIVE STORYBOARD</span>
                <h2>Chapter 12 · The Drowned Bell</h2>
              </div>
              <div className="preview-state">
                <span aria-hidden="true" />
                {generationState === "success" ? "Ready" : "Rendering"}
              </div>
            </div>

            <div className="preview-workbench">
              <div className="preview-toolbar">
                <span>PAGE 01 / 08</span>
                <span>72% storyboard</span>
              </div>
              <div className="storyboard-viewport">
                <figure
                  className={`storyboard-strip ${
                    liveGeneratedPanels.length > 0
                      ? "generated-storyboard-strip"
                      : ""
                  }`}
                >
                  {liveGeneratedPanels.length > 0 ? (
                    liveGeneratedPanels.map((panel, index) => {
                      const panelCopy = bubbleCopy(
                        panel.dialogue || panel.narration,
                        `Panel ${index + 1}`,
                      );
                      return (
                        <div
                          className="generated-panel"
                          key={panel.id || panel.sequence || index}
                        >
                          <Image
                            src={panel.imageUrl as string}
                            alt={`Generated vertical manhwa panel ${index + 1}`}
                            width={1024}
                            height={1536}
                            unoptimized
                          />
                          <div
                            className={`speech-bubble generated-panel-bubble ${
                              index % 2 === 0
                                ? "generated-bubble-right"
                                : "generated-bubble-left"
                            }`}
                          >
                            {panelCopy}
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <>
                      <Image
                        src={previewImageUrl}
                        alt="Moonlit fantasy storyboard showing an exiled heir at a flooded road, a submerged bell, and a dramatic character close-up"
                        width={1024}
                        height={1536}
                        priority
                        unoptimized={previewImageUrl.startsWith("data:")}
                      />
                      <div className="speech-bubble bubble-one">
                        {firstBubble}
                      </div>
                      <div className="speech-bubble bubble-two">
                        {secondBubble}
                      </div>
                    </>
                  )}
                  <figcaption>
                    {liveGeneratedPanels.length > 0
                      ? `${liveGeneratedPanels.length} generated panels with editable dialogue overlays`
                      : "AI storyboard preview with editable dialogue overlays"}
                  </figcaption>
                </figure>
              </div>
              <div className="preview-footer">
                <span>
                  <i aria-hidden="true">A</i> Dialogue remains editable
                </span>
                <button type="button">Open editor <span aria-hidden="true">↗</span></button>
              </div>
            </div>

            <div className="scene-strip" aria-label="Storyboard scenes">
              <button className="scene-card scene-card-active" type="button">
                <span>01</span>
                <strong>The flooded road</strong>
                <small>3 panels · 00:18</small>
              </button>
              <button className="scene-card" type="button">
                <span>02</span>
                <strong>Beneath the lake</strong>
                <small>4 panels · 00:24</small>
              </button>
              <button className="scene-card" type="button">
                <span>03</span>
                <strong>The heir remembers</strong>
                <small>5 panels · queued</small>
              </button>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
