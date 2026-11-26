// The two case studies of Khan, Konios and Guelfi, "A Survey of Petri Nets Slicing", ACM Computing
// Surveys 51(5), 2018, Sec. 7.1: the insurance claim system (Fig. 2(a), non-strongly connected) and
// the WSU-CASAS smart apartment (Fig. 21, strongly connected but for its exit place). Both are
// transcribed from the figures; see docs/slicing.md, "Survey case studies", for what was uncertain.

import type { Arc, Net, Place, Transition } from "@pns/core";

const decl = () => ({ colourSets: [], variables: [], constants: [] });

// ---------------------------------------------------------------------------------------------
// Insurance claim system (survey Sec. 2 and 7.1.2, Fig. 2(a)).

/** The survey's properties of the insurance claim system (Sec. 2 and 7.1.2), in Charlie syntax. */
export const INSURANCE_PROPERTIES = {
  /** φ1 = AG(ac ⇒ AF cs): every accepted claim is settled. Criterion {ac, cs}. */
  phi1: "AG(ac -> AF(cs))",
  /** φ2 = AG(|ac| ≤ 50): at most 50 accepted claims at a time. Criterion {ac}. */
  phi2: "AG(ac <= 50)",
};

/** Survey Fig. 2(a). Unlabelled places and transitions of the figure got descriptive names. */
export function insuranceClaim(): Net {
  // Positions follow the figure (pixel positions of a 330 dpi rendering, scaled by 0.8).
  const at = (x: number, y: number) => ({ x: Math.round(x * 0.8 + 20), y: Math.round(y * 0.8 + 20) });
  const P = (name: string, x: number, y: number, marking = "", color?: string): Place => ({ id: name, name, ...at(x, y), marking, ...(color ? { color } : {}) });
  const T = (name: string, x: number, y: number): Transition => ({ id: name, name, ...at(x, y) });
  const places = [
    P("claim", 390, 65, "1"),
    P("recorded", 390, 252),
    P("customer", 250, 340, "1"),
    P("ac", 390, 422, "", "#86efac"),
    P("to_assess", 290, 500),
    P("with_expert", 185, 590),
    P("assessed", 290, 678),
    P("offered", 390, 790),
    P("cs", 500, 883, "", "#86efac"),
    P("rejected", 390, 975),
    P("in_court", 500, 1075),
    P("paid", 735, 883),
    P("emergency_check", 608, 500),
    P("in_emergency", 735, 590),
    P("emergency_done", 608, 678),
    P("end", 850, 790),
  ];
  const transitions = [
    T("record", 390, 160),
    T("reject", 640, 252),
    T("accept", 390, 340),
    T("handle", 390, 500),
    T("consult_expert", 185, 500),
    T("assess_by_expert", 185, 678),
    T("assess_directly", 290, 590),
    T("offer", 390, 678),
    T("accept_offer", 500, 790),
    T("reject_offer", 390, 885),
    T("revise", 290, 975),
    T("go_legal", 390, 1075),
    T("legal_proceedings", 500, 975),
    T("pay", 608, 883),
    T("emergency_measure", 735, 500),
    T("no_emergency", 608, 590),
    T("end_emergency", 735, 678),
    T("close", 735, 790),
  ];
  const flow: [string, string][] = [
    ["claim", "record"], ["record", "recorded"],
    ["recorded", "reject"],
    ["recorded", "accept"], ["customer", "accept"], ["accept", "ac"],
    ["ac", "handle"], ["handle", "to_assess"], ["handle", "emergency_check"],
    ["to_assess", "consult_expert"], ["consult_expert", "with_expert"], ["with_expert", "assess_by_expert"], ["assess_by_expert", "assessed"],
    ["to_assess", "assess_directly"], ["assess_directly", "assessed"],
    ["assessed", "offer"], ["offer", "offered"],
    ["offered", "accept_offer"], ["accept_offer", "cs"],
    ["offered", "reject_offer"], ["reject_offer", "rejected"],
    ["rejected", "revise"], ["revise", "assessed"],
    ["rejected", "go_legal"], ["go_legal", "in_court"], ["in_court", "legal_proceedings"], ["legal_proceedings", "cs"],
    ["cs", "pay"], ["pay", "paid"],
    ["emergency_check", "emergency_measure"], ["emergency_measure", "in_emergency"], ["in_emergency", "end_emergency"], ["end_emergency", "emergency_done"],
    ["emergency_check", "no_emergency"], ["no_emergency", "emergency_done"],
    ["emergency_done", "close"], ["paid", "close"], ["close", "end"],
  ];
  const arcs: Arc[] = flow.map(([source, target], i) => ({ id: `i${i + 1}`, source, target, kind: "normal", inscription: "1" }));
  return {
    format: "pns/1",
    name: "Insurance claim system",
    netClass: "pt",
    comment:
      "Khan, Konios and Guelfi, A Survey of Petri Nets Slicing (ACM Computing Surveys 51(5), 2018), Fig. 2(a) and Sec. 7.1.2: a claim is recorded, then rejected or accepted; " +
      "an accepted claim (ac) is assessed, directly or by an expert, while a parallel branch handles emergency measures. The customer accepts the offer, or it is revised or goes to " +
      "legal proceedings, until the claim is settled (cs), paid and closed. Properties: φ1 = AG(ac -> AF(cs)) (criterion {ac, cs}; Fig. 2(b) is its slice) and " +
      "φ2 = AG(ac <= 50) (criterion {ac}). Unlabelled nodes of the figure got descriptive names; the offer's accept is accept_offer.",
    places,
    transitions,
    arcs,
    declarations: decl(),
  };
}

