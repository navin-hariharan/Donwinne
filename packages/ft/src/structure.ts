// Fault tree structure: validation, normalisation into a logic graph, and basic event probabilities.

import { EvalEnv, FTEdge, FTNode, FTNodeType, Net, Problem, Value, evaluate, isFaultTree, num, parseCached } from "@pns/core";

/** Thrown by the analyses when the fault tree is not valid or a value cannot be computed. */
export class FTError extends Error {
  constructor(message: string, public readonly problems: Problem[] = []) {
    super(message);
    this.name = "FTError";
  }
}

/** Gate types of extended fault trees whose result depends on the order of failures. */
export const DYNAMIC_GATES: FTNodeType[] = ["pand", "spare", "fdep"];
/** Node types without inputs that carry failure data. */
export const EVENT_LEAVES: FTNodeType[] = ["basic", "undeveloped"];
const GATES: FTNodeType[] = ["and", "or", "xor", "not", "kofn", "pand", "inhibit", "cond", "spare", "fdep"];

/** Is this node type a gate (as opposed to an event)? */
export function isGate(t: FTNodeType): boolean {
  return GATES.includes(t);
}

/** Is this node a basic or undeveloped event, i.e. a variable of the analysis? */
export function isLeaf(t: FTNodeType): boolean {
  return EVENT_LEAVES.includes(t);
}

/** The fault tree of a net, or an empty one. */
export function treeOf(net: Net): { nodes: FTNode[]; edges: FTEdge[] } {
  return net.faultTree ?? { nodes: [], edges: [] };
}

/**
 * Inputs of a node in their logical order: left to right by x coordinate, ties broken by edge order.
 * The order matters for PAND (failure order), SPARE (primary first) and FDEP (trigger first).
 */
export function orderedInputs(net: Net, id: string): string[] {
  const { nodes, edges } = treeOf(net);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return edges
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => e.target === id && byId.has(e.source))
    .sort((a, b) => byId.get(a.e.source)!.x - byId.get(b.e.source)!.x || a.i - b.i)
    .map(({ e }) => e.source);
}

/** An environment that resolves the net's constants (later constants may use earlier ones). */
export function constantsEnv(net: Net): EvalEnv {
  const values = new Map<string, Value>();
  const env: EvalEnv = { lookup: (name) => values.get(name) };
  for (const c of net.declarations.constants) {
    try {
      values.set(c.name, evaluate(parseCached(c.value), env));
    } catch {
      /* reported by validation where it matters */
    }
  }
  return env;
}

function evalNumber(src: string, env: EvalEnv): number {
  return num(evaluate(parseCached(src), env));
}

const has = (s: string | undefined): s is string => !!s && s.trim() !== "";

/** Failure data of a basic event, with expressions evaluated. */
export interface EventData {
  /** Fixed probability, if given. */
  probability?: number;
  /** Failure rate λ per hour, if given. */
  failureRate?: number;
  /** Repair rate μ per hour, if given. */
  repairRate?: number;
}

/** Evaluate the failure data of a basic or undeveloped event. Throws FTError on bad expressions. */
export function eventData(node: FTNode, env: EvalEnv): EventData {
  const out: EventData = {};
  const get = (src: string | undefined, what: string) => {
    if (!has(src)) return undefined;
    let v: number;
    try {
      v = evalNumber(src, env);
    } catch (e) {
      throw new FTError(`${node.name}: ${what}: ${(e as Error).message}`);
    }
    if (!Number.isFinite(v)) throw new FTError(`${node.name}: ${what} is not a finite number`);
    return v;
  };
  out.probability = get(node.probability, "probability");
  out.failureRate = get(node.failureRate, "failure rate");
  out.repairRate = get(node.repairRate, "repair rate");
  return out;
}

/**
 * Probability that an event is failed.
 * - Failure rate λ and repair rate μ: λ/(λ+μ) when `time` is undefined (steady-state unavailability),
 *   otherwise λ/(λ+μ)·(1 − e^{−(λ+μ)t}).
 * - Failure rate only: 1 − e^{−λt} at mission time t; without a time the fixed probability is used.
 * - Probability only: that probability, at any time.
 * - Nothing (undeveloped events): 0.
 */
export function eventProbability(d: EventData, time: number | undefined, name = "event"): number {
  const lam = d.failureRate;
  const mu = d.repairRate;
  if (lam !== undefined && mu !== undefined && mu > 0) {
    if (lam + mu === 0) return 0;
    const ss = lam / (lam + mu);
    return time === undefined ? ss : ss * (1 - Math.exp(-(lam + mu) * time));
  }
  if (lam !== undefined && time !== undefined) return 1 - Math.exp(-lam * time);
  if (d.probability !== undefined) return d.probability;
  if (lam !== undefined)
    throw new FTError(`${name} has a failure rate but no probability; give a mission time to analyse it`);
  return 0;
}

