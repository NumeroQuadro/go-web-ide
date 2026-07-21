"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef } from "react";

import type * as monaco from "monaco-editor";
import type { VimAdapterInstance } from "monaco-vim";

const GOOFY_LIGHT_THEME: monaco.editor.IStandaloneThemeData = {
  base: "vs",
  inherit: true,
  rules: [
    { token: "", foreground: "1e1e2e" },
    { token: "comment", foreground: "a0a1b2" },
    { token: "keyword", foreground: "d946ef" },
    { token: "number", foreground: "0891b2" },
    { token: "string", foreground: "16a34a" },
    { token: "type", foreground: "ca8a04" },
    { token: "delimiter", foreground: "6e7191" },
  ],
  colors: {
    "editor.background": "#ffffff",
    "editor.foreground": "#1e1e2e",
    "editorCursor.foreground": "#3b82f6",
    "editorLineNumber.foreground": "#c4c4cc",
    "editorLineNumber.activeForeground": "#6e7191",
    "editor.selectionBackground": "#dbeafe",
    "editor.inactiveSelectionBackground": "#e8e8ed",
    "editor.lineHighlightBackground": "#f8f8fc",
    "editorIndentGuide.background": "#e8e8ed",
    "editorGutter.background": "#ffffff",
    "editorWidget.background": "#f9f9fb",
  },
};

const MonacoEditor = dynamic(
  async () => (await import("@monaco-editor/react")).default,
  {
    ssr: false,
    loading: () => (
      <div className="monaco-loading" role="status" aria-live="polite">
        Loading editor…
      </div>
    ),
  },
);

export function GoEditor({
  tabId,
  value,
  onChange,
  onRun,
  readOnly,
  vimEnabled,
  vimStatusEl,
  fontSize = 13,
}: {
  tabId: string;
  value: string;
  onChange: (next: string) => void;
  onRun?: () => void;
  readOnly?: boolean;
  vimEnabled: boolean;
  vimStatusEl: HTMLElement | null;
  fontSize?: number;
}) {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const vimModeRef = useRef<VimAdapterInstance | null>(null);
  const keydownRef = useRef<monaco.IDisposable | null>(null);
  const onRunRef = useRef<(() => void) | undefined>(onRun);
  const themeReadyRef = useRef(false);

  useEffect(() => {
    onRunRef.current = onRun;
  }, [onRun]);

  const options = useMemo<monaco.editor.IStandaloneEditorConstructionOptions>(
    () => ({
      readOnly: Boolean(readOnly),
      fontFamily: "var(--mono)",
      fontSize: fontSize,
      lineHeight: Math.round(fontSize * 1.46),
      minimap: { enabled: false },
      automaticLayout: true,
      scrollBeyondLastLine: false,
      renderWhitespace: "selection",
      lineNumbers: "on",
      detectIndentation: false,
      tabSize: 4,
      insertSpaces: true,
      wordWrap: "off",
      smoothScrolling: true,
      scrollbar: {
        verticalScrollbarSize: 10,
        horizontalScrollbarSize: 10,
      },
    }),
    [readOnly, fontSize],
  );

  const onMount = useCallback(
    (editor: monaco.editor.IStandaloneCodeEditor, m: typeof monaco) => {
      editorRef.current = editor;

      if (!keydownRef.current) {
        keydownRef.current = editor.onKeyDown((e) => {
          if ((e.ctrlKey || e.metaKey) && e.keyCode === m.KeyCode.Enter) {
            e.preventDefault();
            onRunRef.current?.();
          }
        });
      }
    },
    [],
  );

  const beforeMount = useCallback((m: typeof monaco) => {
    if (themeReadyRef.current) return;
    m.editor.defineTheme("goofy-light", GOOFY_LIGHT_THEME);
    themeReadyRef.current = true;
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    if (!vimEnabled) {
      if (vimModeRef.current) {
        vimModeRef.current.dispose();
        vimModeRef.current = null;
      }
      return;
    }

    if (!vimStatusEl) return;
    if (vimModeRef.current) return;

    let cancelled = false;

    void (async () => {
      // `monaco-vim` touches `window` at module eval; import it lazily on the client only.
      const { initVimMode } = await import("monaco-vim");
      if (cancelled) return;
      vimModeRef.current = initVimMode(editor, vimStatusEl);
    })();

    return () => {
      cancelled = true;
      vimModeRef.current?.dispose();
      vimModeRef.current = null;
    };
  }, [vimEnabled, vimStatusEl]);

  useEffect(() => {
    return () => {
      vimModeRef.current?.dispose();
      vimModeRef.current = null;
      keydownRef.current?.dispose();
      keydownRef.current = null;
    };
  }, []);

  return (
    <div className="monaco" aria-label="Go editor">
      <MonacoEditor
        theme="goofy-light"
        defaultLanguage="go"
        path={`${tabId}.go`}
        height="100%"
        width="100%"
        value={value}
        onChange={(v) => onChange(v ?? "")}
        options={options}
        beforeMount={beforeMount}
        onMount={onMount}
      />
    </div>
  );
}
