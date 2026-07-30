import Image from "next/image";
import Link from "next/link";
import type { CSSProperties } from "react";

import { SiteHeader } from "@/app/components/site-header";
import { showcaseStories } from "@/lib/showcase";

type LibraryHomeProps = {
  user?: {
    name?: string | null;
    email?: string | null;
  } | null;
};

export function LibraryHome({ user = null }: LibraryHomeProps) {
  const hero = showcaseStories[3];

  return (
    <div className="library-shell">
      <SiteHeader user={user} />

      <main>
        <section className="library-hero">
          <div className="hero-copy">
            <span className="hero-kicker">
              <i aria-hidden="true" />
              LIGHT NOVELS, VISUALIZED
            </span>
            <h1>
              Read the opening.
              <br />
              <span>Forge what comes next.</span>
            </h1>
            <p>
              Explore free vertical-comic previews, then turn your own prose
              into cinematic, lettered manhwa panels.
            </p>
            <div className="hero-actions">
              <Link className="hero-primary" href="#library">
                Browse free previews <span aria-hidden="true">↓</span>
              </Link>
              <Link className="hero-secondary" href="/studio">
                Open the studio <span aria-hidden="true">↗</span>
              </Link>
            </div>
            <div className="hero-proof">
              <span>3 preview pages free</span>
              <span>Original lettering</span>
              <span>No account required</span>
            </div>
          </div>

          <Link
            className="hero-feature"
            href={`/read/${hero.slug}`}
            style={{ "--story-accent": hero.palette } as CSSProperties}
          >
            <Image
              src={hero.image}
              alt="An archivist enters a moonlit floating library"
              fill
              priority
              sizes="(max-width: 900px) 92vw, 46vw"
            />
            <span className="hero-feature-shade" />
            <span className="hero-feature-top">
              <i>FEATURED ORIGINAL</i>
              <b>3 FREE PAGES</b>
            </span>
            <span className="hero-feature-copy">
              <small>{hero.kicker}</small>
              <strong>{hero.title}</strong>
              <span>Read the opening chapter →</span>
            </span>
          </Link>
        </section>

        <section className="library-section" id="library">
          <div className="library-heading">
            <div>
              <span className="section-kicker">CURATED OPENINGS</span>
              <h2>Start with a story worth scrolling</h2>
            </div>
            <p>
              Public-domain Chinese classics and an original cultivation
              serial, reimagined as high-fidelity vertical previews.
            </p>
          </div>

          <div className="story-grid">
            {showcaseStories.map((story, index) => (
              <Link
                className="story-card"
                href={`/read/${story.slug}`}
                key={story.slug}
                style={
                  {
                    "--story-accent": story.palette,
                  } as CSSProperties
                }
              >
                <span className="story-art">
                  <Image
                    src={story.image}
                    alt=""
                    fill
                    sizes="(max-width: 720px) 92vw, (max-width: 1100px) 44vw, 22vw"
                    style={{
                      objectPosition:
                        index === 3 ? "center 12%" : "center top",
                    }}
                  />
                  <span className="story-number">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="story-badge">{story.status}</span>
                </span>
                <span className="story-copy">
                  <small>{story.kicker}</small>
                  <strong>{story.title}</strong>
                  <span>{story.description}</span>
                  <span className="story-tags">
                    {story.genres.map((genre) => (
                      <i key={genre}>{genre}</i>
                    ))}
                  </span>
                  <b>Read 3 pages free →</b>
                </span>
              </Link>
            ))}
          </div>
        </section>

        <section className="library-process">
          <div className="process-copy">
            <span className="section-kicker">FROM MANUSCRIPT TO MANHWA</span>
            <h2>Your chapter already has a camera. PanelForge finds it.</h2>
            <p>
              Paste prose, direct the visual tone, and receive a storyboard
              with consistent beats, embedded dialogue, and production-ready
              vertical panels.
            </p>
            <Link href="/studio">Create a chapter →</Link>
          </div>
          <div className="process-steps">
            <span>
              <i>01</i>
              <b>Paste</b>
              <small>Bring a chapter you own or are authorized to adapt.</small>
            </span>
            <span>
              <i>02</i>
              <b>Direct</b>
              <small>Choose pacing, mood, and visual treatment.</small>
            </span>
            <span>
              <i>03</i>
              <b>Generate</b>
              <small>Get art, balloons, and lettering in one scroll.</small>
            </span>
          </div>
        </section>
      </main>

      <footer className="library-footer">
        <span>PANELFORGE · FROM PROSE TO PANELS</span>
        <span>Preview adaptations use public-domain or original material.</span>
      </footer>
    </div>
  );
}
