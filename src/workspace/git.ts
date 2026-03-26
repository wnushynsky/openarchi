/**
 * Detect the active git branch by reading .git/HEAD via the File System Access API.
 * Returns null if the directory is not a git repo or detection fails.
 */
export async function detectGitBranch(
  dirHandle: FileSystemDirectoryHandle,
): Promise<string | null> {
  try {
    const gitDir = await dirHandle.getDirectoryHandle('.git');
    const headHandle = await gitDir.getFileHandle('HEAD');
    const headFile = await headHandle.getFile();
    const headContent = (await headFile.text()).trim();

    // Symbolic ref: "ref: refs/heads/main"
    if (headContent.startsWith('ref: refs/heads/')) {
      return headContent.slice('ref: refs/heads/'.length);
    }

    // Detached HEAD: return short SHA
    if (/^[0-9a-f]{40}$/i.test(headContent)) {
      return headContent.slice(0, 8) + '...';
    }

    return null;
  } catch {
    // .git directory not found or not readable
    return null;
  }
}
