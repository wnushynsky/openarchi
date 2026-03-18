// ---------------------------------------------------------------------------
// File System Access API wrapper + fallback for opening directories & files
// ---------------------------------------------------------------------------

const VALID_EXTENSIONS = ['.archimate', '.xml', '.json'];

function isValidFile(name: string): boolean {
  const lower = name.toLowerCase();
  return VALID_EXTENSIONS.some(ext => lower.endsWith(ext));
}

// ---------------------------------------------------------------------------
// OpenFileEntry – works with both File System Access handles and plain Files
// ---------------------------------------------------------------------------

export interface OpenFileEntry {
  /** Display name (includes relative path when opened via directory) */
  name: string;
  /** Relative path within the opened directory (e.g. "model/elements/foo.xml") */
  relativePath: string;
  /** Read the file's text content */
  readText: () => Promise<string>;
  /** Write text back in-place (only available with File System Access API) */
  writeText?: (content: string) => Promise<void>;
}

export interface DirectoryState {
  /** Root directory name */
  directoryName: string;
  /** All ArchiMate-compatible files found (recursively) */
  files: OpenFileEntry[];
}

// ---------------------------------------------------------------------------
// File System Access API path (Chrome / Edge)
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
  return { directoryName: directoryHandle.name, files };
}

async function scanDirectoryNative(
  handle: FileSystemDirectoryHandle,
  pathPrefix: string,
  out: OpenFileEntry[],
): Promise<void> {
  for await (const entry of handle.values()) {
    if (entry.kind === 'directory') {
      const subDir = entry as FileSystemDirectoryHandle;
      await scanDirectoryNative(subDir, `${pathPrefix}${subDir.name}/`, out);
    } else if (entry.kind === 'file') {
      const fileHandle = entry as FileSystemFileHandle;
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
// Fallback path – <input webkitdirectory> (Firefox / Safari / all browsers)
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

      // Derive directory name from the common root of webkitRelativePath
      const firstPath = (fileList[0] as any).webkitRelativePath as string || fileList[0].name;
      const directoryName = firstPath.split('/')[0] || 'directory';

      const files: OpenFileEntry[] = [];

      for (let i = 0; i < fileList.length; i++) {
        const file = fileList[i];
        if (!isValidFile(file.name)) continue;

        const fullRelativePath = (file as any).webkitRelativePath as string || file.name;
        // Strip the root directory name to get paths relative to the opened dir
        const parts = fullRelativePath.split('/');
        const relativePath = parts.length > 1 ? parts.slice(1).join('/') : parts[0];

        // Capture file in closure for readText
        const capturedFile = file;
        files.push({
          name: file.name,
          relativePath,
          readText: () => capturedFile.text(),
          // No writeText – browser can't write back via input fallback
        });
      }

      files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
      resolve({ directoryName, files });
    });

    input.addEventListener('cancel', () => {
      reject(new DOMException('User cancelled', 'AbortError'));
    });

    input.click();
  });
}

// ---------------------------------------------------------------------------
// Unified open – picks the best available method
// ---------------------------------------------------------------------------

export async function openDirectory(): Promise<DirectoryState> {
  if (isFileSystemAccessSupported()) {
    return openDirectoryNative();
  }
  return openDirectoryFallback();
}

// ---------------------------------------------------------------------------
// Legacy helpers (kept for direct file handle usage elsewhere)
// ---------------------------------------------------------------------------

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
