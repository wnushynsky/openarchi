import type { OpenFileEntry } from '../io/filesystem';

export type WorkspaceKind = 'single-file' | 'coarchi-directory' | null;

export interface WorkspaceState {
  /** Root directory handle (null when no directory is open or on fallback browsers) */
  directoryHandle: FileSystemDirectoryHandle | null;
  /** Display name of the opened directory */
  directoryName: string | null;
  /** High-level workspace mode used to drive save behavior */
  kind: WorkspaceKind;
  /** Detected model format */
  format: string | null;
  /** True when the model is a fragmented coArchi/GRAFICO directory */
  isFragmented: boolean;
  /** Relative path of the currently active file within the directory */
  activeFilePath: string | null;
  /** True when the model has unsaved changes */
  isDirty: boolean;
  /** Git branch name (null if not a git repo or not detectable) */
  gitBranch: string | null;
  /** All model-compatible files found in the directory */
  files: OpenFileEntry[];
}

export interface WorkspaceMetadata {
  kind?: WorkspaceKind;
  format: string | null;
  activeFilePath: string | null;
  isFragmented: boolean;
  currentViewId: string | null;
  directoryName: string | null;
}

export const INITIAL_WORKSPACE_STATE: WorkspaceState = {
  directoryHandle: null,
  directoryName: null,
  kind: null,
  format: null,
  isFragmented: false,
  activeFilePath: null,
  isDirty: false,
  gitBranch: null,
  files: [],
};
