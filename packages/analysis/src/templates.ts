// Parameterised CTL property templates for ambient systems, after Konios (2015, ch. 7): the
// ambient and general properties of §7.1.1–7.1.2 and the fault-tolerance properties of §7.3.3.

import { placeRef } from "./ctl";

/** The kind of value a template parameter takes. */
export type TemplateFieldKind = "place" | "places" | "number" | "choice";

/** One parameter (or one column of a rule list). */
export interface TemplateField {
  name: string;
  label: string;
  kind: TemplateFieldKind;
  /** One line on what to choose. */
  description: string;
  optional?: boolean;
  default?: number | string;
  /** Allowed values of a "choice". */
  options?: string[];
}

/** A list of rules, each a row of fields (e.g. one row per location and advice). */
export interface TemplateRules {
  name: string;
  label: string;
  kind: "rules";
  description: string;
  fields: TemplateField[];
}

export type TemplateParameter = TemplateField | TemplateRules;

/** Value of a field: a place reference (e.g. "p1", "p1[a]"), a list of them, a number or a choice. */
export type TemplateValue = string | string[] | number | undefined;
export type TemplateArgs = Record<string, TemplateValue | Record<string, TemplateValue>[]>;

/** A formula produced by a template. */
export interface TemplateFormula {
  /** What this formula checks, when a template produces several. */
  label: string;
  /** CTL text in the syntax accepted by {@link parseCtl}. */
  text: string;
  /** The verdict a correctly working ambient system should give, as in the thesis. */
  expected: boolean;
}

export type TemplateCategory = "ambient guidance" | "ambient information" | "common ambient" | "general guidance" | "common general" | "fault tolerance";

/** A named property from Konios (2015, ch. 7) that turns chosen places into its CTL formula. */
export interface PropertyTemplate {
  id: string;
  title: string;
  /** Thesis section, e.g. "7.1.1.1.1". */
  section: string;
  category: TemplateCategory;
  /** The property as the thesis states it in English. */
  statement: string;
  /** One line in plain English on what the formula checks. */
  summary: string;
  params: TemplateParameter[];
  /** Arguments that reproduce the thesis's formula for the ambient garage (or conference room). */
  example: TemplateArgs;
  /** Caveats, e.g. where the thesis's formula text reads differently under Charlie's precedence. */
  note?: string;
  build(args: TemplateArgs): TemplateFormula[];
}

/** Thrown when template arguments are missing or of the wrong kind. */
export class TemplateError extends Error {
  constructor(
    readonly template: string,
    readonly param: string,
    message: string,
  ) {
    super(message);
    this.name = "TemplateError";
  }
}

// ---------------------------------------------------------------- formula building helpers

const ref = (p: string) => placeRef(p.trim());
/** "p" (marked) or "p == k". */
const cond = (p: string, k?: number) => (k === undefined ? ref(p) : `${ref(p)} == ${k}`);
const par = (s: string) => `(${s})`;
const or = (xs: string[]) => (xs.length === 1 ? xs[0] : par(xs.join(" | ")));
const orBare = (xs: string[]) => xs.join(" | ");
const and = (xs: string[]) => xs.join(" & ");

type Row = Record<string, TemplateValue>;
const str = (v: TemplateValue) => v as string;
const list = (v: TemplateValue) => (v === undefined ? [] : Array.isArray(v) ? v : [v as string]);
const num = (v: TemplateValue) => (v === undefined || v === "" ? undefined : Number(v));

const F = (name: string, label: string, kind: TemplateFieldKind, description: string, extra: Partial<TemplateField> = {}): TemplateField => ({
  name,
  label,
  kind,
  description,
  ...extra,
});
const R = (name: string, label: string, description: string, fields: TemplateField[]): TemplateRules => ({ name, label, kind: "rules", description, fields });

// ---------------------------------------------------------------- the templates

