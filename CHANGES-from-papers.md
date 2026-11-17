# Donwinne: what changed and how it was checked

Donwinne, improved from two publications:

- **Framework chapter:** Konios et al., *A Modular Framework for Modelling and Verification of Activities in Ambient Intelligent Systems*, HCII 2023, LNCS 14029.
- **Slicing survey:** Khan, Konios and Guelfi, *A Survey of Petri Nets Slicing*, ACM Computing Surveys 51(5), 2018.

## What was already there

The project already covered the thesis material the chapter builds on:

- APNs and T-APNs
- basic, root and one step nets
- forward and backward composition
- the construction φ, which matches the chapter's Post_NEW and M'0 exactly
- the equivalence check, the concurrent reachability graph, unfolding and CTL

All of it was kept as it was.

## What is new

1. **Petri net slicing.** The new file is `packages/analysis/src/slicing.ts`. It has the twelve algorithms of the survey:
   - Rakow's CTL\*-X (Alg. 1), safety (Alg. 2) and basic slicing (Fig. 7)
   - APNSlicing (Alg. 3), abstract slicing (Alg. 4), and abstract slicing that also drops parallel transitions (Sec. 8.4)
   - Llorens backward (Alg. 7), forward (Alg. 8), backward and forward together, and trace slicing (Alg. 9)
   - Wangyang slicing on the local reachability graph (Alg. 10) and concerned slicing (Alg. 11)

   Around the algorithms:
   - Lee's invariant slices (Alg. 5) and Chang's concurrency sets (Alg. 6).
   - The evolution check of Sec. 8.3, which says whether a change to the net keeps a verdict or needs a new check.
   - The criterion can be read from a CTL formula.
   - A slice can be turned back into an editable net, ready for PNML export.

   The algorithms work on every discrete net class:
   - Coloured nets, APNs and T-APNs are unfolded first, as the framework does.
   - Read, inhibitor, equal and reset arcs are handled, and so are marking-dependent weights, logical places and capacities.
   - A capacity counts only when the P-invariants can't show it is never reached. That is what lets abstract slicing reduce a T-APN the way Fig. 10 of the chapter does.
