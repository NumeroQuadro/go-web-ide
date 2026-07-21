export const WORKSPACE_MODULE_PATH = "scratchpad";

export type WorkspaceRunFile = {
  path: string;
  content: string;
};

function normalizeSegment(input: string): string {
  return input
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
}

export function normalizeWorkspacePath(input: string): string {
  const raw = input.trim().replaceAll("\\", "/");
  const parts = raw
    .split("/")
    .map(normalizeSegment)
    .filter((part) => part.length > 0 && part !== "." && part !== "..");

  let path = parts.join("/");
  if (!path) path = "main.go";
  if (!path.endsWith(".go")) path = `${path}.go`;
  return path;
}

export function getWorkspaceFileName(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}

export function getWorkspaceDirectory(path: string): string {
  const parts = path.split("/");
  return parts.length > 1 ? parts.slice(0, -1).join("/") : "";
}

export function makeUniqueWorkspacePath(existingPaths: string[], preferredPath: string): string {
  const normalized = normalizeWorkspacePath(preferredPath);
  const existing = new Set(existingPaths.map(normalizeWorkspacePath));
  if (!existing.has(normalized)) return normalized;

  const dir = getWorkspaceDirectory(normalized);
  const fileName = getWorkspaceFileName(normalized);
  const dotIndex = fileName.lastIndexOf(".");
  const stem = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
  const ext = dotIndex > 0 ? fileName.slice(dotIndex) : "";

  let counter = 2;
  while (true) {
    const candidateName = `${stem}-${counter}${ext}`;
    const candidate = dir ? `${dir}/${candidateName}` : candidateName;
    if (!existing.has(candidate)) return candidate;
    counter += 1;
  }
}

export function getWorkspaceRunTotalBytes(files: WorkspaceRunFile[]): number {
  return files.reduce(
    (sum, file) => sum + new TextEncoder().encode(file.path).length + new TextEncoder().encode(file.content).length,
    0,
  );
}

export function validateWorkspaceRunFiles(files: WorkspaceRunFile[]): string | null {
  if (!Array.isArray(files) || files.length === 0) return "missing_files";

  const seenPaths = new Set<string>();
  for (const file of files) {
    if (!file || typeof file !== "object") return "invalid_files";
    if (typeof file.path !== "string" || typeof file.content !== "string") {
      return "invalid_files";
    }

    const normalizedPath = normalizeWorkspacePath(file.path);
    if (normalizedPath !== file.path) return "invalid_file_path";
    if (seenPaths.has(normalizedPath)) return "duplicate_file_path";
    seenPaths.add(normalizedPath);
  }

  return null;
}
