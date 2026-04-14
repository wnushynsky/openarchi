import type { OpenFileEntry, DirectoryState } from '../io/filesystem';
import {
  isFileSystemAccessSupported,
  openDirectoryNative,
  openDirectoryFallback,
  rescanDirectory,
  deleteFileAtPath,
  writeFileAtPath,
} from '../io/filesystem';
import { isFragmentedModelDirectory } from '../model/service';
import { detectGitBranch } from './git';
import { saveWorkspace, loadWorkspace, clearWorkspace } from './persistence';
import type { WorkspaceState, WorkspaceMetadata, WorkspaceKind } from './types';
import { INITIAL_WORKSPACE_STATE } from './types';

export type WorkspaceListener = (state: WorkspaceState) => void;

/** Fast string hash for change detection (djb2). Not cryptographic. */
function hashContent(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return h;
}

export interface IncrementalSaveResult {
  writtenCount: number;
  skippedCount: number;
  deletedCount: number;
}

export class WorkspaceManager {
  private _state: WorkspaceState = { ...INITIAL_WORKSPACE_STATE };
  private _listeners: Set<WorkspaceListener> = new Set();
  /** Content hashes from the last successful save, keyed by relative path */
  private _lastSavedHashes = new Map<string, number>();

  get state(): WorkspaceState {
    return this._state;
  }

  subscribe(listener: WorkspaceListener): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  private emit(): void {
    const snapshot = { ...this._state };
    for (const listener of this._listeners) {
      listener(snapshot);
    }
  }

  private update(partial: Partial<WorkspaceState>): void {
    this._state = { ...this._state, ...partial };
    this.emit();
  }

  // ---------------------------------------------------------------------------
  // Open directory
  // ---------------------------------------------------------------------------

  async openDirectory(): Promise<DirectoryState> {
    let dirState: DirectoryState;

    if (isFileSystemAccessSupported()) {
      dirState = await openDirectoryNative();
    } else {
      dirState = await openDirectoryFallback();
    }

    const isFragmented = isFragmentedModelDirectory(dirState.files);
    const kind: WorkspaceKind = isFragmented ? 'coarchi-directory' : null;
    const format = isFragmented ? 'coarchi-xml' : null;

    let gitBranch: string | null = null;
    if (dirState.directoryHandle) {
      gitBranch = await detectGitBranch(dirState.directoryHandle);
    }

    this.update({
      directoryHandle: dirState.directoryHandle ?? null,
      directoryName: dirState.directoryName,
      kind,
      files: dirState.files,
      isFragmented,
      format,
      isDirty: false,
      gitBranch,
      activeFilePath: null,
    });

    // Persist to IndexedDB if we have a handle
    if (dirState.directoryHandle) {
      await this.persist();
    }

    return dirState;
  }

  // ---------------------------------------------------------------------------
  // Set active file (after loading a specific file entry)
  // ---------------------------------------------------------------------------

  setActiveFile(relativePath: string, format: string): void {
    this.update({
      activeFilePath: relativePath,
      kind: 'single-file',
      format,
      isDirty: false,
    });
    this.persist();
  }

  // ---------------------------------------------------------------------------
  // Dirty tracking
  // ---------------------------------------------------------------------------

  markDirty(): void {
    if (!this._state.isDirty) {
      this.update({ isDirty: true });
    }
  }

  markClean(): void {
    if (this._state.isDirty) {
      this.update({ isDirty: false });
    }
  }

  // ---------------------------------------------------------------------------
  // Save helpers
  // ---------------------------------------------------------------------------

  /** Write a single file back to the directory via its OpenFileEntry.writeText */
  async saveFile(entry: OpenFileEntry, content: string): Promise<void> {
    if (entry.writeText) {
      await entry.writeText(content);
    } else {
      throw new Error('File System Access API not available — cannot save in place');
    }
    this.markClean();
  }

  /**
   * Write multiple files to the directory (fragmented save).
   * Only writes files whose content actually changed since the last save.
   * Requires a directory handle (File System Access API).
   */
  async saveFragmented(
    files: { relativePath: string; content: string }[],
    deletedPaths: string[] = [],
  ): Promise<IncrementalSaveResult> {
    const handle = this._state.directoryHandle;
    if (!handle) {
      throw new Error('No directory handle — cannot save fragmented model');
    }

    let deletedCount = 0;
    for (const path of deletedPaths) {
      await deleteFileAtPath(handle, path);
      this._lastSavedHashes.delete(path);
      deletedCount++;
    }

    let writtenCount = 0;
    let skippedCount = 0;
    const newHashes = new Map<string, number>();

    for (const file of files) {
      const h = hashContent(file.content);
      newHashes.set(file.relativePath, h);
      if (this._lastSavedHashes.get(file.relativePath) === h) {
        skippedCount++;
        continue;
      }
      await writeFileAtPath(handle, file.relativePath, file.content);
      writtenCount++;
    }

    this._lastSavedHashes = newHashes;
    this.markClean();
    return { writtenCount, skippedCount, deletedCount };
  }

