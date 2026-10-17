import { describe, expect, it } from "vitest";
import { propsDocked, screenClassFor } from "../src/responsive";

describe("screen classes", () => {
  it("treats portrait phones as phones", () => {
    for (const [w, h] of [[320, 568], [360, 740], [390, 844], [414, 896]]) expect(screenClassFor(w, h)).toBe("phone");
  });

  it("treats phones on their side as short screens, even when narrower than a tablet", () => {
    for (const [w, h] of [[568, 320], [740, 360], [844, 390], [896, 414]]) expect(screenClassFor(w, h)).toBe("short");
  });

  it("treats medium widths as tablets and wide screens as desktops", () => {
    expect(screenClassFor(600, 960)).toBe("tablet");
    expect(screenClassFor(768, 1024)).toBe("tablet");
    expect(screenClassFor(820, 1180)).toBe("tablet");
    expect(screenClassFor(1024, 768)).toBe("desktop");
    expect(screenClassFor(2560, 1440)).toBe("desktop");
    expect(screenClassFor(1080, 1920)).toBe("desktop");
  });

  it("gives the desktop app's smallest window the tablet layout", () => {
    expect(screenClassFor(640, 540)).toBe("tablet");
  });

  it("docks the properties panel on desktops only", () => {
    expect(propsDocked("desktop")).toBe(true);
    expect(propsDocked("tablet")).toBe(false);
    expect(propsDocked("phone")).toBe(false);
    expect(propsDocked("short")).toBe(false);
  });
});