const T: PropertyTemplate[] = [
  {
    id: "sensorDetection",
    title: "Examining sensors: user detection",
    section: "7.1.1.1.1",
    category: "ambient guidance",
    statement: "A user is always detected by the system's sensors when he performs an action.",
    summary: "Whenever a user is at a location, after his next move he is at one of the next locations and that location's sensor has detected him.",
    params: [
      R("rules", "Detections", "One row per location and possible next location with its sensor (control) place.", [
        F("location", "Location", "place", "Where the user is."),
        F("tokens", "Tokens at location", "number", "Exact token count at the location (the thesis uses 2); leave empty for 'marked'.", { optional: true }),
        F("next", "Next location", "place", "A location the user can move to."),
        F("sensor", "Sensor", "place", "The sensor (control) place that detects the user there."),
        F("step", "Next step", "choice", "AX: after every move; EX: after some move.", { options: ["AX", "EX"], default: "AX" }),
      ]),
    ],
    example: {
      rules: [
        { location: "entrance", tokens: 2, next: "p1", sensor: "ctrl_p1" },
        { location: "p1", tokens: 2, next: "p2", sensor: "ctrl_p2" },
        { location: "p1", tokens: 2, next: "A1", sensor: "ctrl_A1" },
        { location: "A1", tokens: 2, next: "p1", sensor: "ctrl_p1_1" },
        { location: "p2", tokens: 2, next: "A2", sensor: "ctrl_A2" },
        { location: "p2", tokens: 2, next: "p1", sensor: "ctrl_p1_2" },
        { location: "p2", tokens: 2, next: "exit", sensor: "ctrl_exit" },
        { location: "A2", tokens: 2, next: "p2", sensor: "ctrl_p2_1" },
      ],
    },
    note: "The thesis (Fig. 7.1) writes the rules without brackets around the first implication, so under Charlie's precedence the other rules are only checked while the first location holds the given tokens; the template brackets every rule.",
    build(a) {
      const groups = new Map<string, { head: string; step: string; alts: string[] }>();
      for (const r of a.rules as Row[]) {
        const head = cond(str(r.location), num(r.tokens));
        const step = (r.step as string) || "AX";
        const k = `${head}\u0000${step}`;
        if (!groups.has(k)) groups.set(k, { head, step, alts: [] });
        groups.get(k)!.alts.push(par(`${ref(str(r.next))} > 0 & ${ref(str(r.sensor))} > 0`));
      }
      const parts = [...groups.values()].map((g) => par(`${g.head} -> ${g.step}(${orBare(g.alts)})`));
      return [{ label: "User detection", text: `AG(${and(parts)})`, expected: true }];
    },
  },
  {
    id: "sensorOverlap",
    title: "Examining sensors: no overlapping sensors",
    section: "7.1.1.1.1",
    category: "ambient guidance",
    statement: "A user cannot be detected by two different sensors at the same time.",
    summary: "No reachable state has the user detected at two locations at once.",
    params: [
      F("locationA", "First location", "place", "A location."),
      F("sensorA", "First sensor", "place", "The sensor place of the first location."),
      F("locationB", "Second location", "place", "Another location."),
      F("sensorB", "Second sensor", "place", "The sensor place of the second location."),
      F("tokens", "Tokens", "number", "Exact token count meaning 'detected' (the thesis uses 2); leave empty for 'marked'.", { optional: true }),
    ],
    example: { locationA: "p1", sensorA: "ctrl_p1", locationB: "p2", sensorB: "ctrl_p2", tokens: 2 },
    build(a) {
      const k = num(a.tokens as TemplateValue);
      const A = and([cond(str(a.locationA as TemplateValue), k), cond(str(a.sensorA as TemplateValue), k)]);
      const B = and([cond(str(a.locationB as TemplateValue), k), cond(str(a.sensorB as TemplateValue), k)]);
      return [{ label: "Sensors do not overlap", text: `AG(${par(A)} -> !${par(B)})`, expected: true }];
    },
  },
  {
    id: "ignoreAdvice",
    title: "User's initiative: ignoring an advice",
    section: "7.1.1.1.2",
    category: "ambient guidance",
    statement: "A user can ignore the system's advice.",
    summary: "Whenever an advice is shown at a location, the user can still move somewhere other than advised.",
    params: [
      R("rules", "Advices", "One row per location, advice shown there, and a move that ignores it.", [
        F("location", "Location", "place", "Where the user is."),
        F("advice", "Advice", "place", "The advice place (what the display shows)."),
        F("alternative", "Other move", "place", "A location the advice does not point to."),
      ]),
    ],
    example: {
      rules: [
        { location: "p1", advice: "Left_p1_1", alternative: "p2" },
        { location: "p1", advice: "Forward_p1_2", alternative: "A1" },
        { location: "p1", advice: "Right_p1_1", alternative: "p2" },
        { location: "p1", advice: "Back_p1_2", alternative: "A1" },
        { location: "p1", advice: "Left_p1_2", alternative: "A1" },
        { location: "p1", advice: "Back_p1_1", alternative: "p2" },
        { location: "A1", advice: "Park_A1_1", alternative: "p1" },
        { location: "p2", advice: "Back_p2_1", alternative: "A2" },
        { location: "p2", advice: "Back_p2_1", alternative: "exit" },
        { location: "p2", advice: "Right_p2_2", alternative: "p1" },
        { location: "A2", advice: "Park_A2_2", alternative: "p2" },
      ],
    },
    build(a) {
      const parts = (a.rules as Row[]).map((r) => par(`${ref(str(r.location))} > 0 & ${ref(str(r.advice))} > 0 -> EX(${ref(str(r.alternative))})`));
      return [{ label: "Advices can be ignored", text: `AG(${and(parts)})`, expected: true }];
    },
  },
  {
    id: "goalAfterIgnoring",
    title: "User's initiative: reaching the goal after ignoring advices",
    section: "7.1.1.1.2",
    category: "ambient guidance",
    statement: "A user partially ignoring the system's advices can eventually reach his goal.",
    summary: "A user who ignores an advice and is redirected can still reach his goal.",
    params: [
      R("rules", "Scenarios", "One row per ignored advice: where it is shown, where ignoring it leads, the redirecting advice there and the goal.", [
        F("location", "Location", "place", "Where the advice is shown."),
        F("advice", "Advice", "place", "The advice the user ignores."),
        F("wrong", "Wrong location", "place", "Where the user goes instead."),
        F("redirect", "Redirecting advice", "place", "The advice shown at the wrong location."),
        F("goal", "Goal", "place", "The user's goal (e.g. his parking bay)."),
      ]),
      F("combine", "Combine scenarios", "choice", "all: every scenario must work; any: one is enough (as in the thesis).", { options: ["all", "any"], default: "all" }),
    ],
    example: {
      rules: [
        { location: "p1", advice: "Left_p1_1", wrong: "p2", redirect: "Back_p2_1", goal: "A1" },
        { location: "p1", advice: "Forward_p1_2", wrong: "A1", redirect: "Back_A1_2", goal: "A2" },
      ],
      combine: "any",
    },
    build(a) {
      const parts = (a.rules as Row[]).map((r) =>
        par(`${par(`${ref(str(r.location))} > 0 & ${ref(str(r.advice))} > 0 -> EX(${ref(str(r.wrong))})`)} & ${par(`${ref(str(r.wrong))} > 0 & ${ref(str(r.redirect))} -> EF(${ref(str(r.goal))})`)}`),
      );
      const op = (a.combine as string) === "any" ? " | " : " & ";
      return [{ label: "Goal reachable after ignoring advices", text: `AG(${parts.join(op)})`, expected: true }];
    },
  },
  {
    id: "displayMode",
    title: "Examining displays",
    section: "7.1.1.2.1",
    category: "ambient information",
    statement: "System's displays are either 'on' or 'off' at any point throughout the operation of the system.",
    summary: "From every reachable state each display can be found off (no tokens) or on (some tokens).",
    params: [F("displays", "Displays", "places", "The advice or display places.")],
    example: {
      displays: ["Left_p1_1", "Forward_p1_2", "Left_p1_2", "Back_p1_1", "Park_A1_1", "Back_A1_2", "Right_p2_2", "Back_p2_1", "Back_A2_1", "Park_A2_2", "Left_p2_1", "Back_p2_2", "Bye_exit_12"],
    },
    note: "As written in the thesis the formula holds in every net: each state itself satisfies d == 0 or d != 0. AG(EF(d == 0)) & AG(EF(d != 0)) would check that every display can still be switched both ways.",
    build(a) {
      const parts = list(a.displays as TemplateValue).map((d) => par(`EF(${ref(d)} == 0) | EF(${ref(d)} != 0)`));
      return [{ label: "Displays are on or off", text: `AG(${and(parts)})`, expected: true }];
    },
  },
  {
    id: "noLeak",
    title: "Examining leak of information",
    section: "7.1.1.2.2",
    category: "ambient information",
    statement: "There is no leak of information to unauthorised users.",
    summary: "While the database holds no information for an advice, that advice is never shown to more users than allowed.",
    params: [
      R("rules", "Advices", "One row per advice and the database place it is determined by.", [
        F("database", "Database place", "place", "The database (resource) place of the advice."),
        F("advice", "Advice", "place", "The advice place."),
        F("max", "Most viewers", "number", "Most tokens the advice may hold then (default 1).", { optional: true, default: 1 }),
        F("databaseTokens", "Database tokens", "number", "Database marking that triggers the check (default 0, empty).", { optional: true, default: 0 }),
      ]),
    ],
    example: {
      rules: [
        { database: "db_p1_1", advice: "Left_p1_1" },
        { database: "db_p1_2", advice: "Forward_p1_2" },
        { database: "db_p1_1_2", advice: "Left_p1_2" },
        { database: "db_p1_1_1", advice: "Back_p1_1" },
        { database: "db_A1_1", advice: "Park_A1_1" },
        { database: "db_A1_2", advice: "Back_A1_2" },
        { database: "db_p1_2_2", advice: "Back_p1_2" },
        { database: "db_p1_2_1", advice: "Right_p1_1" },
        { database: "db_p2_2", advice: "Right_p2_2" },
        { database: "db_p2_1", advice: "Back_p2_1" },
        { database: "db_A2_2", advice: "Park_A2_2" },
        { database: "db_A2_1", advice: "Back_A2_1" },
        { database: "db_p2_1_1", advice: "Left_p2_1" },
        { database: "db_p2_1_1", advice: "Back_p2_2" },
        { database: "db_exit_12", advice: "Bye_exit_12", max: 2 },
      ],
    },
    build(a) {
      const parts = (a.rules as Row[]).map((r) => par(`${ref(str(r.database))} == ${num(r.databaseTokens) ?? 0} -> !(${ref(str(r.advice))} > ${num(r.max) ?? 1})`));
      return [{ label: "No leak of information", text: `AG(${and(parts)})`, expected: true }];
    },
  },
  {
    id: "notifyUser",
    title: "Notifying the user",
    section: "7.1.1.3.1",
    category: "common ambient",
    statement: "A user is notified after every single action that he makes.",
    summary: "Each detected action can be followed by its advice, and each advice by the user's next detected action.",
    params: [
      R("rules", "Interactions", "One row per location, advice given there and the location it leads to.", [
        F("location", "Location", "place", "Where the user is."),
        F("sensor", "Sensor", "place", "The sensor (control) place detecting him there."),
        F("advice", "Advice", "place", "The advice given there."),
        F("next", "Next location", "place", "Where following the advice leads."),
        F("nextSensor", "Next sensor", "place", "The sensor place detecting him there."),
      ]),
    ],
    example: {
      rules: [
        { location: "p1", sensor: "ctrl_p1", advice: "Left_p1_1", next: "p2", nextSensor: "ctrl_p2" },
        { location: "p1", sensor: "ctrl_p1", advice: "Forward_p1_2", next: "p2", nextSensor: "ctrl_p2" },
        { location: "A1", sensor: "ctrl_A1", advice: "Back_A1_2", next: "p1", nextSensor: "ctrl_p1_1" },
        { location: "p1", sensor: "ctrl_p1_1", advice: "Back_p1_1", next: "A1", nextSensor: "ctrl_A1" },
        { location: "p1", sensor: "ctrl_p1_1", advice: "Left_p1_2", next: "p2", nextSensor: "ctrl_p2" },
        { location: "p2", sensor: "ctrl_p2", advice: "Back_p2_1", next: "p1", nextSensor: "ctrl_p1_2" },
        { location: "p2", sensor: "ctrl_p2", advice: "Right_p2_2", next: "A2", nextSensor: "ctrl_A2" },
        { location: "A2", sensor: "ctrl_A2", advice: "Back_A2_1", next: "p2", nextSensor: "ctrl_p2_1" },
        { location: "p2", sensor: "ctrl_p2_1", advice: "Back_p2_1", next: "exit", nextSensor: "ctrl_exit" },
      ],
    },
    build(a) {
      const parts = (a.rules as Row[]).map((r) => {
        const L = ref(str(r.location));
        const A = ref(str(r.advice));
        return par(`${par(`${L} & ${ref(str(r.sensor))} -> EX(${L} & ${A})`)} & ${par(`${L} & ${A} -> EX(${ref(str(r.next))} & ${ref(str(r.nextSensor))})`)}`);
      });
      return [{ label: "User is notified", text: `AG(${and(parts)})`, expected: true }];
    },
  },
  {
    id: "alternation",
    title: "Alternation of actions",
    section: "7.1.1.3.2",
    category: "common ambient",
    statement: "A system's advice is preceded by a user's action and vice versa.",
    summary: "After the user moves to a location an advice follows, and after the advice the user moves on.",
    params: [
      F("before", "Previous location", "place", "Where the user comes from."),
      F("location", "Location", "place", "Where the user arrives."),
      F("tokens", "Tokens at location", "number", "Exact token count at the location (the thesis uses 2); leave empty for 'marked'.", { optional: true }),
      F("pending", "Sensor places", "places", "Sensor (control) places that are empty until an advice is given."),
      F("advices", "Advices", "places", "Advices possible at the location."),
      F("next", "Next locations", "places", "Where the advices lead."),
    ],
    example: { before: "entrance", location: "p1", tokens: 2, pending: ["ctrl_p1_1", "ctrl_p1_2"], advices: ["Left_p1_1", "Forward_p1_2"], next: ["p2", "A1"] },
    note: "The thesis's formula (Fig. 7.15) reads, under Charlie's precedence, (AG(…) & AG(…)) -> AX(…), so its last part is only checked in the initial state; the template puts that part inside AG.",
    build(a) {
      const L = ref(str(a.location as TemplateValue));
      const k = num(a.tokens as TemplateValue);
      const at = cond(str(a.location as TemplateValue), k);
      const waiting = and([at, ...list(a.pending as TemplateValue).map((p) => `${ref(p)} == 0`)]);
      const adv = list(a.advices as TemplateValue).map(ref);
      const shown = or(adv.map((x) => `${x} == 1`));
      const first = `AG(${par(`${ref(str(a.before as TemplateValue))} -> ${L}`)} -> AX(${par(waiting)} -> ${or(adv)}))`;
      const second = `AG(${par(`${par(waiting)} -> ${shown}`)} -> AX(${par(`${at} & ${shown}`)} -> ${or(list(a.next as TemplateValue).map(ref))}))`;
      return [{ label: "Actions alternate", text: `${first} & ${second}`, expected: true }];
    },
  },
  {
    id: "restrictUser",
    title: "Restricting user's actions",
    section: "7.1.1.3.3",
    category: "common ambient",
    statement: "A user cannot perform two consecutive actions without the 'intervention' of the system.",
    summary: "After a move the system always answers with an advice (true), and the user cannot move on straight away (false).",
    params: [
      F("before", "Previous location", "place", "Where the user comes from."),
      F("location", "Location", "place", "Where the user arrives."),
      F("pending", "Sensor places", "places", "Sensor (control) places that are empty until an advice is given."),
      F("advices", "Advices", "places", "Advices possible at the location."),
      F("next", "Next locations", "places", "Where the user would move next."),
    ],
    example: { before: "entrance", location: "p1", pending: ["ctrl_p1_1", "ctrl_p1_2"], advices: ["Left_p1_1", "Forward_p1_2"], next: ["p2"] },
    build(a) {
      const L = ref(str(a.location as TemplateValue));
      const moved = par(`${ref(str(a.before as TemplateValue))} -> ${L}`);
      const waiting = and([`${L} > 0`, ...list(a.pending as TemplateValue).map((p) => `${ref(p)} == 0`)]);
      return [
        { label: "An advice always follows the user's action", text: `AG(${moved} -> AX(${par(waiting)} -> ${or(list(a.advices as TemplateValue).map(ref))}))`, expected: true },
        { label: "Two consecutive user actions (expected to fail)", text: `AG(${moved} -> AX(${L} -> ${or(list(a.next as TemplateValue).map(ref))}))`, expected: false },
      ];
    },
  },
  {
    id: "systemActions",
    title: "Examining system's actions",
    section: "7.1.1.3.4",
    category: "common ambient",
    statement: "Every single user-system interaction consists of user's action, system's response and database refill.",
    summary: "Each user action is followed by a possible advice, and each advice by a possible database refill.",
    params: [
      R("rules", "Interactions", "One row per location: where the user goes next, the advices that may follow and the database places refilled after them.", [
        F("location", "Location", "place", "Where the user acts."),
        F("next", "Next locations", "places", "Where his action leads."),
        F("advices", "Advices", "places", "The system's possible responses."),
        F("refills", "Database places", "places", "Database places refilled after the advice."),
      ]),
      F("timing", "Operators", "choice", "next: AX/EX as for the garage; eventually: AF/EF as for the conference room.", { options: ["next", "eventually"], default: "next" }),
    ],
    example: {
      rules: [
        { location: "entrance", next: ["p1"], advices: ["Left_p1_1", "Forward_p1_2"], refills: ["db_p1_1", "db_p1_2"] },
        { location: "p1", next: ["A1", "p2"], advices: ["Park_A1_1", "Back_A1_2", "Back_p2_1", "Right_p2_2"], refills: ["db_A1_1", "db_A1_2", "db_p2_1", "db_p2_2"] },
        { location: "p2", next: ["A2", "p1", "exit"], advices: ["Park_A2_2", "Back_A2_1", "Back_p1_2", "Right_p1_1", "Bye_exit_12"], refills: ["db_A2_2", "db_A2_1", "db_p1_2_2", "db_p1_2_1", "db_exit_12"] },
        { location: "A1", next: ["p1"], advices: ["Left_p1_2", "Back_p1_1"], refills: ["db_p1_1_2", "db_p1_1_1"] },
        { location: "A2", next: ["p2"], advices: ["Left_p2_1", "Back_p2_2"], refills: ["db_p2_1_1", "db_p2_1_2"] },
      ],
      timing: "next",
    },
    note: "Implication associates to the left in Charlie, so each rule reads ((user action) -> advice) -> refill, as the thesis's formula (Fig. 7.19) was checked; there the later rules were joined to the first rule's last part, while the template conjoins whole rules.",
    build(a) {
      const [A, E] = (a.timing as string) === "eventually" ? ["AF", "EF"] : ["AX", "EX"];
      const parts = (a.rules as Row[]).map((r) =>
        par(`${par(`${par(`${ref(str(r.location))} -> ${A}(${orBare(list(r.next).map(ref))})`)} -> ${E}(${orBare(list(r.advices).map(ref))})`)} -> ${E}(${orBare(list(r.refills).map(ref))})`),
      );
      return [{ label: "Action, response and refill", text: `AG(${and(parts)})`, expected: true }];
    },
  },
  {
    id: "adviceRedundancy",
    title: "Examining redundancy of advices",
    section: "7.1.2.1.1",
    category: "general guidance",
    statement: "None of the advices from the set of possible advices is redundant.",
    summary: "Every advice can be given at some point.",
    params: [F("advices", "Advices", "places", "Every advice place of the system.")],
    example: { advices: ["Back_p1_2", "Left_p1_1", "Right_p1_1", "Forward_p1_2", "Park_A1_1", "Park_A2_2", "Bye_exit_12"] },
    build(a) {
      return [{ label: "No redundant advice", text: and(list(a.advices as TemplateValue).map((x) => `EF(${ref(x)})`)), expected: true }];
    },
  },
  {
    id: "returnToPrevious",
    title: "Returning to previous states",
    section: "7.1.2.1.2",
    category: "general guidance",
    statement: "The user can return to one of the previously visited states.",
    summary: "Between each pair of neighbouring locations the user can go both ways.",
    params: [
      R("rules", "Location pairs", "Pairs of neighbouring locations.", [
        F("from", "Location", "place", "One location."),
        F("to", "Neighbour", "place", "A location reachable from it in one move."),
      ]),
    ],
    example: {
      rules: [
        { from: "p1", to: "A1" },
        { from: "p1", to: "p2" },
        { from: "p2", to: "A2" },
      ],
    },
    build(a) {
      const parts = (a.rules as Row[]).map((r) => `AG(${par(`${ref(str(r.from))} -> EX(${ref(str(r.to))})`)} & ${par(`${ref(str(r.to))} -> EX(${ref(str(r.from))})`)})`);
      return [{ label: "Previous states can be revisited", text: and(parts), expected: true }];
    },
  },
  {
    id: "adviceFromDatabase",
    title: "Relating advice with database resources",
    section: "7.1.2.2.1",
    category: "common general",
    statement: "Advices are 'announced' on the display with respect to what the database indicates about every user.",
    summary: "An advice stays shown until its database place has been used up.",
    params: [
      R("rules", "Advices", "One row per advice and its database place.", [
        F("advice", "Advice", "place", "The advice place."),
        F("database", "Database place", "place", "The database place it is determined by."),
        F("below", "Used up below", "number", "The database counts as used up below this many tokens; leave empty for 'empty' (== 0).", { optional: true }),
      ]),
    ],
    example: {
      rules: [
        { advice: "Left_p1_2", database: "db_p1_1_2" },
        { advice: "Back_p1_1", database: "db_p1_1_1" },
        { advice: "Forward_p1_2", database: "db_p1_2" },
        { advice: "Left_p1_1", database: "db_p1_1" },
        { advice: "Park_A1_1", database: "db_A1_1" },
        { advice: "Back_A1_2", database: "db_A1_2" },
        { advice: "Back_p1_2", database: "db_p1_2_2" },
        { advice: "Right_p1_1", database: "db_p1_2_1" },
        { advice: "Right_p2_2", database: "db_p2_2" },
        { advice: "Back_p2_1", database: "db_p2_1" },
        { advice: "Back_A2_1", database: "db_A2_1" },
        { advice: "Park_A2_2", database: "db_A2_2" },
        { advice: "Back_p2_2", database: "db_p2_1_2" },
        { advice: "Left_p2_1", database: "db_p2_1_1" },
        { advice: "Bye_exit_12", database: "db_exit_12", below: 2 },
      ],
    },
    build(a) {
      const parts = (a.rules as Row[]).map((r) => {
        const A = ref(str(r.advice));
        const b = num(r.below);
        return `AG(${A} -> A[${A} != 0 U ${ref(str(r.database))} ${b === undefined ? "== 0" : `< ${b}`}])`;
      });
      return [{ label: "Advices follow the database", text: and(parts), expected: true }];
    },
  },
  {
    id: "databaseRefill",
    title: "Refilling the database resources",
    section: "7.1.2.2.2",
    category: "common general",
    statement: "The database of the system is 'refilled' after every given advice.",
    summary: "After each advice its database place can be refilled in the next step.",
    params: [
      R("rules", "Advices", "One row per advice and its database place.", [
        F("advice", "Advice", "place", "The advice place."),
        F("database", "Database place", "place", "The database place refilled after it."),
      ]),
    ],
    example: {
      rules: [
        { advice: "Left_p1_1", database: "db_p1_1" },
        { advice: "Forward_p1_2", database: "db_p1_2" },
        { advice: "Back_p1_1", database: "db_p1_1_1" },
        { advice: "Left_p1_2", database: "db_p1_1_2" },
        { advice: "Park_A1_1", database: "db_A1_1" },
        { advice: "Back_A1_2", database: "db_A1_2" },
        { advice: "Back_p2_1", database: "db_p2_1" },
        { advice: "Right_p2_2", database: "db_p2_2" },
        { advice: "Right_p1_1", database: "db_p1_2_1" },
        { advice: "Back_p1_2", database: "db_p1_2_2" },
        { advice: "Left_p2_1", database: "db_p2_1_1" },
        { advice: "Back_p2_2", database: "db_p2_1_2" },
        { advice: "Back_A2_1", database: "db_A2_1" },
        { advice: "Park_A2_2", database: "db_A2_2" },
        { advice: "Bye_exit_12", database: "db_exit_12" },
      ],
    },
    build(a) {
      const parts = (a.rules as Row[]).map((r) => par(`${ref(str(r.advice))} -> EX(${ref(str(r.database))})`));
      return [{ label: "Database refilled", text: `AG(${and(parts)})`, expected: true }];
    },
  },
  {
    id: "resourceUpperBound",
    title: "Quantity of resources: upper bound",
    section: "7.1.2.2.3",
    category: "common general",
    statement: "The number of the resources or agents of the system cannot exceed a certain predefined constant number.",
    summary: "No chosen place ever holds more than the given number of tokens.",
    params: [F("places", "Places", "places", "Places holding users or resources."), F("max", "Most tokens", "number", "The bound (the thesis uses 2).", { default: 2 })],
    example: { places: ["entrance", "exit", "p1", "p2", "A1", "A2"], max: 2 },
    build(a) {
      const k = num(a.max as TemplateValue) ?? 2;
      return [{ label: "Resources bounded", text: `AG(${and(list(a.places as TemplateValue).map((p) => `!(${ref(p)} > ${k})`))})`, expected: true }];
    },
  },
  {
    id: "resourceLowerBound",
    title: "Quantity of resources: lower bound",
    section: "7.1.2.2.3",
    category: "common general",
    statement: "The number of the resources or agents of the system cannot be depleted throughout the user's actions.",
    summary: "No chosen place ever holds fewer than the given number of tokens.",
    params: [F("places", "Places", "places", "Places holding users or resources."), F("min", "Fewest tokens", "number", "The lower bound (the thesis uses 0).", { default: 0 })],
    example: { places: ["entrance", "exit", "p1", "p2", "A1", "A2"], min: 0 },
    note: "With the thesis's bound 0 the formula holds in every net, since markings are never negative.",
    build(a) {
      const k = num(a.min as TemplateValue) ?? 0;
      return [{ label: "Resources not depleted", text: `AG(${and(list(a.places as TemplateValue).map((p) => `!(${ref(p)} < ${k})`))})`, expected: true }];
    },
  },
  {
    id: "reachGoal",
    title: "Reaching user's goal",
    section: "7.1.2.2.4",
    category: "common general",
    statement: "Every user eventually reaches his goal.",
    summary: "Each user's goal state can be reached.",
    params: [
      R("rules", "Goals", "One row per user's goal: places that must all be marked, and optionally places of which one must be.", [
        F("all", "All of", "places", "Places marked in the goal."),
        F("any", "One of", "places", "Alternatives, one of which is marked.", { optional: true }),
      ]),
    ],
    example: { rules: [{ all: ["A1", "Park_A1_1"] }, { all: ["A2", "Park_A2_2"] }] },
    note: "EF checks that the goal can be reached on some run, which is what the thesis's formula expresses.",
    build(a) {
      const parts = (a.rules as Row[]).map((r) => {
        const xs = list(r.all).map(ref);
        const alt = list(r.any).map(ref);
        if (alt.length) xs.push(or(alt));
        return `EF(${and(xs)})`;
      });
      return [{ label: "Goals reachable", text: and(parts), expected: true }];
    },
  },
  {
    id: "reachTerminal",
    title: "Reaching terminal state",
    section: "7.1.2.2.5",
    category: "common general",
    statement: "There always exists a way to get to the terminal state, where the system eventually stops interacting with the users.",
    summary: "From every reachable state the terminal state can still be reached.",
    params: [
      R("rules", "Terminal state", "The places of the terminal state, with exact token counts where needed.", [
        F("place", "Place", "place", "A place of the terminal state."),
        F("tokens", "Tokens", "number", "Exact token count; leave empty for 'marked'.", { optional: true }),
      ]),
    ],
    example: {
      rules: [
        { place: "exit", tokens: 2 },
        ...["db_p1_1", "db_p1_2_2", "db_p1_2_1", "db_p2_1", "db_p2_2", "db_A2_1", "db_A2_2", "db_p2_1_1", "db_p2_1_2", "db_A1_2", "db_A1_1", "db_p1_1_1", "db_p1_1_2", "db_p1_2"].map((place) => ({ place })),
        { place: "db_exit_12", tokens: 2 },
      ],
    },
    build(a) {
      const xs = (a.rules as Row[]).map((r) => cond(str(r.place), num(r.tokens)));
      return [{ label: "Terminal state reachable", text: `AG(EF(${and(xs)}))`, expected: true }];
    },
  },
  {
    id: "interactWithUsers",
    title: "Interacting with users",
    section: "7.1.2.2.6",
    category: "common general",
    statement: "System should be prepared to interact with both authorised and unauthorised users at any point of its execution.",
    summary: "On every run the system eventually reaches a point from which it can serve an authorised and an unauthorised user at once.",
    params: [
      F("first", "First user (all of)", "places", "Places marked while the first (e.g. unauthorised) user is served."),
      F("firstAny", "First user (one of)", "places", "Alternatives for the first user.", { optional: true }),
      F("second", "Second user (all of)", "places", "Places marked while the second (e.g. authorised) user is served."),
      F("secondAny", "Second user (one of)", "places", "Alternatives for the second user.", { optional: true }),
    ],
    example: { first: ["A2", "Back_A2_1"], second: ["p1", "Forward_p1_2"] },
    build(a) {
      const group = (all: TemplateValue, any: TemplateValue) => {
        const xs = list(all).map(ref);
        const alt = list(any).map(ref);
        if (alt.length) xs.push(or(alt));
        return par(and(xs));
      };
      return [{ label: "Interacting with both users", text: `AF(EF(${group(a.first as TemplateValue, a.firstAny as TemplateValue)} & ${group(a.second as TemplateValue, a.secondAny as TemplateValue)}))`, expected: true }];
    },
  },
  {
    id: "improperActions",
    title: "Dealing with improper actions",
    section: "7.1.2.2.7",
    category: "common general",
    statement: "Unauthorised actions are not always followed by appropriate warning advices.",
    summary: "Claims that an improper action is never followed by a warning; a working system makes this fail.",
    params: [
      R("rules", "Improper actions", "One row per improper situation and the warning the system should give.", [
        F("situation", "Situation", "places", "Places marked after the improper action."),
        F("warning", "Warning (all of)", "places", "Places marked once the warning is given."),
        F("warningAny", "Warning (one of)", "places", "Alternatives for the warning.", { optional: true }),
        F("step", "Next step", "choice", "EX: no next state shows the warning; AX: not every next state does.", { options: ["EX", "AX"], default: "EX" }),
      ]),
    ],
    example: {
      rules: [
        { situation: ["A1", "Back_A1_2"], warning: ["p1", "ctrl_p1_1"] },
        { situation: ["A2", "Back_A2_1"], warning: ["p2", "ctrl_p2_1"] },
      ],
    },
    build(a) {
      const parts = (a.rules as Row[]).map((r) => {
        const xs = list(r.warning).map(ref);
        const alt = list(r.warningAny).map(ref);
        if (alt.length) xs.push(or(alt));
        const step = (r.step as string) || "EX";
        return `AG(${and(list(r.situation).map(ref))} -> !(${step}(${and(xs)})))`;
      });
      return [{ label: "No warning after improper actions (expected to fail)", text: and(parts), expected: false }];
    },
  },
  {
    id: "goalAfterWrongAdvice",
    title: "Fault tolerance: reaching the goal after a wrong advice",
    section: "7.3.3",
    category: "fault tolerance",
    statement: "A user can reach his final goal even after a wrong advice of the system.",
    summary: "Whenever the faulty system gives the wrong advice, the user's goal can still be reached.",
    params: [
      R("wrong", "Wrong advice", "The state in which the wrong advice is given.", [
        F("place", "Place", "place", "A place of that state."),
        F("tokens", "Tokens", "number", "Exact token count; leave empty for 'marked'.", { optional: true }),
      ]),
      F("goal", "Goal", "places", "Places marked when the goal is reached."),
    ],
    example: { wrong: [{ place: "p2", tokens: 2 }, { place: "Back_p2_1", tokens: 2 }], goal: ["exit", "Bye_exit_12"] },
    note: "Check it on the net with the fault injected (see faultTolerance).",
    build(a) {
      const w = (a.wrong as Row[]).map((r) => cond(str(r.place), num(r.tokens)));
      return [{ label: "Goal after wrong advice", text: `AG(${and(w)} -> EF(${and(list(a.goal as TemplateValue).map(ref))}))`, expected: true }];
    },
  },
  {
    id: "correctAfterWrongAdvice",
    title: "Fault tolerance: correct advice after a wrong one",
    section: "7.3.3",
    category: "fault tolerance",
    statement: "The system can potentially give a correct advice after a wrong one for the same action of the user.",
    summary: "Whenever the faulty system gives the wrong advice, it can later give the correct one for the same action.",
    params: [
      R("wrong", "Wrong advice", "The state in which the wrong advice is given.", [
        F("place", "Place", "place", "A place of that state."),
        F("tokens", "Tokens", "number", "Exact token count; leave empty for 'marked'.", { optional: true }),
      ]),
      R("correct", "Correct advice", "The state in which the correct advice is given.", [
        F("place", "Place", "place", "A place of that state."),
        F("tokens", "Tokens", "number", "Exact token count; leave empty for 'marked'.", { optional: true }),
      ]),
    ],
    example: {
      wrong: [{ place: "p2", tokens: 2 }, { place: "Back_p2_1", tokens: 2 }],
      correct: [{ place: "p2", tokens: 2 }, { place: "Back_p2_1", tokens: 1 }, { place: "Right_p2_2" }],
    },
    note: "Check it on the net with the fault injected (see faultTolerance).",
    build(a) {
      const c = (rows: Row[]) => and(rows.map((r) => cond(str(r.place), num(r.tokens))));
      return [{ label: "Correct advice after a wrong one", text: `AG(${c(a.wrong as Row[])} -> EF(${c(a.correct as Row[])}))`, expected: true }];
    },
  },
];

