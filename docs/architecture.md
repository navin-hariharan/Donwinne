# Architecture

This page is for developers: how the code is organised, how a net is represented and fired, how the editor runs
simulations and analyses, how the web and desktop apps are built, and how to extend Donwinne with a new net class or
file format.

## Contents

- [Monorepo layout](#monorepo-layout)
- [Packages and their dependencies](#packages-and-their-dependencies)
- [The engine packages](#the-engine-packages)
- [The net data model](#the-net-data-model)
- [The expression language](#the-expression-language)
- [Firing rules](#firing-rules)
- [The editor](#the-editor)
- [How simulation and analysis run](#how-simulation-and-analysis-run)
- [The web app and offline use](#the-web-app-and-offline-use)
- [The desktop app](#the-desktop-app)
- [Building](#building)
- [Docker](#docker)
- [Testing](#testing)
- [Extending Donwinne](#extending-donwinne)

## Monorepo layout

Donwinne is a TypeScript monorepo managed with **pnpm** workspaces (`packages/*` and `apps/*`). You need Node 20 or
later and pnpm 10.

```
.
├── packages/
│   ├── core/        net model, expression language, multisets, firing rules
│   ├── sim/         simulation engines, unfolding, timed token game, reachability
│   ├── analysis/    structural and behavioural analysis, invariants, CTL, paths, fault tolerance
│   ├── apn/         Ambient Petri nets (Konios 2015): steps, CRG, blocks, composition, T-APN, equivalence
│   ├── ft/          fault trees: cut sets, probabilities, importance, Monte Carlo, translation to Petri nets
│   ├── io/          file formats: native, Snoopy, PNML, ANDL/CANDL, LoLA, TINA, APNN, PRISM, SBML, CSV
│   └── editor/      the React user interface and its Zustand store
├── apps/
│   ├── web/         Vite app: the browser build, PWA service worker
│   └── desktop/     Electron shell around the web build
├── docker/          nginx configuration
├── docs/            this documentation (and the thesis PDF)
├── Dockerfile, docker-compose.yml
├── tsconfig.base.json, tsconfig.json, vitest.config.ts
└── package.json, pnpm-workspace.yaml, pnpm-lock.yaml
```

Every package is private, ships TypeScript sources directly (`"main": "src/index.ts"`) and is imported as
`@pns/<name>`. The aliases are resolved in three places, which must agree:

| File | Used by |
| --- | --- |
| [tsconfig.base.json](../tsconfig.base.json) (`paths`) | The TypeScript compiler and editors |
| [vitest.config.ts](../vitest.config.ts) (`alias`) | The tests |
| [apps/web/vite.config.ts](../apps/web/vite.config.ts) | The web build and dev server |

There is no separate build step for the packages: Vite and Vitest compile them from source.

## Packages and their dependencies

![The packages and how they depend on each other](assets/diagrams/architecture.svg)

| Package | Depends on | Responsibility |
| --- | --- | --- |
| `@pns/core` | nothing | The net model, expressions, multisets, compilation and firing of P/T, extended and coloured nets, APN well-formedness checks |
| `@pns/sim` | core | Quantitative simulation (stochastic, continuous, hybrid, fuzzy), the timed token game, unfolding of coloured nets, reachability graphs |
| `@pns/analysis` | core, sim | Charlie-style analysis (structure, invariants, siphons and traps, behaviour), transition systems, CTL, paths, fault tolerance. It uses `unfold` from sim to read coloured nets |
| `@pns/apn` | core | Konios's Ambient Petri nets: step semantics, CRG, building blocks, composition, T-APN construction, equivalence, case studies |
| `@pns/ft` | core | Fault tree analysis and translation to Petri nets |
| `@pns/io` | core | Reading and writing files |
| `@pns/editor` | core, sim, analysis, apn, ft, io | The user interface |
| `@pns/web` (apps/web) | editor | The browser app |
| `@pns/desktop` (apps/desktop) | electron; the editor's platform types only | The desktop shell |

Two points worth knowing:

- `analysis` and `apn` do not depend on each other. The analysis package reads concurrent reachability graphs
  structurally (through [stepgraph.ts](../packages/analysis/src/stepgraph.ts)), and the editor connects the two.
- The editor's `package.json` lists only `@pns/analysis` and `@pns/apn` as dependencies, but its code imports all six
  engine packages; the path aliases make that work.

## The engine packages

### core

| Module | Contents |
| --- | --- |
| [model.ts](../packages/core/src/model.ts) | The `Net` type and its parts, the 23 net classes, class groups (`COLOURED_CLASSES`, `AMBIENT_CLASSES`, `QUANTITATIVE_CLASSES`, `FAULT_TREE_CLASSES`), `arcKindsFor`, `timeBase`, `NET_CLASS_LABELS` |
| [expr.ts](../packages/core/src/expr.ts) | The expression language: parser and evaluator |
| [multiset.ts](../packages/core/src/multiset.ts) | An immutable `Multiset` of colour values |
| [semantics.ts](../packages/core/src/semantics.ts) | Declarations, colour domains, `compile()` to a `CompiledNet`, binding enumeration, enabledness and firing |
| [ambient.ts](../packages/core/src/ambient.ts) | APN helpers: arc variables, complementary colours, per-colour capacities, `ambientProblems` |

### sim

| Module | Contents |
| --- | --- |
| [simulate.ts](../packages/sim/src/simulate.ts) | `simulate`, `simulateAsync` (time-sliced), runs, averaging, fuzzy alpha cuts |
| [engine.ts](../packages/sim/src/engine.ts) | One run: Gillespie's direct method for stochastic transitions, discrete events for immediate, deterministic and scheduled transitions, an ODE solver for continuous ones; hybrid nets integrate the stochastic hazard along with the ODEs |
| [model.ts](../packages/sim/src/model.ts), [rates.ts](../packages/sim/src/rates.ts) | The simulation model and rate functions (`MassAction`, `MichaelisMenten` and others) |
| [ode.ts](../packages/sim/src/ode.ts) | ODE solvers |
| [prng.ts](../packages/sim/src/prng.ts) | Mersenne Twister |
| [timed.ts](../packages/sim/src/timed.ts) | The timed token game |
| [unfold.ts](../packages/sim/src/unfold.ts) | Unfolding coloured nets to uncoloured ones |
| [reachability.ts](../packages/sim/src/reachability.ts) | Reachability graphs by breadth-first search over the core firing rule |
| [csv.ts](../packages/sim/src/csv.ts) | Trace export |

### analysis

| Module | Contents |
| --- | --- |
| [ptnet.ts](../packages/analysis/src/ptnet.ts) | `toPTNet`: the unfolded P/T view every analysis works on, with names mapping back to the coloured elements |
| [analyse.ts](../packages/analysis/src/analyse.ts) | `analyseNet`: one report with every property and a readable summary |
| [structure.ts](../packages/analysis/src/structure.ts), [invariants.ts](../packages/analysis/src/invariants.ts), [siphons.ts](../packages/analysis/src/siphons.ts) | Structural properties, P/T-invariants (Farkas), siphons and traps |
| [statespace.ts](../packages/analysis/src/statespace.ts), [behaviour.ts](../packages/analysis/src/behaviour.ts) | State space exploration, Karp-Miller coverability, behavioural properties |
| [ts.ts](../packages/analysis/src/ts.ts), [stepgraph.ts](../packages/analysis/src/stepgraph.ts), [projection.ts](../packages/analysis/src/projection.ts), [steps.ts](../packages/analysis/src/steps.ts) | Transition systems for model checking: interleaving, step graphs, the colour-blind projection |
| [ctl.ts](../packages/analysis/src/ctl.ts), [check.ts](../packages/analysis/src/check.ts), [templates.ts](../packages/analysis/src/templates.ts) | CTL parser, checker and property templates (see [CTL model checking](ctl.md)) |
| [paths.ts](../packages/analysis/src/paths.ts), [fault.ts](../packages/analysis/src/fault.ts) | Path queries and fault tolerance |

### apn

| Module | Contents |
| --- | --- |
| [semantics.ts](../packages/apn/src/semantics.ts) | `compileAmbient`, `asAmbient`: an APN or T-APN read as structured places and transitions |
| [steps.ts](../packages/apn/src/steps.ts), [crg.ts](../packages/apn/src/crg.ts) | Step semantics, conflicts, the concurrent reachability graph |
| [blocks.ts](../packages/apn/src/blocks.ts), [compose.ts](../packages/apn/src/compose.ts) | Building blocks, forward and backward composition, class checks |
| [model-properties.ts](../packages/apn/src/model-properties.ts), [model-structure.ts](../packages/apn/src/model-structure.ts), [model-layout.ts](../packages/apn/src/model-layout.ts) | Properties of Sec. 4.4, structure reading, layout of composed nets |
| [tapn.ts](../packages/apn/src/tapn.ts), [construction.ts](../packages/apn/src/construction.ts), [equivalence.ts](../packages/apn/src/equivalence.ts) | The T-APN tuple, the construction φ, the equivalence check |
| [validate.ts](../packages/apn/src/validate.ts) | `validateAmbient` |
| [cases.ts](../packages/apn/src/cases.ts), [model-figures.ts](../packages/apn/src/model-figures.ts), [sem-examples.ts](../packages/apn/src/sem-examples.ts) | The thesis's case studies and figures |

The [Ambient Petri nets](ambient-petri-nets.md) page explains these in depth.

### ft and io

| Package | Modules |
| --- | --- |
| ft | [structure.ts](../packages/ft/src/structure.ts) (validation), [bdd.ts](../packages/ft/src/bdd.ts) (BDD and ZDD cut sets), [analysis.ts](../packages/ft/src/analysis.ts) (probability, importance, reliability curves), [montecarlo.ts](../packages/ft/src/montecarlo.ts), [topn.ts](../packages/ft/src/topn.ts) (fault tree to Petri net), [dnf.ts](../packages/ft/src/dnf.ts), [layout.ts](../packages/ft/src/layout.ts) |
| io | [native.ts](../packages/io/src/native.ts) (`.pns.json`: `parseNet`, `serializeNet`, `validateNet`), [snoopy.ts](../packages/io/src/snoopy.ts), [pnml-import.ts](../packages/io/src/pnml-import.ts) and [pnml-export.ts](../packages/io/src/pnml-export.ts), [andl.ts](../packages/io/src/andl.ts) (ANDL and CANDL), [lola.ts](../packages/io/src/lola.ts), [tina.ts](../packages/io/src/tina.ts), [apnn.ts](../packages/io/src/apnn.ts), [prism.ts](../packages/io/src/prism.ts), [sbml.ts](../packages/io/src/sbml.ts), [csv.ts](../packages/io/src/csv.ts), [xml.ts](../packages/io/src/xml.ts) (using `@xmldom/xmldom`) |

## The net data model

A model is one plain JSON object of type `Net` ([model.ts](../packages/core/src/model.ts)). It is what the editor
edits, what the undo history stores, and what the native `.pns.json` file contains.

| Field | Contents |
| --- | --- |
| `format` | Always `"pns/1"` |
| `name`, `comment` | The model's name and description |
| `netClass` | One of 23 classes, for example `"pt"`, `"coloured"`, `"stochastic"`, `"apn"`, `"tapn"`, `"faultTree"` |
| `places` | `Place[]` |
| `transitions` | `Transition[]` |
| `arcs` | `Arc[]` |
| `declarations` | Colour sets, variables, constants, functions and observers |
| `modulus` | For modulo nets: token counts wrap at this value |
| `faultTree` | For fault tree classes: nodes and edges |
| `notes` | Free text notes on the canvas |

The parts:

| Type | Main fields |
| --- | --- |
| `Place` | `id`, `name`, `x`, `y`, `marking` (an expression, such as `3` or `2\`a ++ b`), `capacity`, `colourSet`, `logical` (fusion), `continuous`, `fixed`, `gluing` (APN interface place), `parent` (subnet), `coarse`, `color`, `labelOffset`, `comment` |
| `Transition` | `id`, `name`, `x`, `y`, `guard`, `kind` (stochastic, immediate, deterministic, scheduled, continuous), `rate`, `interval` (timed nets), `sound` (music nets), `parent`, `coarse`, `color`, `labelOffset`, `comment` |
| `Arc` | `id`, `source`, `target`, `kind` (normal, read, inhibitor, reset, equal, modifier), `inscription`, `points` (bends), `color` |
| `ColourSetDecl` | `name`, `type` (dot, enum, int, bool, string, product, union, alias, subset), `values`, `min`, `max`, `components`, `predicate`, and `complementOf` for T-APNs |

Which arc kinds a class allows is given by `arcKindsFor`: for example, P/T nets, T-APNs and fault trees allow only
normal arcs, and APNs allow normal and inhibitor arcs.

Subnets are not separate objects: a node's `parent` names the coarse node it belongs to, and the editor shows one
page at a time.

## The expression language

Markings, arc inscriptions, guards, weights and rates are all written in one small language
([expr.ts](../packages/core/src/expr.ts)):

| Construct | Syntax |
| --- | --- |
| Multisets | `2\`a ++ b ++ (1,red)`: `++` joins, `` ` `` gives a coefficient |
| Logic | `or` `\|\|` `\|`, `and` `&&` `&`, `not` `!` |
| Comparison | `=` `==` `<>` `!=` `<` `<=` `>` `>=` |
| Arithmetic | `+` `-` `*` `/` `%`, unary `-`, `^` (right-associative) |
| Values | numbers, names (constants, variables, colours), tuples `(a, b)`, `true`, `false` |
| Calls | built-in and user functions: `min`, `max`, `abs`, `pow`, `sqrt`, `exp`, `log`, `ln`, `log10`, `log2`, `floor`, `ceil`, `round`, `div`, `sqr`, trigonometric and hyperbolic functions, `sign`, `empty` |

Colour and rate helpers known to the semantics include `all`, `succ`, `pred`, and the rate functions `MassAction`,
`BioMassAction`, `BioLevelInterpretation`, `MichaelisMenten`, `ImmediateFiring`, `TimedFiring`,
`FixedTimedFiring_Single`, `FixedTimedFiring_Periodic`, `binomial`, `TFN` and `TZN`. User functions may call each
other; recursion is stopped at a call depth of 64.

## Firing rules

[semantics.ts](../packages/core/src/semantics.ts) has one firing rule for every discrete class. **Every place holds a
multiset.** In P/T and extended nets every token has the colour `dot`, so "3 tokens" is `3\`dot`.

`compile(net)` turns a `Net` into a `CompiledNet`: declarations resolved, colour domains built, expressions parsed,
arcs indexed. The editor caches the compiled net per `Net` object in a `WeakMap`, so it is built once per edit.

A transition with a binding (values for its variables) is **enabled** when:

| Rule | Condition |
| --- | --- |
| Guard | The guard evaluates to true |
| Normal arc | The place holds the arc's multiset; firing consumes it |
| Read arc | The place holds at least the multiset; nothing is consumed |
| Inhibitor arc | Blocks if, for some colour *c* on the arc, the place holds at least that many tokens of *c* (in P/T terms: at least the weight) |
| Equal arc | The place holds exactly the multiset |
| Reset arc | Always allows firing; firing empties the place |
| Modifier arc | Ignored by the firing rule (it only feeds rates) |
| Colour sets | Every output token must belong to the target place's colour set |
| Capacity | Checked after firing: total tokens for P/T places, tokens of each colour for coloured places |
| Modulo nets | Token counts wrap at the modulus |

Binding enumeration is capped at 10,000 bindings per transition, and colour domains at 100,000 values.

APNs and T-APNs fire by **steps** instead (several structured transitions together), in
[apn/src/steps.ts](../packages/apn/src/steps.ts). In an APN, each place has a default capacity of 1 per colour. See
[step semantics](ambient-petri-nets.md#step-semantics-and-the-step-token-game).

## The editor

The editor package is a React 18 application whose state lives in one **Zustand** store,
[store.ts](../packages/editor/src/store.ts) (`useStore`).

### The store

| State | Purpose |
| --- | --- |
| `net` | The current model |
| `filePath`, `fileName`, `fileHandle`, `dirty` | The open file (a path in the desktop app, a File System Access handle in browsers that have it) and unsaved changes |
| `past`, `future` | Undo and redo stacks: up to 300 nets; edits of the same kind within 1.5 seconds are merged into one |
| `selection`, `tool`, `arcKind`, `snapToGrid`, `view`, `page` | Editing state: selected elements, the active tool, zoom and pan, the subnet shown |
| `mode` | `"edit"` or `"simulate"` |
| `sim`, `simIndex`, `running`, `speed` | The token game history, the current position, and the run state (firings per second) |
| `dialog`, `panel`, `bottomOpen`, `toast`, … | Which dialog and bottom panel are open, messages |
| `theme` | `"light"`, `"dark"` or `"system"` |

Rules of the store:

- All model changes go through `edit(fn)`, which records undo history and sets `dirty`.
- The model is autosaved to `localStorage` under `pns.autosave.v1` (debounced by 400 ms); preferences are kept under
  `pns.prefs.v1`.
- `startSimulation` refuses to start while the model has errors and opens the Problems panel instead.
- Ambient nets have a second small store, `useAmbient` in [ambient.ts](../packages/editor/src/ambient.ts), for the
  step being collected, the maximal toggle, the step picker and the last T-APN construction.

### Main modules

| Module | Role |
| --- | --- |
| [App.tsx](../packages/editor/src/App.tsx) | Layout, keyboard shortcuts, `runCommand` for menu commands from the desktop shell |
| [Toolbar.tsx](../packages/editor/src/Toolbar.tsx) | Menu bar (File, Edit, View, Analyse, Help), net class switcher, simulation bar |
| [Canvas.tsx](../packages/editor/src/Canvas.tsx), [NetDrawing.tsx](../packages/editor/src/NetDrawing.tsx), [Minimap.tsx](../packages/editor/src/Minimap.tsx), [InlineEditor.tsx](../packages/editor/src/InlineEditor.tsx), [ContextMenu.tsx](../packages/editor/src/ContextMenu.tsx) | Drawing and editing the net |
| [PropertiesPanel.tsx](../packages/editor/src/PropertiesPanel.tsx), [PropsSheet.tsx](../packages/editor/src/PropsSheet.tsx), [Elements.tsx](../packages/editor/src/Elements.tsx) | Properties of the selection, the element table |
| [BottomPanel.tsx](../packages/editor/src/BottomPanel.tsx), [Plot.tsx](../packages/editor/src/Plot.tsx), [AmbientSim.tsx](../packages/editor/src/AmbientSim.tsx) | Problems, simulation history, plots, fault tree results, the step token game |
| [Dialogs.tsx](../packages/editor/src/Dialogs.tsx), [Analysis.tsx](../packages/editor/src/Analysis.tsx), [AmbientDialogs.tsx](../packages/editor/src/AmbientDialogs.tsx), [CtlDialog.tsx](../packages/editor/src/CtlDialog.tsx), [RGGraph.tsx](../packages/editor/src/RGGraph.tsx) | Dialogs: new model, help, search, reachability graph (and its drawing), net properties, the ambient dialogs, model checking |
| [simulation.ts](../packages/editor/src/simulation.ts), [ambient.ts](../packages/editor/src/ambient.ts), [ctl.ts](../packages/editor/src/ctl.ts), [trail.ts](../packages/editor/src/trail.ts) | Token game logic, step token game logic, state spaces for model checking, the red token trail |
| [fileOps.ts](../packages/editor/src/fileOps.ts), [examples.ts](../packages/editor/src/examples.ts), [rgExport.ts](../packages/editor/src/rgExport.ts), [watermark.ts](../packages/editor/src/watermark.ts), [version.ts](../packages/editor/src/version.ts) | Open, save, import, export, print; the example models; reachability graph export; the "Exported from Donwinne" mark; the app version |
| [layout.ts](../packages/editor/src/layout.ts), [geometry.ts](../packages/editor/src/geometry.ts), [responsive.ts](../packages/editor/src/responsive.ts), [music.ts](../packages/editor/src/music.ts) | Auto layout (elkjs), geometry, phone and tablet layouts, sound for music nets |
| [platform.ts](../packages/editor/src/platform.ts) | The `DesktopBridge` interface, the `MenuCommand` union and `desktop()` |
| [styles.css](../packages/editor/src/styles.css) | All styles, with light and dark themes |

## How simulation and analysis run

Everything runs in the page's main thread; there are no Web Workers. Long computations stay responsive by yielding to
the browser and can be stopped with an `AbortController` (the **Stop** buttons).

| Task | How it runs |
| --- | --- |
| Token game run | `setInterval` at the chosen speed (1 to 30 firings per second), one firing (or step) per tick ([simulation.ts](../packages/editor/src/simulation.ts)) |
| Simulation plots | `simulateAsync` works in time slices of 20 ms and reports progress ([BottomPanel.tsx](../packages/editor/src/BottomPanel.tsx)) |
| Concurrent reachability graph | `concurrentReachabilityGraphAsync` yields every 40 states and reports states and edges |
| Net properties, reachability graph, interleaving state spaces, equivalence | Start after a short `setTimeout` (30 to 40 ms) so the dialog can show its progress line, then run to the end or to their limits |

Every exploration has limits (states, edges, steps per state), and results say when a limit was reached: "Partial",
"cut off", or an **Unknown** verdict. See the limits on the [CTL page](ctl.md#settings-semantics-limits-and-dead-markings).

## The web app and offline use

[apps/web](../apps/web) is a small Vite app: [main.tsx](../apps/web/src/main.tsx) renders the editor's `App`, adds a
`structuredClone` fallback for older browsers, and in development exposes the store as `window.pns` for debugging.

[vite.config.ts](../apps/web/vite.config.ts):

- `base: "./"`, so the build works from any folder (and inside the desktop app);
- targets ES2020, Safari 14, Chrome 87, Firefox 78 and Edge 88; source maps on; dev server on port 5173;
- the `offlineCache` plugin writes the list of built files and a version (the first 16 hex digits of a SHA-256 of the
  build) into `dist/sw.js` after the build.

The **service worker** ([public/sw.js](../apps/web/public/sw.js)) makes Donwinne work offline:

- it caches the whole build under `donwinne-<version>` and deletes old caches when a new version activates;
- page loads are network first, with a 4-second timeout, falling back to the cached `index.html`;
- other requests are cache first.

[registerServiceWorker.ts](../apps/web/src/registerServiceWorker.ts) registers it only over http(s), outside the
desktop app and not in development. When a new version is installed, a message says "A new version of Donwinne is
ready. Click here to reload."; clicking it activates the new worker.

The [web manifest](../apps/web/public/manifest.webmanifest) makes the app installable (standalone display, icons of
192 and 512 pixels and a maskable icon). [index.html](../apps/web/index.html) sets a strict Content Security Policy.

## The desktop app

[apps/desktop](../apps/desktop) wraps the web build in **Electron**.

### Main process

[src/main.ts](../apps/desktop/src/main.ts):

- one window of 1400 by 900 (at least 640 by 540), with `contextIsolation`, `sandbox` and no `nodeIntegration`;
- a single-instance lock: opening a file while the app runs passes it to the running window;
- it loads `PNS_DEV_URL` when that environment variable is set (to use the Vite dev server), the packaged
  `resources/web/index.html` in an installed app, and `apps/web/dist` in development;
- files are opened from the command line, from macOS "open file" events, or from a second instance. It accepts
  `.pns.json` and the Snoopy, PNML, ANDL and CANDL extensions;
- saves without a dialog go only to paths the user opened or chose in a dialog;
- closing with unsaved changes asks first ("Discard changes" or "Cancel");
- links open in the system browser, and only for http, https and mailto;
- the native menus: File (including "New APN from Building Blocks…", "Import (Snoopy, PNML, ANDL)…" and an "Export As"
  submenu), Edit, View, Analyse (with "Model Checking (CTL)…", "Unfold to an Uncoloured Net" and an "Ambient (Konios)"
  submenu) and Help. Each item sends a `MenuCommand` to the page.

### Preload and IPC

[src/preload.ts](../apps/desktop/src/preload.ts) uses `contextBridge` to expose `window.pnsDesktop`, the
`DesktopBridge` of [platform.ts](../packages/editor/src/platform.ts):

| Method | Purpose |
| --- | --- |
| `openFile(filters)` | Native open dialog; returns the file's text |
| `saveFile(path, content, name, filters)` | Save to a known path, or show a save dialog |
| `exportFile(name, data, filters)` | Save dialog for exports (text or binary) |
| `onMenu(cb)` | Receive menu commands |
| `setDirty(dirty)`, `setTitle(title)` | Keep the window title and the close check in step with the editor |
| `onOpenPath(cb)` | Files handed over by the operating system |

When a text field has focus, Edit menu commands (undo, redo, delete, select all) go to the field's native editing
instead of the net. The channel names (`pns:open-file`, `pns:save-file`, `pns:export-file`, `pns:menu` and others)
are in [src/ipc.ts](../apps/desktop/src/ipc.ts). The editor calls `desktop()` to find the bridge, and falls back to
browser downloads and the File System Access API when it is absent.

### Packaging

[scripts/build.mjs](../apps/desktop/scripts/build.mjs) bundles `main.ts` and `preload.ts` with esbuild into
`build/main.cjs` and `build/preload.cjs` (the sandboxed preload cannot load local modules, so everything is inlined).
With `--copy-web` it copies `apps/web/dist` to `apps/desktop/web`, which electron-builder ships as an extra resource.

electron-builder ([package.json](../apps/desktop/package.json), `build` section): app id `org.donwinne.app`, product
name Donwinne, icon `resources/icon.png`, installers NSIS (Windows x64), dmg (macOS x64 and arm64), AppImage and deb
(Linux x64), output in `apps/desktop/release`, and a file association for `.pns.json` ("Donwinne model").

## Building

| Command (at the repository root) | What it does |
| --- | --- |
| `pnpm install` | Install dependencies |
| `pnpm dev` | Start the Vite dev server for the web app (port 5173) |
| `pnpm build` | Build the web app into `apps/web/dist` |
| `pnpm test` | Run all tests once (`vitest run`) |
| `pnpm typecheck` | Type-check the packages and the web app (`tsc -p tsconfig.json --noEmit`) |
| `pnpm desktop` | Build the web app, then build and start the desktop app |
| `pnpm desktop:dist` | Build the web app, then the desktop installers for the current platform |
| `pnpm --filter @pns/desktop typecheck` | Type-check the desktop shell (it has its own tsconfig) |
| `pnpm --filter @pns/desktop dist:win` (or `dist:mac`, `dist:linux`) | Installers for one platform |

To work on the desktop app against the dev server, run `pnpm dev` in one terminal and, in another:

```
PNS_DEV_URL=http://localhost:5173 pnpm --filter @pns/desktop start
```

## Docker

The [Dockerfile](../Dockerfile) builds and serves the web app:

1. **Build stage** (`node:22-alpine`): installs pnpm 10.28.0, skips the Electron download
   (`ELECTRON_SKIP_BINARY_DOWNLOAD=1`), installs only the web app's and the root's dependencies, then runs
   `pnpm test && pnpm --filter @pns/web build`. **The image is not built if a test fails.**
2. **Serve stage** (`nginx:1.30-alpine`): copies `apps/web/dist` and [docker/nginx.conf](../docker/nginx.conf)
   (gzip; files under `/assets/` cached as immutable for a year; every other path falls back to `index.html`
   without caching). A `HEALTHCHECK` watches the server.
3. **Security headers**: every response carries a Content Security Policy (scripts, styles, workers and
   connections only from the app itself; no plugins, no framing, no `<base>` changes), plus
   `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY` and a
   `Permissions-Policy` that turns off the camera, microphone, location, payment and USB. nginx forgets
   inherited `add_header` lines in a location that adds its own, so each location repeats the full set.

```
docker compose up --build      # then open http://localhost:8080
```

[docker-compose.yml](../docker-compose.yml) runs the service `web` on port 8080.

## Testing

### Running the tests

```
pnpm test                                   # all tests, once
pnpm exec vitest                            # watch mode
pnpm exec vitest run packages/apn           # one package
pnpm exec vitest run -t "Fig. 4.10"         # tests whose name matches
pnpm typecheck                              # types
```

[vitest.config.ts](../vitest.config.ts) runs every `packages/*/test/**/*.test.ts` in the Node environment (the
editor's tests drive the store and its logic without a browser), with the `@pns/*` aliases.

The full suite has **35 test files and 613 tests**, and takes about 80 seconds; most of that is the thesis
reproduction in `thesis.test.ts`.

### What the tests cover

| Package | Test files (tests) | What they check |
| --- | --- | --- |
| core | `semantics` (15), `snoopy-features` (19), `ambient` (5) | Expressions, P/T, extended and coloured firing, logical places, modifier arcs, fixed places, colour sets, user and math functions, observers, the APN class checks |
| sim | `sim` (33), `snoopy-features` (20) | Stochastic, continuous and hybrid simulation, timed nets, unfolding, Snoopy feature parity |
| analysis | `analysis` (50), `verification` (23), `ctl` (14), `crosscheck` (3), `thesis` (19) | Incidence matrix, invariants, structural properties, siphons and traps, behaviour, Snoopy samples, cross-checks on random nets; CTL parser and checker, truncated state spaces; templates, paths, fault tolerance, the colour-blind projection; every result of chapter 7 of the thesis |
| apn | `semantics` (28), `blocks` (18), `compose-figures` (24), `compose-properties` (16), `construction` (20), `cases` (26) | APN and T-APN classes and step semantics, the CRG (Def. 5); building blocks (Defs 6, 7, 11, Fig. 4.1); Figs 4.7 to 4.12; Sec. 4.3 and 4.4 properties; the construction φ on Figs 6.1 and 6.3 and equivalence; the case studies, their T-APNs and the editor examples |
| ft | `analysis` (17), `translate` (11) | Cut sets, probabilities, importance, Monte Carlo of dynamic gates, translation to Petri nets, DNF import, layout |
| io | `native` (38), `snoopy` (36), `pnml` (31), `exporters` (35), `candl` (14), `snoopy-features` (13), `ambient` (4) | Every file format, round trips, Snoopy samples, APN and T-APN files |
| editor | `ambient` (6), `ux` (8), `responsive` (5), `editing` (3) | The step token game and building blocks in the editor, editing, arc checks, screen classes |

The thesis tests are the reference for the reproduction figures given in
[Reproducing the thesis's results](ambient-petri-nets.md#reproducing-the-thesiss-results).

## Extending Donwinne

### Adding a net class

1. **Declare it** in [model.ts](../packages/core/src/model.ts): add the name to the `NetClass` union, a label to
   `NET_CLASS_LABELS`, and the class to the groups it belongs to (`COLOURED_CLASSES`, `QUANTITATIVE_CLASSES`,
   `AMBIENT_CLASSES`, `FAULT_TREE_CLASSES`). Update `arcKindsFor` and, for timed or rated classes, `timeBase`.
2. **Run `pnpm typecheck`.** Several tables are typed `Record<NetClass, …>` (for example `NET_CLASS_LABELS` and
   `SNOOPY_CLASSES` in [snoopy.ts](../packages/io/src/snoopy.ts)), so the compiler lists the places that need an
   entry.
3. **Give it semantics.** If the class fires like an existing one, the shared rule in
   [semantics.ts](../packages/core/src/semantics.ts) may be enough. Otherwise add the rule in its own module or
   package, as `@pns/apn` does for step semantics, and connect it in the editor (the token game in
   [simulation.ts](../packages/editor/src/simulation.ts), or a panel like
   [AmbientSim.tsx](../packages/editor/src/AmbientSim.tsx)).
4. **Show it in the editor**: the class groups in the "Create a new model" dialog
   ([Dialogs.tsx](../packages/editor/src/Dialogs.tsx)) and in the class switcher
   ([Toolbar.tsx](../packages/editor/src/Toolbar.tsx)), and any new fields in
   [PropertiesPanel.tsx](../packages/editor/src/PropertiesPanel.tsx).
5. **Files**: the native format accepts every class in `NET_CLASS_LABELS`. Decide how Snoopy and PNML represent it
   (the APN classes, for instance, are exported as coloured Snoopy nets with a marker line).
6. **Test it**: add tests under `packages/<package>/test/`.

### Adding an exporter

1. Write the function in `@pns/io`, taking a `Net` and returning a string (or bytes), and export it from
   [io/src/index.ts](../packages/io/src/index.ts). Throw an `Error` naming what the format cannot express: the editor
   uses that message to explain why the format is unavailable.
2. Add an entry to `EXPORT_FORMATS` in [fileOps.ts](../packages/editor/src/fileOps.ts): an `id`, a `label`, the
   extension, the MIME type, `applies` (which classes it suits) and `run`. Exporters are looked up by name with
   `ioFn("exportXyz")`, so a missing function simply hides the format.
3. For the desktop app, add a menu item to the "Export As" submenu in
   [apps/desktop/src/main.ts](../apps/desktop/src/main.ts) with the command `export:<id>`; the editor's
   `runCommand` already handles every `export:` command.
4. Add tests in [exporters.test.ts](../packages/io/test/exporters.test.ts).

An importer works the same way: a parser in `@pns/io` returning a `Net`, and an entry in the import list of
[fileOps.ts](../packages/editor/src/fileOps.ts).
