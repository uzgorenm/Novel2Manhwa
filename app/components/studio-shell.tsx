"use client";

import Image from "next/image";
import { ChangeEvent, useMemo, useRef, useState } from "react";

import { SiteHeader } from "@/app/components/site-header";

type StudioShellProps = {
  user?: {
    name?: string | null;
    email?: string | null;
    picture?: string | null;
  } | null;
};

type SourceMode = "upload" | "paste";
type RequestState = "idle" | "loading" | "success" | "error";
type ReferencePanelState = {
  dataUrl: string;
  name: string;
  width: number;
  height: number;
};
type GeneratedPanel = {
  id?: string;
  sequence?: number;
  narration?: string;
  dialogue?: string;
  balloonType?: string;
  imageUrl?: string | null;
  letteringMode?: "embedded" | "overlay";
};

const REFERENCE_UPLOAD_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const MAX_REFERENCE_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_REFERENCE_REQUEST_BYTES = 2 * 1024 * 1024;
const REFERENCE_LONG_EDGE = 1024;

async function readResponse(response: Response) {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("The reference panel could not be read."));
    reader.onerror = () =>
      reject(new Error("The reference panel could not be read."));
    reader.readAsDataURL(blob);
  });
}

function canvasToJpeg(
  canvas: HTMLCanvasElement,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error("The reference panel could not be compressed.")),
      "image/jpeg",
      quality,
    );
  });
}

async function prepareReferenceUpload(
  file: File,
): Promise<ReferencePanelState> {
  if (!REFERENCE_UPLOAD_TYPES.has(file.type)) {
    throw new Error("Choose a JPEG, PNG, or WebP reference panel.");
  }
  if (file.size > MAX_REFERENCE_UPLOAD_BYTES) {
    throw new Error("Reference panels can be up to 5 MB.");
  }

  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(
      1,
      REFERENCE_LONG_EDGE / Math.max(bitmap.width, bitmap.height),
    );
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("The reference panel could not be prepared.");
    }
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);

    let compressed = await canvasToJpeg(canvas, 0.82);
    if (compressed.size > MAX_REFERENCE_REQUEST_BYTES) {
      compressed = await canvasToJpeg(canvas, 0.65);
    }
    if (compressed.size > MAX_REFERENCE_REQUEST_BYTES) {
      throw new Error("The reference panel remains too large after compression.");
    }

    return {
      dataUrl: await readBlobAsDataUrl(compressed),
      name: file.name,
      width,
      height,
    };
  } finally {
    bitmap.close();
  }
}

