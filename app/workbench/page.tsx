import { redirect } from "next/navigation";

import { isAllowlistConfigured, isEmailAllowed } from "@/lib/auth/allowlist";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { loadWorkbenchBootstrap } from "@/lib/workbench-server";

import { WorkbenchClient } from "./workbench-client";

export const dynamic = "force-dynamic";

export default async function WorkbenchPage() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");

  const email = data.user.email ?? "";
  if (isAllowlistConfigured() && (!email || !isEmailAllowed(email))) {
    redirect("/auth/signout?next=/login?error=access_denied");
  }

  const initialData = await loadWorkbenchBootstrap(supabase, data.user.id);

  return <WorkbenchClient email={email} initialData={initialData} />;
}
