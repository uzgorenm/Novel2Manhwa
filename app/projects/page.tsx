import { ProjectsHub } from "@/app/components/workspace-hubs";
import { getOptionalUser } from "@/lib/public-user";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  return <ProjectsHub user={await getOptionalUser()} />;
}
