# Donwinne

Donwinne is a Petri nets studio: a Petri net editor and simulator that runs in the browser and as a desktop app (Windows, macOS, Linux).
It covers Snoopy's core modelling features and is being extended with Ambient Petri Nets (Konios, 2015). See [CREDITS.md](CREDITS.md) for the work it builds on.

## What it does

- **Every Snoopy net class:** place/transition, extended (read, inhibitor, reset, equal arcs), coloured, timed, stochastic, continuous, hybrid, their coloured and fuzzy variants, modulo, music and freestyle nets, plus fault trees and extended fault trees.
- **Easy editing:** drag places, transitions, gates and notes from the palette; drag the **+** handle on a node to draw an arc, or drop it on empty space to create and connect the next node; double-click to rename, edit tokens or arc weights in place; right-click for options; drag arc midpoints to bend them and arc ends to reconnect them; colours, alignment and spacing, auto layout (ELK), subnets (group, open, ungroup, breadcrumbs), overview map, find, hover tooltips, unlimited undo, light and dark themes.
- **Running models:**
  - token game for every Petri net class, including the timed token game with clocks and music nets that play notes;
  - simulation over time with plots: Gillespie for stochastic nets, ODE solvers (Dormand–Prince, Rosenbrock, RK4, Euler) for continuous nets, both for hybrid nets, unfolding for coloured nets and bands for fuzzy parameters; CSV export;
  - reachability graph with dead states and bounds;
  - net properties in the style of Charlie: boundedness, liveness, deadlocks (with the shortest path to one), reversibility, home states, P- and T-invariants, siphons and traps, the structural classes (state machine, marked graph, free choice and the rest) and the incidence matrix, each with a **Show** button that highlights the elements involved, and a text report;
  - fault tree analysis: minimal cut and path sets (BDD), exact top event probability, importance measures, reliability curves, Monte Carlo for dynamic gates, conversion to a stochastic Petri net.
- **Files:** native `.pns.json`; Snoopy import and export for all classes; PNML; ANDL/CANDL; export to LoLA, TINA, APNN, PRISM, SBML, CSV, DNF (cut sets), LaTeX/TikZ, SVG and PNG; printing. Work is auto-saved in the browser.
- **Snoopy declarations:** constants, colour sets (including bool, string, alias, subset and union), variables, functions such as `hill(S, K, n) = S^n / (K^n + S^n)`, and observers that plot an expression over the run. Modifier arcs and fixed places for quantitative nets.
- **Ambient Petri Nets (Konios, 2015), every feature of the thesis:**
  - APN and T-APN net classes with colour-sensitive inhibitor arcs, capacities and gluing (interface) places, checked against Defs 3 and 20;
  - step semantics: a step token game (fire single structured transitions, collected steps or maximal steps, with conflicts and the reason a mode is blocked) and the concurrent reachability graph;
  - modelling with building blocks: root nets, basic step nets with control systems and decision points, one step nets, forward and backward composition, and checks for every class of chapter 4 (composite step nets, pure, ordinary, live, k-bounded, reversible);
  - the construction of the T-APN φ(N) from an APN, and a check that the two are behaviourally equivalent, with a replayable counterexample when they are not;
  - verification as in chapter 7: CTL model checking with witnesses and counterexamples you can replay, all 22 ambient and general property templates, the qualitative properties (FT0, TF0, FP0, PF0, k-B, DCF, DSt, DTr), path queries (reaching a goal by following or ignoring advices) and fault tolerance;
  - the thesis's case studies, the ambient garage and the ambient conference room, plus its chapter 3 and 4 figures, under File > Examples. Checked the way the thesis checks them (colour-blind T-APN, one transition at a time), they reproduce every path length of section 7.3 and 30 of the 32 CTL verdicts that could be decided.
- **Every screen and device:** phones (portrait and landscape), tablets, laptops and large monitors, with touch gestures (pinch to zoom, long-press menus, tap-to-place). It installs as an app on phones and tablets and works offline.
- **Element table and hierarchy:** every place, transition and arc in one filterable, editable table, and the subnet tree (View > Element table and hierarchy).
- **Examples:** File > Examples, including the thesis's Fig. 3.1, 4.9, 4.10 and 4.11 nets, the ambient garage and conference room, predator–prey, decay, a traffic light, a music scale and a fault tree.

Snoopy features not covered yet: lookup tables, the Snoopy steering server (S4) and decision-diagram (MTBDD) based analysis. Snoopy import was checked against real P/T, continuous and hybrid files; the other classes, and the newer Snoopy function, observer and colour set formats, follow Snoopy's source code and have not been checked against files Snoopy wrote.

## Running it

Requires Node.js 20+ and pnpm 10 (`npm i -g pnpm`).

```sh
pnpm install
pnpm dev            # web app at http://localhost:5173
pnpm test           # engine and file format tests
pnpm build          # static web build in apps/web/dist (host it anywhere)
pnpm desktop        # build and launch the desktop app
pnpm desktop:dist   # build installers into apps/desktop/release
```

See `apps/desktop/README.md` for per-OS installer notes.

### With Docker

The Docker image builds the web app, runs the tests, and serves it with nginx. You don't need Node.js installed.

```sh
docker build -t donwinne .
docker run --rm -p 8080:80 donwinne   # open http://localhost:8080
# or: docker compose up --build
```

The desktop app isn't part of the image, because Electron needs a desktop session.

## Layout

| Path | What it holds |
| --- | --- |
| `packages/core` | Net model, expression language, firing rules (no UI) |
| `packages/sim` | Stochastic, continuous, hybrid and fuzzy simulation; timed token game; reachability graph |
| `packages/ft` | Fault tree analysis |
| `packages/analysis` | Qualitative analysis: invariants, siphons and traps, structural and behavioural properties; CTL model checking, property templates, paths and fault tolerance |
| `packages/apn` | Ambient Petri Nets: APN and T-APN semantics, steps and the concurrent reachability graph, building blocks and composition, the T-APN construction and equivalence, the case studies |
| `packages/io` | Native JSON, Snoopy, PNML, ANDL and the other exporters |
| `packages/editor` | React editor: canvas, panels, simulator |
| `apps/web` | Vite web shell |
| `apps/desktop` | Electron shell, menus and native file dialogs |

## Keyboard shortcuts

Press **?** in the app for the full list.

| Key | Action |
| --- | --- |
| V, P, T, A, N | Select, place, transition, arc and note tools |
| 1 to 5 | Arc type: normal, read, inhibitor, reset, equal |
| Double-click | Add a place on empty canvas; rename a node; edit tokens inside a place; edit an arc's weight |
| F2 / Enter | Rename the selected node (Enter opens a subnet) |
| + / − | Add or remove a token on the selected places |
| Delete | Delete selection |
| Ctrl/Cmd + Z, Shift + Z | Undo, redo |
| Ctrl/Cmd + C, X, V, D, A | Copy, cut, paste, duplicate, select all |
| Ctrl/Cmd + G, L, F | Group into subnet, auto layout, find |
| Backspace | Leave a subnet (when nothing is selected) |
| Arrows (Shift) | Nudge selection by 1 (10) |
| Space + drag, right-drag | Pan |
| Ctrl/Cmd + wheel | Zoom |
| F, M, G, B | Zoom to fit, overview map, snap to grid, bottom panel |
| S | Start the token game |
| In the token game: ←, →, R, Space, Esc | Back, forward, random firing, run/pause, stop |

## License

Donwinne by Navin Hariharan (https://navin-hariharan.com). Free for educational use with attribution; commercial use needs permission or a licence. See [LICENSE.md](LICENSE.md).
