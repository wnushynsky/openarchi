import type {
  CanonicalAiMetadata,
  CanonicalElement,
  CanonicalModelDocument,
  CanonicalProperty,
  CanonicalRelationship,
  CanonicalView,
} from '../model/canonical';
import type { ModelDiagnostic } from '../model/diagnostics';
import { compileViewPlans, type ViewCompileLayoutHints, type ViewCompilePlan } from '../model/view-compiler';

interface PatchEntityEnvelope<TAdd, TUpdate> {
  add?: TAdd[];
  update?: TUpdate[];
  remove?: string[];
}

interface ElementAddPatch {
  id: string;
  type: string;
  name?: string;
  documentation?: string;
  summary?: string;
  tags?: string[];
  properties?: CanonicalProperty[];
}

interface ElementUpdatePatch extends Partial<Omit<ElementAddPatch, 'id' | 'type'>> {
  id: string;
  type?: string;
}

interface RelationshipAddPatch {
  id: string;
  type: string;
  sourceId: string;
  targetId: string;
  name?: string;
  documentation?: string;
  tags?: string[];
  properties?: CanonicalProperty[];
}

interface RelationshipUpdatePatch extends Partial<Omit<RelationshipAddPatch, 'id' | 'sourceId' | 'targetId' | 'type'>> {
  id: string;
  type?: string;
  sourceId?: string;
  targetId?: string;
}

interface ViewMemberSet {
  elements?: string[];
  relationships?: string[];
}

interface ViewMemberPatch {
  setElements?: string[];
  addElements?: string[];
  removeElements?: string[];
  setRelationships?: string[];
  addRelationships?: string[];
  removeRelationships?: string[];
}

interface ViewAddPatch {
  id: string;
  name: string;
  documentation?: string;
  purpose?: string;
  viewpoint?: string;
  tags?: string[];
  properties?: CanonicalProperty[];
  childViewIds?: string[];
  members?: ViewMemberSet;
  layout?: ViewCompileLayoutHints;
}

interface ViewUpdatePatch {
  id: string;
  name?: string;
  documentation?: string;
  purpose?: string;
  viewpoint?: string;
  tags?: string[];
  properties?: CanonicalProperty[];
  childViewIds?: string[];
  members?: ViewMemberPatch;
  layout?: ViewCompileLayoutHints;
}

export interface OpenArchiMarkdownPatch {
  kind: 'openarchi-patch';
  version: number;
  metadata?: {
    ai?: CanonicalAiMetadata;
  };
  elements?: PatchEntityEnvelope<ElementAddPatch, ElementUpdatePatch>;
  relationships?: PatchEntityEnvelope<RelationshipAddPatch, RelationshipUpdatePatch>;
  views?: PatchEntityEnvelope<ViewAddPatch, ViewUpdatePatch>;
}

