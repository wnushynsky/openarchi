# Model Support Foundation Plan

This document turns the interoperability direction into concrete foundational work for the current OpenArchi codebase.

## Why This Foundation Is Needed

Current implementation is excellent for direct canvas editing, but interoperability needs additional structure:

- Import/export is currently hardcoded JSON in `src/App.tsx`.
- There is no adapter system for multiple formats.
- The in-memory model stores element coordinates globally, while standardized ArchiMate/coArchi ecosystems rely on view-specific diagram nodes.
- Git collaboration cannot run in a browser-only runtime without additional host capabilities.

## Target Foundation Architecture

### 1) Canonical Interoperability Schema

Introduce a canonical document model that separates:

- **Concepts**: elements and relationships with stable IDs and semantics.
- **Views**: diagram containers.
- **View nodes/connections**: per-view placement, bendpoints, and label positions.
- **Metadata**: source format, import warnings, extension data.

This schema becomes the single source of truth for all import/export formats.

### 2) Adapter-Based I/O Layer

Create format adapters with a consistent interface:

- `parse(raw) -> canonical + diagnostics`
- `serialize(canonical) -> raw`
- `validate(raw|canonical) -> diagnostics`

Planned adapters:

- `openarchi-json` (compatibility adapter first)
- `coarchi-xml`
- `archimate-exchange-xml`

### 3) Model Service Layer

Add a thin service that orchestrates:

- file loading/saving,
- adapter selection,
- validation and warning collection,
- conversion to UI editing state.

UI should call this service instead of embedding format logic in `App.tsx`.

### 4) Runtime Capability Layer (for Git)

Define an abstraction for Git operations:

- status, commit, pull, push, branch info, conflict detection.

Provide implementation based on chosen runtime:

- backend API, or
- desktop shell integration (e.g., Tauri/Electron).

## Incremental Build Plan (Implementation-Oriented)

### Milestone A: Lay Core Contracts (No Behavior Changes)

- Add canonical model type definitions.
- Add adapter interface definitions and diagnostics model.
- Add `openarchi-json` adapter implementing current behavior.
- Keep existing UI behavior unchanged.

**Exit condition:** Current JSON import/export still works through new adapter path.

### Milestone B: State Boundary Refactor

- Introduce mapper between canonical model and editor state.
- Move import/export calls in `App.tsx` to new model service.
- Keep all current editing interactions functional.

**Exit condition:** No regression in existing editing + JSON workflow.

### Milestone C: View-Aware Representation Upgrade

- Extend editor data model to support per-view node instances.
- Ensure rendering and hit-testing use current view node data.
- Add compatibility migration from existing flat model state.

**Exit condition:** Same concept can appear in multiple views with independent layout.

### Milestone D: coArchi Adapter MVP

- Parse core coArchi model structures into canonical schema.
- Serialize canonical schema back to coArchi XML.
- Surface unsupported constructs as warnings.

**Exit condition:** coArchi round-trip passes for agreed fixture set.

### Milestone E: ArchiMate Exchange Adapter MVP

- Implement parser/serializer for standardized exchange format.
- Validate against representative Open Group examples.
- Add cross-format conversion checks.

**Exit condition:** exchange format import/export works for core ArchiMate constructs.

### Milestone F: Git Menu Foundation

- Add Git capability interface and mock implementation in UI.
- Build menu/status UX using the interface.
- Swap to real runtime implementation once backend/desktop path is chosen.

**Exit condition:** UI workflow is complete and runtime integration-ready.

## Suggested Initial File Layout

```text
src/
  model/
    canonical.ts          # Canonical document types
    diagnostics.ts        # Errors/warnings/contracts
    mapper.ts             # Canonical <-> editor model mapper
    service.ts            # Import/export orchestration
  io/
    adapter.ts            # Adapter interface + registry
    adapters/
      openarchi-json.ts
      coarchi-xml.ts
      archimate-exchange-xml.ts
  collaboration/
    git-capability.ts     # Runtime-agnostic Git interface
```

## Technical Risks to Watch Early

- **Model mismatch risk:** current editor model is flatter than exchange formats.
- **Namespace/version risk:** XML variants may differ by tool version.
- **Runtime risk for Git:** browser-only mode cannot satisfy local Git needs.
- **Complexity risk:** large one-shot refactor could destabilize editing UX.

## First PR Recommendation

Keep the first implementation PR focused and low-risk:

1. Add canonical + adapter contracts.
2. Add `openarchi-json` adapter only.
3. Route current JSON import/export through the adapter.

This establishes the extension seam for coArchi and exchange support without blocking ongoing feature work.