/** The property templates of Konios (2015, §7.1.1, §7.1.2 and §7.3.3), in thesis order. */
export const PROPERTY_TEMPLATES: readonly PropertyTemplate[] = T;

function checkValue(t: PropertyTemplate, f: TemplateField, v: TemplateValue, where: string) {
  const missing = v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
  if (missing) {
    if (f.optional || f.default !== undefined) return;
    throw new TemplateError(t.id, f.name, `${where}${f.label} is required.`);
  }
  switch (f.kind) {
    case "place":
      if (typeof v !== "string" || !v.trim()) throw new TemplateError(t.id, f.name, `${where}${f.label} must be a place name.`);
      break;
    case "places":
      if (!Array.isArray(v) || v.some((x) => typeof x !== "string" || !x.trim())) throw new TemplateError(t.id, f.name, `${where}${f.label} must be a list of place names.`);
      break;
    case "number":
      if (!Number.isInteger(Number(v)) || Number(v) < 0) throw new TemplateError(t.id, f.name, `${where}${f.label} must be a whole number of zero or more.`);
      break;
    case "choice":
      if (!f.options?.includes(String(v))) throw new TemplateError(t.id, f.name, `${where}${f.label} must be one of ${f.options?.join(", ")}.`);
      break;
  }
}

/**
 * Turn a template's arguments into its CTL formula(s). Throws a {@link TemplateError} naming the
 * parameter when an argument is missing or malformed. Place names are not checked against a net
 * here; {@link ctlProblems} does that for the resulting text.
 */
export function instantiateTemplate(id: string, args: TemplateArgs): TemplateFormula[] {
  const t = T.find((x) => x.id === id);
  if (!t) throw new Error(`Unknown property template "${id}".`);
  for (const p of t.params) {
    const v = args[p.name];
    if (p.kind === "rules") {
      if (!Array.isArray(v) || v.length === 0 || typeof v[0] !== "object") throw new TemplateError(t.id, p.name, `${p.label}: add at least one row.`);
      (v as Row[]).forEach((row, i) => {
        for (const f of p.fields) checkValue(t, f, row[f.name], `${p.label}, row ${i + 1}: `);
      });
    } else checkValue(t, p, v as TemplateValue, "");
  }
  return t.build(args);
}
