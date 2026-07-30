import { StudioShell } from "@/app/components/studio-shell";
import { auth0 } from "@/lib/auth0";

export const dynamic = "force-dynamic";

function hasAuth0Configuration() {
  return [
    "AUTH0_DOMAIN",
    "AUTH0_CLIENT_ID",
    "AUTH0_CLIENT_SECRET",
    "AUTH0_SECRET",
    "APP_BASE_URL",
  ].every((name) => Boolean(process.env[name]?.trim()));
}

export default async function Home() {
  const authConfigured = hasAuth0Configuration();
  let user: {
    name?: string | null;
    email?: string | null;
    picture?: string | null;
  } | null = null;

  if (authConfigured) {
    try {
      const session = await auth0.getSession();

      if (session?.user) {
        user = {
          name: session.user.name,
          email: session.user.email,
          picture: session.user.picture,
        };
      }
    } catch {
      // Keep the public studio preview available if the identity service has a
      // transient issue. Protected actions still verify the session server-side.
    }
  }

  return <StudioShell authConfigured={authConfigured} user={user} />;
}
