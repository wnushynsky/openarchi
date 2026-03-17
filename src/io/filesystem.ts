// ---------------------------------------------------------------------------
// File System Access API wrapper for opening directories & saving files
// ---------------------------------------------------------------------------

export interface OpenFileEntry {
  name: string;
  handle: FileSystemFileHandle;
}

export interface DirectoryState {
  directoryHandle: FileSystemDirectoryHandle;
  files: OpenFileEntry[];
}

/** True when the browser supports the File System Access API */
export function isFileSystemAccessSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

/**
 * Prompt the user to pick a directory, then scan for ArchiMate-compatible
 * files (.archimate, .xml, .json).
 */
export async function openDirectory(): Promise<DirectoryState> {
  const directoryHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
  const files = await scanDirectory(directoryHandle);
  return { directoryHandle, files };
}

async function scanDirectory(handle: FileSystemDirectoryHandle): Promise<OpenFileEntry[]> {
  const entries: OpenFileEntry[] = [];
  const validExtensions = ['.archimate', '.xml', '.json'];

  for await (const entry of handle.values()) {
    if (entry.kind !== 'file') continue;
    const lower = entry.name.toLowerCase();
    if (validExtensions.some(ext => lower.endsWith(ext))) {
      entries.push({ name: entry.name, handle: entry });
    }
  }

  return entries.sort((a, b) => a.name.localeCompare(b.name));
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
