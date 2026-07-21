"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import {
  WORKSPACE_MODULE_PATH,
  getWorkspaceDirectory,
  getWorkspaceFileName,
  makeUniqueWorkspacePath,
  normalizeWorkspacePath,
  type WorkspaceRunFile,
} from "@/lib/workspace";
import {
  DEFAULT_CODE,
  DEFAULT_OUTPUT_HEIGHT_PX,
  DEFAULT_OUTPUT_SPLIT_PERCENT,
  DEFAULT_SIDEBAR_WIDTH_PX,
  MAX_OUTPUT_HEIGHT_PX,
  MAX_OUTPUT_SPLIT_PERCENT,
  MAX_SIDEBAR_WIDTH_PX,
  MIN_OUTPUT_HEIGHT_PX,
  MIN_OUTPUT_SPLIT_PERCENT,
  MIN_SIDEBAR_WIDTH_PX,
  type WorkbenchBootstrapData,
  type WorkbenchLayout,
  type WorkbenchState,
  type WorkbenchTab,
} from "@/lib/workbench-shared";

import { GoEditor } from "./go-editor";

type RunResult = {
  stdout: string;
  stderr: string;
  exit_code: number | null;
  duration_ms: number;
  timed_out: boolean;
  truncated: boolean;
  internal_error: boolean;
};

type Tab = WorkbenchTab;

type ExplorerNode =
  | {
      kind: "dir";
      name: string;
      path: string;
      children: ExplorerNode[];
    }
  | {
      kind: "file";
      tab: Tab;
    };

type TopbarStatusTone = "subtle" | "muted" | "danger";

type TopbarStatus = {
  label: string;
  tone: TopbarStatusTone;
  title?: string;
  busy?: boolean;
};

type TerminalBarTone = "muted" | "danger";

type TerminalBarStatus = {
  label: string;
  tone: TerminalBarTone;
  title?: string;
};

type PaletteMode = "commands" | "files";

type CommandPaletteItem = {
  id: string;
  title: string;
  hint?: string;
  leading?: ReactNode;
  onSelect: () => void;
};

const SAVE_DEBOUNCE_MS = 400;
const TERMINAL_COLLAPSED_HEIGHT_PX = 36;

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function ensureTrailingNewline(text: string) {
  return text.endsWith("\n") ? text : `${text}\n`;
}

function EmptyState({
  title,
  description,
  actions,
  variant = "panel",
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  variant?: "panel" | "terminal";
}) {
  return (
    <div
      className={`empty-state${variant === "terminal" ? " terminal" : ""}`}
      role="status"
      aria-live="polite"
    >
      <div className="empty-state-inner">
        <div className="empty-state-title">{title}</div>
        {description ? <div className="empty-state-desc">{description}</div> : null}
        {actions ? <div className="empty-state-actions">{actions}</div> : null}
      </div>
    </div>
  );
}


function getFileExtension(title: string) {
  const idx = title.lastIndexOf(".");
  if (idx === -1 || idx === title.length - 1) return "";
  return title.slice(idx + 1).toLowerCase();
}

function getFileTypeGlyph(title: string) {
  const ext = getFileExtension(title);
  if (!ext) return "TXT";
  if (ext === "go") return "GO";
  if (ext === "md") return "MD";
  if (ext === "sql") return "SQL";
  if (ext === "json") return "JSON";
  return ext.length > 4 ? ext.slice(0, 4).toUpperCase() : ext.toUpperCase();
}

function buildExplorerTree(tabs: Tab[]): ExplorerNode[] {
  const root: ExplorerNode[] = [];

  for (const tab of tabs) {
    const normalizedPath = normalizeWorkspacePath(tab.title);
    const parts = normalizedPath.split("/");
    let children = root;
    let currentPath = "";

    for (const dirName of parts.slice(0, -1)) {
      currentPath = currentPath ? `${currentPath}/${dirName}` : dirName;
      let existing = children.find(
        (node): node is Extract<ExplorerNode, { kind: "dir" }> =>
          node.kind === "dir" && node.path === currentPath,
      );
      if (!existing) {
        existing = { kind: "dir", name: dirName, path: currentPath, children: [] };
        children.push(existing);
      }
      children = existing.children;
    }

    children.push({ kind: "file", tab });
  }

  return root;
}

function getAvatarLetter(email: string) {
  const trimmed = email.trim();
  if (!trimmed) return "?";
  return trimmed[0]!.toUpperCase();
}

