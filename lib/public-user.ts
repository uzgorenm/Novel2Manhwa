import "server-only";

import { auth0 } from "@/lib/auth0";

export type PublicUser = {
  name?: string | null;
  email?: string | null;
  picture?: string | null;
};

export function hasAuth0Configuration() {
  return [
    "AUTH0_DOMAIN",
    "AUTH0_CLIENT_ID",
    "AUTH0_CLIENT_SECRET",
    "AUTH0_SECRET",
    "APP_BASE_URL",
  ].every((name) => Boolean(process.env[name]?.trim()));
}

export async function getOptionalUser(): Promise<PublicUser | null> {
  if (!hasAuth0Configuration()) {
    return null;
  }

  try {
    const session = await auth0.getSession();
    if (!session?.user) {
      return null;
    }
    return {
      name: session.user.name,
      email: session.user.email,
      picture: session.user.picture,
    };
  } catch {
    return null;
  }
}
