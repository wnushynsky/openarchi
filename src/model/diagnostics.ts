export type ModelDiagnosticSeverity = 'error' | 'warning' | 'info';

export interface ModelDiagnostic {
  severity: ModelDiagnosticSeverity;
  code: string;
  message: string;
  path?: string;
}

export function hasDiagnosticErrors(diagnostics: ModelDiagnostic[]): boolean {
  return diagnostics.some(diagnostic => diagnostic.severity === 'error');
}

