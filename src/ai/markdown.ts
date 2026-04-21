import { ELEMENT_TYPES, RELATIONSHIP_TYPES } from '../core';
import type {
  CanonicalElement,
  CanonicalModelDocument,
  CanonicalRelationship,
  CanonicalView,
  CanonicalViewConnection,
  CanonicalViewNode,
} from '../model/canonical';

function pushSection(lines: string[], title: string): void {
  lines.push(`## ${title}`, '');
}

function pushBullet(lines: string[], label: string, value: string | number | undefined): void {
  if (value === undefined || value === '') return;
  lines.push(`- ${label}: ${value}`);
}

function formatText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/\r\n/g, '\n');
}

function pushParagraph(lines: string[], value: string | undefined): void {
  const formatted = formatText(value);
  if (!formatted) return;
  lines.push('', formatted, '');
}

function formatProperties(properties: CanonicalElement['properties'] | CanonicalRelationship['properties']): string | undefined {
  if (!properties || properties.length === 0) return undefined;
  return properties.map(property => `\`${property.key}\`=${property.value}`).join(', ');
}

function formatTags(tags: string[] | undefined): string | undefined {
  if (!tags || tags.length === 0) return undefined;
  return tags.map(tag => `\`${tag}\``).join(', ');
}

function elementTypeLabel(type: string): string {
  return ELEMENT_TYPES[type]?.label || type;
}

function relationshipTypeLabel(type: string): string {
  return RELATIONSHIP_TYPES[type]?.label || type;
}

function escapeInlineCode(value: string): string {
  return value.replace(/`/g, '\\`');
}

function viewTitle(view: CanonicalView): string {
  return view.name ? `${view.name} \`${escapeInlineCode(view.id)}\`` : `\`${escapeInlineCode(view.id)}\``;
}

function elementTitle(element: CanonicalElement): string {
  const typeLabel = elementTypeLabel(element.type);
  return `${element.name || typeLabel} \`${escapeInlineCode(element.id)}\``;
}

function relationshipTitle(relationship: CanonicalRelationship): string {
  const label = relationship.name || relationshipTypeLabel(relationship.type);
  return `${label} \`${escapeInlineCode(relationship.id)}\``;
}

function groupNodesByView(nodes: CanonicalViewNode[]): Map<string, CanonicalViewNode[]> {
  const result = new Map<string, CanonicalViewNode[]>();
  for (const node of nodes) {
    const group = result.get(node.viewId);
    if (group) group.push(node);
    else result.set(node.viewId, [node]);
  }
  return result;
}

function groupConnectionsByView(connections: CanonicalViewConnection[]): Map<string, CanonicalViewConnection[]> {
  const result = new Map<string, CanonicalViewConnection[]>();
  for (const connection of connections) {
    const group = result.get(connection.viewId);
    if (group) group.push(connection);
    else result.set(connection.viewId, [connection]);
  }
  return result;
}

function buildViewsByElement(nodes: CanonicalViewNode[], viewsById: Map<string, CanonicalView>): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const node of nodes) {
    const view = viewsById.get(node.viewId);
    const names = result.get(node.elementId) || [];
    names.push(view?.name || node.viewId);
    result.set(node.elementId, names);
  }
  return result;
}

function pushTypeCatalog(
  lines: string[],
  title: string,
  entries: { key: string; label: string; desc?: string }[],
): void {
  if (entries.length === 0) return;
  pushSection(lines, title);
  for (const entry of entries) {
    lines.push(`- \`${entry.key}\` (${entry.label})${entry.desc ? `: ${entry.desc}` : ''}`);
  }
  lines.push('');
}

