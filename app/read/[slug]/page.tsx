import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { CSSProperties } from "react";

import { SiteHeader } from "@/app/components/site-header";
import { getOptionalUser } from "@/lib/public-user";
import {
  getShowcaseStory,
  showcaseStories,
} from "@/lib/showcase";

export const dynamic = "force-dynamic";

export function generateStaticParams() {
  return showcaseStories.map((story) => ({ slug: story.slug }));
}

export default async function ReaderPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const story = getShowcaseStory(slug);
  if (!story) {
    notFound();
  }

  const user = await getOptionalUser();

  return (
    <div
      className="reader-shell"
      style={{ "--story-accent": story.palette } as CSSProperties}
    >
      <SiteHeader user={user} />

      <main className="reader-main">
        <div className="reader-breadcrumb">
          <Link href="/#library">← Discover</Link>
          <span>{story.status}</span>
        </div>

        <header className="reader-title">
          <div>
            <span>{story.kicker}</span>
            <h1>{story.title}</h1>
            <p>{story.description}</p>
          </div>
          <div className="reader-title-meta">
            <span>FREE PREVIEW</span>
            <strong>{story.pages.length} pages</strong>
          </div>
        </header>

        <div className="reader-pages">
          {story.pages.map((page, index) => (
            <article className="reader-page" key={page.label}>
              <div className="reader-page-label">
                <span>PAGE {String(index + 1).padStart(2, "0")}</span>
                <strong>{page.label}</strong>
              </div>
              <div
                className={`reader-panel reader-panel-${page.position}`}
              >
                <Image
                  src={story.image}
                  alt={`${story.title}: ${page.label}`}
                  fill
                  priority={index === 0}
                  sizes="(max-width: 820px) 96vw, 760px"
                />
                <div
                  className={`reader-balloon reader-balloon-${page.bubbleSide} ${
                    page.narration
                      ? "reader-balloon-narration"
                      : "reader-balloon-dialogue"
                  }`}
                >
                  {page.narration || page.dialogue}
                </div>
              </div>
            </article>
          ))}
        </div>

        <section className="reader-gate" aria-label="Create your own chapter">
          <div className="reader-gate-art">
            <Image
              src={story.image}
              alt=""
              fill
              sizes="(max-width: 820px) 96vw, 760px"
            />
          </div>
          <div className="reader-gate-copy">
            <span>{user ? "PREVIEW COMPLETE" : "FREE PREVIEW COMPLETE"}</span>
            <h2>
              {user
                ? "Turn your own chapter into the next scroll."
                : "Ready to forge a story of your own?"}
            </h2>
            <p>
              {user
                ? "Open the studio, paste a chapter you own, and generate a cinematic storyboard with embedded lettering."
                : "Sign in to transform a manuscript you own into original vertical-comic panels with embedded lettering."}
            </p>
            <div>
              {user ? (
                <Link className="reader-gate-primary" href="/studio">
                  Open the studio →
                </Link>
              ) : (
                <a
                  className="reader-gate-primary"
                  href="/auth/login?returnTo=/studio"
                >
                  Sign in to create →
                </a>
              )}
              <Link className="reader-gate-secondary" href="/#library">
                Browse another story
              </Link>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
