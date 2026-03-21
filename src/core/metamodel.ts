import type { LayerDef, ElementTypeDef, RelationshipTypeDef } from '../types';

// ============================================================
// Layer definitions
// ============================================================

export const LAYERS: Record<string, LayerDef> = {
  strategy: { label: 'Strategy', fill: '#F9E8A0', stroke: '#C49520', accent: '#9A7418', text: '#4A3810' },
  business: { label: 'Business', fill: '#F8F4A0', stroke: '#B0A830', accent: '#8A8020', text: '#3E3A08' },
  application: { label: 'Application', fill: '#B8E4EE', stroke: '#3A98A8', accent: '#2A7888', text: '#144050' },
  technology: { label: 'Technology', fill: '#B8E6C2', stroke: '#48945A', accent: '#307842', text: '#164020' },
  motivation: { label: 'Motivation', fill: '#D4C8F8', stroke: '#6A58B0', accent: '#504098', text: '#281850' },
  implementation: { label: 'Impl. & Migration', fill: '#F8C8CE', stroke: '#B04850', accent: '#983840', text: '#4A1018' },
  composite: { label: 'Composite', fill: 'transparent', stroke: '#888890', accent: '#686870', text: '#333' },
};

// Note element styling (not a real layer)
export const NOTE_STYLE: LayerDef = {
  label: 'Note',
  fill: '#EDEDF0',
  stroke: '#A8A8B0',
  accent: '#78787E',
  text: '#333',
};

// ============================================================
// Element type definitions (with ArchiMate descriptions)
// ============================================================

