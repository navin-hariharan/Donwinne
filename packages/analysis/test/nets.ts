import { Arc, ArcKind, Net, NetClass, Place, Transition, emptyNet } from "@pns/core";

export type P = [name: string, marking: string, extra?: Partial<Place>];
export type T = [name: string, extra?: Partial<Transition>];
export type A = [source: string, target: string, inscription?: string, kind?: ArcKind];

/** Small net builder: ids equal names. */
export function mk(netClass: NetClass, places: P[], transitions: T[], arcs: A[]): Net {
  const net = emptyNet(netClass, "test");
  net.places = places.map(([name, marking, extra]) => ({ id: name, name, x: 0, y: 0, marking, ...extra }));
  net.transitions = transitions.map(([name, extra]) => ({ id: name, name, x: 0, y: 0, ...extra }));
  net.arcs = arcs.map(([source, target, inscription, kind], i): Arc => ({ id: `a${i}`, source, target, inscription: inscription ?? "1", kind: kind ?? "normal" }));
  return net;
}

/** Producer–consumer with a buffer of the given capacity (complement place "free"). */
export function producerConsumer(capacity = 2): Net {
  return mk(
    "pt",
    [["ready", "1"], ["produced", ""], ["buffer", ""], ["free", String(capacity)], ["waiting", "1"], ["consumed", ""]],
    [["produce"], ["deliver"], ["remove"], ["consume"]],
    [
      ["ready", "produce"], ["produce", "produced"],
      ["produced", "deliver"], ["free", "deliver"], ["deliver", "ready"], ["deliver", "buffer"],
      ["buffer", "remove"], ["waiting", "remove"], ["remove", "consumed"], ["remove", "free"],
      ["consumed", "consume"], ["consume", "waiting"],
    ],
  );
}

/**
 * Dining philosophers. Atomic: a philosopher takes both forks at once (live).
 * Deadlocking: left fork first, then the right one (all holding their left fork is a deadlock).
 */
export function philosophers(n: number, deadlocking = false): Net {
  const places: P[] = [];
  const transitions: T[] = [];
  const arcs: A[] = [];
  for (let i = 0; i < n; i++) places.push([`think${i}`, "1"], [`eat${i}`, ""], [`fork${i}`, "1"]);
  for (let i = 0; i < n; i++) {
    const r = `fork${(i + 1) % n}`;
    if (deadlocking) {
      places.push([`left${i}`, ""]);
      transitions.push([`takeL${i}`], [`takeR${i}`], [`release${i}`]);
      arcs.push([`think${i}`, `takeL${i}`], [`fork${i}`, `takeL${i}`], [`takeL${i}`, `left${i}`]);
      arcs.push([`left${i}`, `takeR${i}`], [r, `takeR${i}`], [`takeR${i}`, `eat${i}`]);
    } else {
      transitions.push([`take${i}`], [`release${i}`]);
      arcs.push([`think${i}`, `take${i}`], [`fork${i}`, `take${i}`], [r, `take${i}`], [`take${i}`, `eat${i}`]);
    }
    arcs.push([`eat${i}`, `release${i}`], [`release${i}`, `think${i}`], [`release${i}`, `fork${i}`], [`release${i}`, r]);
  }
  return mk("pt", places, transitions, arcs);
}

/** Two processes and a mutex place. */
export function mutex(): Net {
  return mk(
    "pt",
    [["idle1", "1"], ["crit1", ""], ["idle2", "1"], ["crit2", ""], ["mutex", "1"]],
    [["enter1"], ["exit1"], ["enter2"], ["exit2"]],
    [
      ["idle1", "enter1"], ["mutex", "enter1"], ["enter1", "crit1"], ["crit1", "exit1"], ["exit1", "idle1"], ["exit1", "mutex"],
      ["idle2", "enter2"], ["mutex", "enter2"], ["enter2", "crit2"], ["crit2", "exit2"], ["exit2", "idle2"], ["exit2", "mutex"],
    ],
  );
}

/** t1 keeps p1 marked and produces into p2 forever: p2 is unbounded. */
export function unbounded(): Net {
  return mk("pt", [["p1", "1"], ["p2", ""]], [["t1"], ["t2"]], [["p1", "t1"], ["t1", "p1"], ["t1", "p2"], ["p2", "t2"]]);
}

/** t2 needs a token from p4, which nothing ever produces. */
export function deadTransition(): Net {
  return mk("pt", [["p1", "1"], ["p2", ""], ["p4", ""]], [["t1"], ["t2"]], [["p1", "t1"], ["t1", "p2"], ["p2", "t2"], ["p4", "t2"], ["t2", "p1"]]);
}

/** Free-choice, live and safe: fork into two branches, one of them with a choice, then join. */
export function liveFreeChoice(): Net {
  return mk(
    "pt",
    [["p1", "1"], ["p2", ""], ["p3", ""], ["p4", ""], ["p5", ""]],
    [["t1"], ["t2"], ["t3"], ["t4"], ["t5"]],
    [
      ["p1", "t1"], ["t1", "p2"], ["t1", "p3"],
      ["p2", "t2"], ["t2", "p4"], ["p2", "t3"], ["t3", "p4"],
      ["p3", "t4"], ["t4", "p5"],
      ["p4", "t5"], ["p5", "t5"], ["t5", "p1"],
    ],
  );
}

/** Free-choice net whose siphon {p4} holds no marked trap: choosing t2 deadlocks. */
export function siphonTrapFails(): Net {
  return mk(
    "pt",
    [["p1", "1"], ["p2", ""], ["p3", ""], ["p4", ""]],
    [["t1"], ["t2"], ["t3"], ["t4"]],
    [["p1", "t1"], ["t1", "p2"], ["p1", "t2"], ["t2", "p3"], ["p2", "t3"], ["t3", "p1"], ["p3", "t4"], ["p4", "t4"], ["t4", "p1"]],
  );
}

/** Coloured dining philosophers over Phil = {a, b, c} (unfolds to philosophers(3)). */
export function colouredPhilosophers(): Net {
  const net = emptyNet("coloured", "CPhil");
  net.declarations.colourSets.push({ name: "Phil", type: "enum", values: ["a", "b", "c"] });
  net.declarations.variables.push({ name: "x", colourSet: "Phil" });
  net.places = [
    { id: "think", name: "think", x: 0, y: 0, marking: "all(Phil)", colourSet: "Phil" },
    { id: "eat", name: "eat", x: 0, y: 0, marking: "", colourSet: "Phil" },
    { id: "fork", name: "fork", x: 0, y: 0, marking: "all(Phil)", colourSet: "Phil" },
  ];
  net.transitions = [
    { id: "take", name: "take", x: 0, y: 0 },
    { id: "release", name: "release", x: 0, y: 0 },
  ];
  const arc = (id: string, source: string, target: string, inscription: string): Arc => ({ id, source, target, inscription, kind: "normal" });
  net.arcs = [
    arc("c1", "think", "take", "x"),
    arc("c2", "fork", "take", "x ++ succ(x)"),
    arc("c3", "take", "eat", "x"),
    arc("c4", "eat", "release", "x"),
    arc("c5", "release", "think", "x"),
    arc("c6", "release", "fork", "x ++ succ(x)"),
  ];
  return net;
}