2. **Stubborn-set reduction.** The new file is `packages/analysis/src/stubborn.ts`. The reduced state space keeps every deadlock. When you give it the places a property reads (the visibility condition plus Valmari's ignoring proviso), it also keeps every reachable marking of those places, so AG and EF properties over them keep their verdicts.
3. **The framework pipeline.** The new file is `packages/editor/src/framework.ts`. It runs the chapter's Fig. 1 end to end: APN, then T-APN, then the unfolding, then the slice. For each stage it measures the state space with single steps, single steps with stubborn sets, and maximal steps (Sec. 6). It checks every property on both the whole net and the slice. When the whole net is too big, AG and EF properties are checked on the stubborn-set graph instead.
4. **Editor.** There are two new dialogs:
   - **Analyse > Slice the net…**: pick the algorithm and the criterion (places or a CTL formula), compare the state spaces, highlight the slice, open it as a new net, or export it as PNML.
   - **Analyse > Ambient > Framework pipeline…**: has a button that fills in the chapter's properties φ1 and φ2.

   Both dialogs are also in the desktop app's menus.
5. **Speed and memory for big models.** State-space exploration was rewritten:
   - Markings are stored in chunked Int32 arrays with an open-addressing hash table, with no string keys.
   - Each step is applied and undone in place, and the hash is updated incrementally.
   - Only the transitions whose input places changed are tried at each marking.

   Measured results:

   | Model | Before | After |
   | --- | --- | --- |
   | Net with 131,000 states | 1215 ms, 231 MB | 447 ms, 39 MB |
   | Net with 3,000 dead transitions | 3.2 s | 1.3 s |

   The maximal-step graph uses the same store.
6. **Docs and benchmarks.**
   - New page `docs/slicing.md`.
   - README, `docs/analysis.md` and `docs/architecture.md` are updated.
   - The slicing and stubborn-set runs are added to `bench/engine.bench.ts`.

## How it was checked

- **Tests:** 637 pass (613 before, plus 24 new ones). `pnpm typecheck` is clean, the desktop app typechecks, and `pnpm build` succeeds.
- **The chapter's example (Figs 7–10).** The construction gives Post_NEW and M'0 exactly. Abstract slicing for Q = {p3b, p3w, p3g, p3l} keeps 16 places and the 10 transitions of t1, t2, t4, t5 and t7, as in Fig. 10. The state space drops from 256 to 16 states with single steps, and from 5 to 4 with maximal steps. φ1 and φ2 are true on both the net and the slice, and N and φ(N) are equivalent.
- **The survey's Fig. 7.** The basic, CTL\*-X and safety slices contain exactly the places and transitions in the figure.
- **Random nets.** The slices were compared against the full state space on 300 random nets with read and inhibitor arcs and capacities:
  - Every model-checking slice reaches exactly the same criterion markings as the full net.
  - Backward slicing keeps every transition that feeds the criterion, and forward slicing keeps every transition that can fire.
  - Stubborn sets find exactly the same deadlocks and, for the given places, exactly the same markings.
- **In the browser.** The chapter's example was loaded in the built web app and both dialogs were run. Opening the slice works, and there were no console errors.
- **Benchmarks** (`pnpm bench`):

  | Run | Time |
  | --- | --- |
  | Abstract slice of the garage T-APN | 31 ms |
  | Stubborn-set graph of the garage T-APN | 14 ms, 355 states, where the full graph has over 2 million |

## Known differences

- **Survey Fig. 7 state counts.** The slices match the figure, but the survey's state counts (60/24/12/9) don't. The figure doesn't fully give the initial marking. With every place marked once, the counts are 112/28/14/14, in the same order as Table 1.
- **Setup.** Run `pnpm install` before building or testing.

## Update 2: Help > Docs

**Help > Docs** (F1, also in the desktop app's Help menu) opens the full user guide inside Donwinne. It works offline.

**The viewer** (`packages/editor/src/docs/`):

- **Pages.** 12 pages in 4 groups: Start here, Using Donwinne, Analysis and verification, and Reference. The left side lists every page, with the open page's headings under its name. Back (Alt+←) and previous/next buttons move between pages. Each heading has a **#** link that copies its address.
- **Search.** Every section of every page is searched as you type (press / or Ctrl+K to jump to the box):
  - It matches the start of words and ignores plurals.
  - It knows other spellings, so *color* finds *colour*.
  - Quotes search for an exact phrase.
  - Each result shows the page, the section and a snippet with the words marked. Arrow keys and Enter open a result, and the searched words stay highlighted on the page.
- **Safety.** The markdown is rendered without innerHTML. Links to other sites and to source files are checked.
- **Layout.** It works on phones, where the page list becomes a drawer, and in dark mode.

**New pages:**

- **Getting started:** the screen, a first net in five steps, saving, the examples, and how to use the docs.
- **Every feature, A to Z:** each menu item, button, key and option, with a link to its details (177 links).
- **Questions and troubleshooting:** what each message means and what to do about it, plus known limitations.

**Updated pages:** the editor, net classes and slicing pages were updated for the new features.

**New pictures:** 9 screenshots (the five getting-started steps, docs search, the slicing dialog, the framework pipeline, an opened slice) and 3 diagrams (the firing rule, slicing, stubborn sets).

**Bugs found and fixed during the sweep:**

- **Fig. 3.1 example (from Konios's thesis).** "Net properties" and the framework pipeline failed with "b is not in colour set W of p5". The unfolding now skips bindings whose arcs would put a colour outside a place's colour set. Inhibitor arcs on such colours are ignored.
- **APNs that are not composite step nets.** The framework pipeline now carries on with the APN itself when the construction φ doesn't apply, and says so.
- **Clearer error message.** "Unknown criterion place" now shows how place names are written in the open net.

**How it was checked:**

- 653 tests pass, including 14 new docs tests. They check that every page is registered and renders, that every internal link, anchor and image resolves, and how search ranks results. They also check that every toolbar menu item can be found by search.
- `pnpm typecheck` is clean and `pnpm build` succeeds.
- A browser sweep of the built app covered:
  - all 13 examples with every Analyse dialog, and the token game
  - all 12 docs pages: 0 broken images, all 177 feature-index links working, 0 console errors
  - phone width and dark mode

**Docker fix.** The Docker build failed because `.dockerignore` left out the whole `docs` folder, which the docs test and Help > Docs need. The image now copies `docs/` but still leaves out `docs/examples` and `docs/thesis`. The test that checks links to source files runs only in a full checkout, because the image doesn't contain every source file. Building the image now runs 653 tests, with that one test skipped, and the web build succeeds. In the running container, Help > Docs, search and pictures all work.

## Update 3: UI bugs, security, unused code and a full robustness review

**Slice dialog layout.** In the Slice dialog the fields ran into each other: the shared form grid gave each field a 150px column, but the inputs had fixed pixel widths and spilled into the next column. The grid is fixed for every dialog that uses it: each field now fills its column and wraps on narrow screens.

**Every screen size.** An automatic layout check was built. It opens every menu, every dialog and the token game for 7 examples, on phone (390px), tablet (820px), laptop (1366px), desktop (1920px) and ultrawide (3440px) screens. It looks for overlapping controls, sideways scrolling, dialogs larger than the screen, and text cut off inside buttons.
- It catches the Slice dialog bug above.
- It found one more real bug: on phones the last bottom-panel tab ran under the Hide button. The tabs now scroll on their own, with a fade at the edge to show there is more.
- Everything else is clean.

**Accessibility** was checked with axe-core against WCAG 2.2 AA, on every dialog in both themes. These were fixed:
- **Contrast.** Selected tabs and buttons, the Yes/No pills, the Edit/Simulate switch and error messages in dark mode were all below 4.5:1.
- **Bottom panel.** Its tab bar was built wrongly for screen readers.
- **Targets.** Two click targets were smaller than 24px.
- **Keyboard.** Scrolling panels couldn't be reached with the keyboard, and Escape on a menu lost the keyboard focus.
- **Reachability graph.** It nested its clickable states inside an "image".

The result is 0 issues in light and dark mode.

**Security.**
- **Dependencies.** `pnpm audit` found 38 known vulnerabilities (3 critical), all in development tools (vitest and its bundled vite, and the desktop packager). Upgrades:
  - vitest 2 → 4
  - vite 5 → 7
  - Electron 44.9 → 44.11 and electron-builder 26.15 → 26.18
  - two transitive packages pinned to patched versions

  Result: 0 known vulnerabilities. Vite 7 needs Node 20.19 or newer, which the docs and `package.json` now say.
- **Desktop app.**
  - It now denies camera, microphone, location, notification and other device access; only clipboard writing is allowed.
  - Every IPC call is checked to come from the app's own page.
  - Export data is type-checked.
- **Web.** The page's Content Security Policy also blocks plugins, `<base>` changes and form posts. nginx hides its version and sends `Cross-Origin-Opener-Policy`.

**Unused and redundant code.**
- Removed 13 functions nothing called, plus 18 unused variables, parameters and imports.
- Made 93 exported names that were only used inside their own file private.
- Removed a duplicate list of net classes that could drift from the real rule.
- The compiler now rejects unused code (`noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`).

**Robustness.**
- **Fuzzing.** A new test feeds damaged files to all five importers (native, PNML, Snoopy, ANDL/CANDL, DNF); each net that still loads is then analysed and saved again. 15,000 damaged files caused no crashes. It runs in the normal suite at a smaller size.
- **A real crash, fixed.** Expressions or CTL formulas nested about 1,000 deep, or with 5,000 chained terms, crashed with a stack overflow. They now get a clear message.
- **Random-click testing.** Thousands of random clicks, keys, drags and typing in the built app, on laptop and phone sizes, recorded no errors.

**From the papers.** All 12 slicing algorithms of the survey were already in the app. Three more techniques from the survey were only in the engine, and are now in **Analyse > Slice the net…**:
- **Divide the net into parts.** Lee's invariant slices (Alg. 5) and Chang's concurrency sets (Alg. 6), each part with a Highlight button.
- **The evolution check (Sec. 8.3).** The dialog remembers its last slice while you edit the same model. Reopen it after a change and it answers "Does this change need a new check?" with Yes or No, listing the changes and marking those inside the slice.

**Checks.**
- 662 tests pass (8 new).
- Typecheck is clean, also with the stricter settings and for the desktop app.
- The web build succeeds, and 0 vulnerabilities are known.
- The browser sweep of every example, dialog and docs page found 0 errors.
- The Docker steps pass from a clean copy with the frozen lockfile.

## Update 4: the full Fig. 1 loop of the framework chapter

The question was whether the chapter's Fig. 1 (Model APNs → T-APNs → Unfolded T-APNs → Slicing → Sliced net → Model checking → Property fulfilled?, with Properties feeding slicing and model checking, and "no" looping back to modelling) is implemented.

**Before this update:** every forward box was there (Analyse > Ambient > Framework pipeline…), but the decision and the "no" arrow were not. The dialog printed true/false per property, with no overall answer, no counterexample and no way back to the model.

**Now:**

| Fig. 1 box or arrow | Where it is |
| --- | --- |
| Model APNs | The open APN (building blocks, forward/backward composition) |
| T-APNs | `constructTapn` (φ, Def. 10) plus the CRG isomorphism check |
| Unfolded T-APNs | `toPTNet` (Sec. 4.2) |
| Properties → Slicing | The places of the CTL properties form the criterion (`criterionFromCtl`) |
| Slicing → Sliced net | Abstract slicing by default (Sec. 5); 7 other model-checking slicers selectable |
| Properties → Model checking | `checkCtl` on the whole net (stubborn-set fallback for AG/EF) and on the slice |
| Property fulfilled? | New: a Yes/No/Unknown banner for all properties and a Fulfilled? column per property, saying which graph decided |
| yes → end / no → back to modelling | New: a counterexample (or witness) per property, **Replay on the model** in the token game (APN names and modes), **Open the slice and replay** when only the slice could decide, **Back to modelling**, and the dialog remembers properties and runs so you can **Run again on the changed model**; **Runs on this model** lists each answer |

Other changes:
- The dialog draws Fig. 1 as a row of boxes that fill in as the run gets there (wraps on phones).
- When the whole net is too big, the slice now decides a property, but only if the slicing algorithm preserves that kind of property (`slicePreserves`, survey Table 3). Otherwise the answer is Unknown, with the reason.
- A violated AG or reachable EF is now answered from the explored part of the full graph before falling back to stubborn sets, which gives shorter counterexamples.
- The stage-size table (Figs 11 and 12) moved into a collapsible section.
- "History (1 steps)" in the token game now says "1 step".
- Docs: slicing.md (Property fulfilled?, Back to modelling), feature-index, FAQ, and two new screenshots.

**Checked:** 665 tests pass (3 new framework tests), typecheck clean, build OK. In the browser on Fig. 4.10, `AG(p3[b] == 0)` gives No with a one-step counterexample; Replay puts the APN at step {(t1,b)} with a b token on p3. On the garage with a 200-state limit, the slice decides `AG(EF(exit[1] == 0))` and its 5-step counterexample replays on the opened slice. axe shows no violations in either theme, and nothing overflows on phone, laptop or desktop.

## Update 5: the source-code audit

Each finding was checked against the code, the slicing survey and the chapter before changing anything.

| Finding | Verdict | What was done |
| --- | --- | --- |
| EF classed as a safety property (critical) | **Not a bug, kept.** EF s is reachability, the negation of the safety property AG ¬s, not liveness. Rakow's safety slice reaches exactly the criterion markings the net reaches: a slice firing sequence runs unchanged in the net, and a net sequence without the dropped transitions (which only take tokens away) runs in the slice. So AG ¬s, and with it EF s, keeps its verdict. Liveness (AF, EG, AG EF) is not kept and was never classed as safety. | New tests: EF/AG verdicts equal on 200 random nets with every arc kind; AF shown to change on a safety slice and classed as not safety. The reasoning is now written in the code and docs, so it isn't "fixed" by mistake later. |
| Evaluation errors become false deadlocks (critical) | **Real bug, fixed.** A marking-dependent weight that is negative or fractional at a marking made that state "dead" in a "complete" graph. | Such states are now *unresolved*: never dead, marked open, and the graph is incomplete. Fixed in the interleaving explorer, stubborn sets (no reduction at those states either), the properties report, the conflict check, and both reachability-graph builders. Verdicts that depend on them are now Unknown. |
| Wangyang slicing and weighted inhibitor arcs (high) | **Real bug, fixed.** The local reachability graph only knows "marked or not", but treated any token as blocking an inhibitor arc of weight 2 or more, dropping transitions that can fire. | Inhibitor arcs block only at weight 1, equal arcs of weight 0 need an empty place, and marking-dependent weights no longer block. Tests for each case. |
| Maximal steps not used for verdicts (high) | **Real gap, fixed.** The chapter verifies φ1 and φ2 under single and maximal steps (Sec. 6, Figs 11 and 12), but the pipeline only counted maximal-step states. | New "Check with single steps / maximal steps" option. Under maximal steps, the net is checked on its maximal-step graph (the CRG of φ(N) for ambient nets: 5 states on Fig. 4.10, as in Fig. 12). Slices never decide there, since slicing changes which steps are maximal. Counterexamples replay as steps on APNs. |
| Errors making incomplete exploration look complete (high) | **Same root as the deadlock bug**, fixed with it. "Too many bindings" errors now also mark a state unresolved. | Covered by the tests above. |
| Extended-arc slicing cases (medium) | **Now tested.** | The random-net test that compares each exact slice with the full state space now also covers reset arcs, equal arcs and inhibitor arcs of weight up to 3, and checks those arc kinds actually occur. All six model-checking slicers pass. |
| Partial unfolding / testing (medium) | **No change needed.** The survey says Khan et al. used a partial unfolding but "any unfolding technique can be used". The chapter uses Liu et al.'s transition unfolding, which Donwinne follows: the unfolded Fig. 9 net has the chapter's 28 places and 16 transitions. The testing-context slicers (backward, forward, Llorens, Wangyang, concerned, trace) are all present. | None. |

**Checked:** 676 tests pass (11 new), typecheck clean, build OK. In the browser, Fig. 4.10 with maximal steps gives a one-step counterexample {(t1,b),(t1,w)} that replays on the APN. No accessibility issues or overflow on phone and laptop.

## Update 6: version 0.4.0 and the desktop release workflow

- **Version 0.4.0** in every package.json, `packages/editor/src/version.ts` (shown in Help > About and written into exported files), the README badge and the file-formats doc. The existing test that checks the versions agree passes.
- **`.github/workflows/desktop-release.yml`**: on each push to `main` (or by hand from the Actions tab) it reads the version. If no tag `v<version>` exists, it:
  1. checks every package.json has the same version,
  2. runs the type check and all tests,
  3. builds the installers on GitHub's Linux, Windows and macOS machines (AppImage and deb; NSIS .exe; dmg for Apple silicon and Intel),
  4. creates the GitHub release `v<version>` with the installers and generated release notes.

  If the tag already exists, nothing is built, so ordinary pushes don't make releases. Signing and notarisation are optional; the secrets are listed at the top of the workflow.
- **Fixed on the way:** the Linux .deb build failed ("Please specify project homepage"). `homepage` is now set in `apps/desktop/package.json`. A local Linux build produced `donwinne-0.4.0-linux-x86_64.AppImage` and `donwinne-0.4.0-linux-amd64.deb`. The Windows and macOS builds can only run on GitHub's machines.

## Update 7: the v0.4.0 deep code audit

Based on the "Update V0.4.0" commit. Each finding was checked against the code first. All of them were real; one was worse than reported.

| Finding | Verdict | What was done |
| --- | --- | --- |
| Maximal-step search can run away (critical) | **Real.** The step limit only counted steps found, but the search visited every combination: 20 independent transitions took 5.7 s for one step, 30 would take hours. | A search-node budget (`maxSearchNodesPerState`, default 1,000,000) with cancellation checks inside the search. Candidates that nothing competes with are only tried at their largest count. Measured: 15/20/25/30 independent transitions now take 17/22/27/32 search nodes and under 3 ms (before: 91 ms and 5.7 s for 15 and 20). A state that hits the step or search limit is left open, and the notes say which limit stopped it. |
| Maximality with capacities (found while fixing the above) | **Real bug, not in the audit.** A step was called maximal when no *single* transition could be added. With capacities, a step can sometimes be extended by two transitions together (one makes room for the other) but by neither alone. | The check now looks for any enabled extension. A brute-force test enumerates every multiset on 300 random nets (normal, read, inhibitor and equal arcs, capacities, with and without auto-concurrency) and the step graphs match exactly. |
| `findReachable` says "unreachable" after evaluation errors (critical) | **Real.** | Evaluation errors now make the search incomplete (`complete: false`, with `unresolved` and the first `error`). Regression test with an invalid marking-dependent weight. |
| Wangyang slicing drops tokens (high) | **Real.** "Marked or not" emptied a place with 3 tokens after taking 1. | The local reachability graph now holds token counts and uses the net's own firing rule on the backward slice. On safe ordinary nets this is the same as the paper. Above the node limit, or if a weight can't be evaluated, it falls back to concerned slicing with a note. Tests: 3 tokens minus 1 keeps 2, weights, the fallback, and EF verdicts equal to the full state space on 300 random nets (half with reset, equal and inhibitor arcs). |
| `isLiveMarking` and `liveTransitions` on partial graphs (high) | **Real.** | `isLiveMarking` returns Yes / No / Unknown. Yes needs every transition seen firing; No needs nothing unexplored reachable. `liveTransitions` gives `null` for unknown, and `false` only when a fully explored dead end proves it. `isLive` can now say No on a partial graph when that is proven. Graphs now list their open states. |
| Observed vs proven bounds (medium) | **Real.** | `placeBounds` gives the seen maxima plus `provenPerColour` / `provenTotal`. These are exact on a complete graph; otherwise only the capacity proves a bound. `isKBounded` says Yes on a partial graph when every capacity is at most k. The APN properties dialog shows a "proven bound" column, and a dead-state count of 0 on a partial CRG is no longer green. |
| Unsupported arcs under maximal steps (high/feature) | **Real.** Reset arcs and marking-dependent weights threw mid-run. | `stepSemanticsSupport(pt)` lists each arc in the way and why. `stepSystem` and the framework refuse such nets up front with that message. Equal arcs are now supported (a test before the step, like read and inhibitor arcs). The docs have a table of what maximal steps support. |
| Differential tests (validation) | **Added.** | The P/T maximal-step graph matches the APN's maximal-step CRG on 500 random one-colour APNs (with self-loops, several inputs and inhibitor arcs): markings, steps, deadlocks and EF/AG/AG EF verdicts all match. The APN CRG, the T-APN CRG and the unfolded nets' step graphs also agree on Figs 4.9, 4.10, 3.1 and the garage fragment. One documented difference: the thesis's capacity rule (M + Post(U) ≤ K) is stricter than the result-based rule the P/T graph and token game use (the footnote's weak rule). |
| Same runaway in the APN step search | **Real, not in the audit.** 30 independent transitions hit the 200,000-node limit and left the state open. | Independent structured transitions are added to every maximal step directly: 30 of them now give one complete step. |

Every test the audit listed is in: 30 independent transitions; invalid weight leaves reachability incomplete; 3 tokens minus 1; liveness on a partial APN graph is Unknown; reset plus normal arcs rejected clearly; equal arc of weight 2; read plus normal arc on one place; inhibitor of weight 2; capacity while reducing a full place (and an over-full start is an error, so it can't happen); auto-concurrency multiplicities; maximal steps vs the APN CRG.

**Checked:** 712 tests pass (36 new), typecheck clean, build OK. In the browser, APN properties on Fig. 4.10 with a 10-state limit shows Live as Unknown, 1-bounded as Yes (by capacity) and the proven-bound column, with no axe issues in light or dark mode.

**Version 0.4.1.** This audit is released as 0.4.1: every package.json, `packages/editor/src/version.ts`, the README badge and the file-formats doc. The release workflow builds and publishes `v0.4.1` on the next push to `main`.