// ---------------------------------------------------------------------------------------------
// WSU-CASAS smart apartment (survey Sec. 7.1.1, Fig. 21).

/** The survey's properties of the CASAS apartment (Sec. 7.1.1), in Charlie syntax (a bare place means "marked"). */
export const CASAS_PROPERTIES = {
  /** φ1 = EF((M016 ∨ M017 ∨ M018) ⇒ (D007 ∨ D014 ∨ D015 ∨ D016)), as printed (with ⇒). */
  phi1: "EF((M016 | M017 | M018) -> (D007 | D014 | D015 | D016))",
  /** φ2 = AG(¬((A002_hot_tap ∨ A002_cold_tap) ∧ A001_Stove)): never the tap and the stove at once. */
  phi2: "AG(!((A002_hot_tap | A002_cold_tap) & A001_Stove))",
};

/** Criterion places of φ1 and φ2 (the places the formulas mention). */
export const CASAS_CRITERIA = {
  phi1: ["M016", "M017", "M018", "D007", "D014", "D015", "D016"],
  phi2: ["A002_hot_tap", "A002_cold_tap", "A001_Stove"],
};

/**
 * Place centres in pixels of the figure's embedded image (2793 x 3961). Motion sensors M0xx, door
 * sensors D0xx, the refrigerator R001, the stove A001 and the taps A002.
 */
const CASAS_PLACES: Record<string, [number, number]> = {
  M004: [410, 425], M005: [975, 425], M011: [1535, 425], M012: [2085, 445], D002: [2085, 130],
  M003: [410, 780], M006: [975, 780], M010: [1535, 775], M013: [2085, 795],
  D013: [105, 1210], M002: [410, 1205], M007: [975, 1200], M009: [1535, 1200], M014: [2085, 1220],
  M001: [690, 1635], M008: [1245, 1545], M015: [1818, 1505],
  D008: [1395, 1760], M016: [1818, 1830], D016: [2245, 1830],
  M023: [690, 1980], D012: [1155, 1980], D009: [1395, 1970], A001_Stove: [2245, 2025],
  M022: [690, 2320], D010: [1395, 2245], M017: [1818, 2245], D007: [2245, 2245],
  R001: [1395, 2385], D014: [2245, 2435],
  M026: [200, 2670], M021: [695, 2700], M019: [1395, 2715], M018: [1818, 2715], A002_hot_tap: [2245, 2620],
  A002_cold_tap: [2245, 2785], D015: [2245, 2960],
  M020: [1395, 3080], M025: [200, 3100], M024: [700, 3105], M051: [1818, 3150], D011: [2245, 3150],
  D001: [695, 3500], Outside_Entering: [555, 3885], Outside_exiting: [790, 3885],
};