// ---------------------------------------------------------------------------------------------
// Validation

/**
 * Check a fault tree: one top event, no cycles, the right number of gate inputs,
 * failure data on basic events, dynamic gates only in extended fault trees, and nodes that
 * do not contribute to the top event.
 */
export function validateFaultTree(net: Net): Problem[] {
  const problems: Problem[] = [];
  const err = (message: string, elementId?: string) => problems.push({ severity: "error", message, elementId });
  const warn = (message: string, elementId?: string) => problems.push({ severity: "warning", message, elementId });
  if (!isFaultTree(net.netClass)) err("The net is not a fault tree");
  if (!net.faultTree) {
    err("The net has no fault tree");
    return problems;
  }
  const { nodes, edges } = net.faultTree;
  const xft = net.netClass === "extendedFaultTree";
  const byId = new Map<string, FTNode>();
  for (const n of nodes) {
    if (byId.has(n.id)) err(`Two nodes have the id ${n.id}`, n.id);
    byId.set(n.id, n);
  }
  const names = new Map<string, number>();
  for (const n of nodes) names.set(n.name, (names.get(n.name) ?? 0) + 1);
  for (const n of nodes) if ((names.get(n.name) ?? 0) > 1 && n.name) warn(`More than one node is named ${n.name}`, n.id);

  const ins = new Map<string, string[]>();
  const outs = new Map<string, string[]>();
  const seen = new Set<string>();
  for (const e of edges) {
    const s = byId.get(e.source);
    const t = byId.get(e.target);
    if (!s || !t) {
      err("An edge refers to a missing node", e.id);
      continue;
    }
    if (e.source === e.target) {
      err(`${s.name} is connected to itself`, e.id);
      continue;
    }
    const key = `${e.source}>${e.target}`;
    if (seen.has(key)) {
      warn(`${s.name} is connected to ${t.name} twice`, e.id);
      continue;
    }
    seen.add(key);
    (ins.get(e.target) ?? ins.set(e.target, []).get(e.target)!).push(e.source);
    (outs.get(e.source) ?? outs.set(e.source, []).get(e.source)!).push(e.target);
  }

  const tops = nodes.filter((n) => n.type === "top");
  if (tops.length === 0) err("The fault tree has no top event");
  if (tops.length > 1) for (const t of tops) err(`More than one top event (${t.name})`, t.id);

  const env = constantsEnv(net);
  for (const c of net.declarations.constants) {
    try {
      evaluate(parseCached(c.value), env);
    } catch (e) {
      err(`Constant ${c.name}: ${(e as Error).message}`);
    }
  }

  for (const n of nodes) {
    const nin = ins.get(n.id)?.length ?? 0;
    const nout = outs.get(n.id)?.length ?? 0;
    const name = n.name || n.id;
    if (!xft && DYNAMIC_GATES.includes(n.type))
      err(`${name}: ${n.type.toUpperCase()} gates belong to extended fault trees`, n.id);
    switch (n.type) {
      case "top":
        if (nout > 0) err(`The top event ${name} must not feed another node`, n.id);
      // fall through
      case "intermediate":
        if (nin === 0) err(`${name} has no cause; connect a gate or event below it`, n.id);
        else if (nin > 1) warn(`${name} has ${nin} inputs; they are combined with OR`, n.id);
        break;
      case "basic":
      case "undeveloped": {
        if (nin > 0) err(`${name} is a ${n.type} event and cannot have inputs`, n.id);
        let d: EventData | undefined;
        try {
          d = eventData(n, env);
        } catch (e) {
          err((e as Error).message, n.id);
        }
        if (d) {
          if (d.probability === undefined && d.failureRate === undefined) {
            if (n.type === "basic") err(`${name} needs a failure rate or a probability`, n.id);
            else warn(`${name} has no failure data and is treated as never occurring`, n.id);
          }
          if (d.probability !== undefined && (d.probability < 0 || d.probability > 1))
            err(`${name}: the probability must lie between 0 and 1`, n.id);
          if (d.failureRate !== undefined && d.failureRate < 0) err(`${name}: the failure rate must not be negative`, n.id);
          if (d.repairRate !== undefined && d.repairRate < 0) err(`${name}: the repair rate must not be negative`, n.id);
          if (d.repairRate !== undefined && d.failureRate === undefined)
            warn(`${name}: a repair rate without a failure rate is ignored`, n.id);
          if (d.repairRate !== undefined && !xft) warn(`${name}: repair rates belong to extended fault trees`, n.id);
        }
        break;
      }
      case "and":
      case "or":
      case "xor":
      case "pand":
        if (nin === 0) err(`${name} (${n.type.toUpperCase()}) has no inputs`, n.id);
        else if (nin === 1) warn(`${name} (${n.type.toUpperCase()}) has only one input`, n.id);
        break;
      case "not":
        if (nin !== 1) err(`${name} (NOT) needs exactly one input, it has ${nin}`, n.id);
        break;
      case "kofn": {
        const k = n.k;
        if (k === undefined || !Number.isInteger(k) || k < 1) err(`${name} (k-of-n) needs a whole number k ≥ 1`, n.id);
        else if (k > nin) err(`${name} (${k}-of-${nin}) has fewer inputs than k`, n.id);
        if (nin === 0) err(`${name} (k-of-n) has no inputs`, n.id);
        break;
      }
      case "inhibit":
      case "cond":
        if (nin !== 2) err(`${name} (${n.type.toUpperCase()}) needs one input and one condition, it has ${nin} inputs`, n.id);
        break;
      case "spare":
        if (nin < 2) err(`${name} (SPARE) needs a primary input and at least one spare`, n.id);
        for (const s of ins.get(n.id) ?? [])
          if (byId.get(s)!.type !== "basic") err(`${name} (SPARE): the inputs must be basic events`, n.id);
        break;
      case "fdep": {
        if (nin < 2) err(`${name} (FDEP) needs a trigger and at least one dependent event`, n.id);
        const ordered = orderedInputs(net, n.id);
        for (const s of ordered.slice(1))
          if (!isLeaf(byId.get(s)!.type)) err(`${name} (FDEP): the dependent inputs must be basic events`, n.id);
        break;
      }
    }
    if (isGate(n.type) && nout === 0 && n.type !== "fdep") warn(`The output of ${name} is not connected`, n.id);
  }

  // Cycles (iterative colouring DFS over input edges).
  const colour = new Map<string, number>();
  let cycleReported = false;
  for (const start of nodes) {
    if (colour.has(start.id) || cycleReported) continue;
    const stack: [string, number][] = [[start.id, 0]];
    colour.set(start.id, 1);
    while (stack.length) {
      const top = stack[stack.length - 1];
      const children = ins.get(top[0]) ?? [];
      if (top[1] < children.length) {
        const c = children[top[1]++];
        const cc = colour.get(c);
        if (cc === 1) {
          err(`The fault tree has a cycle through ${byId.get(c)!.name}`, c);
          cycleReported = true;
          break;
        }
        if (cc === undefined) {
          colour.set(c, 1);
          stack.push([c, 0]);
        }
      } else {
        colour.set(top[0], 2);
        stack.pop();
      }
    }
  }

  // Nodes that cannot influence the top event (directly or through an FDEP trigger).
  if (tops.length === 1) {
    const reach = new Set<string>();
    const queue = [tops[0].id, ...nodes.filter((n) => n.type === "fdep").map((n) => n.id)];
    while (queue.length) {
      const id = queue.pop()!;
      if (reach.has(id)) continue;
      reach.add(id);
      for (const c of ins.get(id) ?? []) queue.push(c);
    }
    for (const n of nodes)
      if (!reach.has(n.id) && !(isGate(n.type) && (outs.get(n.id)?.length ?? 0) === 0))
        warn(`${n.name || n.id} does not contribute to the top event`, n.id);
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------
// Normalised logic graph

/** Kinds of nodes in the normalised logic graph. */
export type LogicKind = "basic" | "and" | "or" | "xor" | "not" | "kofn" | "pand" | "spare";

/**
 * A node of the normalised graph. Events become OR (identity) nodes, INHIBIT/COND become AND,
 * FDEP gates become the identity of their trigger, and every FDEP-dependent event `d` is read
 * through a synthetic OR node `d#fdep` = d ∨ trigger(s).
 */
export interface LogicNode {
  id: string;
  kind: LogicKind;
  inputs: string[];
  k?: number;
  /** SPARE: the basic events (primary first); `inputs` holds the nodes giving their availability. */
  units?: string[];
  /** The fault tree node this was made from (the dependent event for synthetic FDEP nodes). */
  source: FTNode;
  synthetic?: boolean;
}

/** A validated fault tree in analysable form. */
export interface FTModel {
  net: Net;
  top: string;
  /** Nodes reachable from the top event, keyed by id. */
  nodes: Map<string, LogicNode>;
  /** Reachable node ids, inputs before the nodes they feed. */
  order: string[];
  /** Basic and undeveloped events in depth-first order from the top (a good BDD variable order). */
  basics: string[];
  /** Contains PAND or SPARE gates, whose result depends on failure order or timing. */
  dynamic: boolean;
  /** Evaluated failure data of the basic events. */
  data: Map<string, EventData>;
  warnings: Problem[];
}

/** Validate and normalise a fault tree; throws FTError if it has errors. */
export function buildModel(net: Net): FTModel {
  const problems = validateFaultTree(net);
  const errors = problems.filter((p) => p.severity === "error");
  if (errors.length) throw new FTError(`The fault tree has errors: ${errors.map((e) => e.message).join("; ")}`, errors);
  const { nodes } = treeOf(net);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const top = nodes.find((n) => n.type === "top")!;
  const env = constantsEnv(net);

  const triggers = new Map<string, string[]>();
  for (const g of nodes)
    if (g.type === "fdep") {
      const ins = orderedInputs(net, g.id);
      for (const d of ins.slice(1)) (triggers.get(d) ?? triggers.set(d, []).get(d)!).push(ins[0]);
    }
  const eff = (id: string) => (triggers.has(id) ? `${id}#fdep` : id);

  const logic = new Map<string, LogicNode>();
  const make = (id: string): LogicNode => {
    if (id.endsWith("#fdep") && !byId.has(id)) {
      const d = id.slice(0, -5);
      return { id, kind: "or", inputs: [d, ...triggers.get(d)!.map(eff)], source: byId.get(d)!, synthetic: true };
    }
    const n = byId.get(id)!;
    const ins = orderedInputs(net, id);
    switch (n.type) {
      case "basic":
      case "undeveloped":
        return { id, kind: "basic", inputs: [], source: n };
      case "top":
      case "intermediate":
      case "or":
        return { id, kind: "or", inputs: ins.map(eff), source: n };
      case "and":
      case "inhibit":
      case "cond":
        return { id, kind: "and", inputs: ins.map(eff), source: n };
      case "xor":
      case "not":
      case "pand":
        return { id, kind: n.type, inputs: ins.map(eff), source: n };
      case "kofn":
        return { id, kind: "kofn", k: n.k, inputs: ins.map(eff), source: n };
      case "spare":
        return { id, kind: "spare", inputs: ins.map(eff), units: ins, source: n };
      case "fdep":
        return { id, kind: "or", inputs: [eff(ins[0])], source: n };
    }
  };
  // Depth-first post-order from the top event.
  const order: string[] = [];
  const basics: string[] = [];
  const state = new Map<string, number>();
  const visit = (start: string) => {
    const stack: [LogicNode, number][] = [];
    const enter = (id: string) => {
      const ln = make(id);
      logic.set(id, ln);
      state.set(id, 1);
      stack.push([ln, 0]);
    };
    enter(start);
    while (stack.length) {
      const fr = stack[stack.length - 1];
      if (fr[1] < fr[0].inputs.length) {
        const c = fr[0].inputs[fr[1]++];
        const s = state.get(c);
        if (s === 1) throw new FTError("The fault tree has a cycle through a functional dependency");
        if (s === undefined) enter(c);
      } else {
        state.set(fr[0].id, 2);
        order.push(fr[0].id);
        if (fr[0].kind === "basic") basics.push(fr[0].id);
        stack.pop();
      }
    }
  };
  visit(top.id);

  const data = new Map<string, EventData>();
  for (const b of basics) data.set(b, eventData(logic.get(b)!.source, env));
  const dynamic = [...logic.values()].some((n) => n.kind === "pand" || n.kind === "spare");
  return { net, top: top.id, nodes: logic, order, basics, dynamic, data, warnings: problems };
}

/** Probabilities of the model's basic events at `time` (see {@link eventProbability}). */
export function modelProbabilities(m: FTModel, time?: number): Map<string, number> {
  const out = new Map<string, number>();
  for (const b of m.basics) out.set(b, eventProbability(m.data.get(b)!, time, m.nodes.get(b)!.source.name));
  return out;
}

/**
 * Probability of each basic (and undeveloped) event of the tree at a mission time, keyed by node id.
 * Without a time, events with repair use their steady-state unavailability and events with only
 * a failure rate need a fixed probability.
 */
export function basicEventProbabilities(net: Net, opts: { time?: number } = {}): Record<string, number> {
  return Object.fromEntries(modelProbabilities(buildModel(net), opts.time));
}
