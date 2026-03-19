import type { ModelElement, ModelRelationship, ModelView } from '../types';

export const SAMPLE_ELEMENTS: ModelElement[] = [
  { id: 'el1', type: 'businessProcess', name: 'Order Processing', x: 260, y: 140, w: 160, h: 72, documentation: 'Main order flow' },
  { id: 'el2', type: 'applicationService', name: 'Order Service', x: 260, y: 290, w: 160, h: 72, documentation: 'REST API' },
  { id: 'el3', type: 'applicationComponent', name: 'Order System', x: 500, y: 210, w: 160, h: 72, documentation: 'Core app', linkedViewId: 'v3' },
  { id: 'el4', type: 'dataObject', name: 'Order Record', x: 500, y: 360, w: 160, h: 72, documentation: '' },
  { id: 'el5', type: 'technologyService', name: 'Database Service', x: 260, y: 440, w: 160, h: 72, documentation: '' },
  { id: 'el6', type: 'grouping', name: 'Infrastructure', x: 220, y: 400, w: 480, h: 140, documentation: '' },
  { id: 'el7', type: 'note', name: 'This service handles all incoming orders and validates them before processing.', x: 480, y: 100, w: 180, h: 80, documentation: '' },
];

export const SAMPLE_RELATIONSHIPS: ModelRelationship[] = [
  { id: 'r1', type: 'serving', sourceId: 'el2', targetId: 'el1', name: 'provides', waypoints: [], labelPos: 0.5 },
  { id: 'r2', type: 'realization', sourceId: 'el3', targetId: 'el2', name: '', waypoints: [], labelPos: 0.5 },
  { id: 'r3', type: 'access', sourceId: 'el3', targetId: 'el4', name: 'read/write', waypoints: [], labelPos: 0.5 },
  { id: 'r4', type: 'serving', sourceId: 'el5', targetId: 'el3', name: '', waypoints: [], labelPos: 0.5 },
];

export const SAMPLE_VIEWS: ModelView[] = [
  { id: 'v1', name: 'Main Overview', elementIds: ['el1', 'el2', 'el3', 'el4', 'el5'], childViewIds: ['v2', 'v3'] },
  { id: 'v2', name: 'Order Processing Detail', elementIds: ['el1', 'el2'], childViewIds: [] },
  { id: 'v3', name: 'Technology Stack', elementIds: ['el3', 'el4', 'el5'], childViewIds: [] },
];