export function StudioShell({ user = null }: StudioShellProps) {
  const referenceInputRef = useRef<HTMLInputElement>(null);
  const [sourceMode, setSourceMode] = useState<SourceMode>("paste");
  const [title, setTitle] = useState("");
  const [chapterTitle, setChapterTitle] = useState("");
  const [manuscript, setManuscript] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [referencePanel, setReferencePanel] =
    useState<ReferencePanelState | null>(null);
  const [generatedPanels, setGeneratedPanels] = useState<GeneratedPanel[]>([]);
  const [creditsRemaining, setCreditsRemaining] = useState<number | null>(null);
  const [stylePreset, setStylePreset] = useState("Cinematic webtoon");
  const [generationState, setGenerationState] =
    useState<RequestState>("idle");
  const [billingState, setBillingState] = useState<
    "idle" | "checkout" | "portal"
  >("idle");
  const [message, setMessage] = useState(
    "Add your chapter details and manuscript to begin.",
  );

  const wordCount = useMemo(() => {
    const count = manuscript.trim().split(/\s+/).filter(Boolean).length;
    return count.toLocaleString();
  }, [manuscript]);

  function resetGeneratedOutput(
    nextMessage = "Add your chapter details and manuscript to begin.",
  ) {
    setGeneratedPanels([]);
    setGenerationState("idle");
    setMessage(nextMessage);
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!/\.(txt|md)$/i.test(file.name)) {
      setGeneratedPanels([]);
      setGenerationState("error");
      setMessage("Choose a TXT or Markdown manuscript.");
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
          "Chapters can contain up to 60,000 characters.",
        );
      }

      setManuscript(text);
      setFileName(file.name);
      resetGeneratedOutput(`${file.name} is loaded and ready to adapt.`);
    } catch (error) {
      setGeneratedPanels([]);
      setGenerationState("error");
      setMessage(
        error instanceof Error
          ? error.message
          : "The manuscript could not be read.",
      );
    }
  }

  async function handleReferencePanelChange(
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const prepared = await prepareReferenceUpload(file);
      setReferencePanel(prepared);
      resetGeneratedOutput(
        `${file.name} will guide character and visual continuity for this chapter.`,
      );
    } catch (error) {
      setReferencePanel(null);
      setGeneratedPanels([]);
      setGenerationState("error");
      setMessage(
        error instanceof Error
          ? error.message
          : "The reference panel could not be prepared.",
      );
      event.target.value = "";
    }
  }

  function removeReferencePanel() {
    setReferencePanel(null);
    if (referenceInputRef.current) {
      referenceInputRef.current.value = "";
    }
    resetGeneratedOutput("Reference panel removed.");
  }

  async function handleGenerate() {
    const trimmedTitle = title.trim();
    const trimmedChapterTitle = chapterTitle.trim();
    const trimmedManuscript = manuscript.trim();

    if (!trimmedTitle || !trimmedChapterTitle || !trimmedManuscript) {
      setGenerationState("error");
      setMessage("Add a story title, chapter title, and manuscript first.");
      return;
    }

    setGenerationState("loading");
    setMessage(`Turning ${trimmedChapterTitle} into cinematic panels…`);

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
          title: trimmedTitle,
          chapterTitle: trimmedChapterTitle,
          manuscript: trimmedManuscript,
          stylePreset,
          referencePanel: referencePanel?.dataUrl ?? null,
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
          `${trimmedChapterTitle} is ready to review.`,
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
  const liveGeneratedPanels = generatedPanels.filter(
    (panel) =>
      panel.letteringMode === "embedded" &&
      panel.imageUrl?.startsWith("data:image/"),
  );
  const previewStatus =
    generationState === "loading"
      ? "Generating"
      : generationState === "success"
        ? "Ready"
        : generationState === "error"
          ? "Needs attention"
          : "Ready to generate";

  return (
    <div className="studio-shell">
      <SiteHeader user={user} />

      <main className="studio-main" id="studio">
        <header className="studio-header">
          <div>
            <div className="header-kicker">CREATE A CHAPTER</div>
            <h1>Turn your prose into a finished vertical comic</h1>
            <p>
              Add your chapter, choose a visual direction, and generate
              lettered panels ready to read.
            </p>
          </div>
        </header>

        <div className="studio-content">
          <section
            className="source-column"
            id="source"
            aria-label="Chapter source"
          >
            <div className="panel-heading">
              <div>
                <span className="step-label">01 · CHAPTER</span>
                <h2>Add your manuscript</h2>
                <p>
                  We preserve dialogue, pacing, and character intent while
                  adapting prose for vertical storytelling.
                </p>
              </div>
              <span className="word-badge">{wordCount} words</span>
            </div>

            <div className="chapter-details">
              <label htmlFor="story-title">
                Story title
                <input
                  id="story-title"
                  type="text"
                  value={title}
                  maxLength={120}
                  autoComplete="off"
                  placeholder="e.g. The Moonlit Archive"
                  onChange={(event) => {
                    setTitle(event.target.value);
                    resetGeneratedOutput();
                  }}
                />
              </label>
              <label htmlFor="chapter-title">
                Chapter title
                <input
                  id="chapter-title"
                  type="text"
                  value={chapterTitle}
                  maxLength={160}
                  autoComplete="off"
                  placeholder="e.g. Chapter 1 · The First Bell"
                  onChange={(event) => {
                    setChapterTitle(event.target.value);
                    resetGeneratedOutput();
                  }}
                />
              </label>
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
                accept=".txt,.md,text/plain,text/markdown"
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
                    : "TXT or Markdown · up to 60,000 characters"}
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
                maxLength={60_000}
                onChange={(event) => {
                  setManuscript(event.target.value);
                  resetGeneratedOutput();
                }}
                rows={9}
                placeholder="Paste the prose you want to turn into panels…"
              />
              <div className="textarea-meta">
                <span>{manuscript.length.toLocaleString()} / 60,000 characters</span>
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
                  onChange={(event) => {
                    setStylePreset(event.target.value);
                    resetGeneratedOutput();
                  }}
                >
                  <option>Cinematic webtoon</option>
                  <option>Romantic fantasy</option>
                  <option>High-contrast noir</option>
                  <option>Painterly action</option>
                </select>
              </div>

              <div className="reference-panel-field">
                <div className="reference-panel-heading">
                  <div>
                    <strong>
                      Continuity panel <span>Optional</span>
                    </strong>
                    <p>
                      Attach one finished panel to carry its recurring
                      character cues, palette, and rendering language into
                      later novel chapters.
                    </p>
                  </div>
                  {referencePanel && (
                    <button type="button" onClick={removeReferencePanel}>
                      Remove
                    </button>
                  )}
                </div>

                <input
                  ref={referenceInputRef}
                  className="visually-hidden"
                  id="reference-panel"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleReferencePanelChange}
                />

                {referencePanel ? (
                  <div className="reference-panel-preview">
                    <Image
                      src={referencePanel.dataUrl}
                      alt="Selected visual continuity panel"
                      width={88}
                      height={112}
                      unoptimized
                    />
                    <div>
                      <strong>{referencePanel.name}</strong>
                      <span>
                        {referencePanel.width} × {referencePanel.height} · ready
                      </span>
                      <label htmlFor="reference-panel">
                        Choose another panel
                      </label>
                    </div>
                  </div>
                ) : (
                  <label
                    className="reference-panel-dropzone"
                    htmlFor="reference-panel"
                  >
                    <span aria-hidden="true">＋</span>
                    <div>
                      <strong>Attach a reference panel</strong>
                      <small>JPEG, PNG or WebP · up to 5 MB</small>
                    </div>
                  </label>
                )}
                <small className="reference-panel-note">
                  The panel guides continuity only; new scenes use different
                  poses, compositions, backgrounds, and lettering.
                </small>
              </div>
            </div>

            <div className="generation-card">
              <div className="generation-card-top">
                <div>
                  <span className="step-label">03 · GENERATE</span>
                  <h3>Create your chapter</h3>
                </div>
              </div>
              <p className="generation-description">
                Creates 3–6 illustrated, lettered panels from this chapter.
              </p>

              {user ? (
                <button
                  className="generate-button"
                  type="button"
                  data-loading={
                    generationState === "loading" ? "true" : undefined
                  }
                  disabled={
                    generationState === "loading" ||
                    !title.trim() ||
                    !chapterTitle.trim() ||
                    !manuscript.trim()
                  }
                  onClick={handleGenerate}
                >
                  <span aria-hidden="true">
                    {generationState === "loading" ? "◌" : "✦"}
                  </span>
                  {generationState === "loading"
                    ? "Generating chapter…"
                    : "Generate chapter · 1 credit"}
                </button>
              ) : (
                <a
                  className="generate-button"
                  href="/auth/login?returnTo=/studio"
                >
                  Sign in to generate
                </a>
              )}
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
                {user ? (
                  <>
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
                  </>
                ) : (
                  <a
                    className="upgrade-button"
                    href="/auth/login?returnTo=/studio"
                  >
                    Sign in to subscribe
                  </a>
                )}
              </div>
            </div>
          </section>

          <section
            className="preview-column"
            id="preview"
            aria-label="Chapter preview"
          >
            <div className="preview-heading">
              <div>
                <span className="step-label">PREVIEW</span>
                <h2>{chapterTitle.trim() || "Your generated chapter"}</h2>
              </div>
              <div className="preview-state">
                <span aria-hidden="true" />
                {previewStatus}
              </div>
            </div>

            <div className="preview-workbench">
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
                      const accessiblePanelText = [
                        `Panel ${index + 1}.`,
                        panel.narration?.trim()
                          ? `Narration: ${panel.narration.trim()}`
                          : null,
                        panel.dialogue?.trim()
                          ? `Dialogue: ${panel.dialogue.trim()}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" ");
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
                          <span className="visually-hidden">
                            {accessiblePanelText}
                          </span>
                        </div>
                      );
                    })
                  ) : (
                    <div className="preview-empty">
                      <span aria-hidden="true">✦</span>
                      <strong>
                        {generationState === "loading"
                          ? "Creating your panels…"
                          : generationState === "success"
                            ? "No panel artwork was returned"
                            : "Your chapter will appear here"}
                      </strong>
                      <p>
                        {generationState === "loading"
                          ? "Illustration and lettering are generated together."
                          : generationState === "success"
                            ? "Try generating the chapter again."
                            : "Complete the chapter details, then generate when you’re ready."}
                      </p>
                    </div>
                  )}
                </figure>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
