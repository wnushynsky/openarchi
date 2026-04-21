import type { OpenFileEntry, DirectoryState } from '../io/filesystem';
import {
  openDirectory as openWorkspaceDirectory,
  rescanDirectory,
  deleteFileAtPath,
  writeFileAtPath,
} from '../io/filesystem';
import { isFragmentedModelDirectory } from '../model/service';
import { isTauriRuntime } from '../platform/tauri';
import { detectGitBranch, readGitHistory, readGitChangedFiles, readGitModelSnapshot } from './git';
import type { GitHistoryEntry, GitCommitFile } from './git';
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

  private async applyOpenedDirectoryState(
    dirState: DirectoryState,
    metadata?: WorkspaceMetadata,
  ): Promise<DirectoryState> {
    this._lastSavedHashes.clear();

    const isFragmented = isFragmentedModelDirectory(dirState.files);
    const kind: WorkspaceKind = metadata?.kind
      ?? (isFragmented ? 'coarchi-directory' : metadata?.activeFilePath ? 'single-file' : null);
    const format = metadata?.format ?? (isFragmented ? 'coarchi-xml' : null);
    const directoryRef = dirState.directoryPath ?? dirState.directoryHandle;
    const gitBranch = directoryRef ? await detectGitBranch(directoryRef) : null;

    this.update({
      directoryHandle: dirState.directoryHandle ?? null,
      directoryPath: dirState.directoryPath ?? null,
      backend: dirState.backend,
      directoryName: dirState.directoryName,
      canWrite: dirState.canWrite,
      kind,
      files: dirState.files,
      isFragmented: metadata?.isFragmented ?? isFragmented,
      format,
      isDirty: false,
      gitBranch,
      activeFilePath: metadata?.activeFilePath ?? null,
    });

    await this.persist();
    return dirState;
  }

  // ---------------------------------------------------------------------------
  // Open directory
  // ---------------------------------------------------------------------------

  async openDirectory(): Promise<DirectoryState> {
    const dirState = await openWorkspaceDirectory();
    return this.applyOpenedDirectoryState(dirState);
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
    void this.persist();
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
      throw new Error('Direct write access is not available for the current workspace');
    }
    this.markClean();
  }

  /**
   * Write multiple files to the directory (fragmented save).
   * Only writes files whose content actually changed since the last save.
   */
  async saveFragmented(
    files: { relativePath: string; content: string }[],
    deletedPaths: string[] = [],
  ): Promise<IncrementalSaveResult> {
    const root = this._state.directoryPath ?? this._state.directoryHandle;
    if (!root) {
      throw new Error('No writable workspace is open');
    }

    let deletedCount = 0;
    for (const path of deletedPaths) {
      await deleteFileAtPath(root, path);
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
      await writeFileAtPath(root, file.relativePath, file.content);
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
    const root = this._state.directoryPath ?? this._state.directoryHandle;
    if (!root) {
      throw new Error('No writable workspace is open');
    }
    await writeFileAtPath(root, relativePath, content);
    this._lastSavedHashes.set(relativePath, hashContent(content));
  }

  /**
   * Pre-populate content hashes from a serialized snapshot so the first
   * incremental save can skip files that haven't changed since import.
   */
  seedContentHashes(files: { relativePath: string; content: string }[]): void {
    for (const file of files) {
      this._lastSavedHashes.set(file.relativePath, hashContent(file.content));
    }
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
  // Restore persisted workspace
  // ---------------------------------------------------------------------------

  async restore(): Promise<{
    state: WorkspaceState;
    permissionNeeded: boolean;
    directoryName: string | null;
  } | null> {
    const stored = await loadWorkspace();
    if (!stored) return null;

    const { handle, directoryPath, metadata } = stored;

    if (directoryPath) {
      if (!isTauriRuntime()) {
        await clearWorkspace();
        return null;
      }
      return this.restoreFromPath(directoryPath, metadata);
    }

    if (!handle) {
      await clearWorkspace();
      return null;
    }

    let permissionState: PermissionState;
    try {
      permissionState = await handle.queryPermission({ mode: 'readwrite' });
    } catch {
      await clearWorkspace();
      return null;
    }

    if (permissionState === 'granted') {
      return this.restoreFromHandle(handle, metadata);
    }

    if (permissionState === 'prompt') {
      return {
        state: this._state,
        permissionNeeded: true,
        directoryName: metadata.directoryName,
      };
    }

    await clearWorkspace();
    return null;
  }

  /**
   * Request permission and complete restore.
   * Must be called from a user gesture when restoring a browser handle.
   */
  async requestPermissionAndRestore(): Promise<WorkspaceState | null> {
    const stored = await loadWorkspace();
    if (!stored) return null;

    const { handle, directoryPath, metadata } = stored;

    if (directoryPath) {
      if (!isTauriRuntime()) {
        await clearWorkspace();
        return null;
      }
      const result = await this.restoreFromPath(directoryPath, metadata);
      return result?.state ?? null;
    }

    if (!handle) {
      await clearWorkspace();
      return null;
    }

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
    await this.applyOpenedDirectoryState(dirState, metadata);
    return {
      state: this._state,
      permissionNeeded: false,
      directoryName: dirState.directoryName,
    };
  }

  private async restoreFromPath(
    directoryPath: string,
    metadata: WorkspaceMetadata,
  ): Promise<{ state: WorkspaceState; permissionNeeded: false; directoryName: string | null }> {
    const dirState = await rescanDirectory(directoryPath);
    await this.applyOpenedDirectoryState(dirState, metadata);
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
    const directoryRef = this._state.directoryPath ?? this._state.directoryHandle;
    if (!directoryRef) return;
    const gitBranch = await detectGitBranch(directoryRef);
    this.update({ gitBranch });
  }

  async getGitHistory(limit: number = 30): Promise<GitHistoryEntry[]> {
    const directoryRef = this._state.directoryPath ?? this._state.directoryHandle;
    if (!directoryRef) return [];
    return readGitHistory(directoryRef, limit);
  }

  async getGitChangedFiles(commit: string): Promise<string[]> {
    const directoryRef = this._state.directoryPath ?? this._state.directoryHandle;
    if (!directoryRef) return [];
    return readGitChangedFiles(directoryRef, commit);
  }

  async getGitModelSnapshot(commit: string): Promise<GitCommitFile[]> {
    const directoryRef = this._state.directoryPath ?? this._state.directoryHandle;
    if (!directoryRef) return [];
    return readGitModelSnapshot(directoryRef, commit);
  }

  // ---------------------------------------------------------------------------
  // Persist metadata to IndexedDB
  // ---------------------------------------------------------------------------

  private async persist(): Promise<void> {
    const {
      directoryHandle,
      directoryPath,
      backend,
      kind,
      format,
      activeFilePath,
      isFragmented,
      directoryName,
    } = this._state;
    if (!directoryHandle && !directoryPath) return;

    try {
      await saveWorkspace(
        {
          handle: directoryHandle,
          directoryPath,
          backend,
        },
        {
          backend,
          directoryPath,
          kind,
          format,
          activeFilePath,
          isFragmented,
          currentViewId: null,
          directoryName,
        },
      );
    } catch {
      // IndexedDB not available — silently ignore
    }
  }
}
