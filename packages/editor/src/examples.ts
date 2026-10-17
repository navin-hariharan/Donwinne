import { Net } from "@pns/core";
import { ambientConferenceRoom, ambientGarage, fig410, fig411, fig49 } from "@pns/apn";

/** An example whose net is built on first use, by the APN composition operators of @pns/apn. */
function built(title: string, make: () => Net, comment: string): { title: string; net: Net } {
  let net: Net | undefined;
  return {
    title,
    get net() {
      net ??= { ...make(), comment };
      return net;
    },
  };
}

/** Small nets offered under File > Examples. */
export const EXAMPLES: { title: string; net: Net }[] = [
  {
    title: "Producer and consumer (place/transition)",
    net: {
      format: "pns/1",
      name: "Producer and consumer",
      netClass: "pt",
      comment: "A producer puts items into a buffer of capacity 3; a consumer takes them out.",
      places: [
        { id: "ready", name: "ready_to_produce", x: 120, y: 120, marking: "1" },
        { id: "produced", name: "produced", x: 120, y: 300, marking: "" },
        { id: "buffer", name: "buffer", x: 360, y: 210, marking: "", capacity: 3 },
        { id: "waiting", name: "ready_to_consume", x: 600, y: 120, marking: "1" },
        { id: "consumed", name: "consumed", x: 600, y: 300, marking: "" },
      ],
      transitions: [
        { id: "produce", name: "produce", x: 40, y: 210 },
        { id: "deliver", name: "deliver", x: 230, y: 210 },
        { id: "take", name: "take", x: 490, y: 210 },
        { id: "consume", name: "consume", x: 690, y: 210 },
      ],
      arcs: [
        { id: "a1", source: "ready", target: "produce", kind: "normal", inscription: "1", points: [{ x: 40, y: 120 }] },
        { id: "a2", source: "produce", target: "produced", kind: "normal", inscription: "1", points: [{ x: 40, y: 300 }] },
        { id: "a3", source: "produced", target: "deliver", kind: "normal", inscription: "1" },
        { id: "a4", source: "deliver", target: "ready", kind: "normal", inscription: "1" },
        { id: "a5", source: "deliver", target: "buffer", kind: "normal", inscription: "1" },
        { id: "a6", source: "buffer", target: "take", kind: "normal", inscription: "1" },
        { id: "a7", source: "waiting", target: "take", kind: "normal", inscription: "1" },
        { id: "a8", source: "take", target: "consumed", kind: "normal", inscription: "1" },
        { id: "a9", source: "consumed", target: "consume", kind: "normal", inscription: "1", points: [{ x: 690, y: 300 }] },
        { id: "a10", source: "consume", target: "waiting", kind: "normal", inscription: "1", points: [{ x: 690, y: 120 }] },
      ],
      declarations: { colourSets: [], variables: [], constants: [] },
    },
  },
  {
    title: "Priority access with read, inhibitor and reset arcs (extended)",
    net: {
      format: "pns/1",
      name: "Priority access",
      netClass: "xpt",
      comment:
        "Urgent jobs block normal jobs through an inhibitor arc. Working needs the shared resource (read arc), and an alarm clears the queue (reset arc).",
      places: [
        { id: "urgent", name: "urgent_queue", x: 120, y: 100, marking: "1" },
        { id: "normal", name: "normal_queue", x: 120, y: 300, marking: "3" },
        { id: "resource", name: "resource", x: 470, y: 200, marking: "1" },
        { id: "done", name: "done", x: 640, y: 200, marking: "" },
        { id: "alarm", name: "alarm", x: 120, y: 440, marking: "" },
      ],
      transitions: [
        { id: "serve_u", name: "serve_urgent", x: 330, y: 100 },
        { id: "serve_n", name: "serve_normal", x: 330, y: 300 },
        { id: "flush", name: "flush", x: 330, y: 440 },
      ],
      arcs: [
        { id: "b1", source: "urgent", target: "serve_u", kind: "normal", inscription: "1" },
        { id: "b2", source: "normal", target: "serve_n", kind: "normal", inscription: "1" },
        { id: "b3", source: "urgent", target: "serve_n", kind: "inhibitor", inscription: "1", points: [{ x: 220, y: 200 }, { x: 260, y: 330 }] },
        { id: "b4", source: "resource", target: "serve_u", kind: "read", inscription: "1" },
        { id: "b5", source: "resource", target: "serve_n", kind: "read", inscription: "1" },
        { id: "b6", source: "serve_u", target: "done", kind: "normal", inscription: "1", points: [{ x: 640, y: 100 }] },
        { id: "b7", source: "serve_n", target: "done", kind: "normal", inscription: "1", points: [{ x: 560, y: 300 }] },
        { id: "b8", source: "alarm", target: "flush", kind: "normal", inscription: "1" },
        { id: "b9", source: "normal", target: "flush", kind: "reset", inscription: "" },
      ],
      declarations: { colourSets: [], variables: [], constants: [] },
    },
  },
  {
    title: "Konios Fig. 3.1: colour-sensitive inhibitor arc (APN)",
    net: {
      format: "pns/1",
      name: "Konios 2015, Figure 3.1",
      netClass: "apn",
      comment:
        "Konios (2015), Fig. 3.1. t can fire in black mode only: the white token in p5 blocks t's white mode through the colour-sensitive inhibitor arc.",
      places: [
        { id: "p1", name: "p1", x: 120, y: 120, marking: "b ++ w", colourSet: "BW", capacity: 1 },
        { id: "p2", name: "p2", x: 120, y: 300, marking: "b ++ w", colourSet: "BW", capacity: 1 },
        { id: "p3", name: "p3", x: 480, y: 120, marking: "", colourSet: "BW", capacity: 1 },
        { id: "p4", name: "p4", x: 480, y: 300, marking: "", colourSet: "BW", capacity: 1 },
        { id: "p5", name: "p5", x: 300, y: 400, marking: "w", colourSet: "W", capacity: 1 },
      ],
      transitions: [{ id: "t", name: "t", x: 300, y: 210 }],
      arcs: [
        { id: "c1", source: "p1", target: "t", kind: "normal", inscription: "x" },
        { id: "c2", source: "p2", target: "t", kind: "normal", inscription: "x" },
        { id: "c3", source: "t", target: "p3", kind: "normal", inscription: "x" },
        { id: "c4", source: "t", target: "p4", kind: "normal", inscription: "x" },
        { id: "c5", source: "p5", target: "t", kind: "inhibitor", inscription: "x" },
      ],
      declarations: {
        colourSets: [
          { name: "Dot", type: "dot" },
          { name: "BW", type: "enum", values: ["b", "w"] },
          { name: "W", type: "enum", values: ["w"] },
        ],
        variables: [{ name: "x", colourSet: "BW" }],
        constants: [],
      },
    },
  },
  built(
    "Konios Fig. 4.9: forward composition of step nets (APN)",
    fig49,
    "Konios (2015), Fig. 4.9. A root net (p1, p0) extended by three basic step nets with the forward composition operator (Def. 8): N1 ⊕p1 N2, then ⊕p2 N3 and ⊕p2 N4. Each composition adds a colour-sensitive inhibitor arc from the control place of the gluing place to the new step transition, so a user can only take the next step after the system has answered (emptied the control place).",
  ),
  built(
    "Konios Fig. 4.10: bidirectional step (APN)",
    fig410,
    "Konios (2015), Fig. 4.10. Two unidirectional steps with control systems glued into a bidirectional step by the backward composition operator (Def. 12): users move p1 → p2 by t1 and back by t4. p1 now has two control places, p0 and p7, and the net is cyclic/reversible (Def. 10).",
  ),
  built(
    "Konios Fig. 4.11: N-graph (APN)",
    fig411,
    "Konios (2015), Fig. 4.11. Two forward composite step nets side by side, joined by a backward composition with N4 on (p, p12) and (p2, p13). The root control place pc holds the black token: the black user may not leave p.",
  ),
  built(
    "Konios: ambient garage (APN)",
    () => ambientGarage(),
    "Konios (2015), Sec. 4.5.1, Fig. 4.15. APN model of the ambient garage, built from the root net (entrance, ctrl_entrance) by five forward and three backward compositions. Step places are the sensors of the areas (entrance, junctions p1 and p2, bays A1 and A2, exit), response places the advice on the public displays, database places the allocation of bay A1 to car 1 and bay A2 to car 2. Put a car's colour in ctrl_entrance to model an unpaid ticket.",
  ),
  built(
    "Konios: ambient conference room (APN)",
    () => ambientConferenceRoom(),
    "Konios (2015), Sec. 4.5.2, Fig. 4.17. APN model of the ambient conference room: participants swipe their cards, temporary reviewers log in and score papers during the break (which an intruder interrupts), then the committee session, the final decision and its announcement. Step places are tasks, detections and conditions; response places the advice on the public and private displays.",
  ),
  {
    title: "Predator and prey (continuous)",
    net: {
      format: "pns/1",
      name: "Predator and prey",
      netClass: "continuous",
      comment: "Lotka–Volterra equations as a continuous Petri net. Use Simulate & plot to see the cycles.",
      places: [
        { id: "prey", name: "Prey", x: 160, y: 200, marking: "10", continuous: true },
        { id: "pred", name: "Predator", x: 460, y: 200, marking: "5", continuous: true },
      ],
      transitions: [
        { id: "birth", name: "birth", x: 160, y: 70, kind: "continuous", rate: "a * Prey" },
        { id: "eat", name: "eaten", x: 310, y: 300, kind: "continuous", rate: "b * Prey * Predator" },
        { id: "grow", name: "grow", x: 460, y: 70, kind: "continuous", rate: "d * Prey * Predator" },
        { id: "die", name: "die", x: 600, y: 200, kind: "continuous", rate: "c * Predator" },
      ],
      arcs: [
        { id: "c1", source: "prey", target: "birth", kind: "normal", inscription: "1", points: [{ x: 120, y: 120 }] },
        { id: "c2", source: "birth", target: "prey", kind: "normal", inscription: "2", points: [{ x: 200, y: 120 }] },
        { id: "c3", source: "prey", target: "eat", kind: "normal", inscription: "1" },
        { id: "c4", source: "pred", target: "eat", kind: "read", inscription: "1" },
        { id: "c5", source: "prey", target: "grow", kind: "read", inscription: "1" },
        { id: "c6", source: "pred", target: "grow", kind: "normal", inscription: "1", points: [{ x: 420, y: 120 }] },
        { id: "c7", source: "grow", target: "pred", kind: "normal", inscription: "2", points: [{ x: 500, y: 120 }] },
        { id: "c8", source: "pred", target: "die", kind: "normal", inscription: "1" },
      ],
      declarations: {
        colourSets: [],
        variables: [],
        constants: [
          { name: "a", value: "1" },
          { name: "b", value: "0.1" },
          { name: "c", value: "1.5" },
          { name: "d", value: "0.075" },
        ],
      },
    },
  },
  {
    title: "Radioactive decay (stochastic)",
    net: {
      format: "pns/1",
      name: "Decay",
      netClass: "stochastic",
      comment: "Each atom decays at rate k. Plot several runs to see the noise around the exponential curve.",
      places: [
        { id: "atoms", name: "Atoms", x: 120, y: 160, marking: "N" },
        { id: "decayed", name: "Decayed", x: 380, y: 160, marking: "" },
      ],
      transitions: [{ id: "decay", name: "decay", x: 250, y: 160, kind: "stochastic", rate: "MassAction(k)" }],
      arcs: [
        { id: "d1", source: "atoms", target: "decay", kind: "normal", inscription: "1" },
        { id: "d2", source: "decay", target: "decayed", kind: "normal", inscription: "1" },
      ],
      declarations: { colourSets: [], variables: [], constants: [{ name: "N", value: "100" }, { name: "k", value: "0.05" }] },
    },
  },
  {
    title: "Traffic light (timed)",
    net: {
      format: "pns/1",
      name: "Traffic light",
      netClass: "timed",
      comment: "Each phase lasts a fixed time window. Use Wait to let time pass, then fire.",
      places: [
        { id: "red", name: "red", x: 120, y: 120, marking: "1", color: "#fecaca" },
        { id: "green", name: "green", x: 380, y: 120, marking: "", color: "#bbf7d0" },
        { id: "amber", name: "amber", x: 250, y: 300, marking: "", color: "#fef08a" },
      ],
      transitions: [
        { id: "go", name: "go", x: 250, y: 120, interval: ["30", "30"] },
        { id: "slow", name: "slow", x: 380, y: 300, interval: ["25", "40"] },
        { id: "stop", name: "stop", x: 120, y: 300, interval: ["3", "5"] },
      ],
      arcs: [
        { id: "l1", source: "red", target: "go", kind: "normal", inscription: "1" },
        { id: "l2", source: "go", target: "green", kind: "normal", inscription: "1" },
        { id: "l3", source: "green", target: "slow", kind: "normal", inscription: "1" },
        { id: "l4", source: "slow", target: "amber", kind: "normal", inscription: "1" },
        { id: "l5", source: "amber", target: "stop", kind: "normal", inscription: "1" },
        { id: "l6", source: "stop", target: "red", kind: "normal", inscription: "1" },
      ],
      declarations: { colourSets: [], variables: [], constants: [] },
    },
  },
  {
    title: "Scale (music)",
    net: {
      format: "pns/1",
      name: "Scale",
      netClass: "music",
      comment: "Run the token game with sound on to hear the scale go up and down.",
      places: ["C", "D", "E", "F", "G"].map((n, i) => ({ id: `s${i}`, name: `p${i}`, x: 80 + i * 140, y: 140, marking: i === 0 ? "1" : "" })),
      transitions: [
        ...["D4", "E4", "F4", "G4"].map((note, i) => ({ id: `up${i}`, name: `up${i + 1}`, x: 150 + i * 140, y: 80, sound: { note, duration: 0.35, instrument: "piano" as const } })),
        ...["C4", "D4", "E4", "F4"].map((note, i) => ({ id: `dn${i}`, name: `down${i + 1}`, x: 150 + i * 140, y: 200, sound: { note, duration: 0.35, instrument: "triangle" as const } })),
      ],
      arcs: [
        ...[0, 1, 2, 3].flatMap((i) => [
          { id: `u${i}a`, source: `s${i}`, target: `up${i}`, kind: "normal" as const, inscription: "1" },
          { id: `u${i}b`, source: `up${i}`, target: `s${i + 1}`, kind: "normal" as const, inscription: "1" },
          { id: `d${i}a`, source: `s${i + 1}`, target: `dn${i}`, kind: "normal" as const, inscription: "1" },
          { id: `d${i}b`, source: `dn${i}`, target: `s${i}`, kind: "normal" as const, inscription: "1" },
        ]),
      ],
      declarations: { colourSets: [], variables: [], constants: [] },
    },
  },
  {
    title: "Water supply (fault tree)",
    net: {
      format: "pns/1",
      name: "Water supply",
      netClass: "faultTree",
      comment: "No water if the power fails or both pumps fail.",
      places: [],
      transitions: [],
      arcs: [],
      faultTree: {
        nodes: [
          { id: "top", type: "top", name: "No water", x: 300, y: 60 },
          { id: "g1", type: "or", name: "G1", x: 300, y: 150 },
          { id: "power", type: "basic", name: "Power", x: 200, y: 270, failureRate: "1e-5" },
          { id: "g2", type: "and", name: "Both pumps", x: 400, y: 250 },
          { id: "pa", type: "basic", name: "Pump A", x: 340, y: 370, failureRate: "1e-3" },
          { id: "pb", type: "basic", name: "Pump B", x: 460, y: 370, failureRate: "1e-3" },
        ],
        edges: [
          { id: "f1", source: "g1", target: "top" },
          { id: "f2", source: "power", target: "g1" },
          { id: "f3", source: "g2", target: "g1" },
          { id: "f4", source: "pa", target: "g2" },
          { id: "f5", source: "pb", target: "g2" },
        ],
      },
      declarations: { colourSets: [], variables: [], constants: [] },
    },
  },
];
