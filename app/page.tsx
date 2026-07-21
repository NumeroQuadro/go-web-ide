import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type HomeSearchParams = {
  code?: string | string[];
};

export default async function HomePage({
  searchParams,
}: {
  searchParams?: Promise<HomeSearchParams>;
}) {
  const resolved = searchParams ? await searchParams : undefined;
  const codeRaw = resolved?.code;
  const code = Array.isArray(codeRaw) ? codeRaw[0] : codeRaw;

  if (typeof code === "string" && code.length > 0) {
    redirect(`/auth/callback?code=${encodeURIComponent(code)}`);
  }
  redirect("/workbench");
}
