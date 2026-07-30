import { LibraryHome } from "@/app/components/library-home";
import { getOptionalUser } from "@/lib/public-user";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getOptionalUser();
  return <LibraryHome user={user} />;
}
