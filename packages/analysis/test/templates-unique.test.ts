import { expect, it } from "vitest";
import { PROPERTY_TEMPLATES } from "@pns/analysis";

it("no property template declares the same parameter twice (regression)", () => {
  for (const t of PROPERTY_TEMPLATES) {
    const ids = t.params.map((p) => p.name);
    expect(ids, t.id).toEqual([...new Set(ids)]);
  }
});
