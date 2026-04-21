import type { WorkspaceMetadata } from './types';
import type { WorkspaceBackend } from '../io/filesystem';

const DB_NAME = 'openarchi-workspace';
const DB_VERSION = 1;
const STORE_NAME = 'state';
const KEY = 'workspace';

export interface StoredWorkspace {
  handle?: FileSystemDirectoryHandle;
  directoryPath?: string;
  backend?: WorkspaceBackend | null;
  metadata: WorkspaceMetadata;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveWorkspace(
  workspace: {
    handle?: FileSystemDirectoryHandle | null;
    directoryPath?: string | null;
    backend?: WorkspaceBackend | null;
  },
  metadata: WorkspaceMetadata,
): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const stored: StoredWorkspace = {
      handle: workspace.handle ?? undefined,
      directoryPath: workspace.directoryPath ?? undefined,
      backend: workspace.backend ?? null,
      metadata,
    };
    store.put(stored, KEY);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function loadWorkspace(): Promise<StoredWorkspace | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(KEY);
      request.onsuccess = () => { db.close(); resolve(request.result ?? null); };
      request.onerror = () => { db.close(); reject(request.error); };
    });
  } catch {
    return null;
  }
}

export async function clearWorkspace(): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.delete(KEY);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  } catch {
    // Ignore – no stored workspace
  }
}
