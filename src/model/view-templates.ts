import type {
  DiagramConnectionRecord,
  DiagramNodeRecord,
  ModelElement,
  ModelRelationship,
  ModelView,
} from '../types';
import { ELEMENT_TYPES, RELATIONSHIP_TYPES } from '../core';
import { getSuggestedPurposeForViewpoint } from './viewpoints';

export interface ViewTemplateDefinition {
  id: string;
  kind?: 'builtin' | 'custom';
  label: string;
  viewpoint: string;
  description: string;
  defaultName: string;
  groupLabel?: string;
  noteText?: string;
  starterSummary: string;
  starterElements?: ModelElement[];
  starterRelationships?: ModelRelationship[];
  starterDiagramNodes?: DiagramNodeRecord[];
  starterDiagramConnections?: DiagramConnectionRecord[];
}

export interface ViewTemplateInstance {
  view: ModelView;
  elements: ModelElement[];
  relationships: ModelRelationship[];
  diagramNodes: DiagramNodeRecord[];
  diagramConnections: DiagramConnectionRecord[];
}

export const VIEW_TEMPLATES: ViewTemplateDefinition[] = [
  {
    id: 'landscape-overview',
    kind: 'builtin',
    label: 'Landscape Overview',
    viewpoint: 'landscape',
    description: 'A cross-layer overview with space for major domains and narrative.',
    defaultName: 'Landscape Overview',
    groupLabel: 'Architecture Scope',
    noteText: 'Summarize the scope, main domains, and key stakeholders for this landscape view.',
    starterSummary: 'Seeds business, application, and technology services with cross-layer realization links.',
  },
  {
    id: 'business-process',
    kind: 'builtin',
    label: 'Business Process',
    viewpoint: 'business-process',
    description: 'Business behavior and participating actors, roles, and services.',
    defaultName: 'Business Process',
    groupLabel: 'Business Flow',
    noteText: 'Capture the trigger, primary business roles, and expected business outcome.',
    starterSummary: 'Seeds a business actor, process, service, and object with assignment, realization, and access links.',
  },
  {
    id: 'application-cooperation',
    kind: 'builtin',
    label: 'Application Cooperation',
    viewpoint: 'application-cooperation',
    description: 'Application services, components, and core collaborations.',
    defaultName: 'Application Cooperation',
    groupLabel: 'Application Collaboration',
    noteText: 'Identify the main application services, interfaces, and integration flow.',
    starterSummary: 'Seeds cooperating application components, a service, and shared data with flow, realization, and access links.',
  },
  {
    id: 'technology-usage',
    kind: 'builtin',
    label: 'Technology Usage',
    viewpoint: 'technology-usage',
    description: 'Technology nodes, system software, and deployment footprint.',
    defaultName: 'Technology Usage',
    groupLabel: 'Deployment Scope',
    noteText: 'Describe the runtime footprint, key nodes, and deployment concerns.',
    starterSummary: 'Seeds a node, system software, technology service, and artifact with deployment-oriented relationships.',
  },
  {
    id: 'motivation-trace',
    kind: 'builtin',
    label: 'Motivation Trace',
    viewpoint: 'motivation',
    description: 'Goals, requirements, and architecture rationale.',
    defaultName: 'Motivation Trace',
    groupLabel: 'Motivation Scope',
    noteText: 'Document the goals, requirements, and rationale this view should trace.',
    starterSummary: 'Seeds drivers, goals, requirements, and constraints with traceability links.',
  },
  {
    id: 'implementation-plan',
    kind: 'builtin',
    label: 'Implementation Plan',
    viewpoint: 'implementation',
    description: 'Work packages, deliverables, and migration planning.',
    defaultName: 'Implementation Plan',
    groupLabel: 'Delivery Scope',
    noteText: 'Outline the work packages, target milestones, and migration dependencies.',
    starterSummary: 'Seeds work packages, deliverables, plateaus, and gaps with delivery-oriented relationships.',
  },
];

interface SemanticTemplateData {
  elements: ModelElement[];
  relationships: ModelRelationship[];
}

function createElement(
  id: string,
  type: string,
  name: string,
  x: number,
  y: number,
  w = 160,
  h = 72,
): ModelElement {
  return {
    id,
    type,
    name,
    x,
    y,
    w,
    h,
    documentation: '',
  };
}

function createRelationship(
  id: string,
  type: string,
  sourceId: string,
  targetId: string,
  name = '',
): ModelRelationship {
  return {
    id,
    type,
    sourceId,
    targetId,
    name,
    documentation: '',
    waypoints: [],
    labelPos: 0.5,
  };
}

