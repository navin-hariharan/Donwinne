import { FTNode, FTNodeType, Net, emptyNet } from "@pns/core";

export type NodeSpec = [id: string, type: FTNodeType, extra?: Partial<FTNode>];

/** Build a fault tree net. Edges are [input, gate]; x defaults to the node's index (input order). */
export function tree(nodes: NodeSpec[], edges: [string, string][], netClass: "faultTree" | "extendedFaultTree" = "faultTree"): Net {
  const net = emptyNet(netClass, "test");
  net.faultTree = {
    nodes: nodes.map(([id, type, extra], i) => ({ id, name: id, type, x: i * 10, y: 0, ...extra })),
    edges: edges.map(([source, target], i) => ({ id: `e${i}`, source, target })),
  };
  return net;
}

export const p = (v: number): Partial<FTNode> => ({ probability: String(v) });
export const rate = (l: number, mu?: number): Partial<FTNode> => ({ failureRate: String(l), ...(mu !== undefined ? { repairRate: String(mu) } : {}) });