function pushElementsSection(
  lines: string[],
  document: CanonicalModelDocument,
  viewsByElementId: Map<string, string[]>,
): void {
  pushSection(lines, 'Elements');
  if (document.elements.length === 0) {
    lines.push('No elements.', '');
    return;
  }

  for (const element of document.elements) {
    const def = ELEMENT_TYPES[element.type];
    lines.push(`### ${elementTitle(element)}`);
    pushBullet(lines, 'Type', `\`${element.type}\` (${def?.label || element.type})`);
    pushBullet(lines, 'Layer', def?.layer);
    pushBullet(lines, 'Summary', element.summary);
    pushBullet(lines, 'Tags', formatTags(element.tags));
    pushBullet(lines, 'Properties', formatProperties(element.properties));
    pushBullet(lines, 'Views', viewsByElementId.get(element.id)?.join(', '));
    pushBullet(lines, 'Source path', element.sourcePath);
    pushParagraph(lines, element.documentation);
    lines.push('');
  }
}

function pushRelationshipsSection(lines: string[], document: CanonicalModelDocument): void {
  pushSection(lines, 'Relationships');
  if (document.relationships.length === 0) {
    lines.push('No relationships.', '');
    return;
  }

  for (const relationship of document.relationships) {
    lines.push(`### ${relationshipTitle(relationship)}`);
    pushBullet(lines, 'Type', `\`${relationship.type}\` (${relationshipTypeLabel(relationship.type)})`);
    pushBullet(lines, 'Source', `\`${escapeInlineCode(relationship.sourceId)}\``);
    pushBullet(lines, 'Target', `\`${escapeInlineCode(relationship.targetId)}\``);
    pushBullet(lines, 'Tags', formatTags(relationship.tags));
    pushBullet(lines, 'Properties', formatProperties(relationship.properties));
    pushBullet(lines, 'Source path', relationship.sourcePath);
    pushParagraph(lines, relationship.documentation);
    lines.push('');
  }
}

function pushViewsSection(
  lines: string[],
  document: CanonicalModelDocument,
  viewsById: Map<string, CanonicalView>,
  elementsById: Map<string, CanonicalElement>,
  relationshipsById: Map<string, CanonicalRelationship>,
): void {
  const nodesByViewId = groupNodesByView(document.viewNodes);
  const connectionsByViewId = groupConnectionsByView(document.viewConnections);

  pushSection(lines, 'Views');
  if (document.views.length === 0) {
    lines.push('No views.', '');
    return;
  }

  for (const view of document.views) {
    const nodes = nodesByViewId.get(view.id) || [];
    const connections = connectionsByViewId.get(view.id) || [];

    lines.push(`### ${viewTitle(view)}`);
    pushBullet(lines, 'Purpose', view.purpose);
    pushBullet(lines, 'Viewpoint', view.viewpoint);
    pushBullet(lines, 'Tags', formatTags(view.tags));
    pushBullet(lines, 'Child views', view.childViewIds.map(id => viewsById.get(id)?.name || id).join(', '));
    pushBullet(lines, 'Node count', nodes.length);
    pushBullet(lines, 'Connection count', connections.length);
    pushBullet(lines, 'Source path', view.sourcePath);
    pushParagraph(lines, view.documentation);

    if (nodes.length > 0) {
      lines.push('#### Nodes');
      for (const node of nodes) {
        const element = elementsById.get(node.elementId);
        const label = element?.name || node.elementId;
        const parentSuffix = node.parentNodeId ? ` parent=\`${escapeInlineCode(node.parentNodeId)}\`` : '';
        const linkedSuffix = node.linkedViewId ? ` linkedView=\`${escapeInlineCode(node.linkedViewId)}\`` : '';
        lines.push(
          `- \`${escapeInlineCode(node.id)}\` -> \`${escapeInlineCode(node.elementId)}\` (${label}) at (${node.x}, ${node.y}) size ${node.width}x${node.height}${parentSuffix}${linkedSuffix}`,
        );
      }
      lines.push('');
    }

    if (connections.length > 0) {
      lines.push('#### Connections');
      for (const connection of connections) {
        const relationship = relationshipsById.get(connection.relationshipId);
        const label = relationship?.name || relationshipTypeLabel(relationship?.type || connection.relationshipId);
        const sourceSuffix = connection.sourceNodeId ? ` sourceNode=\`${escapeInlineCode(connection.sourceNodeId)}\`` : '';
        const targetSuffix = connection.targetNodeId ? ` targetNode=\`${escapeInlineCode(connection.targetNodeId)}\`` : '';
        lines.push(
          `- \`${escapeInlineCode(connection.id)}\` -> \`${escapeInlineCode(connection.relationshipId)}\` (${label}) waypoints=${connection.waypoints.length}${sourceSuffix}${targetSuffix}`,
        );
      }
      lines.push('');
    }
  }
}

