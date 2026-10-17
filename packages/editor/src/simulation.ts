import { useEffect } from "react";
import { enabledBindings } from "@pns/core";
import { advanceTime, compiled, currentMarking, fireTransition, onFire, timedEnabled, toast, useStore } from "./store";
import { playNote } from "./music";
import { isAmbientNet, stepRandomAmbient } from "./ambient";

/** Fire one enabled transition, chosen uniformly among all enabled bindings. Returns false if dead. */
export function stepRandom(): boolean {
  const s = useStore.getState();
  const M = currentMarking();
  if (!M) return false;
  // Ambient nets fire steps of structured transitions (Konios Sec. 3.3).
  if (isAmbientNet(s.net)) return stepRandomAmbient();
  const ts = s.sim[s.simIndex]?.timed;
  if (ts) {
    // Timed nets: fire something that may fire now, otherwise let time pass until something can.
    const info = timedEnabled(ts);
    if (!info.enabled.length) {
      toast("No transition is enabled: the net is dead in this marking");
      useStore.setState({ running: false });
      return false;
    }
    if (!info.fireable.length) {
      advanceTime(info.minDelay);
      return true;
    }
    const opts = info.fireable.flatMap((t) => t.bindings.map((b) => ({ id: t.id, b })));
    const pick = opts[Math.floor(Math.random() * opts.length)];
    fireTransition(pick.id, pick.b);
    return true;
  }
  const cn = compiled(s.net);
  const options: { id: string; b: Record<string, unknown> }[] = [];
  for (const t of cn.transitions) for (const b of enabledBindings(cn, t.index, M).bindings) options.push({ id: t.id, b });
  if (!options.length) {
    toast("No transition is enabled: the net is dead in this marking");
    useStore.setState({ running: false });
    return false;
  }
  const pick = options[Math.floor(Math.random() * options.length)];
  fireTransition(pick.id, pick.b as never);
  return true;
}

/** Drives the run/pause loop and music playback. Mount once. */
export function useSimulationRunner() {
  const running = useStore((s) => s.running);
  const speed = useStore((s) => s.speed);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      if (useStore.getState().mode !== "simulate" || !stepRandom()) useStore.setState({ running: false });
    }, 1000 / speed);
    return () => clearInterval(id);
  }, [running, speed]);

  useEffect(
    () =>
      onFire((t) => {
        const s = useStore.getState();
        if (s.net.netClass === "music" && s.sound && t.sound?.note) playNote(t.sound.note, t.sound.duration ?? 0.3, t.sound.instrument ?? "piano");
      }),
    [],
  );
}
