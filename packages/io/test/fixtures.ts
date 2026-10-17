import { Net, arcKindsFor, emptyNet } from "@pns/core";

export function ptNet(): Net {
  const net = emptyNet("pt", "Producer & <consumer>");
  net.comment = 'A "classic"\nwith two lines';
  net.places = [
    { id: "p1", name: "buffer", x: 100, y: 120.5, marking: "3", capacity: 5 },
    { id: "p2", name: "", x: -40, y: 0, marking: "" },
    { id: "p3", name: "zero", x: 10, y: 20, marking: "0", logical: true, comment: "" },
  ];
  net.transitions = [
    { id: "t1", name: "produce", x: 200, y: 120, horizontal: true, comment: "makes <items> & stuff" },
    { id: "t2", name: "consume", x: 300, y: 120 },
  ];
  net.arcs = [
    { id: "a1", source: "t1", target: "p1", kind: "normal", inscription: "2", points: [{ x: 150, y: 80 }, { x: 120, y: 90.25 }] },
    { id: "a2", source: "p1", target: "t2", kind: "normal", inscription: "1" },
    { id: "a3", source: "p2", target: "t2", kind: "normal", inscription: "" },
    { id: "a4", source: "t2", target: "p3", kind: "normal", inscription: "buffer + 1" },
  ];
  return net;
}

export function xptNet(): Net {
  const net = emptyNet("xpt", "All arc kinds");
  net.places = [
    { id: "p", name: "p", x: 0, y: 0, marking: "2" },
    { id: "q", name: "q", x: 0, y: 100, marking: "" },
  ];
  net.transitions = [{ id: "t", name: "t", x: 100, y: 50 }];
  net.arcs = arcKindsFor("xpt").map((kind, i) => ({
    id: `a_${kind}`,
    source: "p",
    target: "t",
    kind,
    inscription: kind === "reset" ? "" : String(i + 1),
  }));
  net.arcs.push({ id: "out", source: "t", target: "q", kind: "normal", inscription: "1" });
  return net;
}

export function colouredNet(): Net {
  const net = emptyNet("coloured", "Philosophers");
  net.declarations = {
    colourSets: [
      { name: "Dot", type: "dot" },
      { name: "Phil", type: "enum", values: ["ph1", "ph2", "ph3"] },
      { name: "Small", type: "int", min: 0, max: 4 },
      { name: "Pair", type: "product", components: ["Phil", "Small"] },
      { name: "Empty", type: "enum", values: [] },
    ],
    variables: [
      { name: "x", colourSet: "Phil" },
      { name: "n", colourSet: "Small" },
    ],
    constants: [{ name: "first", value: "ph1" }, { name: "lim", value: "2 < 3" }],
  };
  net.places = [
    { id: "think", name: "think", x: 0, y: 0, marking: "all(Phil)", colourSet: "Phil" },
    { id: "eat", name: "eat", x: 0, y: 100, marking: "", colourSet: "Pair", capacity: 1 },
    { id: "token", name: "token", x: 50, y: 50, marking: "1`dot" },
  ];
  net.transitions = [{ id: "go", name: "go", x: 100, y: 50, guard: "x <> first && n < 3" }];
  net.arcs = [
    { id: "a1", source: "think", target: "go", kind: "normal", inscription: "x" },
    { id: "a2", source: "go", target: "eat", kind: "normal", inscription: "1`(x, n) ++ 1`(succ(x), n)" },
    { id: "a3", source: "token", target: "go", kind: "read", inscription: "" },
  ];
  return net;
}