export const ELEMENT_TYPES: Record<string, ElementTypeDef> = {
  // Strategy
  resource: { label: 'Resource', layer: 'strategy', shape: 'rect', desc: 'An asset owned or controlled by an individual or organization' },
  capability: { label: 'Capability', layer: 'strategy', shape: 'round', desc: 'An ability that an active structure element possesses' },
  valueStream: { label: 'Value Stream', layer: 'strategy', shape: 'round', desc: 'A sequence of activities that creates an overall result for a customer or stakeholder' },
  courseOfAction: { label: 'Course of Action', layer: 'strategy', shape: 'round', desc: 'An approach or plan for configuring capabilities and resources to achieve a goal' },
  // Business
  businessActor: { label: 'Business Actor', layer: 'business', shape: 'rect', desc: 'A business entity that is capable of performing behavior' },
  businessRole: { label: 'Business Role', layer: 'business', shape: 'rect', desc: 'The responsibility for performing specific behavior to which an actor can be assigned' },
  businessCollaboration: { label: 'Business Collab.', layer: 'business', shape: 'rect', desc: 'An aggregate of two or more business roles that work together to perform collective behavior' },
  businessInterface: { label: 'Business Interface', layer: 'business', shape: 'rect', desc: 'A point of access where a business service is made available to the environment' },
  businessProcess: { label: 'Business Process', layer: 'business', shape: 'round', desc: 'A sequence of business behaviors that achieves a specific result' },
  businessFunction: { label: 'Business Function', layer: 'business', shape: 'round', desc: 'A collection of business behavior based on specific business criteria' },
  businessInteraction: { label: 'Business Interaction', layer: 'business', shape: 'round', desc: 'A unit of collective business behavior performed by two or more business roles' },
  businessEvent: { label: 'Business Event', layer: 'business', shape: 'round', desc: 'An organizational state change that triggers or is triggered by behavior' },
  businessService: { label: 'Business Service', layer: 'business', shape: 'round', desc: 'An explicitly defined exposed business behavior' },
  businessObject: { label: 'Business Object', layer: 'business', shape: 'rect', desc: 'A concept used within a particular business domain' },
  contract: { label: 'Contract', layer: 'business', shape: 'rect', desc: 'A formal or informal specification of an agreement between a provider and a consumer' },
  representation: { label: 'Representation', layer: 'business', shape: 'rect', desc: 'A perceptible form of the information carried by a business object' },
  product: { label: 'Product', layer: 'business', shape: 'rect', desc: 'A coherent collection of services and/or passive elements, accompanied by a contract' },
  // Application
  applicationComponent: { label: 'App. Component', layer: 'application', shape: 'rect', desc: 'An encapsulation of application functionality aligned to implementation' },
  applicationCollaboration: { label: 'App. Collaboration', layer: 'application', shape: 'rect', desc: 'An aggregate of two or more application components that work together' },
  applicationInterface: { label: 'App. Interface', layer: 'application', shape: 'rect', desc: 'A point of access where application services are made available' },
  applicationFunction: { label: 'App. Function', layer: 'application', shape: 'round', desc: 'Automated behavior that can be performed by an application component' },
  applicationInteraction: { label: 'App. Interaction', layer: 'application', shape: 'round', desc: 'A unit of collective application behavior performed by collaborating components' },
  applicationProcess: { label: 'App. Process', layer: 'application', shape: 'round', desc: 'A sequence of application behaviors that achieves a specific result' },
  applicationEvent: { label: 'App. Event', layer: 'application', shape: 'round', desc: 'An application state change that triggers or is triggered by behavior' },
  applicationService: { label: 'App. Service', layer: 'application', shape: 'round', desc: 'An explicitly defined exposed application behavior' },
  dataObject: { label: 'Data Object', layer: 'application', shape: 'rect', desc: 'Data structured for automated processing' },
  // Technology
  node: { label: 'Node', layer: 'technology', shape: 'rect', desc: 'A computational or physical resource that hosts or manipulates artifacts' },
  device: { label: 'Device', layer: 'technology', shape: 'rect', desc: 'A physical IT resource upon which system software and artifacts may be stored or deployed' },
  systemSoftware: { label: 'System Software', layer: 'technology', shape: 'rect', desc: 'Software that provides or contributes to an environment for running other software' },
  technologyCollaboration: { label: 'Tech. Collaboration', layer: 'technology', shape: 'rect', desc: 'An aggregate of two or more technology nodes that work together' },
  technologyInterface: { label: 'Tech. Interface', layer: 'technology', shape: 'rect', desc: 'A point of access where technology services are provided' },
  path: { label: 'Path', layer: 'technology', shape: 'rect', desc: 'A link between two or more technology nodes through which they can exchange data' },
  communicationNetwork: { label: 'Comm. Network', layer: 'technology', shape: 'rect', desc: 'A set of structures that connects nodes for transmission, routing, and reception' },
  technologyFunction: { label: 'Tech. Function', layer: 'technology', shape: 'round', desc: 'A collection of technology behavior that can be performed by a node' },
  technologyProcess: { label: 'Tech. Process', layer: 'technology', shape: 'round', desc: 'A sequence of technology behaviors that achieves a specific result' },
  technologyInteraction: { label: 'Tech. Interaction', layer: 'technology', shape: 'round', desc: 'A unit of collective technology behavior performed by collaborating nodes' },
  technologyEvent: { label: 'Tech. Event', layer: 'technology', shape: 'round', desc: 'A technology state change that triggers or is triggered by behavior' },
  technologyService: { label: 'Tech. Service', layer: 'technology', shape: 'round', desc: 'An explicitly defined exposed technology behavior' },
  artifact: { label: 'Artifact', layer: 'technology', shape: 'rect', desc: 'A piece of data used or produced in a software development process' },
  equipment: { label: 'Equipment', layer: 'technology', shape: 'rect', desc: 'One or more physical machines, tools, or instruments that can create, use, store, move, or transform materials' },
  facility: { label: 'Facility', layer: 'technology', shape: 'rect', desc: 'A physical structure or environment used to house equipment or other active structure elements' },
  distributionNetwork: { label: 'Distribution Network', layer: 'technology', shape: 'rect', desc: 'A physical network used to transport materials or energy' },
  material: { label: 'Material', layer: 'technology', shape: 'rect', desc: 'Tangible physical matter or energy used to create, use, store, move, or transform' },
  // Motivation
  stakeholder: { label: 'Stakeholder', layer: 'motivation', shape: 'rect', desc: 'The role of an individual, team, or organization that represents their interests' },
  driver: { label: 'Driver', layer: 'motivation', shape: 'rect', desc: 'An external or internal condition that motivates an organization to define its goals' },
  assessment: { label: 'Assessment', layer: 'motivation', shape: 'rect', desc: 'The result of an analysis of the state of affairs with respect to a driver' },
  goal: { label: 'Goal', layer: 'motivation', shape: 'rect', desc: 'A high-level statement of intent or desired end state' },
  outcome: { label: 'Outcome', layer: 'motivation', shape: 'rect', desc: 'An end result that has been achieved' },
  principle: { label: 'Principle', layer: 'motivation', shape: 'rect', desc: 'A qualitative statement of intent that should be met by the architecture' },
  requirement: { label: 'Requirement', layer: 'motivation', shape: 'rect', desc: 'A statement of need that must be met by the architecture' },
  constraint: { label: 'Constraint', layer: 'motivation', shape: 'rect', desc: 'A factor that limits the realization of goals' },
  meaning: { label: 'Meaning', layer: 'motivation', shape: 'rect', desc: 'The knowledge or expertise present in, or the interpretation given to, a concept' },
  value: { label: 'Value', layer: 'motivation', shape: 'rect', desc: 'The relative worth, utility, or importance of an element' },
  // Implementation & Migration
  workPackage: { label: 'Work Package', layer: 'implementation', shape: 'round', desc: 'A series of actions designed to accomplish a unique goal within a specified time' },
  deliverable: { label: 'Deliverable', layer: 'implementation', shape: 'rect', desc: 'A precisely-defined outcome of a work package' },
  implementationEvent: { label: 'Impl. Event', layer: 'implementation', shape: 'round', desc: 'A state change related to implementation or migration' },
  plateau: { label: 'Plateau', layer: 'implementation', shape: 'rect', desc: 'A relatively stable state of the architecture that exists during a limited period of time' },
  gap: { label: 'Gap', layer: 'implementation', shape: 'rect', desc: 'A statement of difference between two plateaus' },
  // Composite
  grouping: { label: 'Grouping', layer: 'composite', shape: 'rect', desc: 'Groups a collection of concepts within an architecture' },
  location: { label: 'Location', layer: 'composite', shape: 'rect', desc: 'A conceptual or physical place or position where concepts are located' },
  // Special (internal — not shown in layer toolbars)
  andJunction: { label: 'Junction (And)', layer: 'other', shape: 'round', desc: 'A junction used to connect relationships of the same type (AND semantics)' },
  orJunction: { label: 'Junction (Or)', layer: 'other', shape: 'round', desc: 'A junction used to connect relationships of the same type (OR semantics)' },
  viewReference: { label: 'View', layer: 'other', shape: 'rect', desc: 'A navigation reference to another view' },
  note: { label: 'Note', layer: 'composite', shape: 'rect', isNote: true, desc: 'An annotation or comment' },
};