export function serializeCanonicalToMarkdown(document: CanonicalModelDocument): string {
  const generatedAt = new Date().toISOString();
  const viewsById = new Map(document.views.map(view => [view.id, view]));
  const elementsById = new Map(document.elements.map(element => [element.id, element]));
  const relationshipsById = new Map(document.relationships.map(relationship => [relationship.id, relationship]));
  const viewsByElementId = buildViewsByElement(document.viewNodes, viewsById);

  const usedElementTypes = [...new Set(document.elements.map(element => element.type))]
    .sort()
    .map(type => ({
      key: type,
      label: elementTypeLabel(type),
      desc: ELEMENT_TYPES[type]?.desc,
    }));
  const usedRelationshipTypes = [...new Set(document.relationships.map(relationship => relationship.type))]
    .sort()
    .map(type => ({
      key: type,
      label: relationshipTypeLabel(type),
      desc: RELATIONSHIP_TYPES[type]?.desc,
    }));

  const lines: string[] = [];

  lines.push('# OpenArchi AI Markdown', '');
  lines.push('This document is a readable projection of the canonical OpenArchi model.', '');
  lines.push('Import supports the canonical JSON block below and an optional structured patch block.', '');

  pushSection(lines, 'Summary');
  pushBullet(lines, 'Generated at', generatedAt);
  pushBullet(lines, 'Model version', document.version);
  pushBullet(lines, 'Source format', document.metadata?.sourceFormat);
  pushBullet(lines, 'Elements', document.elements.length);
  pushBullet(lines, 'Relationships', document.relationships.length);
  pushBullet(lines, 'Views', document.views.length);
  pushBullet(lines, 'View nodes', document.viewNodes.length);
  pushBullet(lines, 'View connections', document.viewConnections.length);
  pushBullet(lines, 'Model name', document.metadata?.coArchi?.modelName);
  pushBullet(lines, 'Model purpose', document.metadata?.coArchi?.modelPurpose);
  pushBullet(lines, 'AI primary prompt', document.metadata?.ai?.primaryPrompt);
  pushBullet(lines, 'AI notes', document.metadata?.ai?.agentNotes?.join(' | '));
  lines.push('');

  pushTypeCatalog(lines, 'Used Element Types', usedElementTypes);
  pushTypeCatalog(lines, 'Used Relationship Types', usedRelationshipTypes);
  pushElementsSection(lines, document, viewsByElementId);
  pushRelationshipsSection(lines, document);
  pushViewsSection(lines, document, viewsById, elementsById, relationshipsById);

  pushSection(lines, 'Patch Template');
  lines.push('Use this JSON block for deterministic agent edits. Leave arrays empty when unused.', '');
  lines.push('```json');
  lines.push(JSON.stringify({
    kind: 'openarchi-patch',
    version: 1,
    metadata: {
      ai: {
        agentNotes: [],
      },
    },
    elements: {
      add: [],
      update: [],
      remove: [],
    },
    relationships: {
      add: [],
      update: [],
      remove: [],
    },
    views: {
      add: [],
      update: [],
      remove: [],
    },
  }, null, 2));
  lines.push('```', '');

  pushSection(lines, 'Canonical Data');
  lines.push('```json');
  lines.push(JSON.stringify(document, null, 2));
  lines.push('```', '');

  return `${lines.join('\n').trimEnd()}\n`;
}
