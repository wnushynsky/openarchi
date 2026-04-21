type InvokeArgs = Record<string, unknown> | undefined;

interface TauriCoreApi {
  invoke: <T>(command: string, args?: InvokeArgs) => Promise<T>;
}

interface TauriWindowApi {
  core?: TauriCoreApi;
}

function getTauriApi(): TauriWindowApi | null {
  if (typeof window === 'undefined') return null;
  const tauri = (window as Window & { __TAURI__?: TauriWindowApi }).__TAURI__;
  return tauri ?? null;
}

export function isTauriRuntime(): boolean {
  return typeof getTauriApi()?.core?.invoke === 'function';
}

export async function invokeTauri<T>(command: string, args?: InvokeArgs): Promise<T> {
  const core = getTauriApi()?.core;
  if (!core) {
    throw new Error('Tauri runtime is not available');
  }
  return core.invoke<T>(command, args);
}
