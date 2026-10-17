// The small example nets of Konios (2015) used to explain the APN and T-APN semantics and the
// construction: Fig. 3.1 (APN), Fig. 5.1 (T-APN), Fig. 6.1 (APN N) and Fig. 6.3 (APN N1).
// Positions follow the figures so that the nets and their constructed T-APNs draw like them.

import { Arc, ArcKind, ColourSetDecl, Net, Place, Transition } from "@pns/core";

/** The figures' coordinates are scaled up so that places (40 units wide) do not crowd each other. */
const SCALE = 1.6;

type P = [name: string, x: number, y: number, marking?: string, colourSet?: string];
type T = [name: string, x: number, y: number];
type A = [source: string, target: string, kind?: ArcKind, inscription?: string];

function build(name: string, netClass: "apn" | "tapn", comment: string, places: P[], transitions: T[], arcs: A[], colourSets: ColourSetDecl[], variables: [string, string][], gluing: string[] = [], guards: Record<string, string> = {}): Net {
  const ps: Place[] = places.map(([n, x, y, marking = "", colourSet]) => {
    const p: Place = { id: n, name: n, x: Math.round(x * SCALE), y: Math.round(y * SCALE), marking, colourSet: colourSet ?? colourSets[1]?.name ?? "Dot", capacity: 1 };
    if (gluing.includes(n)) p.gluing = true;
    return p;
  });
  const ts: Transition[] = transitions.map(([n, x, y]) => {
    const t: Transition = { id: n, name: n, x: Math.round(x * SCALE), y: Math.round(y * SCALE) };
    if (guards[n]) t.guard = guards[n];
    return t;
  });
  const as: Arc[] = arcs.map(([source, target, kind = "normal", inscription = "x"], i) => ({ id: `a${i + 1}`, source, target, kind, inscription }));
  return {
    format: "pns/1",
    name,
    netClass,
    comment,
    places: ps,
    transitions: ts,
    arcs: as,
    declarations: { colourSets, variables: variables.map(([n, cs]) => ({ name: n, colourSet: cs })), constants: [] },
  };
}

const DOT: ColourSetDecl = { name: "Dot", type: "dot" };

/**
 * Konios Fig. 3.1: an APN with one transition t, Cl = {{w}, {b, w}}, C(p5) = {w}, K = 1. The white
 * token in the inhibitor place p5 blocks mode w, so CRG(N) is M0 --{(t,b)}--> M1.
 */
export function thesisFig3_1(): Net {
  return build(
    "Konios Fig. 3.1",
    "apn",
    "Konios (2015) Fig. 3.1: an Ambient Petri Net. Each token colour is a user; t can fire only in black mode because p5 holds a white token.",
    [
      ["p1", 120, 100, "b ++ w"],
      ["p2", 280, 100, "b ++ w"],
      ["p3", 120, 300],
      ["p4", 280, 300],
      ["p5", 460, 300, "w", "W"],
    ],
    [["t", 220, 200]],
    [
      ["p1", "t"],
      ["p2", "t"],
      ["t", "p3"],
      ["t", "p4"],
      ["p5", "t", "inhibitor"],
    ],
    [DOT, { name: "BW", type: "enum", values: ["b", "w"] }, { name: "W", type: "enum", values: ["w"] }],
    [["x", "BW"]],
  );
}

/**
 * Konios Fig. 5.1: a T-APN with Cl = {b, w}, Cl̄ = {g, l} (f(b) = g, f(w) = l), C_P(p5) = {g},
 * Ins((p5, t)) = {g, l} and the binding pairs B_t = {(b, g), (w, l)} as guard. CRG: M0 --{(t,b)}--> M1.
 */
export function thesisFig5_1(): Net {
  return build(
    "Konios Fig. 5.1",
    "tapn",
    "Konios (2015) Fig. 5.1: a Transformed Ambient Petri Net. The grey token in p5 is the complement of black, so t fires in black mode only.",
    [
      ["p1", 120, 100, "b ++ w", "BW"],
      ["p2", 280, 100, "b ++ w", "BW"],
      ["p3", 120, 300, "", "BW"],
      ["p4", 280, 300, "", "BW"],
      ["p5", 460, 300, "g", "G"],
    ],
    [["t", 220, 200]],
    [
      ["p1", "t"],
      ["p2", "t"],
      ["t", "p3"],
      ["t", "p4"],
      ["p5", "t", "normal", "x_bar"],
    ],
    [
      DOT,
      { name: "BW", type: "enum", values: ["b", "w"] },
      { name: "BW_bar", type: "enum", values: ["g", "l"], complementOf: "BW" },
      { name: "G", type: "subset", components: ["BW_bar"], predicate: "x = g" },
    ],
    [
      ["x", "BW"],
      ["x_bar", "BW_bar"],
    ],
    [],
    { t: "x = b and x_bar = g or x = w and x_bar = l" },
  );
}

