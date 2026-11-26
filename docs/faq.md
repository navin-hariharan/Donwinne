# Questions and troubleshooting

Answers to the questions people ask most, and what to do when something does not work as you expect.

## Contents

- [Drawing](#drawing)
- [The token game](#the-token-game)
- [Simulation](#simulation)
- [Analysis and model checking](#analysis-and-model-checking)
- [Slicing and big models](#slicing-and-big-models)
- [Ambient Petri nets](#ambient-petri-nets)
- [Files](#files)
- [The app itself](#the-app-itself)
- [Known limitations](#known-limitations)

## Drawing

### Why can't I draw an arc between two places?

An arc always joins a place and a transition ("Arcs must join a place and a transition"). Put a
transition between the two places. Read, inhibitor, reset and equal arcs must also go from a place to a
transition. Freestyle nets have no such rules.

### I drew the same arc again and nothing happened

Donwinne does not add a second arc with the same ends and type. It selects the existing arc and opens
its weight, so you can raise the weight instead.

### My place/transition net became an "extended net"

You drew a read, inhibitor, reset or equal arc (keys 2 to 5), which a place/transition net cannot hold,
so Donwinne switched the class and said "Switched to an extended net to allow this arc type". Undo
(Ctrl+Z) switches back. See [Arc types](net-classes.md#arc-types).

### How do I get a node back that I cannot see?

Press **F** to fit the whole page in the window, or **Shift+F** to zoom to the selection. **Edit >
Find…** (Ctrl+F) finds an element by name, even inside a subnet, and centres the view on it. The
[overview map](editor.md#navigating-the-canvas) (M) shows where everything is.

### The labels disappear when I zoom out

On a large net, names too small to read are left out so the structure stays visible; zoom in to bring
them back. The selected element and the one under the pointer keep their labels, and exported pictures
always show every label.

### How do I undo a layout or a deletion?

**Edit > Undo** (Ctrl+Z) undoes the last 300 steps, including auto layout. Undo is not available while
the token game runs; stop it first (Esc).

## The token game

### "Fix N problems before simulating"

The model has errors, and the **Problems** tab lists them. Click a problem to select the element it is
about, fix it, and press S again. Common errors are a marking or weight that is not a number, a name
used twice, or an arc inscription that does not fit the place's colour set.

### Why can't this transition fire?

Click it, or hover over it: Donwinne names the reason, for example "reuse cannot fire: stock has 0
tokens, needs 1". The reasons are a place short of tokens, a read or equal arc that is not satisfied, an
inhibitor arc that blocks, a false guard, or an output place that would go over its capacity. The
**Cannot fire** list in the token game tab gives the reason for every blocked transition. In ambient
nets the step token game explains blocked colour modes the same way.

### The net is dead. How did it get there?

When nothing can fire, the [red token trail](simulation.md#the-red-token-trail-and-deadlocks) turns
solid and shows the route into the deadlock, and the places with stuck tokens pulse red. **Show stuck
tokens** in the banner goes to them one at a time, at a readable size, and says why each waiting transition
can't fire; **List** shows them all. Step back with ← to see the firings one by one. **Analyse > Net properties and
invariants…** also gives the shortest path to a deadlock.

### How do I start the game from a different marking?

Play the game to the marking you want and press **Keep this marking**: it becomes the initial marking
(as an undoable edit).

## Simulation

### Why is "Simulate over time" missing from the Analyse menu?

It is only for nets with rates: stochastic, continuous and hybrid nets and their coloured and fuzzy
variants. Change the class with the class badge in the toolbar, or create the model in one of those
classes. A place/transition net has the token game instead.

### Each stochastic run gives a different plot

That is what random delays do. Average more runs (**Runs**), or type a **Seed** to get the same result
every time. See [Stochastic simulation](simulation.md#stochastic-simulation).

### The simulation stopped early or says a value is wrong

The simulator checks its settings before it starts: times, tolerances and step sizes must be finite
positive numbers, at most 10,000 runs, and at most 5,000,000 numbers in the result. A very stiff model
may need the **Stiff (Rosenbrock)** solver. See [Settings](simulation.md#settings).

## Analysis and model checking

### The reachability graph says "(stopped early)"

The net has more markings than the limit (5,000 by default, up to 200,000), or infinitely many. Raise
the limit and press **Explore again**. For a net that is too big to explore, use **Net properties and
invariants…** (its structural results, such as invariants, do not need the state space), or slice the
net first (below).

### Why is a CTL verdict "Unknown"?

The state space was cut off at the limit and the answer depends on the part not explored. Raise the
limit, choose a smaller semantics (maximal steps for ambient nets), or slice the net. When the verdict
does not depend on the unexplored part you still get True or False. See
[Unknown verdicts](ctl.md#unknown-verdicts).

### My formula has a syntax error

The formula box checks as you type: it shows the error with its line and column and what was expected
there, and for an unknown name it offers **Did you mean** with close matches.
Coloured places are written with their colour, `p[b]`, and transitions with their binding, `t<x=b>`.
The full syntax is in [Syntax](ctl.md#syntax).

### What do the abbreviations in the properties report mean?

They are Charlie's: for example **k-B** (k-bounded), **DCF** (dynamically conflict free), **DSt** (dead
states) and **DTr** (dead transitions). Each property in the report comes with an explanation. See
[Behavioural properties](analysis.md#behavioural-properties).

## Slicing and big models

### Which slicing algorithm should I use?

For model checking, **abstract slicing** gives the smallest slice that still keeps every CTL\*-X
property of the criterion places; use **safety slicing** if the property is only `AG` or `EF` of a
state formula. If the formula uses `EX` or `AX`, slicing may change the verdict. For testing, use
**backward**, **forward**, **concerned** or **trace** slicing. See [The algorithms](slicing.md#the-algorithms).

### "Unknown criterion place" when I slice or run the pipeline

A property or criterion names a place that this net does not have. The message shows how names are
written in this net, for example `p3[b]` for colour `b` of a coloured place `p3`. **Use the chapter's
φ1 and φ2** fills in the properties of Fig. 4.9, so they fit that example and the nets built like it,
not every net; edit them to use your own place names.

### The framework pipeline says "Property fulfilled? No". What now?

That is the figure's "no" arrow: back to modelling. Press **Counterexample** next to the failing
property (the first one is already open), then **Replay on the model**: the token game plays the
path that breaks the property, with the trail drawn on the net. Change the model, open the pipeline
again and press **Run again on the changed model**. **Runs on this model** keeps the answer of each
run. See [Back to modelling](slicing.md#back-to-modelling).

### Why is a property "Unknown" in the framework pipeline?

The whole net's graph was cut off at the state limit before the answer was certain, and the slice
could not stand in for it: either the slicing algorithm does not preserve that kind of property, or
the formula uses `EX`, `AX`, `deadlock` or `fireable(…)`. Raise the limit, or choose abstract
slicing, which keeps every CTL\*-X property of the criterion places.

### My net is too big to check. What can I do?

1. **Slice it** (Analyse > Slice the net…) for the places your property reads.
2. Use **stubborn sets**: **Slice and compare state spaces** and the framework pipeline show how much
   smaller they make the graph, and the pipeline uses them to decide `AG` and `EF` properties on graphs
   that are too big. When even those are too big, the pipeline lets the slice decide every property its
   slicing algorithm preserves.
3. For ambient nets, use **maximal steps**.
4. Raise the state limit: Donwinne stores markings compactly, so hundreds of thousands of states fit.

## Ambient Petri nets

### "Check equivalence…" is greyed out

In a T-APN that was not constructed in this session, Donwinne does not have the APN to compare it with:
"Open the APN and check equivalence there".

### What is the difference between an APN and a T-APN?

An APN uses colour-sensitive inhibitor arcs. The construction φ (**Construct T-APN**) replaces them with
guards and complementary colours, giving a T-APN with the same behaviour, which more tools can analyse.
See [Ambient Petri nets](ambient-petri-nets.md).

## Files

### Which files can Donwinne open?

**File > Open…** opens Donwinne and PNML files; **File > Import…** also reads Snoopy files of every
class, ANDL, CANDL and DNF fault trees. You can also drop a file on the window. See
[Files and formats](file-formats.md).

### An export is greyed out

The format cannot hold this net, and the menu says why underneath, for example "LoLA has no inhibitor
arcs". Choose a format that can, such as Snoopy or PNML.

### Where did my model go?

Models are only on your device. If you did not save a file, the browser's auto-save brings the last
model back when you open Donwinne again in the same browser; clearing the site's data removes it. Save
important models with **File > Save**.

### Save downloads a new file every time

Browsers without the File System Access API (Firefox, Safari) cannot write back to a file, so each Save
downloads a copy. Chrome, Edge and the desktop app save to the same file.

## The app itself

### Does it work offline?

Yes, once it has been loaded: the web app keeps a copy of itself, and these docs are part of it.
Animated pictures in the docs load from the network the first time. When a new version is published, a
message offers to reload.

### How do I see every keyboard shortcut?

**Help > Quick guide and shortcuts** (?) shows the common ones; [Keyboard shortcuts](editor.md#keyboard-shortcuts)
lists them all.

### Does it work on a phone or tablet?

Yes. Menus move into a drawer, the palette becomes a bar, and properties open as a sheet. See
[Touch gestures](editor.md#touch-gestures) and [Phones, tablets and desktops](editor.md#phones-tablets-and-desktops).

### Is my model uploaded anywhere?

No. Donwinne runs entirely in your browser or desktop app; nothing is sent to a server.

## Known limitations

- Not yet supported from Snoopy: lookup tables, the Snoopy steering server (S4), and decision diagram
  (MTBDD) based analysis.
- Snoopy import was checked against real place/transition, continuous and hybrid files; the other
  classes follow Snoopy's source code.
- State spaces are explored explicitly. Very large nets stop at the state limit and report Unknown where
  a verdict could change; slicing and stubborn sets push that limit much further.
- Slicing and stubborn sets apply to the discrete behaviour (they ignore time and rates). Modulo nets
  and marking-dependent weights are explored without stubborn-set reduction.