function errorMessage(e: unknown) {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (
    e &&
    typeof e === "object" &&
    "message" in e &&
    typeof (e as { message: unknown }).message === "string"
  ) {
    return (e as { message: string }).message;
  }
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

function getMaybeSupabaseErrorCode(e: unknown): string | null {
  if (!e || typeof e !== "object") return null;
  if (!("code" in e)) return null;
  const code = (e as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function formatSaveError(e: unknown): string {
  const code = getMaybeSupabaseErrorCode(e);
  const message = errorMessage(e);

  // Supabase/PostgREST returns "schema cache" errors when migrations weren't applied
  // (or the API schema cache hasn't reloaded yet).
  if (
    code === "PGRST204" ||
    (message.includes("schema cache") && message.includes("Could not find the table"))
  ) {
    return "Database schema missing. Apply `supabase/migrations/0001_scratchpad_schema.sql` in Supabase (SQL Editor), then run `NOTIFY pgrst, 'reload schema';` and refresh.";
  }

  if (message === "Failed to fetch") {
    return "Could not reach the app server. Refresh and try again.";
  }

  return message;
}

async function workbenchRequest<T>(payload: unknown): Promise<T> {
  const response = await fetch("api/workbench", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const bodyText = await response.text();
  let bodyJson: unknown = null;
  try {
    bodyJson = JSON.parse(bodyText) as unknown;
  } catch {
    // ignore
  }

  if (!response.ok) {
    const errorKey =
      bodyJson &&
      typeof bodyJson === "object" &&
      "error" in bodyJson &&
      typeof (bodyJson as { error?: unknown }).error === "string"
        ? String((bodyJson as { error: string }).error)
        : "";

    if (response.status === 401) {
      throw new Error("Signed out. Please sign in again.");
    }
    if (response.status === 403) {
      throw new Error(
        "Access denied. This app is allowlist-only when APP_ALLOWED_EMAILS is set.",
      );
    }

    throw new Error(
      errorKey
        ? `Sync failed (${response.status}): ${errorKey}`
        : `Sync failed (${response.status}): ${bodyText || response.statusText}`,
    );
  }

  if (!bodyJson || typeof bodyJson !== "object") {
    throw new Error("Sync failed: invalid response from server.");
  }

  return bodyJson as T;
}

function getTerminalStatusFromResult(result: RunResult): TerminalBarStatus {
  if (result.internal_error) {
    return { label: "Internal error", tone: "danger" };
  }
  if (result.timed_out) {
    return { label: "Timed out", tone: "danger" };
  }
  if (typeof result.exit_code === "number" && result.exit_code !== 0) {
    return { label: `Exit ${result.exit_code}`, tone: "danger" };
  }

  const details: string[] = [];
  if (result.truncated) details.push("Output truncated");
  if (details.length > 0) {
    return { label: "Success", tone: "muted", title: details.join(" • ") };
  }

  return { label: "Success", tone: "muted" };
}

function normalizeCommandPaletteQuery(input: string) {
  return input.trim().toLowerCase();
}

function matchesPaletteQuery(value: string, query: string) {
  if (!query) return true;
  return value.toLowerCase().includes(query);
}

export function WorkbenchClient({
  email,
  initialData,
}: {
  email: string;
  initialData: WorkbenchBootstrapData;
}) {
  const [tabs, setTabs] = useState<Tab[]>(initialData.tabs);
  const [activeTabId, setActiveTabId] = useState<string | null>(initialData.activeTabId);
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [vimModeEnabled, setVimModeEnabled] = useState(initialData.vimModeEnabled);
  const [vimStatusEl, setVimStatusEl] = useState<HTMLSpanElement | null>(null);
  const [editorFontSize, setEditorFontSize] = useState(13);
  const [loading, setLoading] = useState(false);
  const [saveQueued, setSaveQueued] = useState(false);
  const [recentlySaved, setRecentlySaved] = useState(false);
  const [pendingWrites, setPendingWrites] = useState(0);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [online, setOnline] = useState(true);
  const [tabDirty, setTabDirty] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [srcExpanded, setSrcExpanded] = useState(true);
  const [sidebarWidthPx, setSidebarWidthPx] = useState(initialData.layout.sidebar_width_px);
  const [outputHeightPx, setOutputHeightPx] = useState(initialData.layout.output_height_px);
  const [outputSplitPercent, setOutputSplitPercent] = useState(
    initialData.layout.output_split_percent,
  );
  const [resizing, setResizing] = useState<null | "sidebar" | "output">(null);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement | null>(null);
  const terminalBarTimeoutRef = useRef<number | null>(null);
  const [terminalBarStatus, setTerminalBarStatus] = useState<TerminalBarStatus | null>(null);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandPaletteMode, setCommandPaletteMode] = useState<PaletteMode>("commands");
  const [commandPaletteQuery, setCommandPaletteQuery] = useState("");
  const [commandPaletteIndex, setCommandPaletteIndex] = useState(0);
  const commandPaletteInputRef = useRef<HTMLInputElement | null>(null);
  const commandPaletteListRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const terminalBodyRef = useRef<HTMLDivElement | null>(null);

  const activeTab = useMemo(
    () => tabs.find((t) => t.id === activeTabId) ?? null,
    [activeTabId, tabs],
  );
  const explorerTree = useMemo(() => buildExplorerTree(tabs), [tabs]);
  const workspaceFilesForRun = useMemo<WorkspaceRunFile[]>(
    () =>
      tabs.map((tab) => ({
        path: normalizeWorkspacePath(tab.title),
        content: tab.content,
      })),
    [tabs],
  );
  const fileNameCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const tab of tabs) {
      const fileName = getWorkspaceFileName(tab.title);
      counts.set(fileName, (counts.get(fileName) ?? 0) + 1);
    }
    return counts;
  }, [tabs]);

  const loadFailure = Boolean(saveError && !loading && tabs.length === 0);

  const syncing = pendingWrites > 0;

  const topbarStatus = useMemo<TopbarStatus>(() => {
    if (loading) return { label: "Loading…", tone: "muted", busy: true };
    if (saveError) return { label: "Sync error", tone: "danger", title: saveError };
    if (!online) return { label: "Offline", tone: "danger" };
    if (syncing) return { label: "Syncing…", tone: "muted", busy: true };
    if (saveQueued) return { label: "Saving…", tone: "muted", busy: true };
    if (tabDirty) return { label: "Unsaved", tone: "muted" };
    if (recentlySaved) return { label: "Saved", tone: "subtle" };
    return {
      label: "Synced",
      tone: "subtle",
      title: lastSyncedAt ? `last synced ${new Date(lastSyncedAt).toLocaleString()}` : undefined,
    };
  }, [lastSyncedAt, loading, online, recentlySaved, saveError, saveQueued, syncing, tabDirty]);

  useEffect(() => {
    if (!lastSyncedAt) return;
    setRecentlySaved(true);
    const id = window.setTimeout(() => setRecentlySaved(false), 1400);
    return () => window.clearTimeout(id);
  }, [lastSyncedAt]);

  useEffect(() => {
    if (!accountMenuOpen) return;

    const onPointerDown = (event: PointerEvent) => {
      const root = accountMenuRef.current;
      if (!root) return;
      if (event.target instanceof Node && root.contains(event.target)) return;
      setAccountMenuOpen(false);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAccountMenuOpen(false);
    };

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [accountMenuOpen]);

  const layout = useMemo<WorkbenchLayout>(
    () => ({
      sidebar_width_px: sidebarWidthPx,
      output_height_px: outputHeightPx,
      output_split_percent: outputSplitPercent,
    }),
    [outputHeightPx, outputSplitPercent, sidebarWidthPx],
  );

  const buildWorkbenchState = useCallback(
    (nextTabs: Tab[] = tabs, nextActiveId: string | null = activeTabId): WorkbenchState => ({
      open_tab_ids: nextTabs.map((t) => t.id),
      active_tab_id: nextActiveId,
      layout,
    }),
    [activeTabId, layout, tabs],
  );

  const tabSaveRef = useRef<{
    timer: ReturnType<typeof setTimeout> | null;
    tabId: string | null;
    content: string;
  }>({ timer: null, tabId: null, content: "" });

  const runningRef = useRef(false);
  const sidebarWidthRef = useRef(sidebarWidthPx);
  const outputHeightRef = useRef(outputHeightPx);
  const lastExpandedOutputHeightRef = useRef(DEFAULT_OUTPUT_HEIGHT_PX);
  const outputSplitRef = useRef(outputSplitPercent);

  useEffect(() => {
    sidebarWidthRef.current = sidebarWidthPx;
  }, [sidebarWidthPx]);

  useEffect(() => {
    outputHeightRef.current = outputHeightPx;
  }, [outputHeightPx]);

  useEffect(() => {
    outputSplitRef.current = outputSplitPercent;
  }, [outputSplitPercent]);

  const activeTabIdRef = useRef<string | null>(activeTabId);

  useEffect(() => {
    activeTabIdRef.current = activeTabId;
  }, [activeTabId]);

  const beginWrite = useCallback(() => {
    setPendingWrites((count) => count + 1);
  }, []);

  const endWrite = useCallback(() => {
    setPendingWrites((count) => Math.max(0, count - 1));
  }, []);

  const markSyncedNow = useCallback(() => {
    setLastSyncedAt(Date.now());
  }, []);

  const saveTabNow = useCallback(
    async (tabId: string, content: string) => {
      setSaveError(null);
      beginWrite();
      try {
        await workbenchRequest<{ ok: true }>({
          action: "save_tab",
          tabId,
          content,
        });

        if (tabId === activeTabIdRef.current) {
          setTabDirty(false);
        }
        markSyncedNow();
      } catch (e) {
        setSaveError(formatSaveError(e));
        throw e;
      } finally {
        endWrite();
      }
    },
    [beginWrite, endWrite, markSyncedNow],
  );

  const flushTabSave = useCallback(async () => {
    const pending = tabSaveRef.current;
    if (!pending.timer || !pending.tabId) return;
    clearTimeout(pending.timer);
    pending.timer = null;
    setSaveQueued(false);
    const tabId = pending.tabId;
    const content = pending.content;
    pending.tabId = null;
    pending.content = "";
    await saveTabNow(tabId, content);
  }, [saveTabNow]);

  const scheduleTabSave = useCallback(
    (tabId: string, content: string) => {
      const pending = tabSaveRef.current;
      if (pending.timer) clearTimeout(pending.timer);
      pending.tabId = tabId;
      pending.content = content;
      setSaveQueued(true);
      pending.timer = setTimeout(() => {
        const latest = tabSaveRef.current;
        if (!latest.tabId) return;
        const id = latest.tabId;
        const c = latest.content;
        latest.timer = null;
        latest.tabId = null;
        latest.content = "";
        setSaveQueued(false);
        void saveTabNow(id, c).catch(() => {});
      }, SAVE_DEBOUNCE_MS);
    },
    [saveTabNow],
  );

  const persistWorkbenchState = useCallback(
    async (state: WorkbenchState) => {
      setSaveError(null);
      beginWrite();
      const stateWithLayout: WorkbenchState = {
        ...state,
        layout: {
          sidebar_width_px: sidebarWidthRef.current,
          output_height_px: outputHeightRef.current,
          output_split_percent: outputSplitRef.current,
        },
      };

      try {
        await workbenchRequest<{ ok: true }>({
          action: "save_state",
          state: stateWithLayout,
        });
        markSyncedNow();
      } finally {
        endWrite();
      }
    },
    [beginWrite, endWrite, markSyncedNow],
  );

  const persistUserSettings = useCallback(
    async (enabled: boolean) => {
      setSaveError(null);
      beginWrite();
      try {
        await workbenchRequest<{ ok: true }>({
          action: "save_settings",
          vimModeEnabled: enabled,
        });
        markSyncedNow();
      } finally {
        endWrite();
      }
    },
    [beginWrite, endWrite, markSyncedNow],
  );

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  useEffect(() => {
    const pending = tabSaveRef.current;
    return () => {
      if (pending.timer) clearTimeout(pending.timer);
      pending.timer = null;
      pending.tabId = null;
      pending.content = "";
    };
  }, []);

  useEffect(() => {
    const handle = () => {
      void flushTabSave().catch((e) => {
        setSaveError(formatSaveError(e));
      });
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") handle();
    };

    window.addEventListener("pagehide", handle);
    window.addEventListener("beforeunload", handle);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.removeEventListener("pagehide", handle);
      window.removeEventListener("beforeunload", handle);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [flushTabSave]);

  const retrySave = useCallback(() => {
    if (!activeTabId) return;
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab) return;
    void saveTabNow(activeTabId, tab.content).catch(() => {});
  }, [activeTabId, saveTabNow, tabs]);

  const clearTerminalOutput = useCallback(() => {
    setResult(null);
    setRunError(null);
  }, []);

  const terminalCommand = "go run .";

  const terminalCollapsed = outputHeightPx <= TERMINAL_COLLAPSED_HEIGHT_PX + 2;
  const terminalHasOutput = Boolean(result || runError || running);
  const getTabLabel = useCallback(
    (tab: Tab) => {
      const fileName = getWorkspaceFileName(tab.title);
      return (fileNameCounts.get(fileName) ?? 0) > 1 ? tab.title : fileName;
    },
    [fileNameCounts],
  );

  useEffect(() => {
    if (terminalBarTimeoutRef.current) {
      window.clearTimeout(terminalBarTimeoutRef.current);
      terminalBarTimeoutRef.current = null;
    }

    if (running) {
      setTerminalBarStatus({ label: "Running…", tone: "muted" });
      return;
    }

    if (runError) {
      setTerminalBarStatus({ label: "Error", tone: "danger", title: runError });
      return;
    }

    if (result) {
      const status = getTerminalStatusFromResult(result);
      setTerminalBarStatus(status);
      if (status.tone === "muted") {
        terminalBarTimeoutRef.current = window.setTimeout(() => {
          setTerminalBarStatus(null);
          terminalBarTimeoutRef.current = null;
        }, 2000);
      }
      return;
    }

    setTerminalBarStatus(null);
  }, [result, runError, running]);

  const run = useCallback(async () => {
    if (runningRef.current) return;
    if (!activeTab) {
      setRunError("No active file to run.");
      return;
    }

    runningRef.current = true;
    setRunning(true);
    setRunError(null);
    try {
      await flushTabSave().catch((e) => {
        setSaveError(formatSaveError(e));
      });
      const response = await fetch("api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: workspaceFilesForRun }),
      });

      const bodyText = await response.text();
      let bodyJson: unknown = null;
      try {
        bodyJson = JSON.parse(bodyText) as unknown;
      } catch {
        // ignore
      }

      if (!response.ok) {
        const errorKey =
          bodyJson &&
          typeof bodyJson === "object" &&
          "error" in bodyJson &&
          typeof (bodyJson as { error?: unknown }).error === "string"
            ? String((bodyJson as { error: string }).error)
            : "";

        if (response.status === 401) {
          throw new Error("Signed out. Please sign in again.");
        }
        if (response.status === 403) {
          throw new Error(
            "Access denied. This app is allowlist-only when APP_ALLOWED_EMAILS is set.",
          );
        }
        if (response.status === 502) {
          throw new Error(
            "Runner unavailable. Check that the runner is running and RUNNER_INTERNAL_URL/RUNNER_SHARED_SECRET are configured.",
          );
        }

        throw new Error(
          errorKey
            ? `Run failed (${response.status}): ${errorKey}`
            : `Run failed (${response.status}): ${bodyText || response.statusText}`,
        );
      }

      if (!bodyJson || typeof bodyJson !== "object") {
        throw new Error("Run failed: invalid response from server.");
      }

      setResult(bodyJson as RunResult);
    } catch (e) {
      setResult(null);
      setRunError(errorMessage(e));
    } finally {
      setRunning(false);
      runningRef.current = false;
    }
  }, [activeTab, flushTabSave, workspaceFilesForRun]);

  const setActiveTab = useCallback(
    async (tabId: string) => {
      if (tabId === activeTabId) return;
      setRenamingTabId(null);
      setRenameDraft("");

      await flushTabSave().catch((e) => {
        setSaveError(formatSaveError(e));
      });

      setActiveTabId(tabId);
      setTabDirty(false);
      try {
        await persistWorkbenchState(buildWorkbenchState(tabs, tabId));
      } catch (e) {
        setSaveError(formatSaveError(e));
      }
    },
    [activeTabId, buildWorkbenchState, flushTabSave, persistWorkbenchState, tabs],
  );

  const addTab = useCallback(async () => {
    setRenamingTabId(null);
    setRenameDraft("");

    await flushTabSave().catch((e) => {
      setSaveError(formatSaveError(e));
    });

    try {
      const nextIndex = tabs.length;
      const title =
        nextIndex === 0
          ? "main.go"
          : makeUniqueWorkspacePath(
              tabs.map((tab) => tab.title),
              `file-${nextIndex + 1}.go`,
            );

      const response = await workbenchRequest<{ tab: Tab }>({
        action: "create_tab",
        title,
        content: DEFAULT_CODE,
        sortIndex: nextIndex,
      });
      const newTab = response.tab;

      const nextTabs = [
        ...tabs,
        newTab,
      ];
      setTabs(nextTabs);
      setActiveTabId(newTab.id);
      setTabDirty(false);

      await persistWorkbenchState(buildWorkbenchState(nextTabs, newTab.id));
    } catch (e) {
      setSaveError(formatSaveError(e));
    }
  }, [buildWorkbenchState, flushTabSave, persistWorkbenchState, tabs]);

  const beginRenameTab = useCallback((tab: Tab) => {
    setRenamingTabId(tab.id);
    setRenameDraft(tab.title);
  }, []);

  const commitRenameTab = useCallback(
    async (tabId: string, rawTitle: string) => {
      const nextTitle = normalizeWorkspacePath(rawTitle);
      const existing = tabs.find((t) => t.id === tabId);
      if (!existing) return;
      const previousTitle = existing.title;
      if (tabs.some((tab) => tab.id !== tabId && tab.title === nextTitle)) {
        setSaveError(`A file already exists at ${nextTitle}.`);
        return;
      }

      setTabs((prev) =>
        prev.map((t) => (t.id === tabId ? { ...t, title: nextTitle } : t)),
      );

      try {
        await flushTabSave().catch((e) => {
          setSaveError(formatSaveError(e));
        });
        await workbenchRequest<{ ok: true }>({
          action: "rename_tab",
          tabId,
          title: nextTitle,
        });

        setRenamingTabId(null);
        setRenameDraft("");
      } catch (e) {
        setTabs((prev) =>
          prev.map((t) =>
            t.id === tabId ? { ...t, title: previousTitle } : t,
          ),
        );
        setSaveError(formatSaveError(e));
      }
    },
    [flushTabSave, tabs],
  );

  const cancelRenameTab = useCallback(() => {
    setRenamingTabId(null);
    setRenameDraft("");
  }, []);

  const deleteTab = useCallback(
    async (tabId: string) => {
      setRenamingTabId(null);
      setRenameDraft("");
      await flushTabSave().catch((e) => {
        setSaveError(formatSaveError(e));
      });

      const existing = tabs.find((t) => t.id === tabId);
      if (!existing) return;

      try {
        if (tabs.length === 1) {
          await workbenchRequest<{ ok: true }>({
            action: "rename_tab",
            tabId,
            title: "main.go",
          });
          await workbenchRequest<{ ok: true }>({
            action: "save_tab",
            tabId,
            content: DEFAULT_CODE,
          });

          const nextTabs = [{ id: tabId, title: "main.go", content: DEFAULT_CODE }];
          setTabs(nextTabs);
          setActiveTabId(tabId);
          setTabDirty(false);
          await persistWorkbenchState(buildWorkbenchState(nextTabs, tabId));
          return;
        }

        const idx = tabs.findIndex((t) => t.id === tabId);
        const remaining = tabs.filter((t) => t.id !== tabId);

        let nextActiveId = activeTabId;
        if (activeTabId === tabId) {
          nextActiveId =
            remaining[idx]?.id ??
            remaining[idx - 1]?.id ??
            remaining[0]?.id ??
            null;
        }

        await workbenchRequest<{ ok: true }>({
          action: "delete_tab",
          tabId,
        });

        setTabs(remaining);
        setActiveTabId(nextActiveId);
        setTabDirty(false);
        await persistWorkbenchState(buildWorkbenchState(remaining, nextActiveId));
      } catch (e) {
        setSaveError(formatSaveError(e));
      }
    },
    [activeTabId, buildWorkbenchState, flushTabSave, persistWorkbenchState, tabs],
  );

  const moveTab = useCallback(
    async (tabId: string, direction: -1 | 1) => {
      setRenamingTabId(null);
      setRenameDraft("");
      await flushTabSave().catch((e) => {
        setSaveError(formatSaveError(e));
      });

      const idx = tabs.findIndex((t) => t.id === tabId);
      if (idx === -1) return;
      const nextIdx = idx + direction;
      if (nextIdx < 0 || nextIdx >= tabs.length) return;

      const nextTabs = [...tabs];
      const tmp = nextTabs[idx]!;
      nextTabs[idx] = nextTabs[nextIdx]!;
      nextTabs[nextIdx] = tmp;

      setTabs(nextTabs);
      try {
        await persistWorkbenchState(buildWorkbenchState(nextTabs, activeTabId));
      } catch (e) {
        setSaveError(formatSaveError(e));
      }
    },
    [activeTabId, buildWorkbenchState, flushTabSave, persistWorkbenchState, tabs],
  );

  const toggleVim = useCallback(async () => {
    const next = !vimModeEnabled;
    setVimModeEnabled(next);
    try {
      await persistUserSettings(next);
    } catch (e) {
      setVimModeEnabled(!next);
      setSaveError(formatSaveError(e));
    }
  }, [persistUserSettings, vimModeEnabled]);

  const increaseFontSize = useCallback(() => {
    setEditorFontSize((size) => Math.min(32, size + 1));
  }, []);

  const decreaseFontSize = useCallback(() => {
    setEditorFontSize((size) => Math.max(8, size - 1));
  }, []);

  const resetFontSize = useCallback(() => {
    setEditorFontSize(13);
  }, []);

  const persistLayoutState = useCallback(async () => {
    if (tabs.length === 0) return;
    try {
      await persistWorkbenchState({
        open_tab_ids: tabs.map((t) => t.id),
        active_tab_id: activeTabId,
        layout: {
          sidebar_width_px: sidebarWidthRef.current,
          output_height_px: outputHeightRef.current,
          output_split_percent: outputSplitRef.current,
        },
      });
    } catch (e) {
      setSaveError(formatSaveError(e));
    }
  }, [activeTabId, persistWorkbenchState, tabs]);

  const toggleTerminalCollapsed = useCallback(() => {
    const currentHeight = outputHeightRef.current;
    if (currentHeight <= TERMINAL_COLLAPSED_HEIGHT_PX + 2) {
      const nextHeight = clampNumber(
        lastExpandedOutputHeightRef.current,
        TERMINAL_COLLAPSED_HEIGHT_PX,
        MAX_OUTPUT_HEIGHT_PX,
      );
      outputHeightRef.current = nextHeight;
      setOutputHeightPx(nextHeight);
    } else {
      lastExpandedOutputHeightRef.current = currentHeight;
      outputHeightRef.current = TERMINAL_COLLAPSED_HEIGHT_PX;
      setOutputHeightPx(TERMINAL_COLLAPSED_HEIGHT_PX);
    }
    void persistLayoutState();
  }, [persistLayoutState]);

  const focusExplorer = useCallback(() => {
    setSrcExpanded(true);
    requestAnimationFrame(() => {
      const activeFile = document.querySelector<HTMLButtonElement>(
        ".explorer-file.active .explorer-file-main",
      );
      if (activeFile) {
        activeFile.focus();
        return;
      }

      const rootFolder = document.querySelector<HTMLButtonElement>(
        ".explorer-row.explorer-folder",
      );
      rootFolder?.focus();
    });
  }, []);

  const focusTerminal = useCallback(() => {
    if (terminalCollapsed) toggleTerminalCollapsed();
    requestAnimationFrame(() => {
      terminalBodyRef.current?.focus();
    });
  }, [terminalCollapsed, toggleTerminalCollapsed]);

  const openCommandPalette = useCallback(
    (mode: PaletteMode) => {
      previousFocusRef.current =
        (document.activeElement instanceof HTMLElement ? document.activeElement : null);
      setAccountMenuOpen(false);
      setCommandPaletteOpen(true);
      setCommandPaletteMode(mode);
      setCommandPaletteQuery("");
      setCommandPaletteIndex(
        mode === "files" && activeTabId ? Math.max(0, tabs.findIndex((t) => t.id === activeTabId)) : 0,
      );
      requestAnimationFrame(() => {
        commandPaletteInputRef.current?.focus();
      });
    },
    [activeTabId, tabs],
  );

  const closeCommandPalette = useCallback(
    ({ restoreFocus }: { restoreFocus: boolean } = { restoreFocus: true }) => {
      setCommandPaletteOpen(false);
      setCommandPaletteQuery("");
      setCommandPaletteIndex(0);

      if (!restoreFocus) return;
      const el = previousFocusRef.current;
      if (!el) return;
      if (!document.contains(el)) return;
      requestAnimationFrame(() => el.focus());
    },
    [],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;

      const key = event.key.toLowerCase();
      const wantsFiles = key === "p" && !event.shiftKey;
      const wantsCommands = key === "k" || (key === "p" && event.shiftKey);
      if (!wantsFiles && !wantsCommands) return;
      event.preventDefault();

      if (!commandPaletteOpen) {
        openCommandPalette(wantsFiles ? "files" : "commands");
        return;
      }

      const nextMode: PaletteMode = wantsFiles ? "files" : "commands";
      if (commandPaletteMode === nextMode) {
        closeCommandPalette();
        return;
      }

      setCommandPaletteMode(nextMode);
      setCommandPaletteQuery("");
      setCommandPaletteIndex(
        nextMode === "files" && activeTabId
          ? Math.max(0, tabs.findIndex((t) => t.id === activeTabId))
          : 0,
      );
      requestAnimationFrame(() => {
        commandPaletteInputRef.current?.focus();
      });
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [
    activeTabId,
    closeCommandPalette,
    commandPaletteMode,
    commandPaletteOpen,
    openCommandPalette,
    tabs,
  ]);

  const commandPaletteItems = useMemo<CommandPaletteItem[]>(() => {
    const query = normalizeCommandPaletteQuery(commandPaletteQuery);

    if (commandPaletteMode === "files") {
      return tabs
        .filter((tab) => matchesPaletteQuery(tab.title, query))
        .map((tab) => ({
          id: tab.id,
          title: getTabLabel(tab),
          hint: getWorkspaceDirectory(tab.title) || undefined,
          leading: (
            <span className="palette-glyph" aria-hidden="true">
              {getFileTypeGlyph(tab.title)}
            </span>
          ),
          onSelect: () => {
            closeCommandPalette();
            void setActiveTab(tab.id);
          },
        }));
    }

    const activeIndex = activeTabId ? tabs.findIndex((t) => t.id === activeTabId) : -1;

    const commands: CommandPaletteItem[] = [
      {
        id: "open-file",
        title: "Open File…",
        hint: "⌘P",
        onSelect: () => {
          setCommandPaletteMode("files");
          setCommandPaletteQuery("");
          setCommandPaletteIndex(
            activeTabId ? Math.max(0, tabs.findIndex((t) => t.id === activeTabId)) : 0,
          );
          requestAnimationFrame(() => commandPaletteInputRef.current?.focus());
        },
      },
      {
        id: "new-file",
        title: "New File",
        onSelect: () => {
          closeCommandPalette();
          void addTab();
        },
      },
      ...(activeTabId
        ? [
            {
              id: "close-file",
              title: "Close File",
              onSelect: () => {
                closeCommandPalette();
                void deleteTab(activeTabId);
              },
            },
          ]
        : []),
      ...(activeTab
        ? [
            {
              id: "rename-file",
              title: "Rename File",
              onSelect: () => {
                closeCommandPalette({ restoreFocus: false });
                setSrcExpanded(true);
                beginRenameTab(activeTab);
              },
            },
          ]
        : []),
      ...(activeTabId && activeIndex > 0
        ? [
            {
              id: "move-file-up",
              title: "Move File Up",
              onSelect: () => {
                closeCommandPalette();
                void moveTab(activeTabId, -1);
              },
            },
          ]
        : []),
      ...(activeTabId && activeIndex >= 0 && activeIndex < tabs.length - 1
        ? [
            {
              id: "move-file-down",
              title: "Move File Down",
              onSelect: () => {
                closeCommandPalette();
                void moveTab(activeTabId, 1);
              },
            },
          ]
        : []),
      {
        id: "toggle-vim",
        title: vimModeEnabled ? "Disable Vim Mode" : "Enable Vim Mode",
        onSelect: () => {
          closeCommandPalette();
          void toggleVim();
        },
      },
      {
        id: "run",
        title: running ? "Running…" : "Run Code",
        hint: "⌘↵",
        onSelect: () => {
          closeCommandPalette();
          void run();
        },
      },
      {
        id: "focus-explorer",
        title: "Focus Explorer",
        onSelect: () => {
          closeCommandPalette({ restoreFocus: false });
          focusExplorer();
        },
      },
      {
        id: "focus-terminal",
        title: "Focus Terminal",
        onSelect: () => {
          closeCommandPalette({ restoreFocus: false });
          focusTerminal();
        },
      },
      {
        id: "sign-out",
        title: "Sign Out",
        onSelect: () => {
          closeCommandPalette({ restoreFocus: false });
          window.location.href = "auth/signout";
        },
      },
    ];

    return commands.filter((cmd) => matchesPaletteQuery(cmd.title, query));
  }, [
    activeTab,
    activeTabId,
    addTab,
    beginRenameTab,
    closeCommandPalette,
    commandPaletteMode,
    commandPaletteQuery,
    deleteTab,
    focusExplorer,
    focusTerminal,
    getTabLabel,
    run,
    running,
    setActiveTab,
    moveTab,
    tabs,
    toggleVim,
    vimModeEnabled,
  ]);

  useEffect(() => {
    if (!commandPaletteOpen) return;

    if (commandPaletteIndex < 0) setCommandPaletteIndex(0);
    if (commandPaletteItems.length > 0 && commandPaletteIndex >= commandPaletteItems.length) {
      setCommandPaletteIndex(commandPaletteItems.length - 1);
    }
  }, [commandPaletteIndex, commandPaletteItems.length, commandPaletteOpen]);

  useEffect(() => {
    if (!commandPaletteOpen) return;
    const root = commandPaletteListRef.current;
    if (!root) return;

    const active = root.querySelector<HTMLElement>(`[data-palette-index="${commandPaletteIndex}"]`);
    active?.scrollIntoView({ block: "nearest" });
  }, [commandPaletteIndex, commandPaletteOpen]);

  const startGlobalDrag = useCallback((cursor: string) => {
    const prevCursor = document.body.style.cursor;
    const prevUserSelect = document.body.style.userSelect;
    const prevWebkitUserSelect = (document.body.style as { webkitUserSelect?: string })
      .webkitUserSelect;
    document.body.style.cursor = cursor;
    document.body.style.userSelect = "none";
    (document.body.style as { webkitUserSelect?: string }).webkitUserSelect = "none";

    return () => {
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevUserSelect;
      (document.body.style as { webkitUserSelect?: string }).webkitUserSelect =
        prevWebkitUserSelect;
    };
  }, []);

  const onSidebarResizerPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      setResizing("sidebar");
      e.currentTarget.setPointerCapture(e.pointerId);

      const startX = e.clientX;
      const startWidth = sidebarWidthRef.current;
      const stopGlobalDrag = startGlobalDrag("col-resize");

      const onMove = (ev: PointerEvent) => {
        const next = clampNumber(
          startWidth + (ev.clientX - startX),
          MIN_SIDEBAR_WIDTH_PX,
          MAX_SIDEBAR_WIDTH_PX,
        );
        sidebarWidthRef.current = next;
        setSidebarWidthPx(next);
      };

      const onEnd = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onEnd);
        window.removeEventListener("pointercancel", onEnd);
        stopGlobalDrag();
        setResizing(null);
        void persistLayoutState();
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onEnd);
      window.addEventListener("pointercancel", onEnd);
    },
    [persistLayoutState, startGlobalDrag],
  );

  const onOutputResizerPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      setResizing("output");
      e.currentTarget.setPointerCapture(e.pointerId);

      const startY = e.clientY;
      const startHeight = outputHeightRef.current;
      const stopGlobalDrag = startGlobalDrag("row-resize");

      const onMove = (ev: PointerEvent) => {
        const next = clampNumber(
          startHeight - (ev.clientY - startY),
          MIN_OUTPUT_HEIGHT_PX,
          MAX_OUTPUT_HEIGHT_PX,
        );
        outputHeightRef.current = next;
        setOutputHeightPx(next);
      };

      const onEnd = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onEnd);
        window.removeEventListener("pointercancel", onEnd);
        stopGlobalDrag();
        setResizing(null);
        void persistLayoutState();
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onEnd);
      window.addEventListener("pointercancel", onEnd);
    },
    [persistLayoutState, startGlobalDrag],
  );

  const renderExplorerNodes = (nodes: ExplorerNode[], level: number): ReactNode =>
    nodes.map((node) => {
      if (node.kind === "dir") {
        return (
          <div key={node.path} role="presentation">
            <div
              className="explorer-row explorer-folder"
              style={{ "--level": level } as CSSProperties}
              role="treeitem"
              aria-selected={false}
            >
              <span className="explorer-chevron" aria-hidden="true">
                ▾
              </span>
              <span className="explorer-name">{node.name}</span>
            </div>
            <div className="explorer-children" role="group">
              {renderExplorerNodes(node.children, level + 1)}
            </div>
          </div>
        );
      }

      const tab = node.tab;
      const isActive = tab.id === activeTabId;
      const isRenaming = tab.id === renamingTabId;
      return (
        <div
          key={tab.id}
          className={`explorer-row explorer-file${isActive ? " active" : ""}`}
          style={{ "--level": level } as CSSProperties}
          role="treeitem"
          aria-selected={isActive}
        >
          {isRenaming ? (
            <form
              className="explorer-rename"
              onSubmit={(e) => {
                e.preventDefault();
                void commitRenameTab(tab.id, renameDraft);
              }}
            >
              <input
                value={renameDraft}
                onChange={(e) => setRenameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") cancelRenameTab();
                }}
                onBlur={() => cancelRenameTab()}
                autoFocus
                aria-label="File path"
              />
            </form>
          ) : (
            <>
              <button
                className="explorer-file-main"
                type="button"
                onClick={() => void setActiveTab(tab.id)}
                title={tab.title}
              >
                <span className="explorer-filetype" aria-hidden="true">
                  {getFileTypeGlyph(tab.title)}
                </span>
                <span className="explorer-name" title={tab.title}>
                  {getWorkspaceFileName(tab.title)}
                </span>
              </button>

              <div className="explorer-file-actions" aria-label="File actions">
                <button
                  className="explorer-action"
                  type="button"
                  title="Rename"
                  aria-label="Rename"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    beginRenameTab(tab);
                  }}
                >
                  ✎
                </button>
                <button
                  className="explorer-action"
                  type="button"
                  title="Delete"
                  aria-label="Delete"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    void deleteTab(tab.id);
                  }}
                >
                  ×
                </button>
              </div>
            </>
          )}
        </div>
      );
    });

  return (
    <div
      className="workbench"
      style={
        {
          "--sidebar-w": `${sidebarWidthPx}px`,
          "--output-h": `${outputHeightPx}px`,
          "--output-split": `${outputSplitPercent}`,
        } as CSSProperties
      }
    >
      <header className="topbar">
        <nav className="tabbar-tabs" aria-label="Open tabs" role="tablist">
          {tabs.map((tab) => {
            const isActive = tab.id === activeTabId;
            const tabLabel = getTabLabel(tab);
            return (
              <div
                key={tab.id}
                className={`tabbar-tab${isActive ? " active" : ""}${
                  isActive && tabDirty ? " dirty" : ""
                }`}
              >
                <button
                  type="button"
                  className="tabbar-tab-main"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => void setActiveTab(tab.id)}
                  title={tab.title}
                >
                  <span className="tabbar-tab-title">{tabLabel}</span>
                  {isActive && tabDirty ? (
                    <span className="tabbar-tab-dirty" aria-hidden="true" title="Unsaved" />
                  ) : null}
                </button>
                <button
                  type="button"
                  className="tabbar-tab-close"
                  aria-label={`Close ${tabLabel}`}
                  title={`Close ${tabLabel}`}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    void deleteTab(tab.id);
                  }}
                >
                  ×
                </button>
              </div>
            );
          })}
        </nav>

        <div className="tabbar-right" aria-label="Toolbar">
          <div className="run-group" aria-label="Run controls">
            <button
              className={`run-button${running ? " running" : ""}`}
              type="button"
              aria-label={running ? "Running" : "Run"}
              aria-keyshortcuts="Control+Enter Meta+Enter"
              title="Run (Ctrl+Enter / ⌘Enter)"
              onClick={() => void run()}
              disabled={running || loading}
            >
              {running ? <span className="run-spinner" aria-hidden="true" /> : null}
              {!running ? (
                <svg className="run-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                  <path d="M7 5l9 5-9 5V5z" />
                </svg>
              ) : null}
              <span className="run-text">{running ? "Running" : "Run"}</span>
              {!running ? (
                <span className="run-kbd" aria-hidden="true">
                  ⌘↵
                </span>
              ) : null}
            </button>

            <span
              key={`${topbarStatus.tone}-${topbarStatus.label}`}
              className={`topbar-status ${topbarStatus.tone}${topbarStatus.busy ? " busy" : ""}`}
              title={topbarStatus.title ?? undefined}
              aria-live="polite"
              aria-atomic="true"
            >
              {topbarStatus.busy ? (
                <span className="status-spinner" aria-hidden="true" />
              ) : null}
              {topbarStatus.label}
            </span>
          </div>

          <div className="topbar-divider" aria-hidden="true" />

          <div className="font-size-controls" aria-label="Font size controls">
            <button
              className="font-size-btn"
              type="button"
              onClick={decreaseFontSize}
              aria-label="Decrease font size"
              title="Decrease font size"
              disabled={editorFontSize <= 8}
            >
              −
            </button>
            <span className="font-size-display" title="Double-click to reset">
              <button
                className="font-size-value"
                type="button"
                onClick={resetFontSize}
                aria-label={`Font size ${editorFontSize}px (click to reset)`}
              >
                {editorFontSize}
              </button>
            </span>
            <button
              className="font-size-btn"
              type="button"
              onClick={increaseFontSize}
              aria-label="Increase font size"
              title="Increase font size"
              disabled={editorFontSize >= 32}
            >
              +
            </button>
          </div>

          <div className="topbar-divider" aria-hidden="true" />

          <button
            className="vim-toggle"
            type="button"
            onClick={toggleVim}
            aria-pressed={vimModeEnabled}
          >
            <span className="vim-toggle-label">Vim</span>
            <span className="vim-toggle-state">{vimModeEnabled ? "On" : "Off"}</span>
          </button>
          {vimModeEnabled ? (
            <div className="vim-indicator" aria-label="Vim status" aria-live="polite">
              <span className="vim-indicator-label">Vim</span>
              <span className="vim-indicator-status" ref={setVimStatusEl} />
            </div>
          ) : null}

          <div className="account-menu" ref={accountMenuRef}>
            <button
              className="account-trigger"
              type="button"
              aria-haspopup="menu"
              aria-expanded={accountMenuOpen}
              aria-label="Account"
              title="Account"
              onClick={() => setAccountMenuOpen((open) => !open)}
            >
              <span className="account-letter" aria-hidden="true">
                {getAvatarLetter(email)}
              </span>
            </button>
            {accountMenuOpen ? (
              <div className="account-popover" role="menu" aria-label="Account menu">
                <div className="account-email" role="presentation" title={email}>
                  {email}
                </div>
                <div className="account-sep" role="presentation" />
                <form action="auth/signout" method="post">
                  <button className="account-menu-item" type="submit" role="menuitem">
                    Sign out
                  </button>
                </form>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <aside className="sidebar" aria-label="File explorer">
        <div className="sidebar-header">EXPLORER</div>
        <div className="sidebar-meta">module {WORKSPACE_MODULE_PATH}</div>

        <div className="explorer-tree" role="tree">
	          <button
	            className="explorer-row explorer-folder"
	            style={{ "--level": 0 } as CSSProperties}
	            type="button"
            onClick={() => setSrcExpanded((prev) => !prev)}
            aria-expanded={srcExpanded}
            aria-selected={false}
            role="treeitem"
          >
	            <span className="explorer-chevron" aria-hidden="true">
	              {srcExpanded ? "▾" : "▸"}
	            </span>
	            <span className="explorer-name">workspace</span>
	          </button>

          {srcExpanded ? (
            <div className="explorer-children" role="group">
              {!loading && tabs.length === 0 ? (
                <div className="explorer-empty" role="presentation">
                  <div className="explorer-empty-title">No files</div>
                  <div className="explorer-empty-desc">
                    Create a new file to start coding.
                  </div>
                </div>
              ) : (
                renderExplorerNodes(explorerTree, 1)
              )}
            </div>
          ) : null}

        </div>

        <button
          className="explorer-new-file"
          type="button"
          onClick={() => void addTab()}
        >
          + New File
        </button>
      </aside>

      <div
        className={`resizer vertical sidebar-resizer${resizing === "sidebar" ? " dragging" : ""}`}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        onPointerDown={onSidebarResizerPointerDown}
        onDoubleClick={() => {
          sidebarWidthRef.current = DEFAULT_SIDEBAR_WIDTH_PX;
          setSidebarWidthPx(DEFAULT_SIDEBAR_WIDTH_PX);
          void persistLayoutState();
        }}
        title="Drag to resize sidebar"
      />

      <main className="editor">

        {saveError ? (
          <div className="alert save-alert" role="alert">
            <div className="save-alert-message" title={saveError}>
              {loadFailure ? "Failed to load workbench: " : "Autosave failed: "}
              {saveError}
            </div>
            {activeTab && activeTabId ? (
              <button
                className="button secondary"
                type="button"
                onClick={retrySave}
                disabled={syncing}
              >
                Retry save
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="editor-body">
          {activeTab && activeTabId ? (
            <GoEditor
              tabId={activeTabId}
              value={activeTab.content}
              onRun={() => void run()}
              onChange={(next) => {
                const id = activeTabId;
                setTabDirty(true);
                setTabs((prev) =>
                  prev.map((t) => (t.id === id ? { ...t, content: next } : t)),
                );
                scheduleTabSave(id, next);
              }}
              vimEnabled={vimModeEnabled}
              vimStatusEl={vimStatusEl}
              fontSize={editorFontSize}
            />
          ) : (
            <EmptyState
              title={
                loading
                  ? "Loading files…"
                  : tabs.length === 0
                    ? "No files"
                    : "No file selected"
              }
              description={
                loading ? undefined : tabs.length === 0 ? (
                  "Create a new file to start coding."
                ) : (
                  "Select a file in Explorer, or open one with ⌘P / Ctrl+P."
                )
              }
              actions={
                loading ? null : tabs.length === 0 ? (
                  <button className="button" type="button" onClick={() => void addTab()}>
                    New File
                  </button>
                ) : (
                  <button
                    className="button secondary"
                    type="button"
                    onClick={() => openCommandPalette("files")}
                  >
                    Open File…
                  </button>
                )
              }
            />
          )}
        </div>
      </main>

      <div
        className={`resizer horizontal output-resizer${resizing === "output" ? " dragging" : ""}`}
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize terminal panel"
        onPointerDown={onOutputResizerPointerDown}
        onDoubleClick={() => {
          outputHeightRef.current = DEFAULT_OUTPUT_HEIGHT_PX;
          setOutputHeightPx(DEFAULT_OUTPUT_HEIGHT_PX);
          void persistLayoutState();
        }}
        title="Drag to resize terminal panel"
      />

      <section className="terminal" aria-label="Terminal">
        <div className="terminal-bar" aria-label="Terminal toolbar">
          <div className="terminal-bar-left">
            <div className="terminal-bar-title">Terminal</div>
            {terminalBarStatus ? (
              <span
                key={`${terminalBarStatus.tone}-${terminalBarStatus.label}`}
                className={`terminal-bar-status ${terminalBarStatus.tone}`}
                title={terminalBarStatus.title ?? undefined}
                aria-live="polite"
                aria-atomic="true"
              >
                {terminalBarStatus.label}
              </span>
            ) : null}
          </div>

          <div className="terminal-bar-actions">
            <button
              className="terminal-action"
              type="button"
              aria-label="Clear output"
              title="Clear output"
              onClick={clearTerminalOutput}
              disabled={!terminalHasOutput || running}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                <path d="M6 6l8 8M14 6l-8 8" />
              </svg>
            </button>

            <button
              className="terminal-action"
              type="button"
              aria-label={terminalCollapsed ? "Expand terminal" : "Collapse terminal"}
              title={terminalCollapsed ? "Expand terminal" : "Collapse terminal"}
              onClick={toggleTerminalCollapsed}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                {terminalCollapsed ? (
                  <path d="M6 12l4-4 4 4" />
                ) : (
                  <path d="M6 8l4 4 4-4" />
                )}
              </svg>
            </button>
          </div>
        </div>

        {!terminalCollapsed ? (
          <div
            className="terminal-body"
            role="log"
            aria-live="polite"
            tabIndex={0}
            ref={terminalBodyRef}
          >
            {terminalHasOutput ? (
              <pre className="terminal-pre">
                <>
                  <span className="terminal-prompt">$ </span>
                  {terminalCommand}
                  {"\n"}
                  {running && !result && !runError ? (
                    <span className="terminal-muted">running…{"\n"}</span>
                  ) : null}
                  {runError ? (
                    <span className="terminal-stderr">{ensureTrailingNewline(runError)}</span>
                  ) : null}
                  {result ? (
                    <>
                      {result.stdout ? (
                        <span className="terminal-stdout">
                          {ensureTrailingNewline(result.stdout)}
                        </span>
                      ) : null}
                      {result.stderr ? (
                        <span className="terminal-stderr">
                          {ensureTrailingNewline(result.stderr)}
                        </span>
                      ) : null}
                      {"\n"}
                      <span
                        className={`terminal-status${result.exit_code === 0 ? " ok" : " danger"}`}
                      >
                        {[
                          `exit ${result.exit_code ?? "?"}`,
                          `${result.duration_ms}ms`,
                          result.timed_out ? "timed out" : null,
                          result.truncated ? "truncated" : null,
                          result.internal_error ? "internal error" : null,
                        ]
                          .filter(Boolean)
                          .join(" • ")}
                      </span>
                      {"\n"}
                    </>
                  ) : null}
                </>
              </pre>
            ) : (
              <EmptyState
                variant="terminal"
                title="No output"
                description={
                  <>
                    Run (⌘↵ / Ctrl+Enter) to execute{" "}
                    <span className="terminal-empty-command">{terminalCommand}</span>.
                  </>
                }
              />
            )}
          </div>
        ) : null}
      </section>

      {commandPaletteOpen ? (
        <div
          className="palette-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={commandPaletteMode === "files" ? "Open file" : "Command palette"}
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) closeCommandPalette();
          }}
        >
          <div
            className="palette-panel"
            onPointerDown={(e) => {
              e.stopPropagation();
            }}
          >
            <div className="palette-input-row">
              <input
                ref={commandPaletteInputRef}
                className="palette-input"
                value={commandPaletteQuery}
                onChange={(e) => {
                  setCommandPaletteQuery(e.target.value);
                  setCommandPaletteIndex(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    closeCommandPalette();
                    return;
                  }

                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setCommandPaletteIndex((idx) =>
                      Math.min(commandPaletteItems.length - 1, idx + 1),
                    );
                    return;
                  }

                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setCommandPaletteIndex((idx) => Math.max(0, idx - 1));
                    return;
                  }

                  if (e.key === "Enter") {
                    e.preventDefault();
                    const item = commandPaletteItems[commandPaletteIndex];
                    item?.onSelect();
                  }
                }}
                placeholder={commandPaletteMode === "files" ? "Search files…" : "Type a command…"}
                aria-label={commandPaletteMode === "files" ? "Search files" : "Search commands"}
                aria-activedescendant={
                  commandPaletteItems[commandPaletteIndex]
                    ? `palette-item-${commandPaletteItems[commandPaletteIndex]!.id}`
                    : undefined
                }
              />
            </div>

            <div
              ref={commandPaletteListRef}
              className="palette-list"
              role="listbox"
              aria-label="Command palette results"
            >
              {commandPaletteItems.length === 0 ? (
                <div className="palette-empty">No results</div>
              ) : (
                commandPaletteItems.map((item, idx) => (
                  <button
                    key={item.id}
                    id={`palette-item-${item.id}`}
                    data-palette-index={idx}
                    type="button"
                    className={`palette-item${idx === commandPaletteIndex ? " active" : ""}`}
                    role="option"
                    aria-selected={idx === commandPaletteIndex}
                    tabIndex={-1}
                    onPointerMove={() => setCommandPaletteIndex(idx)}
                    onClick={() => item.onSelect()}
                  >
                    <span className="palette-item-left">
                      {item.leading ? item.leading : null}
                      <span className="palette-item-title">{item.title}</span>
                    </span>
                    {item.hint ? (
                      <span className="palette-item-hint" aria-hidden="true">
                        {item.hint}
                      </span>
                    ) : null}
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
