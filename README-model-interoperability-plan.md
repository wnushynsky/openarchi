# Model Interoperability Plan

This plan is aligned to the current OpenArchi codebase and defines how to add:

- coArchi model import/export/edit support, plus Git collaboration workflows.
- ArchiMate Model Exchange File import/export/edit support (The Open Group standard).

## Current Baseline (What Exists Today)

- Frontend-only React + Canvas app, no backend runtime yet.
- Import/export currently supports only `openarchi` JSON from `App.tsx`.
- Model state is currently split into `elements`, `relationships`, `views` arrays.
- View definitions exist, but rendering/editing currently operates on global element coordinates.
- No parser/serializer abstraction layer yet; no format-specific adapters yet.
- No Git runtime integration yet.

## Key Gaps to Close First

1. Introduce a canonical internal document schema that can represent:
   - Concepts (elements/relationships) independent from diagrams.
   - View-specific nodes/connections (same concept in multiple views with different bounds).
2. Add a reusable model I/O adapter pipeline (`parse -> validate -> map`, `map -> validate -> serialize`).
3. Add validation and warning infrastructure (fatal vs non-fatal mapping issues).
4. Add host/runtime path for Git operations (browser-only runtime cannot perform local Git workflows by itself).

## Scope

### In Scope

- Adapter-based import/export for coArchi XML and ArchiMate Model Exchange XML.
- Editing imported models in the existing canvas editor.
- Built-in menus for format-aware import/export actions.
- Built-in Git collaboration menus once runtime support exists.

### Out of Scope (initial)

- Real-time concurrent editing.
- Hosted sync services beyond Git remotes.
- Full semantic linting of every optional ArchiMate extension feature in v1.

## Implementation Strategy

1. Stabilize a canonical model schema for interoperability.
2. Create a format adapter registry and shared import/export service layer.
3. Migrate existing JSON flow to use the same service layer (as control implementation).
4. Add coArchi adapter first (faster path to collaboration workflows).
5. Add ArchiMate Model Exchange adapter second.
6. Layer Git collaboration menus on a runtime that can actually execute Git commands.

## Phased Plan

### Phase 0: Foundation Refactor (Prerequisite)

- Define canonical model schema with view nodes and view connections.
- Add mapping from current in-memory model to canonical schema.
- Add model validation contracts and error types.
- Add format adapter interfaces and registry.
- Rewire current JSON import/export through adapter pipeline.

**Acceptance Criteria**
- Existing JSON import/export behavior still works via new pipeline.
- Canonical schema can represent one concept across multiple views.
- Validation errors are structured and surfaced consistently.

### Phase 1: coArchi Adapter (Import/Export/Edit)

- Implement coArchi XML parser + serializer.
- Map coArchi structures to canonical schema and back.
- Add user import/export actions in toolbar/menu with format selection.
- Add round-trip tests with fixture models.

**Acceptance Criteria**
- coArchi imports load editable diagrams without losing core element/relationship semantics.
- Exported coArchi can be reopened by OpenArchi and external coArchi-compatible tools.
- Unsupported features produce clear warnings instead of silent drops.

### Phase 2: ArchiMate Model Exchange Adapter

- Implement Model Exchange XML parser + serializer.
- Add mapping layer to canonical schema.
- Add conformance checks against representative Open Group samples.
- Add cross-format conversion tests (`coArchi <-> canonical <-> exchange`).

**Acceptance Criteria**
- Standard-compliant files import/export successfully.
- Core semantics survive round-trip and cross-format conversion.
- Non-mappable constructs are reported with actionable messages.

### Phase 3: Git Collaboration Menus

- Add menu-level Git workflows: open/clone/init, status, commit, pull, push.
- Add model-aware conflict guidance and post-merge revalidation.
- Add operation logs/status panel to replace current placeholder changelog.
- Define runtime approach (desktop shell or backend API) to execute Git safely.

**Acceptance Criteria**
- Users can complete edit -> commit -> push from in-app menus.
- Pull conflicts are detected and surfaced with clear next steps.
- Merged models are validated before final save/export.

### Phase 4: Hardening

- Performance profiling on large models.
- Expand fixture/test matrix for edge cases.
- Improve error UX and documentation.
- Finalize release checklist and migration notes.

## Risks and Mitigations

- **Schema mismatch risk:** Current model shape is too view-light.
  - **Mitigation:** Land canonical schema refactor first and keep compatibility mapper.
- **Runtime constraint risk:** Browser runtime cannot run local Git directly.
  - **Mitigation:** Decide runtime path early (desktop wrapper or backend Git service).
- **Data loss risk in conversion:** some constructs may not map 1:1.
  - **Mitigation:** mapping coverage matrix + explicit warning channel.

## Definition of Done

- coArchi and ArchiMate Exchange formats can be imported, edited, exported.
- Built-in Git collaboration menus are available in supported runtime mode.
- Round-trip/cross-format fixtures pass with documented known limitations.
- Docs include workflows, caveats, and troubleshooting.
