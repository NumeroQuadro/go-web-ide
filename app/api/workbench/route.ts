import { NextResponse } from "next/server";

import { isAllowlistConfigured, isEmailAllowed } from "@/lib/auth/allowlist";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  type WorkbenchState,
  normalizeLayout,
} from "@/lib/workbench-shared";
import {
  createWorkbenchTab,
  deleteWorkbenchTab,
  saveWorkbenchState,
  saveWorkbenchUserSettings,
  updateWorkbenchTab,
} from "@/lib/workbench-server";
import { normalizeWorkspacePath } from "@/lib/workspace";

type SaveTabAction = {
  action: "save_tab";
  tabId: string;
  content: string;
};

type CreateTabAction = {
  action: "create_tab";
  title: string;
  content: string;
  sortIndex: number;
};

type RenameTabAction = {
  action: "rename_tab";
  tabId: string;
  title: string;
};

type DeleteTabAction = {
  action: "delete_tab";
  tabId: string;
};

type SaveStateAction = {
  action: "save_state";
  state: WorkbenchState;
};

type SaveSettingsAction = {
  action: "save_settings";
  vimModeEnabled: boolean;
};

type WorkbenchAction =
  | SaveTabAction
  | CreateTabAction
  | RenameTabAction
  | DeleteTabAction
  | SaveStateAction
  | SaveSettingsAction;

async function getAuthorizedContext() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const email = data.user.email ?? "";
  if (isAllowlistConfigured() && (!email || !isEmailAllowed(email))) {
    return NextResponse.json({ error: "access_denied" }, { status: 403 });
  }

  return { supabase, userId: data.user.id };
}

function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400 });
}

export async function POST(request: Request) {
  const authorized = await getAuthorizedContext();
  if (authorized instanceof NextResponse) {
    return authorized;
  }

  let body: WorkbenchAction;
  try {
    body = (await request.json()) as WorkbenchAction;
  } catch {
    return badRequest("invalid_json");
  }

  if (!body || typeof body !== "object" || typeof body.action !== "string") {
    return badRequest("invalid_action");
  }

  try {
    switch (body.action) {
      case "save_tab": {
        if (typeof body.tabId !== "string" || typeof body.content !== "string") {
          return badRequest("invalid_save_tab");
        }

        await updateWorkbenchTab(authorized.supabase, authorized.userId, {
          tabId: body.tabId,
          content: body.content,
        });
        return NextResponse.json({ ok: true });
      }

      case "create_tab": {
        if (
          typeof body.title !== "string" ||
          typeof body.content !== "string" ||
          typeof body.sortIndex !== "number" ||
          !Number.isFinite(body.sortIndex)
        ) {
          return badRequest("invalid_create_tab");
        }

        const tab = await createWorkbenchTab(authorized.supabase, authorized.userId, {
          title: body.title,
          content: body.content,
          sortIndex: Math.max(0, Math.trunc(body.sortIndex)),
        });
        return NextResponse.json({ tab });
      }

      case "rename_tab": {
        if (typeof body.tabId !== "string" || typeof body.title !== "string") {
          return badRequest("invalid_rename_tab");
        }

        await updateWorkbenchTab(authorized.supabase, authorized.userId, {
          tabId: body.tabId,
          title: normalizeWorkspacePath(body.title),
        });
        return NextResponse.json({ ok: true });
      }

      case "delete_tab": {
        if (typeof body.tabId !== "string") {
          return badRequest("invalid_delete_tab");
        }

        await deleteWorkbenchTab(authorized.supabase, authorized.userId, body.tabId);
        return NextResponse.json({ ok: true });
      }

      case "save_state": {
        const rawState = body.state;
        if (!rawState || typeof rawState !== "object") {
          return badRequest("invalid_state");
        }

        const openTabIds = Array.isArray(rawState.open_tab_ids)
          ? rawState.open_tab_ids.filter((id): id is string => typeof id === "string" && Boolean(id))
          : [];
        const activeTabId =
          typeof rawState.active_tab_id === "string" ? rawState.active_tab_id : null;

        await saveWorkbenchState(authorized.supabase, authorized.userId, {
          open_tab_ids: openTabIds,
          active_tab_id: activeTabId,
          layout: normalizeLayout(rawState.layout),
        });
        return NextResponse.json({ ok: true });
      }

      case "save_settings": {
        if (typeof body.vimModeEnabled !== "boolean") {
          return badRequest("invalid_settings");
        }

        await saveWorkbenchUserSettings(
          authorized.supabase,
          authorized.userId,
          body.vimModeEnabled,
        );
        return NextResponse.json({ ok: true });
      }

      default:
        return badRequest("unsupported_action");
    }
  } catch {
    return NextResponse.json({ error: "workbench_write_failed" }, { status: 500 });
  }
}