/**
 * Konios Fig. 6.3: the APN N1, a composite step net (root net p0/p1 and two basic step nets) with one
 * black user. Its CRG (Fig. 6.5) has ten states.
 */
export function thesisFig6_3(): Net {
  return build(
    "Konios Fig. 6.3 (N1)",
    "apn",
    "Konios (2015) Fig. 6.3: the APN net N1 used to show that N1 and its constructed T-APN behave alike (Figs 6.4-6.6).",
    [
      ["p0", 515, 720],
      ["p1", 590, 720, "b"],
      ["p2", 590, 487],
      ["p3", 490, 487],
      ["p4", 490, 555, "b"],
      ["p5", 350, 487],
      ["p6", 590, 250],
      ["p7", 490, 250],
      ["p8", 490, 297, "b"],
      ["p9", 350, 250],
    ],
    [
      ["t1", 590, 603],
      ["t2", 420, 487],
      ["t3", 420, 555],
      ["t4", 590, 368],
      ["t5", 420, 250],
      ["t6", 420, 297],
    ],
    [
      ["p1", "t1"],
      ["p0", "t1", "inhibitor"],
      ["t1", "p2"],
      ["t1", "p3"],
      ["p3", "t2"],
      ["p4", "t2"],
      ["t2", "p5"],
      ["p5", "t3"],
      ["t3", "p4"],
      ["p2", "t4"],
      ["p3", "t4", "inhibitor"],
      ["t4", "p6"],
      ["t4", "p7"],
      ["p7", "t5"],
      ["p8", "t5"],
      ["t5", "p9"],
      ["p9", "t6"],
      ["t6", "p8"],
    ],
    [DOT, { name: "B", type: "enum", values: ["b"] }],
    [["x", "B"]],
    ["p1", "p2", "p6"],
  );
}

/**
 * Konios Fig. 6.1: the APN N built from a root net, three basic step nets and a backward composition
 * that makes p2 ⇄ p6 a bidirectional step; two users, black and white. (Fig. 6.1's drawing gives p8
 * and p15 a white token and p9 and p16 a black one; the drawing is followed here.)
 */
export function thesisFig6_1(): Net {
  return build(
    "Konios Fig. 6.1 (N)",
    "apn",
    "Konios (2015) Fig. 6.1: the APN net N from which the T-APN of Fig. 6.2 is constructed.",
    [
      ["p0", 376, 787],
      ["p1", 447, 787, "b ++ w"],
      ["p2", 447, 550],
      ["p3", 352, 550],
      ["p4", 352, 597, "b ++ w"],
      ["p5", 210, 550],
      ["p6", 447, 315],
      ["p7", 352, 315],
      ["p8", 352, 362, "w"],
      ["p9", 352, 410, "b"],
      ["p10", 210, 315],
      ["p11", 210, 410],
      ["p14", 588, 550],
      ["p15", 588, 597, "w"],
      ["p16", 588, 645, "b"],
      ["p17", 730, 550],
      ["p18", 730, 645],
    ],
    [
      ["t1", 447, 668],
      ["t2", 280, 550],
      ["t3", 280, 622],
      ["t4", 445, 433],
      ["t5", 280, 315],
      ["t6", 280, 362],
      ["t7", 280, 410],
      ["t8", 280, 457],
      ["t9", 517, 433],
      ["t10", 658, 550],
      ["t11", 658, 597],
      ["t12", 658, 645],
      ["t13", 658, 692],
    ],
    [
      // Pre_DIR
      ["p1", "t1"],
      ["p3", "t2"],
      ["p5", "t3"],
      ["p4", "t2"],
      ["p2", "t4"],
      ["p7", "t5"],
      ["p7", "t7"],
      ["p8", "t5"],
      ["p9", "t7"],
      ["p10", "t6"],
      ["p11", "t8"],
      ["p14", "t10"],
      ["p6", "t9"],
      ["p14", "t12"],
      ["p15", "t10"],
      ["p16", "t12"],
      ["p17", "t11"],
      ["p18", "t13"],
      // I
      ["p0", "t1", "inhibitor"],
      ["p3", "t4", "inhibitor"],
      ["p7", "t9", "inhibitor"],
      ["p14", "t4", "inhibitor"],
      // Post_ALL (the text's (t4, p14) is the drawing's t9 -> p14)
      ["t1", "p2"],
      ["t1", "p3"],
      ["t2", "p5"],
      ["t3", "p4"],
      ["t4", "p6"],
      ["t4", "p7"],
      ["t5", "p10"],
      ["t6", "p8"],
      ["t7", "p11"],
      ["t8", "p9"],
      ["t9", "p14"],
      ["t9", "p2"],
      ["t10", "p17"],
      ["t11", "p15"],
      ["t12", "p18"],
      ["t13", "p16"],
    ],
    [DOT, { name: "BW", type: "enum", values: ["b", "w"] }],
    [["x", "BW"]],
    ["p1", "p2", "p6"],
  );
}
