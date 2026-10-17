// The nets of Konios (2015), Figs 4.1, 4.2 and 4.6-4.12, built with the generators and the
// composition operators. Names follow the figures (p1' and p5' are the starting places that the
// compositions glue away). Colour set BW: b is the black token •, w the white token ◦.

import { Net } from "@pns/core";
import { basicStepNet, oneStepNet, rootNet, unidirectionalStep, BasicStepOptions } from "./blocks";
import { backwardCompose, forwardCompose, parallelCompose, tidy } from "./compose";

/** Fig. 4.1: a unidirectional step p1 → t1 → p2 with a black token in p1. */
export function fig41(): Net {
  return unidirectionalStep({ start: "p1", step: "t1", finish: "p2", users: ["b"], name: "Konios 2015, Fig. 4.1" });
}

const N2: BasicStepOptions = {
  start: "p1'",
  finish: "p2",
  step: "t1",
  control: "p3",
  decisions: [{ users: ["b", "w"], database: "p4", emptying: "t2", response: "p5", retrieve: "t3" }],
};

const N3: BasicStepOptions = {
  start: "p5'",
  finish: "p6",
  step: "t4",
  control: "p7",
  decisions: [
    { users: ["w"], database: "p8", emptying: "t5", response: "p10", retrieve: "t6" },
    { users: ["b"], database: "p9", emptying: "t7", response: "p11", retrieve: "t8" },
  ],
};

const N4: BasicStepOptions = {
  start: "p12",
  finish: "p13",
  step: "t9",
  control: "p14",
  decisions: [
    { users: ["w"], database: "p15", emptying: "t10", response: "p17", retrieve: "t11" },
    { users: ["b"], database: "p16", emptying: "t12", response: "p18", retrieve: "t13" },
  ],
};

/** Fig. 4.2(a) and Fig. 4.7(b): N2, a unidirectional step with control system (one decision point). */
export function fig47N2(): Net {
  return basicStepNet({ ...N2, name: "N2 (Fig. 4.7(b))" });
}

/** Fig. 4.2(b) and Fig. 4.7(c): N3, a unidirectional step with control system and two decision points. */
export function fig47N3(): Net {
  return basicStepNet({ ...N3, name: "N3 (Fig. 4.7(c))" });
}

/** Fig. 4.7(a), the root net N1 = Fig. 4.6(a): users b and w in p1, no restrictions in p0. */
export function fig47N1(): Net {
  return rootNet({ place: "p1", control: "p0", users: ["b", "w"], name: "N1 (Fig. 4.7(a))" });
}

/** Fig. 4.6(a) and (b): a root net without restrictions, or with the black user blocked. */
export function fig46(blocked: boolean): Net {
  return rootNet({ place: "p", control: "pc", users: ["b", "w"], blocked: blocked ? ["b"] : [], name: `Root net (Fig. 4.6(${blocked ? "b" : "a"}))` });
}

/** Fig. 4.8: N4, a basic step net. */
export function fig48N4(): Net {
  return basicStepNet({ ...N4, name: "N4 (Fig. 4.8)" });
}

/** The forward composite net N = (N1 ⊕^p1 N2) ⊕^p2 N3 of Sec. 4.3.1.2 (Fig. 4.3 plus p0). */
export function fig43N(): Net {
  return forwardCompose(forwardCompose(fig47N1(), "p1", fig47N2()), "p2", fig47N3(), { name: "N = (N1 ⊕p1 N2) ⊕p2 N3" });
}

/** Fig. 4.9: N ⊕^p2 N4, a forward composition of the forward composite net N and the basic step net N4. */
export function fig49(): Net {
  return tidy(forwardCompose(fig43N(), "p2", fig48N4(), { name: "Konios 2015, Fig. 4.9" }));
}

/** Fig. 4.10: the bidirectional step (N1 ⊕^p1 N2) ⊕^{p2}_{p1} N3, N3 treated as a one step net. */
export function fig410(): Net {
  const n = forwardCompose(fig47N1(), "p1", fig47N2());
  return tidy(backwardCompose(n, "p2", "p1", oneStepNet({ ...N3, name: "N3 as one step net" }), { name: "Konios 2015, Fig. 4.10" }));
}

/**
 * Fig. 4.11: the N-graph. N6 = N1 ⊕^p1 N2 and N7 = R ⊕^p N3 (R the root net of Fig. 4.6(b)) side by side,
 * then backward composed with N4 on (p, p12) and (p2, p13).
 */
export function fig411(): Net {
  const n6 = forwardCompose(fig47N1(), "p1", fig47N2(), { name: "N6" });
  const n7 = forwardCompose(fig46(true), "p", fig47N3(), { name: "N7" });
  const n = parallelCompose(n6, n7, { name: "N6 ∥ N7" });
  return tidy(backwardCompose(n, "p", "p2", oneStepNet({ ...N4, name: "N4 as one step net" }), { name: "Konios 2015, Fig. 4.11" }));
}

/** Fig. 4.12: N ⊕^{p2}_{p1} N4 with N = (N1 ⊕^p1 N2) ⊕^p2 N3 and N4 treated as a one step net. */
export function fig412(): Net {
  return tidy(backwardCompose(fig43N(), "p2", "p1", oneStepNet({ ...N4, name: "N4 as one step net" }), { name: "Konios 2015, Fig. 4.12" }));
}