/** Each pair joins two places with a transition in each direction, named as in the figure (M1M2: M001 to M002). */
const CASAS_LINKS: [string, string, string, string][] = [
  // [place a, place b, transition a→b, transition b→a]
  ["M004", "M003", "M4M3", "M3M4"],
  ["M005", "M004", "M5M4", "M4M5"],
  ["M011", "M005", "M11M5", "M5M11"],
  ["M005", "M006", "M5M6", "M6M5"],
  ["M012", "M011", "M12M11", "M11M12"],
  ["M011", "M010", "M11M10", "M10M11"],
  ["D002", "M012", "D2M12", "M12D2"],
  ["M012", "M013", "M12M13", "M13M12"],
  ["M006", "M003", "M6M3", "M3M6"],
  ["M003", "M002", "M3M2", "M2M3"],
  ["M006", "M007", "M6M7", "M7M6"],
  ["M010", "M006", "M10M6", "M6M10"],
  ["M013", "M010", "M13M10", "M10M13"],
  ["M010", "M009", "M10M9", "M9M10"],
  ["M013", "M014", "M13M14", "M14M13"],
  ["M002", "D013", "M2D13", "D13M2"],
  ["M007", "M002", "M7M2", "M2M7"],
  ["M009", "M007", "M9M7", "M7M9"],
  ["M014", "M009", "M14M9", "M9M14"],
  ["M001", "M002", "M1M2", "M2M1"],
  ["M007", "M008", "M7M8", "M8M7"],
  ["M009", "M008", "M9M8", "M8M9"],
  ["M008", "M001", "M8M1", "M1M8"],
  ["M014", "M015", "M14M15", "M15M14"],
  ["M015", "M008", "M15M8", "M8M15"],
  ["M015", "M016", "M15M16", "M16M15"],
  ["M001", "M023", "M1M23", "M23M1"],
  ["M023", "D012", "M23D12", "D12M23"],
  ["M023", "M022", "M23M22", "M22M23"],
  ["M022", "M021", "M22M21", "M21M22"],
  ["M019", "M021", "M19M21", "M21M19"],
  ["M021", "M024", "M21M24", "M24M21"],
  ["M024", "M025", "M24M25", "M25M24"],
  ["M025", "M026", "M25M26", "M26M25"],
  ["M024", "D001", "M24D1", "D1M24"],
  ["M019", "M020", "M19M20", "M20M19"],
  ["M018", "M019", "M18M19", "M19M18"],
  ["M016", "D008", "M16D8", "D8M16"],
  ["M016", "D009", "M16D9", "D9M16"],
  ["M016", "D016", "M16D16", "D16M16"],
  ["M016", "M017", "M16M17", "M17M16"],
  ["D010", "M017", "D10M17", "M17D10"],
  ["M017", "R001", "M17R1", "R1M17"],
  ["M017", "A001_Stove", "M17A1", "A1M17"],
  ["M017", "D007", "M17D7", "D7M17"],
  ["M017", "M018", "M17M18", "M18M17"],
  ["M018", "D014", "M18D14", "D14M18"],
  ["M018", "A002_hot_tap", "M18A2H", "A2HM18"],
  ["M018", "A002_cold_tap", "M18A2C", "A2CM18"],
  ["M018", "D015", "M18D15", "D15M18"],
  ["M018", "M051", "M18M51", "M51M18"],
  ["M051", "D011", "M51D11", "D11M51"],
];

/**
 * The kitchen's sensors fan out from M016-M018 and M051; their transitions stand in two columns, as
 * in the figure (same pixel coordinates as {@link CASAS_PLACES}). Every other pair of transitions
 * sits across the middle of its link.
 */