// ============================================================
// Relationship type definitions
// ============================================================

export const RELATIONSHIP_TYPES: Record<string, RelationshipTypeDef> = {
  composition: { label: 'Composition', dash: false, head: 'diamond_filled', desc: 'Part of' },
  aggregation: { label: 'Aggregation', dash: false, head: 'diamond', desc: 'Groups' },
  assignment: { label: 'Assignment', dash: false, head: 'filled_dot', desc: 'Assigned to' },
  realization: { label: 'Realization', dash: true, head: 'hollow_arrow', desc: 'Realizes' },
  serving: { label: 'Serving', dash: false, head: 'open_arrow', desc: 'Serves' },
  access: { label: 'Access', dash: true, head: 'open_arrow', desc: 'Accesses' },
  influence: { label: 'Influence', dash: true, head: 'open_arrow', desc: 'Influences' },
  triggering: { label: 'Triggering', dash: false, head: 'filled_arrow', desc: 'Triggers' },
  flow: { label: 'Flow', dash: true, head: 'filled_arrow', desc: 'Flows to' },
  specialization: { label: 'Specialization', dash: false, head: 'hollow_arrow', desc: 'Specializes' },
  association: { label: 'Association', dash: false, head: 'none', desc: 'Associated' },
};

// ============================================================
// Icons — Lucide SVG paths (MIT license, 24×24 viewBox, stroke-based)
// Rendered on canvas via Path2D for crisp, professional icons.
// ============================================================

