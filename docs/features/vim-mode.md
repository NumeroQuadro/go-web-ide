# Feature — Vim mode (optional)

## Summary

Provide an optional Vim keybinding mode for the Monaco editor. Preference must persist server-side and apply across devices.

## Requirements (MVP)

- Vim mode is **optional** and **off by default**.
- Toggle is available in the workbench UI.
- A visible mode/status indicator is shown when Vim mode is enabled (e.g. `-- INSERT --`, `-- NORMAL --`).
- Vim mode state is persisted in Supabase (`scratchpad_user_settings.vim_mode_enabled`).
- On workbench load, Vim mode is initialized from the persisted setting.

## Implementation notes (non-prescriptive)

- Monaco + Vim integration must run client-side only.
- If using a library like `monaco-vim`, ensure:
  - it does not break core Monaco shortcuts
  - it can be toggled cleanly without requiring a full page reload
  - editor-specific shortcuts like `Ctrl+Enter` / `Cmd+Enter` still work (recommended: register the handler before initializing Vim mode and call `preventDefault()` so Vim ignores it)

## Acceptance criteria

- User can toggle Vim mode on/off in the workbench.
- Preference is restored on refresh and across devices.
