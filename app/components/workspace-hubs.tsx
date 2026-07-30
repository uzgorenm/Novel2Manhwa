"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

import { SiteHeader } from "@/app/components/site-header";
import type { PublicUser } from "@/lib/public-user";

type HubProps = {
  user?: PublicUser | null;
};

function HubFrame({
  user,
  kicker,
  title,
  description,
  children,
}: HubProps & {
  kicker: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="workspace-shell">
      <SiteHeader user={user} />
      <main className="workspace-main">
        <header className="workspace-heading">
          <div>
            <span>{kicker}</span>
            <h1>{title}</h1>
            <p>{description}</p>
          </div>
          {user ? (
            <Link href="/studio#source">Create chapter ↗</Link>
          ) : (
            <a href="/auth/login?returnTo=/studio">Create chapter ↗</a>
          )}
        </header>
        {children}
      </main>
    </div>
  );
}

type ProjectSummary = {
  id: string;
  title: string;
  chapterTitle: string;
  stylePreset: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

type ProjectsState =
  | { kind: "loading" }
  | { kind: "ready"; projects: ProjectSummary[] }
  | { kind: "auth-required" }
  | { kind: "error" };

export function ProjectsHub({ user }: HubProps) {
  const [state, setState] = useState<ProjectsState>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    void requestProjects(controller.signal).then(setState).catch((error) => {
      if (!isAbortError(error)) {
        setState({ kind: "error" });
      }
    });
    return () => controller.abort();
  }, []);

  function retryProjects() {
    setState({ kind: "loading" });
    void requestProjects()
      .then(setState)
      .catch(() => setState({ kind: "error" }));
  }

  return (
    <HubFrame
      user={user}
      kicker="YOUR GENERATIONS"
      title="Generation history"
      description="A record of chapters you have generated and their current status."
    >
      <div className="hub-grid project-grid" id="new-project">
        {user ? (
          <Link className="new-project-card" href="/studio#source">
            <span>＋</span>
            <strong>Create chapter</strong>
            <small>Paste or upload your manuscript</small>
          </Link>
        ) : (
          <a
            className="new-project-card"
            href="/auth/login?returnTo=/studio"
          >
            <span>＋</span>
            <strong>Create chapter</strong>
            <small>Paste or upload your manuscript</small>
          </a>
        )}
        <ProjectsContent state={state} onRetry={retryProjects} />
      </div>
    </HubFrame>
  );
}

async function requestProjects(signal?: AbortSignal): Promise<ProjectsState> {
  const response = await fetch("/api/projects", {
    cache: "no-store",
    signal,
  });

  if (response.status === 401) {
    return { kind: "auth-required" };
  }

  if (!response.ok) {
    return { kind: "error" };
  }

  const payload = (await response.json()) as { projects?: unknown };
  if (!Array.isArray(payload.projects)) {
    return { kind: "error" };
  }

  return {
    kind: "ready",
    projects: payload.projects.filter(isProjectSummary),
  };
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function ProjectsContent({
  state,
  onRetry,
}: {
  state: ProjectsState;
  onRetry: () => void;
}) {
  if (state.kind === "loading") {
    return (
      <article className="project-hub-card" aria-live="polite" aria-busy="true">
        <span className="project-hub-cover project-hub-cover-blue">LOADING</span>
        <div>
          <small>YOUR HISTORY</small>
          <h2>Loading chapter history…</h2>
          <p>This should only take a moment.</p>
        </div>
      </article>
    );
  }

  if (state.kind === "auth-required") {
    return (
      <article className="project-hub-card">
        <span className="project-hub-cover project-hub-cover-blue">PRIVATE</span>
        <div>
          <small>SIGN IN REQUIRED</small>
          <h2>See your generation history</h2>
          <p>Sign in to securely access chapter records linked to your account.</p>
          <a href="/auth/login?returnTo=/projects">Sign in →</a>
        </div>
      </article>
    );
  }

  if (state.kind === "error") {
    return (
      <article className="project-hub-card" role="alert">
        <span className="project-hub-cover project-hub-cover-blue">RETRY</span>
        <div>
          <small>COULD NOT LOAD</small>
          <h2>Your history is temporarily unavailable</h2>
          <p>Please try again. Your chapter records have not been changed.</p>
          <button className="site-cta" type="button" onClick={onRetry}>
            Try again
          </button>
        </div>
      </article>
    );
  }

  if (state.projects.length === 0) {
    return (
      <article className="project-hub-card">
        <span className="project-hub-cover project-hub-cover-blue">NEW</span>
        <div>
          <small>NO GENERATIONS YET</small>
          <h2>Your first chapter starts here</h2>
          <p>Create a chapter to add it to your generation history.</p>
          <Link href="/studio#source">Create chapter →</Link>
        </div>
      </article>
    );
  }

  return state.projects.map((project, index) => (
    <article className="project-hub-card" key={project.id}>
      <span
        className={`project-hub-cover ${
          index % 2 === 0
            ? "project-hub-cover-blue"
            : "project-hub-cover-green"
        }`}
      >
        {formatStyle(project.stylePreset)}
      </span>
      <div>
        <small>
          {formatStatus(project.status)} · UPDATED {formatDate(project.updatedAt)}
        </small>
        <h2>{project.title}</h2>
        <p>{project.chapterTitle}</p>
      </div>
    </article>
  ));
}

function isProjectSummary(value: unknown): value is ProjectSummary {
  if (!value || typeof value !== "object") {
    return false;
  }

  const project = value as Record<string, unknown>;
  return (
    typeof project.id === "string" &&
    typeof project.title === "string" &&
    typeof project.chapterTitle === "string" &&
    typeof project.stylePreset === "string" &&
    typeof project.status === "string" &&
    typeof project.createdAt === "string" &&
    typeof project.updatedAt === "string"
  );
}

function formatStatus(status: string) {
  return status.replaceAll("_", " ").toUpperCase();
}

function formatStyle(style: string) {
  return style.replaceAll("-", " ").toUpperCase();
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "RECENTLY";
  }

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}
