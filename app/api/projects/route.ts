import { desc, eq } from "drizzle-orm";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { projects, users } from "@/db/schema";
import { parseProjectInput } from "@/lib/storyboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AuthenticatedUser = {
  sub: string;
  email: string | null;
  displayName: string | null;
};

export async function GET() {
  const identity = await getAuthenticatedUser();
  if (!identity) {
    return json({ error: "Authentication required." }, 401);
  }

  try {
    const db = getDb();
    const [owner] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.auth0Sub, identity.sub))
      .limit(1);

    if (!owner) {
      return json({ projects: [] });
    }

    const projectRows = await db
      .select({
        id: projects.id,
        title: projects.title,
        chapterTitle: projects.chapterTitle,
        stylePreset: projects.stylePreset,
        status: projects.status,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt,
      })
      .from(projects)
      .where(eq(projects.userId, owner.id))
      .orderBy(desc(projects.createdAt))
      .limit(100);

    return json({ projects: projectRows });
  } catch (error) {
    return databaseError(error);
  }
}

export async function POST(request: Request) {
  const identity = await getAuthenticatedUser();
  if (!identity) {
    return json({ error: "Authentication required." }, 401);
  }

  const payload = await readJsonBody(request);
  if (!payload.ok) {
    return json({ error: payload.error }, 400);
  }

  const parsed = parseProjectInput(payload.value);
  if (!parsed.ok) {
    return json({ error: parsed.error }, 400);
  }

  try {
    const db = getDb();
    const ownerId = await upsertOwner(db, identity);
    const [project] = await db
      .insert(projects)
      .values({
        userId: ownerId,
        title: parsed.value.title,
        chapterTitle: parsed.value.chapterTitle,
        manuscript: parsed.value.manuscript,
        stylePreset: parsed.value.stylePreset,
        status: "draft",
      })
      .returning({
        id: projects.id,
        title: projects.title,
        chapterTitle: projects.chapterTitle,
        stylePreset: projects.stylePreset,
        status: projects.status,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt,
      });

    return json(
      {
        project: {
          ...project,
          manuscriptLength: parsed.value.manuscript.length,
        },
        paths: {
          projectsApi: "/api/projects",
          generationApi: "/api/generate",
        },
      },
      201,
    );
  } catch (error) {
    return databaseError(error);
  }
}

async function getAuthenticatedUser(): Promise<AuthenticatedUser | null> {
  try {
    const session = await auth0.getSession();
    const user = session?.user;
    if (!user?.sub) {
      return null;
    }

    const email =
      typeof user.email === "string" ? user.email.trim().slice(0, 320) : null;
    const preferredName =
      typeof user.name === "string"
        ? user.name
        : typeof user.nickname === "string"
          ? user.nickname
          : null;

    return {
      sub: user.sub,
      email: email || null,
      displayName: preferredName?.trim().slice(0, 200) || email || null,
    };
  } catch {
    return null;
  }
}

async function upsertOwner(
  db: ReturnType<typeof getDb>,
  identity: AuthenticatedUser,
): Promise<string> {
  const [owner] = await db
    .insert(users)
    .values({
      auth0Sub: identity.sub,
      email: identity.email,
      displayName: identity.displayName,
    })
    .onConflictDoUpdate({
      target: users.auth0Sub,
      set: {
        email: identity.email,
        displayName: identity.displayName,
        updatedAt: new Date(),
      },
    })
    .returning({ id: users.id });

  return owner.id;
}

async function readJsonBody(
  request: Request,
): Promise<
  { ok: true; value: unknown } | { ok: false; error: string }
> {
  try {
    return { ok: true, value: (await request.json()) as unknown };
  } catch {
    return { ok: false, error: "Request body must be valid JSON." };
  }
}

function databaseError(error: unknown): Response {
  if (
    error instanceof Error &&
    error.message === "DATABASE_CONNECTION_STRING is not configured."
  ) {
    return json({ error: "Database service is not configured." }, 503);
  }
  return json({ error: "The project database request failed." }, 500);
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
