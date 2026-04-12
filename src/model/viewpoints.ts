import { ELEMENT_TYPES } from '../core';

export interface ViewpointDefinition {
  id: string;
  label: string;
  description: string;
  allowedLayers: string[];
  suggestedPurpose: string;
}

export const VIEWPOINTS: ViewpointDefinition[] = [
  {
    id: 'landscape',
    label: 'Landscape',
    description: 'Cross-domain overview spanning the main architecture layers.',
    allowedLayers: ['strategy', 'business', 'application', 'technology', 'motivation', 'implementation', 'composite'],
    suggestedPurpose: 'Provide a cross-layer architecture overview.',
  },
  {
    id: 'business-process',
    label: 'Business Process',
    description: 'Business behavior, actors, roles, and services.',
    allowedLayers: ['business', 'motivation', 'composite'],
    suggestedPurpose: 'Explain a business process and the participating business structure.',
  },
  {
    id: 'application-cooperation',
    label: 'Application Cooperation',
    description: 'Application components, services, interfaces, and key collaborations.',
    allowedLayers: ['application', 'technology', 'motivation', 'composite'],
    suggestedPurpose: 'Show how application services and components cooperate.',
  },
  {
    id: 'technology-usage',
    label: 'Technology Usage',
    description: 'Infrastructure, nodes, system software, and deployment relationships.',
    allowedLayers: ['technology', 'application', 'implementation', 'composite'],
    suggestedPurpose: 'Describe the technology footprint and deployment structure.',
  },
  {
    id: 'motivation',
    label: 'Motivation',
    description: 'Goals, requirements, assessments, and constraints.',
    allowedLayers: ['motivation', 'strategy', 'business', 'application', 'composite'],
    suggestedPurpose: 'Trace goals and requirements to the architecture.',
  },
  {
    id: 'implementation',
    label: 'Implementation',
    description: 'Work packages, deliverables, plateaus, and migration planning.',
    allowedLayers: ['implementation', 'application', 'technology', 'motivation', 'composite'],
    suggestedPurpose: 'Plan implementation and migration work.',
  },
];

const VIEWPOINT_BY_ID = new Map(VIEWPOINTS.map(viewpoint => [viewpoint.id, viewpoint]));
const ALL_LAYERS = [...new Set(Object.values(ELEMENT_TYPES).map(definition => definition.layer))];

export function getViewpointDefinition(id: string | undefined): ViewpointDefinition | undefined {
  if (!id) return undefined;
  return VIEWPOINT_BY_ID.get(id);
}

export function getAllowedLayersForViewpoint(id: string | undefined): string[] {
  const viewpoint = getViewpointDefinition(id);
  return viewpoint?.allowedLayers || ALL_LAYERS;
}

export function getAllowedElementTypesForViewpoint(id: string | undefined): string[] {
  const allowedLayers = new Set(getAllowedLayersForViewpoint(id));
  return Object.entries(ELEMENT_TYPES)
    .filter(([type, definition]) => definition.isNote || type === 'grouping' || allowedLayers.has(definition.layer))
    .map(([type]) => type);
}

export function isElementTypeAllowedInViewpoint(type: string, viewpointId: string | undefined): boolean {
  if (type === 'note' || type === 'grouping' || type === 'viewReference') return true;
  return getAllowedElementTypesForViewpoint(viewpointId).includes(type);
}

export function getSuggestedPurposeForViewpoint(id: string | undefined): string | undefined {
  return getViewpointDefinition(id)?.suggestedPurpose;
}