function buildSemanticTemplateData(templateId: string, makeId: () => string): SemanticTemplateData {
  switch (templateId) {
    case 'business-process': {
      const actor = createElement(makeId(), 'businessActor', 'Customer Services', 110, 250);
      const process = createElement(makeId(), 'businessProcess', 'Handle Customer Request', 330, 245, 190, 82);
      const service = createElement(makeId(), 'businessService', 'Customer Handling Service', 580, 250, 180, 72);
      const object = createElement(makeId(), 'businessObject', 'Case Record', 345, 365, 170, 72);
      return {
        elements: [actor, process, service, object],
        relationships: [
          createRelationship(makeId(), 'assignment', actor.id, process.id),
          createRelationship(makeId(), 'realization', process.id, service.id),
          createRelationship(makeId(), 'access', process.id, object.id, 'updates'),
        ],
      };
    }
    case 'application-cooperation': {
      const systemA = createElement(makeId(), 'applicationComponent', 'Order API', 110, 250);
      const systemB = createElement(makeId(), 'applicationComponent', 'Order Processing', 330, 250);
      const service = createElement(makeId(), 'applicationService', 'Order Service', 580, 250, 170, 72);
      const data = createElement(makeId(), 'dataObject', 'Order Payload', 345, 365, 160, 72);
      return {
        elements: [systemA, systemB, service, data],
        relationships: [
          createRelationship(makeId(), 'flow', systemA.id, systemB.id, 'events'),
          createRelationship(makeId(), 'realization', systemB.id, service.id),
          createRelationship(makeId(), 'access', systemB.id, data.id, 'reads/writes'),
        ],
      };
    }
    case 'technology-usage': {
      const node = createElement(makeId(), 'node', 'Runtime Cluster', 110, 250, 175, 82);
      const software = createElement(makeId(), 'systemSoftware', 'Container Platform', 330, 250, 185, 72);
      const service = createElement(makeId(), 'technologyService', 'Container Hosting', 580, 250, 180, 72);
      const artifact = createElement(makeId(), 'artifact', 'Deployment Package', 345, 365, 170, 72);
      return {
        elements: [node, software, service, artifact],
        relationships: [
          createRelationship(makeId(), 'composition', node.id, software.id),
          createRelationship(makeId(), 'realization', software.id, service.id),
          createRelationship(makeId(), 'access', software.id, artifact.id, 'deploys'),
        ],
      };
    }
    case 'motivation-trace': {
      const driver = createElement(makeId(), 'driver', 'Customer Demand', 110, 250, 170, 72);
      const goal = createElement(makeId(), 'goal', 'Improve Fulfilment Speed', 330, 250, 200, 72);
      const requirement = createElement(makeId(), 'requirement', 'Automate Order Routing', 580, 250, 180, 72);
      const constraint = createElement(makeId(), 'constraint', 'Compliance Rules', 345, 365, 170, 72);
      return {
        elements: [driver, goal, requirement, constraint],
        relationships: [
          createRelationship(makeId(), 'influence', driver.id, goal.id),
          createRelationship(makeId(), 'realization', requirement.id, goal.id),
          createRelationship(makeId(), 'association', constraint.id, requirement.id),
        ],
      };
    }
    case 'implementation-plan': {
      const workPackage = createElement(makeId(), 'workPackage', 'Modernize Order Flow', 110, 250, 185, 82);
      const deliverable = createElement(makeId(), 'deliverable', 'Order Service Release', 345, 250, 180, 72);
      const plateau = createElement(makeId(), 'plateau', 'Target Operating Model', 580, 250, 180, 72);
      const gap = createElement(makeId(), 'gap', 'Manual Handoff Removed', 345, 365, 180, 72);
      return {
        elements: [workPackage, deliverable, plateau, gap],
        relationships: [
          createRelationship(makeId(), 'realization', workPackage.id, deliverable.id),
          createRelationship(makeId(), 'association', deliverable.id, plateau.id),
          createRelationship(makeId(), 'association', gap.id, plateau.id),
        ],
      };
    }
    case 'landscape-overview':
    default: {
      const business = createElement(makeId(), 'businessService', 'Business Capability Service', 110, 250, 180, 72);
      const application = createElement(makeId(), 'applicationService', 'Application Platform Service', 345, 250, 190, 72);
      const technology = createElement(makeId(), 'technologyService', 'Hosting Service', 590, 250, 170, 72);
      return {
        elements: [business, application, technology],
        relationships: [
          createRelationship(makeId(), 'realization', application.id, business.id),
          createRelationship(makeId(), 'realization', technology.id, application.id),
        ],
      };
    }
  }
}