/** SVG path `d` strings per icon key (24×24 coordinate space).
 *  These follow the ArchiMate standard notation shapes. */
export const ICON_PATHS: Record<string, string[]> = {
  // ── Behavior ──
  // Process: right-pointing chevron (flat left, arrow right)
  process: ['M4 4L4 20L17 20L22 12L17 4Z'],
  // Function: rounded rect with horizontal divider
  function: ['M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z', 'M3 8h18'],
  // Interaction: two overlapping circles
  interaction: ['M9 12a5 5 0 1010 0a5 5 0 10-10 0z', 'M5 12a5 5 0 1010 0a5 5 0 10-10 0z'],
  // Event: left-notched right-pointed signal shape
  event: ['M4 4L8 12L4 20L17 20L22 12L17 4Z'],
  // Service: stadium / pill (flat left, rounded right)
  service: ['M4 5h10a7 7 0 010 14H4z'],
  // ── Active Structure ──
  // Actor: stick figure
  actor: ['M12 3a3 3 0 100 6 3 3 0 000-6z', 'M12 9v6', 'M8 12h8', 'M12 15l-4 6', 'M12 15l4 6'],
  // Role: circle with vertical tick on left
  role: ['M12 4a8 8 0 100 16 8 8 0 000-16z', 'M4 9v6'],
  // Component: rect with two protruding tabs on left
  component: ['M8 3h13v18H8z', 'M3 6h8v4H3z', 'M3 14h8v4H3z'],
  // Collaboration: two overlapping ovals
  collaboration: ['M8 7a6 5 0 100 10 6 5 0 00 0-10z', 'M10 7a6 5 0 100 10 6 5 0 000-10z'],
  // Interface: lollipop (circle + line)
  interfaceEl: ['M15 12a5 5 0 10-10 0 5 5 0 0010 0z', 'M20 12h-5'],
  // ── Technology ──
  // Node: 3D box (front + top + side)
  node: ['M3 8v12h14V8z', 'M3 8l4-4h14l-4 4', 'M17 20l4-4V4'],
  // Device: monitor with stand
  device: ['M3 4h18v12H3z', 'M8 20h8', 'M12 16v4'],
  // ── Passive Structure ──
  // Object: rect with top divider
  object: ['M4 3h16v18H4z', 'M4 8h16'],
  // Artifact: document with folded corner
  artifact: ['M4 3h11l5 5v13H4z', 'M15 3v5h5'],
  // ── Motivation ──
  // Stakeholder: stick figure (same as actor)
  stakeholder: ['M12 3a3 3 0 100 6 3 3 0 000-6z', 'M12 9v6', 'M8 12h8', 'M12 15l-4 6', 'M12 15l4 6'],
  // Goal: bullseye (3 concentric circles)
  goal: ['M12 2a10 10 0 100 20 10 10 0 000-20z', 'M12 6a6 6 0 100 12 6 6 0 000-12z', 'M12 10a2 2 0 100 4 2 2 0 000-4z'],
  // Outcome: ellipse with checkmark
  outcome: ['M12 5a9 7 0 100 14 9 7 0 000-14z', 'M8 12l3 3l5-5'],
  // Driver: diamond / rhombus
  driver: ['M12 2l10 10l-10 10L2 12z'],
  // Assessment: circle with arrow/needle
  assessment: ['M12 2a10 10 0 100 20 10 10 0 000-20z', 'M10 14l8-8', 'M18 6l-3 1', 'M18 6l-1 3'],
  // Principle: upward triangle
  principle: ['M12 3l10 18H2z'],
  // Requirement: rounded rectangle
  requirement: ['M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z'],
  // Constraint: rounded rect + diagonal slash
  constraint: ['M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z', 'M21 3L3 21'],
  // Meaning: cloud / thought bubble
  meaning: ['M6 17a4 4 0 01-.5-7.97 6 6 0 0111.27-3.8A5 5 0 0121 11a4.5 4.5 0 01-2.08 6H6z'],
  // Value: ellipse
  value: ['M12 5a10 7 0 100 14 10 7 0 000-14z'],
  // ── Implementation & Migration ──
  // Work Package: rounded rect with check
  workPackage: ['M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z', 'M8 12l3 3 5-5'],
  // Deliverable: document
  deliverable: ['M4 3h11l5 5v13H4z', 'M15 3v5h5'],
  // Plateau: stacked layers
  plateau: ['M4 6h16v12H4z', 'M6 4h16v12'],
  // Gap: ellipse with line through
  gap: ['M12 5a10 7 0 100 14 10 7 0 000-14z', 'M6 12h12'],
  // ── Composite / Other ──
  // Note: page with folded corner
  note: ['M4 3h11l5 5v13H4z', 'M15 3v5h5'],
  // Grouping: folder with tab
  grouping: ['M2 8h20v13H2z', 'M2 8l2-4h6l2 4'],
  // Location: map pin
  location: ['M12 2a8 8 0 00-8 8c0 5.4 8 12 8 12s8-6.6 8-12a8 8 0 00-8-8z', 'M12 7a3 3 0 100 6 3 3 0 000-6z'],
  // ── Strategy ──
  // Resource: rectangle with center divider
  resource: ['M4 4h16v16H4z', 'M4 12h16'],
  // Capability: 2x2 grid
  capability: ['M4 4h16v16H4z', 'M12 4v16', 'M4 12h16'],
  // Value Stream: right-pointing arrow
  valueStream: ['M4 4L4 20L17 20L22 12L17 4Z'],
  // Course of Action: stadium/pill
  courseOfAction: ['M8 4a8 8 0 100 16h8a8 8 0 100-16z'],
  // ── Technology extras ──
  // Path: double horizontal line
  path: ['M2 10h20', 'M2 14h20'],
  // Communication Network: triangle of connected nodes
  communicationNetwork: ['M4 19l8-14l8 14', 'M4 19a2 2 0 100 4 2 2 0 000-4z', 'M12 3a2 2 0 100 4 2 2 0 000-4z', 'M20 19a2 2 0 100 4 2 2 0 000-4z'],
  // Product: rect with header + right column divider
  product: ['M4 3h16v18H4z', 'M4 8h16', 'M15 3v5'],
  // Contract: document with header + text lines
  contract: ['M4 3h16v18H4z', 'M4 8h16', 'M8 13h8', 'M8 17h8'],
  // Representation: rect with wavy bottom + header
  representation: ['M4 3h16v11c-3 3-5-1-8 2s-5-1-8 2z', 'M4 8h16'],
  // Equipment: gear cog
  equipment: ['M12 8a4 4 0 100 8 4 4 0 000-8z', 'M12 2v3', 'M12 19v3', 'M2 12h3', 'M19 12h3', 'M4.93 4.93l2.12 2.12', 'M16.95 16.95l2.12 2.12', 'M4.93 19.07l2.12-2.12', 'M16.95 7.05l2.12-2.12'],
  // Facility: building with peaked roof + door
  facility: ['M3 21V9l9-6l9 6v12z', 'M9 21v-6h6v6'],
  // Distribution Network: line with nodes
  distributionNetwork: ['M3 12h18', 'M6 12a2 2 0 100 4 2 2 0 000-4z', 'M12 12a2 2 0 100 4 2 2 0 000-4z', 'M18 12a2 2 0 100 4 2 2 0 000-4z'],
  // Material: triangle
  material: ['M12 3l10 18H2z'],
  // Junction: filled circle
  junction: ['M12 6a6 6 0 100 12 6 6 0 000-12z'],
  // Generic: simple rectangle
  generic: ['M4 4h16v16H4z'],
};

