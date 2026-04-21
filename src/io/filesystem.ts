// ---------------------------------------------------------------------------
// File access layer for browser File System Access API, browser fallback input,
// and the native Tauri runtime.
// ---------------------------------------------------------------------------

import { invokeTauri, isTauriRuntime } from '../platform/tauri';

const VALID_EXTENSIONS = ['.archimate', '.xml', '.json', '.openarchi.md'];

export type WorkspaceBackend = 'browser' | 'tauri';

export interface OpenFileEntry {
  /** Display name (includes relative path when opened via directory) */
  name: string;
  /** Relative path within the opened directory (e.g. "model/elements/foo.xml") */
  relativePath: string;
  /** Read the file's text content */
  readText: () => Promise<string>;
  /** Write text back in-place when supported by the active backend */
  writeText?: (content: string) => Promise<void>;
}

export interface DirectoryState {
  /** Root directory name */
  directoryName: string;
  /** All ArchiMate-compatible files found (recursively) */
  files: OpenFileEntry[];
  /** Active backend used for the workspace */
  backend: WorkspaceBackend;
  /** True when the selected backend can write back to disk */
  canWrite: boolean;
  /** Root directory handle (browser File System Access only) */
  directoryHandle?: FileSystemDirectoryHandle;
  /** Root directory path (Tauri only) */
  directoryPath?: string;
}

interface TauriDirectoryScan {
  directoryName: string;
  files: {
    name: string;
    relativePath: string;
  }[];
}

type FileWithRelativePath = File & {
  webkitRelativePath?: string;
};

function isValidFile(name: string): boolean {
  const lower = name.toLowerCase();
  return VALID_EXTENSIONS.some(ext => lower.endsWith(ext));
}

function getRelativePath(file: File): string {
  const fileWithRelativePath: FileWithRelativePath = file;
  const relativePath = fileWithRelativePath.webkitRelativePath;
  return relativePath && relativePath.length > 0 ? relativePath : file.name;
}

function buildTauriFileEntry(directoryPath: string, relativePath: string): OpenFileEntry {
  const parts = relativePath.split('/');
  const name = parts[parts.length - 1] || relativePath;

  return {
    name,
    relativePath,
    readText: () => invokeTauri<string>('read_workspace_file', { directoryPath, relativePath }),
    writeText: (content: string) => invokeTauri<void>('write_workspace_file', {
      directoryPath,
      relativePath,
      content,
    }),
  };
}

// ---------------------------------------------------------------------------
// Browser File System Access API path (Chrome / Edge)
// ---------------------------------------------------------------------------

/** True when the browser supports the File System Access API */
export function isFileSystemAccessSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

/**
 * Open a directory using the File System Access API (Chrome/Edge).
 * Recursively scans for ArchiMate-compatible files.
 */
export async function openDirectoryNative(): Promise<DirectoryState> {
  const directoryHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
  const files: OpenFileEntry[] = [];
  await scanDirectoryNative(directoryHandle, '', files);
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return {
    directoryName: directoryHandle.name,
    files,
    backend: 'browser',
    canWrite: true,
    directoryHandle,
  };
}

