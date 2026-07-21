# Feature — Output panel

## Summary

The workbench includes an output panel that shows the result of the most recent run: stdout, stderr, exit code, duration, and timeout/truncation indicators.

## Requirements (MVP)

- Output panel is visible on the workbench (desktop-first).
- Output panel height is resizable (desktop-first).
- Running state is clearly indicated while a run is in progress.
- Output panel supports:
  - stdout text
  - stderr text
  - exit code (if available)
  - duration (ms)
  - timed out indicator
  - truncated indicator (output cap hit)
  - internal/backend error indicator (runner unavailable or internal runner error)
- User actions:
  - clear output
  - copy output (stdout+stderr or separately)

## Layout (recommended)

- Present run output as a terminal-style stream:
  - command prompt line (e.g. `$ go run .`)
  - stdout followed by stderr (stderr styled as error)
  - status line (exit code, duration, timeout/truncation/internal-error indicators)

## Output size and truncation

- The runner must cap total output size (stdout+stderr combined) to prevent abuse.
- UI must display a truncation message when capped.
- MVP cap: **64 KiB** total (stdout+stderr combined).

## Error display

- Compilation errors are displayed in stderr.
- The UI should preserve whitespace and use a monospace font in the output panel.

## Persistence

- Output does not need to be persisted for MVP.
- If output persistence is added later, it must not become a large unbounded storage sink.

## Acceptance criteria

- After pressing Run, the output panel shows the result and basic metadata.
- Output is truncated safely when limits are reached.