/** Cached Path2D objects (built lazily from ICON_PATHS) */
const pathCache = new Map<string, Path2D[]>();

/** Get cached Path2D array for an icon key */
export function getIconPaths(key: string): Path2D[] {
  let cached = pathCache.get(key);
  if (!cached) {
    const dStrings = ICON_PATHS[key] || ICON_PATHS.generic;
    cached = dStrings.map(d => new Path2D(d));
    pathCache.set(key, cached);
  }
  return cached;
}

/** Draw a Lucide icon on a canvas context at (cx, cy) with the given size and color.
 *  Icons are 24×24 viewBox, scaled to fit `size` pixels. */
export function drawIcon(ctx: CanvasRenderingContext2D, key: string, cx: number, cy: number, size: number, color: string) {
  const paths = getIconPaths(key);
  const scale = size / 24;
  ctx.save();
  ctx.translate(cx - size / 2, cy - size / 2);
  ctx.scale(scale, scale);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5; // thin crisp strokes in 24×24 space (native Lucide is 2)
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const p of paths) {
    ctx.stroke(p);
  }
  ctx.restore();
}

// Maps element type keys to icon keys
export const ICON_MAP: Record<string, string> = {
  // Strategy
  resource: 'resource', capability: 'capability', valueStream: 'valueStream', courseOfAction: 'courseOfAction',
  // Business behavior
  businessProcess: 'process', applicationProcess: 'process', technologyProcess: 'process',
  businessFunction: 'function', applicationFunction: 'function', technologyFunction: 'function',
  businessInteraction: 'interaction', applicationInteraction: 'interaction', technologyInteraction: 'interaction',
  businessEvent: 'event', applicationEvent: 'event', technologyEvent: 'event', implementationEvent: 'event',
  businessService: 'service', applicationService: 'service', technologyService: 'service',
  // Business structure
  businessActor: 'actor', stakeholder: 'stakeholder',
  businessRole: 'role',
  applicationComponent: 'component', systemSoftware: 'component',
  businessCollaboration: 'collaboration', applicationCollaboration: 'collaboration', technologyCollaboration: 'collaboration',
  businessInterface: 'interfaceEl', applicationInterface: 'interfaceEl', technologyInterface: 'interfaceEl',
  // Technology
  node: 'node', device: 'device',
  path: 'path', communicationNetwork: 'communicationNetwork',
  equipment: 'equipment', facility: 'facility',
  distributionNetwork: 'distributionNetwork', material: 'material',
  // Passive
  businessObject: 'object', dataObject: 'object',
  contract: 'contract', representation: 'representation', product: 'product',
  artifact: 'artifact',
  // Motivation
  goal: 'goal', outcome: 'outcome',
  driver: 'driver', assessment: 'assessment',
  principle: 'principle', requirement: 'requirement', constraint: 'constraint',
  meaning: 'meaning', value: 'value',
  // Implementation
  workPackage: 'workPackage', deliverable: 'deliverable', plateau: 'plateau', gap: 'gap',
  // Composite/special
  andJunction: 'junction', orJunction: 'junction',
  note: 'note', grouping: 'grouping', location: 'location',
};