function getGenericElementName(type: string): string {
  return ELEMENT_TYPES[type]?.label || type;
}

function getGenericRelationshipName(type: string): string {
  return RELATIONSHIP_TYPES[type]?.label || type;
}

export function createCustomViewTemplate(
  templateId: string,
  label: string,
  view: ModelView,
  elements: ModelElement[],
  relationships: ModelRelationship[],
  diagramNodes: DiagramNodeRecord[],
  diagramConnections: DiagramConnectionRecord[],
): ViewTemplateDefinition {
  const includedElementIds = new Set(view.elementIds || []);
  const includedElements = elements.filter(element => includedElementIds.has(element.id));
  const includedRelationships = relationships.filter(relationship => (
    includedElementIds.has(relationship.sourceId) && includedElementIds.has(relationship.targetId)
  ));
  const nodeByElementId = new Map(diagramNodes.map(node => [node.elementId, node]));
  const connectionByRelationshipId = new Map(diagramConnections.map(connection => [connection.relationshipId, connection]));

  const starterElements = includedElements.map(element => {
    const node = nodeByElementId.get(element.id);
    return {
      ...element,
      name: getGenericElementName(element.type),
      documentation: '',
      properties: undefined,
      sourcePath: undefined,
      linkedViewId: undefined,
      x: node?.x ?? element.x,
      y: node?.y ?? element.y,
      w: node?.w ?? element.w,
      h: node?.h ?? element.h,
      zIndex: node?.zIndex ?? element.zIndex,
      style: node?.style ?? element.style,
    };
  });

  const starterRelationships = includedRelationships.map(relationship => ({
    ...relationship,
    name: getGenericRelationshipName(relationship.type),
    documentation: '',
    properties: undefined,
    sourcePath: undefined,
    waypoints: [],
    labelPos: 0.5,
  }));

  const starterDiagramNodes = starterElements.map(element => {
    const node = nodeByElementId.get(element.id);
    return {
      id: `${view.id}::${element.id}`,
      viewId: view.id,
      elementId: element.id,
      x: node?.x ?? element.x,
      y: node?.y ?? element.y,
      w: node?.w ?? element.w,
      h: node?.h ?? element.h,
      linkedViewId: undefined,
      zIndex: node?.zIndex ?? element.zIndex,
      style: node?.style ?? element.style,
      parentNodeId: node?.parentNodeId,
      nestingDepth: node?.nestingDepth,
    };
  });

  const nodeIdByElementId = new Map(starterDiagramNodes.map(node => [node.elementId, node.id]));
  const starterDiagramConnections = starterRelationships.map(relationship => {
    const connection = connectionByRelationshipId.get(relationship.id);
    return {
      id: `${view.id}::${relationship.id}`,
      viewId: view.id,
      relationshipId: relationship.id,
      sourceNodeId: nodeIdByElementId.get(relationship.sourceId),
      targetNodeId: nodeIdByElementId.get(relationship.targetId),
      waypoints: connection?.waypoints.map(waypoint => ({ ...waypoint })) || [],
      labelPos: connection?.labelPos ?? 0.5,
      relativeBendpoints: connection?.relativeBendpoints?.map(bendpoint => ({ ...bendpoint })),
    };
  });

  return {
    id: templateId,
    kind: 'custom',
    label,
    viewpoint: view.viewpoint || 'landscape',
    description: `Custom scaffold captured from "${view.name}".`,
    defaultName: view.name,
    starterSummary: `Seeds ${starterElements.length} elements and ${starterRelationships.length} relationships from the captured structure.`,
    starterElements,
    starterRelationships,
    starterDiagramNodes,
    starterDiagramConnections,
  };
}