function cloneDocument(document: CanonicalModelDocument): CanonicalModelDocument {
  return JSON.parse(JSON.stringify(document)) as CanonicalModelDocument;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isOpenArchiMarkdownPatch(value: unknown): value is OpenArchiMarkdownPatch {
  return isRecord(value) && value.kind === 'openarchi-patch';
}

function normalizeTags(tags: string[] | undefined): string[] | undefined {
  if (!tags) return undefined;
  const normalized = [...new Set(tags.map(tag => tag.trim()).filter(Boolean))];
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeProperties(properties: CanonicalProperty[] | undefined): CanonicalProperty[] | undefined {
  if (!properties) return undefined;
  const normalized = properties
    .filter(property => property.key.trim() !== '')
    .map(property => ({ key: property.key.trim(), value: property.value }));
  return normalized.length > 0 ? normalized : undefined;
}

function inferRelationshipsForElements(document: CanonicalModelDocument, elementIds: Set<string>): string[] {
  return document.relationships
    .filter(relationship => elementIds.has(relationship.sourceId) && elementIds.has(relationship.targetId))
    .map(relationship => relationship.id);
}

function pruneInvalidReferences(document: CanonicalModelDocument): void {
  const elementIds = new Set(document.elements.map(element => element.id));
  const relationshipIds = new Set(document.relationships.map(relationship => relationship.id));
  const viewIds = new Set(document.views.map(view => view.id));

  document.viewNodes = document.viewNodes.filter(node => viewIds.has(node.viewId) && elementIds.has(node.elementId));
  const nodeIds = new Set(document.viewNodes.map(node => node.id));
  document.viewConnections = document.viewConnections.filter(connection =>
    viewIds.has(connection.viewId) &&
    relationshipIds.has(connection.relationshipId) &&
    (!connection.sourceNodeId || nodeIds.has(connection.sourceNodeId)) &&
    (!connection.targetNodeId || nodeIds.has(connection.targetNodeId)),
  );
}

function currentElementMembership(document: CanonicalModelDocument, viewId: string): string[] {
  return [...new Set(document.viewNodes.filter(node => node.viewId === viewId).map(node => node.elementId))];
}

function currentRelationshipMembership(document: CanonicalModelDocument, viewId: string): string[] {
  return [...new Set(document.viewConnections.filter(connection => connection.viewId === viewId).map(connection => connection.relationshipId))];
}

function applySetPatch(current: Set<string>, patch: { set?: string[]; add?: string[]; remove?: string[] }): Set<string> {
  const result = patch.set ? new Set(patch.set) : new Set(current);
  for (const value of patch.add || []) result.add(value);
  for (const value of patch.remove || []) result.delete(value);
  return result;
}

function buildViewPlanForAddedView(document: CanonicalModelDocument, view: ViewAddPatch): ViewCompilePlan {
  const elementIds = new Set(view.members?.elements || []);
  const relationshipIds = view.members?.relationships
    ? [...new Set(view.members.relationships)]
    : inferRelationshipsForElements(document, elementIds);

  return {
    viewId: view.id,
    elementIds: [...elementIds],
    relationshipIds,
    layout: view.layout,
  };
}

function buildViewPlanForUpdatedView(
  document: CanonicalModelDocument,
  view: ViewUpdatePatch,
  newlyAddedRelationshipIds: Set<string>,
): ViewCompilePlan {
  const currentElements = new Set(currentElementMembership(document, view.id));
  const nextElements = applySetPatch(currentElements, {
    set: view.members?.setElements,
    add: view.members?.addElements,
    remove: view.members?.removeElements,
  });

  let nextRelationships: Set<string>;
  if (view.members?.setRelationships) {
    nextRelationships = new Set(view.members.setRelationships);
  } else {
    const currentRelationships = new Set(
      currentRelationshipMembership(document, view.id).filter(relationshipId => {
        const relationship = document.relationships.find(candidate => candidate.id === relationshipId);
        return relationship
          ? nextElements.has(relationship.sourceId) && nextElements.has(relationship.targetId)
          : false;
      }),
    );
    nextRelationships = applySetPatch(currentRelationships, {
      add: view.members?.addRelationships,
      remove: view.members?.removeRelationships,
    });
    for (const relationshipId of newlyAddedRelationshipIds) {
      const relationship = document.relationships.find(candidate => candidate.id === relationshipId);
      if (!relationship) continue;
      if (nextElements.has(relationship.sourceId) && nextElements.has(relationship.targetId)) {
        nextRelationships.add(relationshipId);
      }
    }
  }

  return {
    viewId: view.id,
    elementIds: [...nextElements],
    relationshipIds: [...nextRelationships],
    layout: view.layout,
  };
}

export function applyOpenArchiMarkdownPatch(
  baseDocument: CanonicalModelDocument,
  patch: OpenArchiMarkdownPatch,
): { document: CanonicalModelDocument; diagnostics: ModelDiagnostic[] } {
  const diagnostics: ModelDiagnostic[] = [];
  const document = cloneDocument(baseDocument);
  const newlyAddedRelationshipIds = new Set<string>();
  const viewPlans: ViewCompilePlan[] = [];

  const elementById = new Map(document.elements.map(element => [element.id, element]));
  const relationshipById = new Map(document.relationships.map(relationship => [relationship.id, relationship]));
  const viewById = new Map(document.views.map(view => [view.id, view]));

  if (patch.metadata?.ai) {
    document.metadata = {
      ...(document.metadata || {}),
      ai: {
        ...(document.metadata?.ai || {}),
        ...patch.metadata.ai,
      },
    };
  }

  for (const elementId of patch.elements?.remove || []) {
    document.elements = document.elements.filter(element => element.id !== elementId);
    document.relationships = document.relationships.filter(relationship =>
      relationship.sourceId !== elementId && relationship.targetId !== elementId,
    );
    elementById.delete(elementId);
  }

  for (const update of patch.elements?.update || []) {
    const current = elementById.get(update.id);
    if (!current) {
      diagnostics.push({
        severity: 'error',
        code: 'PATCH_ELEMENT_NOT_FOUND',
        message: `Cannot update missing element '${update.id}'.`,
      });
      continue;
    }
    Object.assign(current, {
      ...(update.type ? { type: update.type } : {}),
      ...(update.name !== undefined ? { name: update.name } : {}),
      ...(update.documentation !== undefined ? { documentation: update.documentation } : {}),
      ...(update.summary !== undefined ? { summary: update.summary } : {}),
      ...(update.tags !== undefined ? { tags: normalizeTags(update.tags) } : {}),
      ...(update.properties !== undefined ? { properties: normalizeProperties(update.properties) } : {}),
    });
  }

  for (const add of patch.elements?.add || []) {
    if (elementById.has(add.id)) {
      diagnostics.push({
        severity: 'error',
        code: 'PATCH_ELEMENT_DUPLICATE',
        message: `Cannot add duplicate element '${add.id}'.`,
      });
      continue;
    }
    const element: CanonicalElement = {
      id: add.id,
      type: add.type,
      name: add.name || add.type,
      documentation: add.documentation || '',
      summary: add.summary,
      tags: normalizeTags(add.tags),
      properties: normalizeProperties(add.properties),
    };
    document.elements.push(element);
    elementById.set(element.id, element);
  }

  for (const relationshipId of patch.relationships?.remove || []) {
    document.relationships = document.relationships.filter(relationship => relationship.id !== relationshipId);
    relationshipById.delete(relationshipId);
  }

  for (const update of patch.relationships?.update || []) {
    const current = relationshipById.get(update.id);
    if (!current) {
      diagnostics.push({
        severity: 'error',
        code: 'PATCH_RELATIONSHIP_NOT_FOUND',
        message: `Cannot update missing relationship '${update.id}'.`,
      });
      continue;
    }
    if (update.sourceId && !elementById.has(update.sourceId)) {
      diagnostics.push({
        severity: 'error',
        code: 'PATCH_RELATIONSHIP_SOURCE_MISSING',
        message: `Cannot point relationship '${update.id}' to missing source '${update.sourceId}'.`,
      });
      continue;
    }
    if (update.targetId && !elementById.has(update.targetId)) {
      diagnostics.push({
        severity: 'error',
        code: 'PATCH_RELATIONSHIP_TARGET_MISSING',
        message: `Cannot point relationship '${update.id}' to missing target '${update.targetId}'.`,
      });
      continue;
    }
    Object.assign(current, {
      ...(update.type ? { type: update.type } : {}),
      ...(update.sourceId ? { sourceId: update.sourceId } : {}),
      ...(update.targetId ? { targetId: update.targetId } : {}),
      ...(update.name !== undefined ? { name: update.name } : {}),
      ...(update.documentation !== undefined ? { documentation: update.documentation } : {}),
      ...(update.tags !== undefined ? { tags: normalizeTags(update.tags) } : {}),
      ...(update.properties !== undefined ? { properties: normalizeProperties(update.properties) } : {}),
    });
  }

  for (const add of patch.relationships?.add || []) {
    if (relationshipById.has(add.id)) {
      diagnostics.push({
        severity: 'error',
        code: 'PATCH_RELATIONSHIP_DUPLICATE',
        message: `Cannot add duplicate relationship '${add.id}'.`,
      });
      continue;
    }
    if (!elementById.has(add.sourceId) || !elementById.has(add.targetId)) {
      diagnostics.push({
        severity: 'error',
        code: 'PATCH_RELATIONSHIP_ENDPOINT_MISSING',
        message: `Cannot add relationship '${add.id}' because one or both endpoints do not exist.`,
      });
      continue;
    }
    const relationship: CanonicalRelationship = {
      id: add.id,
      type: add.type,
      sourceId: add.sourceId,
      targetId: add.targetId,
      name: add.name || '',
      documentation: add.documentation,
      tags: normalizeTags(add.tags),
      properties: normalizeProperties(add.properties),
    };
    document.relationships.push(relationship);
    relationshipById.set(relationship.id, relationship);
    newlyAddedRelationshipIds.add(relationship.id);
  }

  for (const viewId of patch.views?.remove || []) {
    document.views = document.views.filter(view => view.id !== viewId);
    viewById.delete(viewId);
  }

  for (const update of patch.views?.update || []) {
    const current = viewById.get(update.id);
    if (!current) {
      diagnostics.push({
        severity: 'error',
        code: 'PATCH_VIEW_NOT_FOUND',
        message: `Cannot update missing view '${update.id}'.`,
      });
      continue;
    }
    Object.assign(current, {
      ...(update.name !== undefined ? { name: update.name } : {}),
      ...(update.documentation !== undefined ? { documentation: update.documentation } : {}),
      ...(update.purpose !== undefined ? { purpose: update.purpose } : {}),
      ...(update.viewpoint !== undefined ? { viewpoint: update.viewpoint } : {}),
      ...(update.tags !== undefined ? { tags: normalizeTags(update.tags) } : {}),
      ...(update.properties !== undefined ? { properties: normalizeProperties(update.properties) } : {}),
      ...(update.childViewIds !== undefined ? { childViewIds: [...update.childViewIds] } : {}),
    });
  }

  for (const add of patch.views?.add || []) {
    if (viewById.has(add.id)) {
      diagnostics.push({
        severity: 'error',
        code: 'PATCH_VIEW_DUPLICATE',
        message: `Cannot add duplicate view '${add.id}'.`,
      });
      continue;
    }
    const view: CanonicalView = {
      id: add.id,
      name: add.name,
      childViewIds: [...(add.childViewIds || [])],
      documentation: add.documentation,
      purpose: add.purpose,
      viewpoint: add.viewpoint,
      tags: normalizeTags(add.tags),
      properties: normalizeProperties(add.properties),
    };
    document.views.push(view);
    viewById.set(view.id, view);
    viewPlans.push(buildViewPlanForAddedView(document, add));
  }

  pruneInvalidReferences(document);

  for (const update of patch.views?.update || []) {
    if (update.members) {
      viewPlans.push(buildViewPlanForUpdatedView(document, update, newlyAddedRelationshipIds));
    }
  }

  diagnostics.push(...compileViewPlans(document, viewPlans));
  pruneInvalidReferences(document);

  return { document, diagnostics };
}