  /**
   * Write a single fragment file to the directory.
   * Useful for saving just the currently selected item without a full save.
   */
  async saveSingleFragment(relativePath: string, content: string): Promise<void> {
    const handle = this._state.directoryHandle;
    if (!handle) {
      throw new Error('No directory handle — cannot save fragment');
    }
    await writeFileAtPath(handle, relativePath, content);
    this._lastSavedHashes.set(relativePath, hashContent(content));
  }

  /** Get a file entry by relative path */
  getFile(relativePath: string): OpenFileEntry | undefined {
    return this._state.files.find(f => f.relativePath === relativePath);
  }

  /** Get the active file entry */
  getActiveFile(): OpenFileEntry | undefined {
    if (!this._state.activeFilePath) return undefined;
    return this.getFile(this._state.activeFilePath);
  }

  // ---------------------------------------------------------------------------
  // Restore from IndexedDB (page refresh)
  // ---------------------------------------------------------------------------

  async restore(): Promise<{
    state: WorkspaceState;
    permissionNeeded: boolean;
    directoryName: string | null;
  } | null> {
    const stored = await loadWorkspace();
    if (!stored) return null;

    const { handle, metadata } = stored;

    // Check if we still have permission
    let permissionState: PermissionState;
    try {
      permissionState = await handle.queryPermission({ mode: 'readwrite' });
    } catch {
      await clearWorkspace();
      return null;
    }

    if (permissionState === 'granted') {
      // We can restore silently
      return await this.restoreFromHandle(handle, metadata);
    }

    if (permissionState === 'prompt') {
      // Need user gesture to request permission
      return {
        state: this._state,
        permissionNeeded: true,
        directoryName: metadata.directoryName,
      };
    }

    // Permission denied — clean up
    await clearWorkspace();
    return null;
  }

  /**
   * Request permission and complete restore.
   * Must be called from a user gesture (e.g. button click).
   */
  async requestPermissionAndRestore(): Promise<WorkspaceState | null> {
    const stored = await loadWorkspace();
    if (!stored) return null;

    const { handle, metadata } = stored;

    try {
      const permission = await handle.requestPermission({ mode: 'readwrite' });
      if (permission !== 'granted') {
        await clearWorkspace();
        return null;
      }
    } catch {
      await clearWorkspace();
      return null;
    }

    const result = await this.restoreFromHandle(handle, metadata);
    return result?.state ?? null;
  }

  private async restoreFromHandle(
    handle: FileSystemDirectoryHandle,
    metadata: WorkspaceMetadata,
  ): Promise<{ state: WorkspaceState; permissionNeeded: false; directoryName: string | null }> {
    const dirState = await rescanDirectory(handle);
    const gitBranch = await detectGitBranch(handle);
    const kind: WorkspaceKind = metadata.kind
      ?? (metadata.isFragmented ? 'coarchi-directory' : metadata.activeFilePath ? 'single-file' : null);

    this.update({
      directoryHandle: handle,
      directoryName: dirState.directoryName,
      kind,
      files: dirState.files,
      isFragmented: metadata.isFragmented,
      format: metadata.format,
      activeFilePath: metadata.activeFilePath,
      isDirty: false,
      gitBranch,
    });

    return {
      state: this._state,
      permissionNeeded: false,
      directoryName: dirState.directoryName,
    };
  }

  // ---------------------------------------------------------------------------
  // Close workspace
  // ---------------------------------------------------------------------------

  async close(): Promise<void> {
    await clearWorkspace();
    this._lastSavedHashes.clear();
    this._state = { ...INITIAL_WORKSPACE_STATE };
    this.emit();
  }

  // ---------------------------------------------------------------------------
  // Refresh git branch (e.g. after a git operation)
  // ---------------------------------------------------------------------------

  async refreshGitBranch(): Promise<void> {
    if (this._state.directoryHandle) {
      const gitBranch = await detectGitBranch(this._state.directoryHandle);
      this.update({ gitBranch });
    }
  }

  // ---------------------------------------------------------------------------
  // Persist metadata to IndexedDB
  // ---------------------------------------------------------------------------

  private async persist(): Promise<void> {
    const { directoryHandle, kind, format, activeFilePath, isFragmented, directoryName } = this._state;
    if (!directoryHandle) return;
    try {
      await saveWorkspace(directoryHandle, {
        kind,
        format,
        activeFilePath,
        isFragmented,
        currentViewId: null, // will be set by the hook
        directoryName,
      });
    } catch {
      // IndexedDB not available — silently ignore
    }
  }
}
