import type { LayerDef, ElementTypeDef, RelationshipTypeDef } from '../types';

// ============================================================
// Layer definitions
// ============================================================

export const LAYERS: Record<string, LayerDef> = {
  strategy: { label: 'Strategy', fill: '#FBF0D1', stroke: '#C9A24A', accent: '#A68530', text: '#5A4A20' },
  business: { label: 'Business', fill: '#FAFACC', stroke: '#BFBA58', accent: '#9A9030', text: '#4A4510' },
  application: { label: 'Application', fill: '#D0EEF2', stroke: '#5AABB5', accent: '#3690A0', text: '#1A5060' },
  technology: { label: 'Technology', fill: '#D2EED8', stroke: '#60A870', accent: '#408A50', text: '#1E4E28' },
  motivation: { label: 'Motivation', fill: '#E4DCFF', stroke: '#8070B8', accent: '#6050A0', text: '#302060' },
  implementation: { label: 'Impl. & Migration', fill: '#FFDCE0', stroke: '#C06068', accent: '#A84850', text: '#5A1820' },
  composite: { label: 'Composite', fill: 'transparent', stroke: '#A0A0A8', accent: '#808088', text: '#444' },
};

// Note element styling (not a real layer)
export const NOTE_STYLE: LayerDef = {
  label: 'Note',
  fill: '#F2F2F4',
  stroke: '#C0C0C4',
  accent: '#909098',
  text: '#444',
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
  // Special
  andJunction: { label: 'Junction (And)', layer: 'composite', shape: 'round', desc: 'A junction used to connect relationships of the same type (AND semantics)' },
  orJunction: { label: 'Junction (Or)', layer: 'composite', shape: 'round', desc: 'A junction used to connect relationships of the same type (OR semantics)' },
  viewReference: { label: 'View', layer: 'application', shape: 'rect', desc: 'A navigation reference to another view' },
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
// Icon drawing functions (canvas 2D — Archi-style)
// ============================================================

type IconDrawFn = (ctx: CanvasRenderingContext2D, x: number, y: number, s: number) => void;

export const ICONS: Record<string, IconDrawFn> = {
  // Behavior (process, function, interaction, event, service)
  process: (c, x, y, s) => {
    const w = s * 1.4, h = s * 1.6, notch = s * 0.5;
    c.moveTo(x - w / 2, y - h / 2);
    c.lineTo(x + w / 2 - notch, y - h / 2);
    c.lineTo(x + w / 2, y);
    c.lineTo(x + w / 2 - notch, y + h / 2);
    c.lineTo(x - w / 2, y + h / 2);
    c.closePath();
  },
  function: (c, x, y, s) => {
    const w = s * 1.5, h = s * 1.4, r = s * 0.25;
    c.moveTo(x - w / 2 + r, y - h / 2);
    c.lineTo(x + w / 2 - r, y - h / 2);
    c.quadraticCurveTo(x + w / 2, y - h / 2, x + w / 2, y - h / 2 + r);
    c.lineTo(x + w / 2, y + h / 2 - r);
    c.quadraticCurveTo(x + w / 2, y + h / 2, x + w / 2 - r, y + h / 2);
    c.lineTo(x - w / 2 + r, y + h / 2);
    c.quadraticCurveTo(x - w / 2, y + h / 2, x - w / 2, y + h / 2 - r);
    c.lineTo(x - w / 2, y - h / 2 + r);
    c.quadraticCurveTo(x - w / 2, y - h / 2, x - w / 2 + r, y - h / 2);
    c.closePath();
    c.moveTo(x - w / 2, y - h / 2 + h * 0.28);
    c.lineTo(x + w / 2, y - h / 2 + h * 0.28);
  },
  interaction: (c, x, y, s) => {
    const r = s * 0.6, gap = s * 0.3;
    c.arc(x - gap, y, r, 0, Math.PI * 2);
    c.moveTo(x + gap + r, y);
    c.arc(x + gap, y, r, 0, Math.PI * 2);
  },
  event: (c, x, y, s) => {
    const w = s * 1.4, h = s * 1.5, notch = s * 0.35;
    c.moveTo(x - w / 2, y - h / 2);
    c.lineTo(x + w / 2 - notch, y - h / 2);
    c.lineTo(x + w / 2, y);
    c.lineTo(x + w / 2 - notch, y + h / 2);
    c.lineTo(x - w / 2, y + h / 2);
    c.lineTo(x - w / 2 + notch, y);
    c.closePath();
  },
  service: (c, x, y, s) => {
    const w = s * 1.5, h = s * 1.2, r = h / 2;
    c.moveTo(x - w / 2, y - h / 2);
    c.lineTo(x + w / 2 - r, y - h / 2);
    c.arc(x + w / 2 - r, y, r, -Math.PI / 2, Math.PI / 2);
    c.lineTo(x - w / 2, y + h / 2);
    c.closePath();
  },
  // Structure (actor, role, component, collaboration, interface, node, device)
  actor: (c, x, y, s) => {
    c.arc(x, y - s * 0.55, s * 0.3, 0, Math.PI * 2);
    c.moveTo(x, y - s * 0.25);
    c.lineTo(x, y + s * 0.3);
    c.moveTo(x - s * 0.45, y);
    c.lineTo(x + s * 0.45, y);
    c.moveTo(x, y + s * 0.3);
    c.lineTo(x - s * 0.35, y + s * 0.8);
    c.moveTo(x, y + s * 0.3);
    c.lineTo(x + s * 0.35, y + s * 0.8);
  },
  role: (c, x, y, s) => {
    // ArchiMate: yellow circle with a small vertical line on the left (hat shape)
    c.arc(x, y, s * 0.55, 0, Math.PI * 2);
    c.moveTo(x - s * 0.55, y - s * 0.15);
    c.lineTo(x - s * 0.55, y + s * 0.15);
  },
  component: (c, x, y, s) => {
    const bw = s * 1.2, bh = s * 1.4;
    const tw = s * 0.4, th = s * 0.25;
    c.rect(x - bw / 2 + tw / 2, y - bh / 2, bw - tw / 2, bh);
    c.rect(x - bw / 2, y - bh / 4 - th / 2, tw, th);
    c.rect(x - bw / 2, y + bh / 4 - th / 2, tw, th);
  },
  collaboration: (c, x, y, s) => {
    const rx = s * 0.55, ry = s * 0.4, gap = s * 0.2;
    c.ellipse(x - gap, y, rx, ry, 0, 0, Math.PI * 2);
    c.moveTo(x + gap + rx, y);
    c.ellipse(x + gap, y, rx, ry, 0, 0, Math.PI * 2);
  },
  interfaceEl: (c, x, y, s) => {
    // ArchiMate: lollipop — circle with a line extending left
    c.arc(x + s * 0.2, y, s * 0.35, 0, Math.PI * 2);
    c.moveTo(x - s * 0.6, y);
    c.lineTo(x - s * 0.15, y);
  },
  node: (c, x, y, s) => {
    const w = s * 1.2, h = s * 0.8, d = s * 0.35;
    c.moveTo(x - w / 2, y + h / 2);
    c.lineTo(x - w / 2, y - h / 2 + d);
    c.lineTo(x - w / 2 + d, y - h / 2);
    c.lineTo(x + w / 2, y - h / 2);
    c.lineTo(x + w / 2, y + h / 2 - d);
    c.lineTo(x - w / 2, y + h / 2);
    c.moveTo(x + w / 2, y - h / 2);
    c.lineTo(x + w / 2 - d, y - h / 2 + d);
    c.lineTo(x - w / 2, y - h / 2 + d);
    c.moveTo(x + w / 2 - d, y - h / 2 + d);
    c.lineTo(x + w / 2 - d, y + h / 2);
  },
  device: (c, x, y, s) => {
    const w = s * 1.3, h = s * 0.8, bw = s * 0.6;
    c.moveTo(x - w / 2, y - h / 2);
    c.lineTo(x + w / 2, y - h / 2);
    c.lineTo(x + w / 2, y + h / 2 * 0.3);
    c.lineTo(x + bw / 2, y + h / 2);
    c.lineTo(x - bw / 2, y + h / 2);
    c.lineTo(x - w / 2, y + h / 2 * 0.3);
    c.closePath();
  },
  // Passive (object, artifact)
  object: (c, x, y, s) => {
    const w = s * 1.3, h = s * 1.3;
    c.rect(x - w / 2, y - h / 2, w, h);
    c.moveTo(x - w / 2, y - h / 2 + h * 0.25);
    c.lineTo(x + w / 2, y - h / 2 + h * 0.25);
  },
  artifact: (c, x, y, s) => {
    const w = s * 1.1, h = s * 1.4, fold = s * 0.35;
    c.moveTo(x - w / 2, y - h / 2);
    c.lineTo(x + w / 2 - fold, y - h / 2);
    c.lineTo(x + w / 2, y - h / 2 + fold);
    c.lineTo(x + w / 2, y + h / 2);
    c.lineTo(x - w / 2, y + h / 2);
    c.closePath();
    c.moveTo(x + w / 2 - fold, y - h / 2);
    c.lineTo(x + w / 2 - fold, y - h / 2 + fold);
    c.lineTo(x + w / 2, y - h / 2 + fold);
  },
  // Motivation
  stakeholder: (c, x, y, s) => {
    c.arc(x, y - s * 0.4, s * 0.32, 0, Math.PI * 2);
    c.moveTo(x + s * 0.6, y + s * 0.55);
    c.arc(x, y + s * 0.55, s * 0.6, 0, Math.PI, true);
  },
  goal: (c, x, y, s) => {
    // ArchiMate: concentric circles (target/bullseye)
    c.arc(x, y, s * 0.75, 0, Math.PI * 2);
    c.moveTo(x + s * 0.45, y);
    c.arc(x, y, s * 0.45, 0, Math.PI * 2);
    c.moveTo(x + s * 0.15, y);
    c.arc(x, y, s * 0.15, 0, Math.PI * 2);
  },
  outcome: (c, x, y, s) => {
    // ArchiMate: ellipse with a small tick/check
    c.ellipse(x, y, s * 0.7, s * 0.55, 0, 0, Math.PI * 2);
    c.moveTo(x - s * 0.2, y + s * 0.05);
    c.lineTo(x - s * 0.02, y + s * 0.25);
    c.lineTo(x + s * 0.3, y - s * 0.2);
  },
  driver: (c, x, y, s) => {
    // Diamond shape
    c.moveTo(x, y - s * 0.8);
    c.lineTo(x + s * 0.7, y);
    c.lineTo(x, y + s * 0.8);
    c.lineTo(x - s * 0.7, y);
    c.closePath();
  },
  assessment: (c, x, y, s) => {
    // ArchiMate: circle with a diagonal arrow (compass needle / gauge)
    c.arc(x, y, s * 0.65, 0, Math.PI * 2);
    // Needle pointing upper-right
    c.moveTo(x - s * 0.2, y + s * 0.2);
    c.lineTo(x + s * 0.4, y - s * 0.4);
    // Small arrowhead
    c.moveTo(x + s * 0.4, y - s * 0.4);
    c.lineTo(x + s * 0.15, y - s * 0.3);
    c.moveTo(x + s * 0.4, y - s * 0.4);
    c.lineTo(x + s * 0.3, y - s * 0.15);
  },
  principle: (c, x, y, s) => {
    // Triangle pointing up
    c.moveTo(x, y - s * 0.8);
    c.lineTo(x + s * 0.75, y + s * 0.7);
    c.lineTo(x - s * 0.75, y + s * 0.7);
    c.closePath();
  },
  requirement: (c, x, y, s) => {
    // Rounded rect with exclamation
    const w = s * 1.3, h = s * 1.3, r = s * 0.2;
    c.moveTo(x - w / 2 + r, y - h / 2);
    c.lineTo(x + w / 2 - r, y - h / 2);
    c.quadraticCurveTo(x + w / 2, y - h / 2, x + w / 2, y - h / 2 + r);
    c.lineTo(x + w / 2, y + h / 2 - r);
    c.quadraticCurveTo(x + w / 2, y + h / 2, x + w / 2 - r, y + h / 2);
    c.lineTo(x - w / 2 + r, y + h / 2);
    c.quadraticCurveTo(x - w / 2, y + h / 2, x - w / 2, y + h / 2 - r);
    c.lineTo(x - w / 2, y - h / 2 + r);
    c.quadraticCurveTo(x - w / 2, y - h / 2, x - w / 2 + r, y - h / 2);
    c.closePath();
  },
  constraint: (c, x, y, s) => {
    // Octagon (stop sign shape)
    const r = s * 0.7;
    for (let i = 0; i < 8; i++) {
      const a = (Math.PI * 2 * i) / 8 - Math.PI / 8;
      const px = x + r * Math.cos(a), py = y + r * Math.sin(a);
      if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
    }
    c.closePath();
  },
  meaning: (c, x, y, s) => {
    // ArchiMate: thought bubble / cloud
    c.arc(x - s * 0.25, y + s * 0.15, s * 0.4, 0, Math.PI * 2);
    c.moveTo(x + s * 0.35 + s * 0.35, y + s * 0.15);
    c.arc(x + s * 0.35, y + s * 0.15, s * 0.35, 0, Math.PI * 2);
    c.moveTo(x + s * 0.5, y - s * 0.25);
    c.arc(x + s * 0.05, y - s * 0.25, s * 0.45, 0, Math.PI * 2);
  },
  value: (c, x, y, s) => {
    // Ellipse
    c.ellipse(x, y, s * 0.8, s * 0.55, 0, 0, Math.PI * 2);
  },
  // Implementation
  workPackage: (c, x, y, s) => {
    const w = s * 1.5, h = s * 1.2, r = s * 0.2;
    c.moveTo(x - w / 2 + r, y - h / 2);
    c.lineTo(x + w / 2 - r, y - h / 2);
    c.quadraticCurveTo(x + w / 2, y - h / 2, x + w / 2, y - h / 2 + r);
    c.lineTo(x + w / 2, y + h / 2 - r);
    c.quadraticCurveTo(x + w / 2, y + h / 2, x + w / 2 - r, y + h / 2);
    c.lineTo(x - w / 2 + r, y + h / 2);
    c.quadraticCurveTo(x - w / 2, y + h / 2, x - w / 2, y + h / 2 - r);
    c.lineTo(x - w / 2, y - h / 2 + r);
    c.quadraticCurveTo(x - w / 2, y - h / 2, x - w / 2 + r, y - h / 2);
    c.closePath();
    c.moveTo(x - s * 0.3, y - s * 0.15);
    c.lineTo(x - s * 0.05, y + s * 0.15);
    c.lineTo(x + s * 0.35, y - s * 0.3);
  },
  deliverable: (c, x, y, s) => {
    const w = s * 1.3, h = s * 1.3;
    c.rect(x - w / 2, y - h / 2, w, h);
    c.moveTo(x - w / 4, y - h / 6);
    c.lineTo(x + w / 4, y - h / 6);
    c.moveTo(x - w / 4, y + h / 10);
    c.lineTo(x + w / 4, y + h / 10);
  },
  plateau: (c, x, y, s) => {
    const w = s * 1.3, h = s * 1.1;
    c.rect(x - w / 2, y - h / 2, w, h);
    c.moveTo(x - w / 2 + s * 0.15, y - h / 2 + s * 0.15);
    c.rect(x - w / 2 + s * 0.15, y - h / 2 + s * 0.15, w - s * 0.3, h - s * 0.3);
  },
  gap: (c, x, y, s) => {
    // Ellipse with horizontal line through
    c.ellipse(x, y, s * 0.8, s * 0.55, 0, 0, Math.PI * 2);
    c.moveTo(x - s * 0.5, y);
    c.lineTo(x + s * 0.5, y);
  },
  // Composite
  note: (c, x, y, s) => {
    const w = s * 1.1, h = s * 1.3, fold = s * 0.3;
    c.moveTo(x - w / 2, y - h / 2);
    c.lineTo(x + w / 2 - fold, y - h / 2);
    c.lineTo(x + w / 2, y - h / 2 + fold);
    c.lineTo(x + w / 2, y + h / 2);
    c.lineTo(x - w / 2, y + h / 2);
    c.closePath();
  },
  grouping: (c, x, y, s) => {
    const w = s * 1.3, h = s * 1.0, tab = s * 0.5;
    c.moveTo(x - w / 2, y - h / 2 + tab * 0.5);
    c.lineTo(x - w / 2, y - h / 2);
    c.lineTo(x - w / 2 + tab, y - h / 2);
    c.lineTo(x - w / 2 + tab, y - h / 2 + tab * 0.5);
    c.moveTo(x - w / 2, y - h / 2 + tab * 0.5);
    c.lineTo(x + w / 2, y - h / 2 + tab * 0.5);
    c.lineTo(x + w / 2, y + h / 2);
    c.lineTo(x - w / 2, y + h / 2);
    c.closePath();
  },
  location: (c, x, y, s) => {
    c.moveTo(x, y + s * 0.85);
    c.quadraticCurveTo(x - s * 0.6, y, x - s * 0.5, y - s * 0.3);
    c.arc(x, y - s * 0.3, s * 0.5, Math.PI * 0.8, Math.PI * 0.2, true);
    c.quadraticCurveTo(x + s * 0.6, y, x, y + s * 0.85);
    c.closePath();
    c.moveTo(x + s * 0.18, y - s * 0.3);
    c.arc(x, y - s * 0.3, s * 0.18, 0, Math.PI * 2);
  },
  // Other motivation
  resource: (c, x, y, s) => {
    c.rect(x - s * 0.65, y - s * 0.5, s * 1.3, s * 1.0);
    c.moveTo(x - s * 0.65, y);
    c.lineTo(x + s * 0.65, y);
  },
  capability: (c, x, y, s) => {
    const w = s * 1.4, h = s * 1.2, r = s * 0.2;
    c.moveTo(x - w / 2 + r, y - h / 2);
    c.lineTo(x + w / 2 - r, y - h / 2);
    c.quadraticCurveTo(x + w / 2, y - h / 2, x + w / 2, y - h / 2 + r);
    c.lineTo(x + w / 2, y + h / 2 - r);
    c.quadraticCurveTo(x + w / 2, y + h / 2, x + w / 2 - r, y + h / 2);
    c.lineTo(x - w / 2 + r, y + h / 2);
    c.quadraticCurveTo(x - w / 2, y + h / 2, x - w / 2, y + h / 2 - r);
    c.lineTo(x - w / 2, y - h / 2 + r);
    c.quadraticCurveTo(x - w / 2, y - h / 2, x - w / 2 + r, y - h / 2);
    c.closePath();
    c.moveTo(x - s * 0.35, y - h / 2);
    c.lineTo(x - s * 0.35, y + h / 2);
    c.moveTo(x - w / 2, y);
    c.lineTo(x + w / 2, y);
  },
  valueStream: (c, x, y, s) => {
    // Right-pointing chevron (flat left, arrow right) matching Archi
    const w = s * 1.8, h = s * 1.2, arrow = s * 0.4;
    c.moveTo(x - w / 2, y - h / 2);
    c.lineTo(x + w / 2 - arrow, y - h / 2);
    c.lineTo(x + w / 2, y);
    c.lineTo(x + w / 2 - arrow, y + h / 2);
    c.lineTo(x - w / 2, y + h / 2);
    c.closePath();
  },
  courseOfAction: (c, x, y, s) => {
    const w = s * 1.5, h = s * 1.2, r = s * 0.4;
    c.moveTo(x - w / 2 + r, y - h / 2);
    c.lineTo(x + w / 2 - r, y - h / 2);
    c.arc(x + w / 2 - r, y, h / 2, -Math.PI / 2, Math.PI / 2);
    c.lineTo(x - w / 2 + r, y + h / 2);
    c.arc(x - w / 2 + r, y, h / 2, Math.PI / 2, -Math.PI / 2);
    c.closePath();
  },
  path: (c, x, y, s) => {
    c.moveTo(x - s * 0.7, y);
    c.lineTo(x + s * 0.7, y);
    c.moveTo(x - s * 0.7, y - s * 0.15);
    c.lineTo(x + s * 0.7, y - s * 0.15);
  },
  communicationNetwork: (c, x, y, s) => {
    c.moveTo(x - s * 0.5, y + s * 0.3);
    c.lineTo(x, y - s * 0.4);
    c.lineTo(x + s * 0.5, y + s * 0.3);
    c.lineTo(x - s * 0.5, y + s * 0.3);
    c.closePath();
    c.arc(x - s * 0.5, y + s * 0.3, s * 0.15, 0, Math.PI * 2);
    c.moveTo(x + s * 0.15, y - s * 0.4);
    c.arc(x, y - s * 0.4, s * 0.15, 0, Math.PI * 2);
    c.moveTo(x + s * 0.65, y + s * 0.3);
    c.arc(x + s * 0.5, y + s * 0.3, s * 0.15, 0, Math.PI * 2);
  },
  product: (c, x, y, s) => {
    c.rect(x - s * 0.65, y - s * 0.65, s * 1.3, s * 1.3);
    c.moveTo(x - s * 0.65, y - s * 0.25);
    c.lineTo(x + s * 0.65, y - s * 0.25);
    c.moveTo(x + s * 0.3, y - s * 0.65);
    c.lineTo(x + s * 0.3, y - s * 0.25);
  },
  contract: (c, x, y, s) => {
    c.rect(x - s * 0.55, y - s * 0.65, s * 1.1, s * 1.3);
    c.moveTo(x - s * 0.55, y - s * 0.25);
    c.lineTo(x + s * 0.55, y - s * 0.25);
    c.moveTo(x - s * 0.3, y + s * 0.05);
    c.lineTo(x + s * 0.3, y + s * 0.05);
    c.moveTo(x - s * 0.3, y + s * 0.3);
    c.lineTo(x + s * 0.3, y + s * 0.3);
  },
  representation: (c, x, y, s) => {
    c.moveTo(x - s * 0.6, y - s * 0.65);
    c.lineTo(x + s * 0.6, y - s * 0.65);
    c.lineTo(x + s * 0.6, y + s * 0.35);
    c.bezierCurveTo(x + s * 0.3, y + s * 0.55, x, y + s * 0.15, x - s * 0.3, y + s * 0.55);
    c.lineTo(x - s * 0.6, y + s * 0.55);
    c.closePath();
    c.moveTo(x - s * 0.6, y - s * 0.25);
    c.lineTo(x + s * 0.6, y - s * 0.25);
  },
  // Physical technology
  equipment: (c, x, y, s) => {
    // Gear/cog shape
    const r = s * 0.55, teeth = 6, toothH = s * 0.2;
    for (let i = 0; i < teeth; i++) {
      const a1 = (Math.PI * 2 * i) / teeth - Math.PI / teeth;
      const a2 = (Math.PI * 2 * (i + 0.4)) / teeth - Math.PI / teeth;
      const a3 = (Math.PI * 2 * (i + 0.5)) / teeth - Math.PI / teeth;
      const a4 = (Math.PI * 2 * (i + 0.9)) / teeth - Math.PI / teeth;
      if (i === 0) c.moveTo(x + (r + toothH) * Math.cos(a1), y + (r + toothH) * Math.sin(a1));
      c.lineTo(x + (r + toothH) * Math.cos(a2), y + (r + toothH) * Math.sin(a2));
      c.lineTo(x + r * Math.cos(a3), y + r * Math.sin(a3));
      c.lineTo(x + r * Math.cos(a4), y + r * Math.sin(a4));
    }
    c.closePath();
    c.moveTo(x + s * 0.2, y);
    c.arc(x, y, s * 0.2, 0, Math.PI * 2);
  },
  facility: (c, x, y, s) => {
    // Building shape
    const w = s * 1.2, h = s * 1.4;
    c.moveTo(x - w / 2, y + h / 2);
    c.lineTo(x - w / 2, y - h / 2 + s * 0.3);
    c.lineTo(x, y - h / 2);
    c.lineTo(x + w / 2, y - h / 2 + s * 0.3);
    c.lineTo(x + w / 2, y + h / 2);
    c.closePath();
    // Door
    c.moveTo(x - s * 0.15, y + h / 2);
    c.lineTo(x - s * 0.15, y + s * 0.1);
    c.lineTo(x + s * 0.15, y + s * 0.1);
    c.lineTo(x + s * 0.15, y + h / 2);
  },
  distributionNetwork: (c, x, y, s) => {
    // Horizontal line with nodes
    c.moveTo(x - s * 0.7, y);
    c.lineTo(x + s * 0.7, y);
    c.moveTo(x - s * 0.5 + s * 0.12, y);
    c.arc(x - s * 0.5, y, s * 0.12, 0, Math.PI * 2);
    c.moveTo(x + s * 0.12, y);
    c.arc(x, y, s * 0.12, 0, Math.PI * 2);
    c.moveTo(x + s * 0.5 + s * 0.12, y);
    c.arc(x + s * 0.5, y, s * 0.12, 0, Math.PI * 2);
  },
  material: (c, x, y, s) => {
    // Triangle (physical matter)
    c.moveTo(x, y - s * 0.7);
    c.lineTo(x + s * 0.7, y + s * 0.5);
    c.lineTo(x - s * 0.7, y + s * 0.5);
    c.closePath();
  },
  junction: (c, x, y, s) => {
    // Filled circle (junction point)
    c.arc(x, y, s * 0.4, 0, Math.PI * 2);
  },
  generic: (c, x, y, s) => {
    c.rect(x - s * 0.6, y - s * 0.6, s * 1.2, s * 1.2);
  },
};

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
