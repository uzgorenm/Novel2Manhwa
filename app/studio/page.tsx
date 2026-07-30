import { StudioShell } from "@/app/components/studio-shell";
import { getOptionalUser } from "@/lib/public-user";

export const dynamic = "force-dynamic";

export default async function StudioPage() {
  const user = await getOptionalUser();
  return <StudioShell user={user} />;
}