const CASAS_TRANSITIONS: Record<string, [number, number]> = {
  M16D8: [1605, 1760], D8M16: [1605, 1845], M16D9: [1605, 1970], D9M16: [1605, 2060],
  D10M17: [1605, 2150], M17D10: [1605, 2245], M17R1: [1605, 2385], R1M17: [1605, 2475],
  M16D16: [2025, 1830], D16M16: [2025, 1920], M17A1: [2025, 2025], A1M17: [2025, 2120],
  M17D7: [2025, 2245], D7M17: [2025, 2340], M18D14: [2025, 2435], D14M18: [2025, 2535],
  M18A2H: [2025, 2620], A2HM18: [2025, 2705], M18A2C: [2025, 2785], A2CM18: [2025, 2865],
  M18D15: [2025, 2960], D15M18: [2025, 3055], M51D11: [2025, 3150], D11M51: [2025, 3245],
};

/** Survey Fig. 21: 45 places, 106 transitions, one resident (the token in Outside_Entering). */
export function casasApartment(): Net {
  const S = 0.42; // figure pixels to canvas units
  const places: Place[] = Object.entries(CASAS_PLACES).map(([name, [x, y]]) => ({
    id: name,
    name,
    x: Math.round(x * S + 20),
    y: Math.round(y * S + 20),
    marking: name === "Outside_Entering" ? "1" : "",
    ...(/^D/.test(name) ? { color: "#fde68a" } : /^A/.test(name) ? { color: "#fecaca" } : name === "R001" ? { color: "#bfdbfe" } : {}),
  }));
  const pos = (p: string) => places.find((q) => q.name === p)!;
  const transitions: Transition[] = [];
  const arcs: Arc[] = [];
  const arc = (source: string, target: string) => arcs.push({ id: `c${arcs.length + 1}`, source, target, kind: "normal", inscription: "1" });
  for (const [a, b, ab, ba] of CASAS_LINKS) {
    const A = pos(a), B = pos(b);
    const dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy);
    // The two transitions of a pair sit side by side across the link, as in the figure.
    const ox = (-dy / len) * 20, oy = (dx / len) * 20;
    const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
    const place = (name: string, x: number, y: number): Transition => {
      const fixed = CASAS_TRANSITIONS[name];
      return fixed ? { id: name, name, x: Math.round(fixed[0] * S + 20), y: Math.round(fixed[1] * S + 20) } : { id: name, name, x: Math.round(x), y: Math.round(y) };
    };
    transitions.push(place(ab, mx + ox, my + oy), place(ba, mx - ox, my - oy));
    arc(a, ab), arc(ab, b), arc(b, ba), arc(ba, a);
  }
  const ent = pos("Outside_Entering"), ext = pos("Outside_exiting"), d1 = pos("D001");
  transitions.push({ id: "Entering", name: "Entering", x: ent.x + 10, y: Math.round((ent.y + d1.y) / 2) });
  transitions.push({ id: "Exiting", name: "Exiting", x: ext.x, y: Math.round((ext.y + d1.y) / 2) });
  arc("Outside_Entering", "Entering"), arc("Entering", "D001"), arc("D001", "Exiting"), arc("Exiting", "Outside_exiting");
  return {
    format: "pns/1",
    name: "WSU-CASAS smart apartment",
    netClass: "pt",
    comment:
      "Khan, Konios and Guelfi, A Survey of Petri Nets Slicing (ACM Computing Surveys 51(5), 2018), Fig. 21 and Sec. 7.1.1: the WSU-CASAS smart apartment. " +
      "One resident (the token) moves between motion sensors (M0xx), door sensors (D0xx), the refrigerator (R001), the stove (A001_Stove) and the taps (A002); " +
      "transition MaMb fires when the resident moves from Ma to Mb. Areas: main entrance (D001), entrance hall (M021-M026), storage room (M019, M020), " +
      "kitchen (M016-M018, M051) and living/dining room (the rest). Properties: φ1 = EF((M016 | M017 | M018) -> (D007 | D014 | D015 | D016)) and " +
      "φ2 = AG(!((A002_hot_tap | A002_cold_tap) & A001_Stove)). The item labels of the figure (I001-I012) are notes on the door places, not places.",
    places,
    transitions,
    arcs,
    declarations: decl(),
  };
}
