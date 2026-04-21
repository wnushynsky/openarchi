import { useState, useRef, useEffect, useCallback } from 'react';
import { WorkspaceManager } from './manager';
import type { IncrementalSaveResult } from './manager';
import type { WorkspaceState } from './types';
import { INITIAL_WORKSPACE_STATE } from './types';
import type { DirectoryState, OpenFileEntry } from '../io/filesystem';
import type { GitHistoryEntry, GitCommitFile } from './git';

export interface UseWorkspaceReturn {
  /** Current workspace state */
  workspace: WorkspaceState;
  /** Open a new directory (shows picker) */
  openDirectory: () => Promise<DirectoryState>;
  /** Set the active file after loading it */
  setActiveFile: (relativePath: string, format: string) => void;
  /** Mark model as having unsaved changes */
  markDirty: () => void;
  /** Mark model as saved (clean) */
  markClean: () => void;
  /** Save content to the active single file */
  saveFile: (entry: OpenFileEntry, content: string) => Promise<void>;
  /** Save fragmented files to the directory (incremental — only writes changed files) */
  saveFragmented: (
    files: { relativePath: string; content: string }[],
    deletedPaths?: string[],
  ) => Promise<IncrementalSaveResult>;
  /** Save a single fragment file to the directory */
  saveSingleFragment: (relativePath: string, content: string) => Promise<void>;
  /** Pre-seed content hashes so the first incremental save skips unchanged files */
  seedContentHashes: (files: { relativePath: string; content: string }[]) => void;
  /** Get a file entry by relative path */
  getFile: (relativePath: string) => OpenFileEntry | undefined;
  /** Get the currently active file entry */
  getActiveFile: () => OpenFileEntry | undefined;
  /** Close the workspace */
  closeWorkspace: () => Promise<void>;
  /** Refresh git branch info */
  refreshGitBranch: () => Promise<void>;
  /** Read recent git history for the opened workspace */
  getGitHistory: (limit?: number) => Promise<GitHistoryEntry[]>;
  /** Read changed files for a git commit */
  getGitChangedFiles: (commit: string) => Promise<string[]>;
  /** Read a full model snapshot from a git commit */
  getGitModelSnapshot: (commit: string) => Promise<GitCommitFile[]>;
  /** True if a restore is pending and needs user permission */
  restorePending: boolean;
  /** Directory name of the pending restore (for the reconnect banner) */
  restoreDirectoryName: string | null;
  /** Request permission and complete restore (call from user gesture) */
  requestPermissionAndRestore: () => Promise<WorkspaceState | null>;
  /** The underlying manager instance (for advanced use) */
  manager: WorkspaceManager;
}

export function useWorkspace(): UseWorkspaceReturn {
  const managerRef = useRef<WorkspaceManager>(null!);
  if (!managerRef.current) {
    managerRef.current = new WorkspaceManager();
  }
  const manager = managerRef.current;

  const [workspace, setWorkspace] = useState<WorkspaceState>(INITIAL_WORKSPACE_STATE);
  const [restorePending, setRestorePending] = useState(false);
  const [restoreDirectoryName, setRestoreDirectoryName] = useState<string | null>(null);

  // Subscribe to manager state changes
  useEffect(() => {
    return manager.subscribe(setWorkspace);
  }, [manager]);

  // Attempt restore on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await manager.restore();
        if (cancelled || !result) return;

        if (result.permissionNeeded) {
          setRestorePending(true);
          setRestoreDirectoryName(result.directoryName);
        }
      } catch {
        // Restore failed silently
      }
    })();
    return () => { cancelled = true; };
  }, [manager]);

  // beforeunload warning when dirty
  useEffect(() => {
    if (!workspace.isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [workspace.isDirty]);

  const openDirectory = useCallback(async () => {
    setRestorePending(false);
    setRestoreDirectoryName(null);
    return manager.openDirectory();
  }, [manager]);

  const setActiveFile = useCallback((relativePath: string, format: string) => {
    manager.setActiveFile(relativePath, format);
  }, [manager]);

  const markDirty = useCallback(() => manager.markDirty(), [manager]);
  const markClean = useCallback(() => manager.markClean(), [manager]);

  const saveFile = useCallback(async (entry: OpenFileEntry, content: string) => {
    await manager.saveFile(entry, content);
  }, [manager]);

  const saveFragmented = useCallback(async (
    files: { relativePath: string; content: string }[],
    deletedPaths: string[] = [],
  ): Promise<IncrementalSaveResult> => {
    return manager.saveFragmented(files, deletedPaths);
  }, [manager]);

  const saveSingleFragment = useCallback(async (relativePath: string, content: string) => {
    await manager.saveSingleFragment(relativePath, content);
  }, [manager]);

  const seedContentHashes = useCallback((files: { relativePath: string; content: string }[]) => {
    manager.seedContentHashes(files);
  }, [manager]);

  const getFile = useCallback((relativePath: string) => {
    return manager.getFile(relativePath);
  }, [manager]);

  const getActiveFile = useCallback(() => {
    return manager.getActiveFile();
  }, [manager]);

  const closeWorkspace = useCallback(async () => {
    setRestorePending(false);
    setRestoreDirectoryName(null);
    await manager.close();
  }, [manager]);

  const refreshGitBranch = useCallback(async () => {
    await manager.refreshGitBranch();
  }, [manager]);

  const getGitHistory = useCallback(async (limit: number = 30) => {
    return manager.getGitHistory(limit);
  }, [manager]);

  const getGitChangedFiles = useCallback(async (commit: string) => {
    return manager.getGitChangedFiles(commit);
  }, [manager]);

  const getGitModelSnapshot = useCallback(async (commit: string) => {
    return manager.getGitModelSnapshot(commit);
  }, [manager]);

  const requestPermissionAndRestore = useCallback(async () => {
    setRestorePending(false);
    setRestoreDirectoryName(null);
    return manager.requestPermissionAndRestore();
  }, [manager]);

  return {
    workspace,
    openDirectory,
    setActiveFile,
    markDirty,
    markClean,
    saveFile,
    saveFragmented,
    saveSingleFragment,
    seedContentHashes,
    getFile,
    getActiveFile,
    closeWorkspace,
    refreshGitBranch,
    getGitHistory,
    getGitChangedFiles,
    getGitModelSnapshot,
    restorePending,
    restoreDirectoryName,
    requestPermissionAndRestore,
    manager,
  };
}
