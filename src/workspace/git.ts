import { invokeTauri } from '../platform/tauri';

export interface GitHistoryEntry {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  subject: string;
}

export interface GitCommitFile {
  relativePath: string;
  content: string;
}

/**
 * Detect the active git branch from either a browser directory handle or a
 * native Tauri directory path. Returns null if the directory is not a git repo
 * or detection fails.
 */
export async function detectGitBranch(
  directory: FileSystemDirectoryHandle | string,
): Promise<string | null> {
  if (typeof directory === 'string') {
    try {
      return await invokeTauri<string | null>('detect_git_branch', { directoryPath: directory });
    } catch {
      return null;
    }
  }

  try {
    const gitDir = await directory.getDirectoryHandle('.git');
    const headHandle = await gitDir.getFileHandle('HEAD');
    const headFile = await headHandle.getFile();
    const headContent = (await headFile.text()).trim();

    if (headContent.startsWith('ref: refs/heads/')) {
      return headContent.slice('ref: refs/heads/'.length);
    }

    if (/^[0-9a-f]{40}$/i.test(headContent)) {
      return `${headContent.slice(0, 8)}...`;
    }

    return null;
  } catch {
    return null;
  }
}

export async function readGitHistory(
  directory: FileSystemDirectoryHandle | string,
  limit: number = 30,
): Promise<GitHistoryEntry[]> {
  if (typeof directory === 'string') {
    try {
      return await invokeTauri<GitHistoryEntry[]>('read_git_history', {
        directoryPath: directory,
        limit,
      });
    } catch {
      return [];
    }
  }

  // Browser handle mode does not have reliable access to git commit history.
  return [];
}

export async function readGitChangedFiles(
  directory: FileSystemDirectoryHandle | string,
  commit: string,
): Promise<string[]> {
  if (typeof directory === 'string') {
    try {
      return await invokeTauri<string[]>('read_git_changed_files', {
        directoryPath: directory,
        commit,
      });
    } catch {
      return [];
    }
  }

  return [];
}

export async function readGitModelSnapshot(
  directory: FileSystemDirectoryHandle | string,
  commit: string,
): Promise<GitCommitFile[]> {
  if (typeof directory === 'string') {
    try {
      return await invokeTauri<GitCommitFile[]>('read_git_model_snapshot', {
        directoryPath: directory,
        commit,
      });
    } catch {
      return [];
    }
  }

  return [];
}