async function scanDirectoryNative(
  handle: FileSystemDirectoryHandle,
  pathPrefix: string,
  out: OpenFileEntry[],
): Promise<void> {
  for await (const entry of handle.values()) {
    if (entry.kind === 'directory') {
      await scanDirectoryNative(entry, `${pathPrefix}${entry.name}/`, out);
    } else if (entry.kind === 'file') {
      const fileHandle = entry;
      if (!isValidFile(fileHandle.name)) continue;
      const relativePath = `${pathPrefix}${fileHandle.name}`;
      out.push({
        name: fileHandle.name,
        relativePath,
        readText: async () => {
          const file = await fileHandle.getFile();
          return file.text();
        },
        writeText: async (content: string) => {
          const writable = await fileHandle.createWritable();
          await writable.write(content);
          await writable.close();
        },
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Tauri native path
// ---------------------------------------------------------------------------

export async function openDirectoryTauri(): Promise<DirectoryState> {
  const directoryPath = await invokeTauri<string | null>('pick_workspace_directory');
  if (!directoryPath) {
    throw new DOMException('User cancelled', 'AbortError');
  }

  return rescanDirectoryTauri(directoryPath);
}

async function rescanDirectoryTauri(directoryPath: string): Promise<DirectoryState> {
  const result = await invokeTauri<TauriDirectoryScan>('scan_workspace', { directoryPath });
  const files = result.files
    .map(file => buildTauriFileEntry(directoryPath, file.relativePath))
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  return {
    directoryName: result.directoryName,
    files,
    backend: 'tauri',
    canWrite: true,
    directoryPath,
  };
}

// ---------------------------------------------------------------------------
// Browser fallback path – <input webkitdirectory> (Firefox / Safari / all browsers)
// ---------------------------------------------------------------------------

/**
 * Open a directory using an `<input webkitdirectory>` file picker.
 * Returns a promise that resolves when the user selects a directory.
 */
export function openDirectoryFallback(): Promise<DirectoryState> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.setAttribute('webkitdirectory', '');
    input.multiple = true;

    input.addEventListener('change', () => {
      const fileList = input.files;
      if (!fileList || fileList.length === 0) {
        reject(new DOMException('No files selected', 'AbortError'));
        return;
      }

      const firstPath = getRelativePath(fileList[0]);
      const directoryName = firstPath.split('/')[0] || 'directory';
      const files: OpenFileEntry[] = [];

      for (let i = 0; i < fileList.length; i++) {
        const file = fileList[i];
        if (!isValidFile(file.name)) continue;

        const fullRelativePath = getRelativePath(file);
        const parts = fullRelativePath.split('/');
        const relativePath = parts.length > 1 ? parts.slice(1).join('/') : parts[0];
        const capturedFile = file;

        files.push({
          name: file.name,
          relativePath,
          readText: () => capturedFile.text(),
        });
      }

      files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
      resolve({
        directoryName,
        files,
        backend: 'browser',
        canWrite: false,
      });
    });

    input.addEventListener('cancel', () => {
      reject(new DOMException('User cancelled', 'AbortError'));
    });

    input.click();
  });
}

// ---------------------------------------------------------------------------
// Unified open / rescan / write helpers
// ---------------------------------------------------------------------------

export async function openDirectory(): Promise<DirectoryState> {
  if (isTauriRuntime()) {
    return openDirectoryTauri();
  }
  if (isFileSystemAccessSupported()) {
    return openDirectoryNative();
  }
  return openDirectoryFallback();
}

/** Read a file's text content from its handle */
export async function readFileHandle(handle: FileSystemFileHandle): Promise<string> {
  const file = await handle.getFile();
  return file.text();
}

/** Write text content back to the same file handle (save-in-place) */
export async function writeFileHandle(handle: FileSystemFileHandle, content: string): Promise<void> {
  const writable = await handle.createWritable();
  await writable.write(content);
  await writable.close();
}

/** Create a new file in the directory and write content to it */
export async function createFileInDirectory(
  directoryHandle: FileSystemDirectoryHandle,
  fileName: string,
  content: string,
): Promise<FileSystemFileHandle> {
  const fileHandle = await directoryHandle.getFileHandle(fileName, { create: true });
  await writeFileHandle(fileHandle, content);
  return fileHandle;
}

/**
 * Re-scan a previously opened directory.
 * Browser restores use the persisted File System Access handle.
 * Tauri restores use the persisted absolute directory path.
 */
export async function rescanDirectory(
  directory: FileSystemDirectoryHandle | string,
): Promise<DirectoryState> {
  if (typeof directory === 'string') {
    return rescanDirectoryTauri(directory);
  }

  const files: OpenFileEntry[] = [];
  await scanDirectoryNative(directory, '', files);
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return {
    directoryName: directory.name,
    files,
    backend: 'browser',
    canWrite: true,
    directoryHandle: directory,
  };
}

/**
 * Write a file at the given relative path within a workspace root.
 * Creates intermediate directories as needed.
 */
export async function writeFileAtPath(
  root: FileSystemDirectoryHandle | string,
  relativePath: string,
  content: string,
): Promise<void> {
  if (typeof root === 'string') {
    await invokeTauri<void>('write_workspace_file', {
      directoryPath: root,
      relativePath,
      content,
    });
    return;
  }

  const parts = relativePath.split('/');
  const fileName = parts.pop()!;
  let dirHandle = root;
  for (const part of parts) {
    dirHandle = await dirHandle.getDirectoryHandle(part, { create: true });
  }
  const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
  await writeFileHandle(fileHandle, content);
}

export async function deleteFileAtPath(
  root: FileSystemDirectoryHandle | string,
  relativePath: string,
): Promise<void> {
  if (typeof root === 'string') {
    await invokeTauri<void>('delete_workspace_file', {
      directoryPath: root,
      relativePath,
    });
    return;
  }

  const parts = relativePath.split('/');
  const fileName = parts.pop();
  if (!fileName) return;

  let dirHandle = root;
  for (const part of parts) {
    try {
      dirHandle = await dirHandle.getDirectoryHandle(part);
    } catch {
      return;
    }
  }

  try {
    await dirHandle.removeEntry(fileName);
  } catch {
    // Ignore missing files; fragmented saves should be idempotent.
  }
}
