import Link from "next/link";

type SiteHeaderProps = {
  user?: {
    name?: string | null;
    email?: string | null;
  } | null;
};

export function SiteHeader({ user = null }: SiteHeaderProps) {
  return (
    <header className="site-header">
      <Link className="site-brand" href="/" aria-label="PanelForge home">
        <span className="brand-mark" aria-hidden="true">
          PF
        </span>
        <span>
          <strong>PANELFORGE</strong>
          <small>Stories, forged vertically.</small>
        </span>
      </Link>

      <nav className="site-nav" aria-label="Main navigation">
        <Link href="/#library">Discover</Link>
        <Link href="/studio">Create</Link>
        <Link href="/projects">History</Link>
      </nav>

      <div className="site-actions">
        {user ? (
          <>
            <span className="site-user">{user.name || user.email}</span>
            <a className="site-sign-out" href="/auth/logout">
              Sign out
            </a>
          </>
        ) : (
          <>
            <a className="site-sign-in" href="/auth/login">
              Sign in
            </a>
            <a className="site-cta" href="/auth/login?returnTo=/studio">
              Start creating
            </a>
          </>
        )}
      </div>
    </header>
  );
}