export function instantiateViewTemplate(
  template: ViewTemplateDefinition,
  options: {
    viewId: string;
    name?: string;
    makeId?: () => string;
  },
): ViewTemplateInstance {
  const makeId = options.makeId || (() => `template-${Math.random().toString(36).slice(2, 10)}`);
  if (template.kind === 'custom' && template.starterElements && template.starterRelationships) {
    const elementIdMap = new Map<string, string>();
    const relationshipIdMap = new Map<string, string>();
    const nodeIdMap = new Map<string, string>();
    const elements = template.starterElements.map(element => {
      const nextId = makeId();
      elementIdMap.set(element.id, nextId);
      return {
        ...element,
        id: nextId,
        sourcePath: undefined,
        linkedViewId: undefined,
      };
    });
    const relationships = template.starterRelationships.map(relationship => {
      const nextId = makeId();
      relationshipIdMap.set(relationship.id, nextId);
      return {
        ...relationship,
        id: nextId,
        sourceId: elementIdMap.get(relationship.sourceId) || relationship.sourceId,
        targetId: elementIdMap.get(relationship.targetId) || relationship.targetId,
        sourcePath: undefined,
      };
    });
    const diagramNodes = (template.starterDiagramNodes || []).map(node => {
      const nextNodeId = `${options.viewId}::${elementIdMap.get(node.elementId) || makeId()}`;
      nodeIdMap.set(node.id, nextNodeId);
      return {
        ...node,
        id: nextNodeId,
        viewId: options.viewId,
        elementId: elementIdMap.get(node.elementId) || node.elementId,
        linkedViewId: undefined,
      };
    });
    const diagramConnections = (template.starterDiagramConnections || []).map(connection => ({
      ...connection,
      id: `${options.viewId}::${relationshipIdMap.get(connection.relationshipId) || makeId()}`,
      viewId: options.viewId,
      relationshipId: relationshipIdMap.get(connection.relationshipId) || connection.relationshipId,
      sourceNodeId: connection.sourceNodeId ? nodeIdMap.get(connection.sourceNodeId) : undefined,
      targetNodeId: connection.targetNodeId ? nodeIdMap.get(connection.targetNodeId) : undefined,
      waypoints: connection.waypoints.map(waypoint => ({ ...waypoint })),
      relativeBendpoints: connection.relativeBendpoints?.map(bendpoint => ({ ...bendpoint })),
    }));

    return {
      view: {
        id: options.viewId,
        name: options.name?.trim() || template.defaultName,
        elementIds: elements.map(element => element.id),
        childViewIds: [],
        viewpoint: template.viewpoint,
        purpose: getSuggestedPurposeForViewpoint(template.viewpoint) || template.description,
      },
      elements,
      relationships,
      diagramNodes,
      diagramConnections,
    };
  }

  const groupId = makeId();
  const noteId = makeId();
  const group: ModelElement = {
    id: groupId,
    type: 'grouping',
    name: template.groupLabel || 'Grouping',
    x: 64,
    y: 64,
    w: 740,
    h: 420,
    documentation: '',
  };

  const note: ModelElement = {
    id: noteId,
    type: 'note',
    name: template.noteText || 'Describe the purpose of this view.',
    x: 92,
    y: 96,
    w: 240,
    h: 110,
    documentation: '',
  };

  const semanticTemplate = buildSemanticTemplateData(template.id, makeId);
  const elements = [group, note, ...semanticTemplate.elements];
  const nodeByElementId = new Map<string, DiagramNodeRecord>();
  const diagramNodes = elements.map((element, index) => {
    const node: DiagramNodeRecord = {
      id: `${options.viewId}::${element.id}`,
      viewId: options.viewId,
      elementId: element.id,
      x: element.x,
      y: element.y,
      w: element.w,
      h: element.h,
      parentNodeId: element.id === group.id ? undefined : `${options.viewId}::${group.id}`,
      zIndex: element.id === group.id ? 0 : element.id === note.id ? 2 : 1,
      nestingDepth: element.id === group.id ? 0 : 1,
      linkedViewId: element.linkedViewId,
      style: element.style,
    };
    if (index === 0) {
      node.parentNodeId = undefined;
    }
    nodeByElementId.set(element.id, node);
    return node;
  });
  const diagramConnections = semanticTemplate.relationships.map(relationship => ({
    id: `${options.viewId}::${relationship.id}`,
    viewId: options.viewId,
    relationshipId: relationship.id,
    sourceNodeId: nodeByElementId.get(relationship.sourceId)?.id,
    targetNodeId: nodeByElementId.get(relationship.targetId)?.id,
    waypoints: [],
    labelPos: 0.5,
  }));

  return {
    view: {
      id: options.viewId,
      name: options.name?.trim() || template.defaultName,
      elementIds: elements.map(element => element.id),
      childViewIds: [],
      viewpoint: template.viewpoint,
      purpose: getSuggestedPurposeForViewpoint(template.viewpoint) || template.description,
    },
    elements,
    relationships: semanticTemplate.relationships,
    diagramNodes,
    diagramConnections,
  };
}
