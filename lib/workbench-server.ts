import { type SupabaseClient } from "@supabase/supabase-js";

import {
  DEFAULT_CODE,
  type WorkbenchBootstrapData,
  type WorkbenchState,
  type WorkbenchTab,
  normalizeLayout,
} from "@/lib/workbench-shared";
import { normalizeWorkspacePath } from "@/lib/workspace";

function nowIso() {
  return new Date().toISOString();
}

async function persistWorkbenchState(
  supabase: SupabaseClient,
  userId: string,
  state: WorkbenchState,
) {
  const { error } = await supabase
    .from("scratchpad_workbench_state")
    .upsert(
      { user_id: userId, state, updated_at: nowIso() },
      { onConflict: "user_id" },
    );

  if (error) throw error;
}

async function persistUserSettings(
  supabase: SupabaseClient,
  userId: string,
  vimModeEnabled: boolean,
) {
  const { error } = await supabase
    .from("scratchpad_user_settings")
    .upsert(
      { user_id: userId, vim_mode_enabled: vimModeEnabled, updated_at: nowIso() },
      { onConflict: "user_id" },
    );

  if (error) throw error;
}

async function listTabs(
  supabase: SupabaseClient,
  userId: string,
): Promise<WorkbenchTab[]> {
  const { data, error } = await supabase
    .from("scratchpad_tabs")
    .select("id,title,content")
    .eq("user_id", userId)
    .order("sort_index", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw error;

  return (data ?? []).map((tab) => ({
    id: tab.id,
    title: normalizeWorkspacePath(tab.title),
    content: tab.content,
  }));
}

async function createDefaultTab(
  supabase: SupabaseClient,
  userId: string,
): Promise<WorkbenchTab> {
  const { data, error } = await supabase
    .from("scratchpad_tabs")
    .insert({
      user_id: userId,
      title: "main.go",
      content: DEFAULT_CODE,
      sort_index: 0,
    })
    .select("id,title,content")
    .single();

  if (error) throw error;

  return {
    id: data.id,
    title: normalizeWorkspacePath(data.title),
    content: data.content,
  };
}

export async function loadWorkbenchBootstrap(
  supabase: SupabaseClient,
  userId: string,
): Promise<WorkbenchBootstrapData> {
  const { data: settingsRow, error: settingsError } = await supabase
    .from("scratchpad_user_settings")
    .select("vim_mode_enabled")
    .eq("user_id", userId)
    .maybeSingle();
  if (settingsError) throw settingsError;

  const vimModeEnabled = Boolean(settingsRow?.vim_mode_enabled ?? false);
  if (!settingsRow) {
    await persistUserSettings(supabase, userId, vimModeEnabled);
  }

  const { data: stateRow, error: stateError } = await supabase
    .from("scratchpad_workbench_state")
    .select("state")
    .eq("user_id", userId)
    .maybeSingle();
  if (stateError) throw stateError;

  const layout = normalizeLayout(
    stateRow?.state && typeof stateRow.state === "object"
      ? (stateRow.state as { layout?: unknown }).layout
      : null,
  );

  const createDefaultBootstrap = async (): Promise<WorkbenchBootstrapData> => {
    const tab = await createDefaultTab(supabase, userId);
    await persistWorkbenchState(supabase, userId, {
      open_tab_ids: [tab.id],
      active_tab_id: tab.id,
      layout,
    });

    return {
      tabs: [tab],
      activeTabId: tab.id,
      layout,
      vimModeEnabled,
    };
  };

  const adoptAllTabs = async (): Promise<WorkbenchBootstrapData | null> => {
    const tabs = await listTabs(supabase, userId);
    if (tabs.length === 0) return null;

    await persistWorkbenchState(supabase, userId, {
      open_tab_ids: tabs.map((tab) => tab.id),
      active_tab_id: tabs[0]!.id,
      layout,
    });

    return {
      tabs,
      activeTabId: tabs[0]!.id,
      layout,
      vimModeEnabled,
    };
  };

  if (!stateRow?.state) {
    return (await adoptAllTabs()) ?? (await createDefaultBootstrap());
  }

  const state = stateRow.state as Partial<WorkbenchState>;
  const rawOpenIds = Array.isArray(state.open_tab_ids) ? state.open_tab_ids : [];
  const openIds = [
    ...new Set(
      rawOpenIds.filter(
        (id): id is string => typeof id === "string" && Boolean(id),
      ),
    ),
  ];
  const activeId = typeof state.active_tab_id === "string" ? state.active_tab_id : null;

  if (openIds.length === 0) {
    return (await adoptAllTabs()) ?? (await createDefaultBootstrap());
  }

  const { data: tabRows, error: tabError } = await supabase
    .from("scratchpad_tabs")
    .select("id,title,content")
    .eq("user_id", userId)
    .in("id", openIds);
  if (tabError) throw tabError;

  const byId = new Map<string, WorkbenchTab>(
    (tabRows ?? []).map((tab) => [
      tab.id,
      {
        id: tab.id,
        title: normalizeWorkspacePath(tab.title),
        content: tab.content,
      },
    ]),
  );

  const tabs = openIds.map((id) => byId.get(id)).filter(Boolean) as WorkbenchTab[];
  if (tabs.length === 0) {
    return (await adoptAllTabs()) ?? (await createDefaultBootstrap());
  }

  const nextActiveId = activeId && byId.has(activeId) ? activeId : tabs[0]!.id;
  const nextOpenIds = tabs.map((tab) => tab.id);
  const shouldPersist =
    nextActiveId !== activeId ||
    nextOpenIds.length !== openIds.length ||
    nextOpenIds.some((id, idx) => id !== openIds[idx]);

  if (shouldPersist) {
    await persistWorkbenchState(supabase, userId, {
      open_tab_ids: nextOpenIds,
      active_tab_id: nextActiveId,
      layout,
    });
  }

  return {
    tabs,
    activeTabId: nextActiveId,
    layout,
    vimModeEnabled,
  };
}

export async function updateWorkbenchTab(
  supabase: SupabaseClient,
  userId: string,
  input: {
    tabId: string;
    title?: string;
    content?: string;
  },
) {
  const patch: Record<string, string> = {
    updated_at: nowIso(),
  };

  if (typeof input.title === "string") {
    patch.title = normalizeWorkspacePath(input.title);
  }
  if (typeof input.content === "string") {
    patch.content = input.content;
  }

  const { error } = await supabase
    .from("scratchpad_tabs")
    .update(patch)
    .eq("id", input.tabId)
    .eq("user_id", userId);

  if (error) throw error;
}

export async function createWorkbenchTab(
  supabase: SupabaseClient,
  userId: string,
  input: {
    title: string;
    content: string;
    sortIndex: number;
  },
): Promise<WorkbenchTab> {
  const { data, error } = await supabase
    .from("scratchpad_tabs")
    .insert({
      user_id: userId,
      title: normalizeWorkspacePath(input.title),
      content: input.content,
      sort_index: input.sortIndex,
    })
    .select("id,title,content")
    .single();

  if (error) throw error;

  return {
    id: data.id,
    title: normalizeWorkspacePath(data.title),
    content: data.content,
  };
}

export async function deleteWorkbenchTab(
  supabase: SupabaseClient,
  userId: string,
  tabId: string,
) {
  const { error } = await supabase
    .from("scratchpad_tabs")
    .delete()
    .eq("id", tabId)
    .eq("user_id", userId);

  if (error) throw error;
}

export async function saveWorkbenchState(
  supabase: SupabaseClient,
  userId: string,
  state: WorkbenchState,
) {
  await persistWorkbenchState(supabase, userId, state);
}

export async function saveWorkbenchUserSettings(
  supabase: SupabaseClient,
  userId: string,
  vimModeEnabled: boolean,
) {
  await persistUserSettings(supabase, userId, vimModeEnabled);
}
