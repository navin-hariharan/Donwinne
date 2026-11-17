# Every feature, A to Z

One line on every feature of Donwinne: what it does, where to find it and its shortcut, with a link to
the full description. Ctrl means ⌘ on a Mac. "Analyse > Ambient" means the **Ambient (Konios)** group
at the top of the Analyse menu, shown for APNs and T-APNs.

## Contents

- [A](#a) · [B](#b) · [C](#c) · [D](#d) · [E](#e) · [F](#f) · [G](#g) · [H](#h) · [I](#i) · [K](#k) · [L](#l) · [M](#m) · [N](#n) · [O](#o) · [P](#p) · [Q](#q) · [R](#r) · [S](#s) · [T](#t) · [U](#u) · [V](#v) · [W](#w) · [Z](#z)

## A

| Feature | What it does | Where | Key |
| --- | --- | --- | --- |
| [About](editor.md#help) | Shows the version and the licence. | Help > About | |
| [Abstract slicing](slicing.md#abstract-slicing-in-detail) | Slices a net and also merges places joined by neutral transitions; keeps CTL\*-X properties. | Analyse > Slice the net… | |
| [Add a token / Remove a token](editor.md#editing-in-place) | Changes the initial marking of the selected places by one. | Right-click a place; − and + in the properties panel | + / − |
| [Align and distribute](editor.md#aligning-and-spacing) | Lines up the selected nodes (left, centre, right, top, middle, bottom) or spaces them evenly. | Selection bar over the canvas; properties panel **Arrange** | |
| [Ambient Petri nets (APN)](ambient-petri-nets.md) | Konios's coloured nets for ambient systems, with colour-sensitive inhibitor arcs and step semantics. | File > New…, group *Ambient (Konios)* | |
| [APN properties](ambient-petri-nets.md#properties-of-composite-apns) | Checks the class, the composition structure, boundedness, liveness, reversibility, purity and more. | Analyse > Ambient > APN properties… | |
| [APNN export](file-formats.md#apnn) | Writes the net for the APNN toolbox. | File > Export as > APNN | |
| [Arc](net-classes.md#arc-types) | Joins a place and a transition; six types: normal, read, inhibitor, reset, equal, modifier. | Palette > Arc, or drag a node's + handle | A |
| [Arc type chooser](editor.md#the-arc-type-chooser) | Picks the type of the next arcs; also changes the type of a selected arc. | Click the active arc tool, its ▾, or right-click it | 1 to 6 |
| [Auto layout](editor.md#auto-layout) | Arranges the page: flow (left to right), top to bottom, organic, or the selection only. | Edit > Auto layout; toolbar button | Ctrl+L |
| [Auto-save](editor.md#undo-auto-save-and-themes) | Keeps the model in the browser after every change and brings it back next time. | Automatic | |

## B

| Feature | What it does | Where | Key |
| --- | --- | --- | --- |
| [Back to parent net](editor.md#subnets-and-breadcrumbs) | Leaves a subnet page. | Breadcrumbs; right-click the canvas | Backspace |
| [Backward and forward slicing](slicing.md#the-algorithms) | Llorens's slices: what can feed the criterion, and what the initial tokens can reach. | Analyse > Slice the net… | |
| [Backward composition](ambient-petri-nets.md#backward-composition-defs-12-and-13) | Glues two step nets into a bidirectional step (Def. 12). | Analyse > Ambient > Compose steps… | |
| [Bend points](editor.md#reshaping-arcs) | Bend an arc by dragging the dot in a segment; Alt-click a bend to remove it; **Straighten** removes all. | Select an arc | Alt-click |
| [Bindings](net-classes.md#guards-and-bindings) | The values of a coloured transition's variables in one firing; the token game asks when there are several. | Token game, **Choose a binding** | |
| [Bottom panel](editor.md#the-bottom-panel) | Tabs for problems, elements, the token game, plots and fault tree analysis. Drag its edge to resize. | View > Bottom panel | B |
| [Breadcrumbs](editor.md#subnets-and-breadcrumbs) | Show which subnet page you are on; click one to go there. | Top of the canvas inside a subnet | |
| [Building blocks](ambient-petri-nets.md#the-blocks-defs-6-7-11) | Creates unidirectional steps, basic step nets, root nets and one step nets of the thesis. | Analyse > Ambient > Building blocks…; File > New APN from building blocks… | |

## C

| Feature | What it does | Where | Key |
| --- | --- | --- | --- |
| [Capacity](net-classes.md#places-capacity-and-logical-places) | The most tokens a place may hold (per colour in coloured nets); firings that would exceed it are disabled. | Properties panel of a place | |
| [CANDL](file-formats.md#andl-and-candl) | Reads and writes coloured nets in Snoopy's text format. | File > Import…; File > Export as | |
| [Chang's concurrency sets](slicing.md#lee-and-chang-slices-that-cover-the-whole-net) | Groups communication transitions with the paths that lead to them, for testing. | Analyse > Slice the net… > Divide the net into parts | |
| [Check equivalence](ambient-petri-nets.md#behavioural-equivalence) | Checks that an APN and its T-APN have isomorphic concurrent reachability graphs, with a counterexample if not. | Analyse > Ambient > Check equivalence… | |
| [Check the model](editor.md#the-bottom-panel) | Lists the errors and warnings of the model; click one to select the element. | Analyse > Check the model; **Problems** tab | |
| [Class badge](net-classes.md#switching-class) | Shows the net class; click it to switch class. | Toolbar | |
| [Colour sets](net-classes.md#colour-sets) | dot, enum, int range, bool, string, product, union, alias and subset types. | Properties panel with nothing selected | |
| [Coloured nets](net-classes.md#coloured-nets) | Tokens carry values; guards, variables and multiset inscriptions. | File > New… | |
| [Colours of elements](editor.md#notes-and-colours) | Ten swatches and a custom colour for nodes and notes, a line colour for arcs. | Right-click menu; selection bar; properties panel | |
| [Comment](editor.md#notes-and-colours) | A free text comment on a place, transition or arc; the net has a description. | Properties panel | |
| [Concerned slicing](slicing.md#the-algorithms) | Keeps the paths from the initial marking that can change the criterion (survey Alg. 11). | Analyse > Slice the net… | |
| [Concurrent reachability graph (CRG)](ambient-petri-nets.md#the-concurrent-reachability-graph) | Every reachable marking of an APN under step semantics, all steps or maximal steps only. | Analyse > Ambient > Concurrent reachability graph… | |
| [Constants](net-classes.md#constants) | Named values for markings, weights, guards and rates. | Properties panel with nothing selected | |
| [Construct T-APN](ambient-petri-nets.md#chapter-6-the-construction-φ) | Turns an APN into its transformed APN by the construction φ (no inhibitor arcs). | Analyse > Ambient > Construct T-APN | |
| [Continuous nets](net-classes.md#continuous-nets) | Real amounts that change by ordinary differential equations. | File > New… | |
| [Continuous simulation](simulation.md#continuous-simulation) | Solves the ODEs with adaptive or fixed-step solvers and plots the result. | Analyse > Simulate over time and plot… | |
| [Copy, cut, paste, duplicate](editor.md#copy-cut-paste-and-duplicate) | Copies nodes with the arcs between them; pasted names stay unique. | Edit menu; right-click menu | Ctrl+C, Ctrl+X, Ctrl+V, Ctrl+D |
| [Counterexamples and witnesses](ctl.md#witnesses-and-counterexamples) | A path that shows why a CTL formula holds or fails; replay it in the token game. | Model checking (CTL) | |
| [CTL model checking](ctl.md) | Checks temporal properties such as `AG(EF(deadlock))` on the state space. | Analyse > Model checking (CTL)… | |
| [CTL\*-X slicing](slicing.md#the-algorithms) | Rakow's slicing that keeps CTL\* properties without next-time. | Analyse > Slice the net… | |
| [CSV of declarations](file-formats.md#declarations-as-csv) | Exports constants, colour sets and variables as a spreadsheet. | File > Export as | |

## D

| Feature | What it does | Where | Key |
| --- | --- | --- | --- |
| [Dark theme](editor.md#undo-auto-save-and-themes) | Light, dark or match the system. | View menu; sun/moon button | |
| [Deadlocks](simulation.md#the-red-token-trail-and-deadlocks) | The token game shows the route into a deadlock and the stuck tokens; analysis finds dead states and the shortest path to one. | Token game; Net properties | |
| [Declarations](net-classes.md#declarations) | Colour sets, variables, constants, functions and observers of the net. | Properties panel with nothing selected | |
| [Delete](editor.md#menus) | Deletes the selection. | Edit > Delete; right-click | Del, Backspace |
| [Description](editor.md#notes-and-colours) | A text about the whole net. | Properties panel with nothing selected | |
| [Desktop app](editor.md#the-desktop-app) | The editor in its own window with native menus, file dialogs and file associations. | `pnpm desktop` | |
| [DNF fault trees](file-formats.md#minimal-cut-sets-dnf) | Reads a fault tree from, or writes its minimal cut sets to, a Boolean formula. | File > Import…; File > Export as | |
| [Docs](getting-started.md#using-these-docs) | These pages, searchable, inside the app. | Help > Docs | F1 |
| [Drop a file](file-formats.md#opening-importing-and-saving) | Drag a model file onto the window to open it. | Anywhere | |

## E

| Feature | What it does | Where | Key |
| --- | --- | --- | --- |
| [Edit / Simulate switch](editor.md#the-top-bar) | Switches between drawing and the token game. | Toolbar | S, Esc |
| [Editing in place](editor.md#editing-in-place) | Double-click a name, a place's inside, an arc or a note to type its value on the canvas. | Canvas | F2, Enter |
| [Element table](editor.md#element-table-and-hierarchy) | A sortable, filterable, editable spreadsheet of places, transitions and arcs, with the subnet hierarchy. | View > Element table and hierarchy | |
| [Equal arc](net-classes.md#arc-types) | Enables the transition only when the place holds exactly the weight. | Arc type chooser | 5 |
| [Evolution impact](slicing.md#evolution-when-does-a-change-need-a-new-check) | Says whether a change to the net keeps a verdict or needs a new check. | Analyse > Slice the net… (after editing the net) | |
| [Examples](getting-started.md#trying-the-examples) | Ready-made models of every main class. | File > Examples | |
| [Export](file-formats.md) | Snoopy, PNML, ANDL, CANDL, LoLA, TINA, APNN, PRISM, SBML, CSV, DNF, TikZ, SVG and PNG. | File > Export as | |
| [Extended fault trees](net-classes.md#fault-trees) | Adds repair rates and dynamic gates (priority AND, spare, functional dependency). | File > New… | |
| [Extended nets](net-classes.md#extended-nets) | P/T nets with read, inhibitor, reset and equal arcs and marking-dependent weights. | File > New… | |

## F

| Feature | What it does | Where | Key |
| --- | --- | --- | --- |
| [Fault tolerance](ctl.md#fault-tolerance) | Checks whether the system still reaches its goal when a sensor gives a wrong advice. | Model checking (CTL), **Fault tolerance** tab | |
| [Fault tree analysis](analysis.md#fault-tree-analysis) | Minimal cut sets, top event probability, importance measures, unreliability, Monte Carlo of dynamic gates. | **Analyse tree** button | |
| [Fault trees](net-classes.md#fault-trees) | Events and gates (AND, OR, XOR, k-of-n, NOT, inhibit) for reliability analysis. | File > New…, group *Reliability* | |
| [Find](editor.md#find) | Searches names, markings, guards, rates, inscriptions and notes, across subnets. | Edit > Find… | Ctrl+F |
| [Fire a maximal step](ambient-petri-nets.md#playing-the-step-token-game) | Fires the largest step in an ambient net's token game. | Step token game | X |
| [Firing rule](net-classes.md#the-basic-firing-rule) | When a transition is enabled and what firing does, for every arc type. | | |
| [Fixed place](net-classes.md#continuous-nets) | A continuous place whose amount the simulation keeps constant. | Properties panel | |
| [Forward composition](ambient-petri-nets.md#forward-composition-defs-8-and-9) | Chains step nets one after the other (Def. 8). | Analyse > Ambient > Compose steps… | |
| [Framework pipeline](slicing.md#the-framework-pipeline) | Runs Fig. 1 of the chapter: APN → T-APN → unfolding → slice → model checking, drawn as the figure with each stage filled in, with state-space sizes and verdicts at each stage, checked with single or maximal steps. | Analyse > Ambient > Framework pipeline… | |
| [Property fulfilled?](slicing.md#property-fulfilled) | The framework's yes/no/unknown answer for all properties and for each one, and which graph decided it (whole net, stubborn sets or slice). | Framework pipeline | |
| [Back to modelling](slicing.md#back-to-modelling) | A counterexample or witness per property, replayed on the model (or on the opened slice), and a list of runs on the model so the loop of Fig. 1 is visible. | Framework pipeline > Counterexample > Replay on the model | |
| [Freestyle nets](net-classes.md#freestyle-nets) | Draw anything, with no rules; no simulation. | File > New… | |
| [Functions](net-classes.md#functions) | Your own functions such as `hill(S, K, n) = …` for rates, weights and guards. | Properties panel with nothing selected | |
| [Fuzzy nets](net-classes.md#fuzzy-nets) | Uncertain parameters as fuzzy numbers; plots show bands. | File > New… | |

## G

| Feature | What it does | Where | Key |
| --- | --- | --- | --- |
| [Gluing places](ambient-petri-nets.md#the-class-def-3) | Marks an APN place as a gluing (interface) place, where nets are composed; drawn with a double ring and G. | Properties panel of an APN place | |
| [Group into subnet](editor.md#subnets-and-breadcrumbs) | Moves the selection into a subnet drawn as a coarse transition. | Edit > Group into subnet | Ctrl+G |
| [Guards](net-classes.md#guards-and-bindings) | A condition on a coloured transition's variables. | Properties panel of a transition | |

## H

| Feature | What it does | Where | Key |
| --- | --- | --- | --- |
| [Highlight](analysis.md#show-highlighting-results) | **Show** buttons mark the places or transitions of a result on the canvas; Esc clears them. | Analysis dialogs; Slice the net | Esc |
| [History of the token game](simulation.md#history-back-and-forward) | Every marking so far; click one to go back to it. | Token game tab | ←, → |
| [Hybrid nets](net-classes.md#hybrid-nets) | Discrete and continuous parts together. | File > New… | |

## I

| Feature | What it does | Where | Key |
| --- | --- | --- | --- |
| [Import](file-formats.md#opening-importing-and-saving) | Reads Snoopy, PNML, ANDL, CANDL and DNF files. | File > Import… | |
| [Incidence matrix](analysis.md#incidence-matrix) | The net's matrix of token changes per transition and place. | Net properties, **Incidence matrix** tab | |
| [Inhibitor arc](net-classes.md#arc-types) | Blocks the transition while the place holds at least the weight (colour by colour in coloured nets). | Arc type chooser | 3 |
| [Install the web app](editor.md#installing-and-working-offline) | Installs Donwinne from the browser; it then works offline. | Browser's Install command | |
| [Invariants](analysis.md#invariants) | P- and T-invariants, and whether the net is covered by them. | Analyse > Net properties and invariants… | |

## K

| Feature | What it does | Where | Key |
| --- | --- | --- | --- |
| [Keep this marking](simulation.md#keep-this-marking) | Makes the token game's current marking the initial marking. | Token game controls | |
| [Keyboard shortcuts](editor.md#keyboard-shortcuts) | Every shortcut, by context. | Help > Quick guide and shortcuts | ? |

## L

| Feature | What it does | Where | Key |
| --- | --- | --- | --- |
| [LaTeX (TikZ)](file-formats.md#pictures-svg-png-and-latex-tikz) | Exports the drawing as a TikZ picture. | File > Export as | |
| [Lee's slices](slicing.md#lee-and-chang-slices-that-cover-the-whole-net) | Splits a net into slices built from its P-invariants. | Analyse > Slice the net… > Divide the net into parts | |
| [Logical (fusion) places](net-classes.md#places-capacity-and-logical-places) | Places with the same name share one marking, for drawing one place in several spots. | Right-click > Make logical; properties panel | |
| [LoLA export](file-formats.md#lola) | Writes the net for the LoLA model checker. | File > Export as | |

## M

| Feature | What it does | Where | Key |
| --- | --- | --- | --- |
| [Marking](net-classes.md#weights-markings-and-expressions) | The tokens on the places; a number, a constant, an expression or a coloured multiset. | Properties panel; double-click inside a place | |
| [Marking-dependent weights](net-classes.md#weights-markings-and-expressions) | Arc weights that mention place names, evaluated when the transition fires. | Arc weight field | |
| [Maximal steps](ambient-petri-nets.md#steps-sec-33) | Steps that cannot grow; the CRG and the framework can use only these. | CRG dialog; framework pipeline | X |
| [Minimal cut sets](analysis.md#minimal-cut-sets) | The smallest sets of basic events that cause the top event. | Fault tree analysis | |
| [Modifier arc](net-classes.md#arc-types) | Lets a place's marking appear in a rate without testing or changing it. | Arc type chooser | 6 |
| [Modulo nets](net-classes.md#modulo-nets) | Token arithmetic modulo a number. | File > New… | |
| [Music nets](net-classes.md#music-nets) | Each firing plays a note. | File > New… | |

## N

| Feature | What it does | Where | Key |
| --- | --- | --- | --- |
| [Net properties](analysis.md#behavioural-properties) | Bounded, safe, k-bounded, live, deadlock-free, reversible, home states, dead transitions and more, in Charlie's style. | Analyse > Net properties and invariants… | |
| [New model](getting-started.md#opening-donwinne) | Creates a model of any class, or opens a file or example. | File > New… | Ctrl+N |
| [Notes](editor.md#notes-and-colours) | Free text on the canvas. | Palette > Note | N |
| [Nudge](editor.md#selecting-moving-and-arranging) | Moves the selection by 1 unit, or 10 with Shift. | Arrow keys | ←↑→↓ |

## O

| Feature | What it does | Where | Key |
| --- | --- | --- | --- |
| [Observers](net-classes.md#observers) | Extra plot curves computed from markings or rates. | Properties panel with nothing selected | |
| [Offline use](editor.md#installing-and-working-offline) | The installed web app keeps a copy of itself and works without a network. | Automatic | |
| [Open](file-formats.md#opening-importing-and-saving) | Opens a Donwinne or PNML file. | File > Open… | Ctrl+O |
| [Overview map](editor.md#navigating-the-canvas) | A miniature of the page for moving around. | View > Overview map | M |

## P

| Feature | What it does | Where | Key |
| --- | --- | --- | --- |
| [Palette](editor.md#the-palette) | Tools to select and to add places, transitions, arcs and notes; drag or click. | Left side (bottom on phones) | V, P, T, A, N |
| [Pan](editor.md#navigating-the-canvas) | Moves the view. | Space+drag, right- or middle-drag, two fingers | |
| [Paths](ctl.md#path-queries) | Finds the shortest (or all) firing sequences to a target, with transitions that must or must not fire. | Model checking (CTL), **Paths** tab | |
| [Place](net-classes.md#the-basic-firing-rule) | Holds tokens. | Palette > Place; double-click empty canvas | P |
| [PNG and SVG images](file-formats.md#pictures-svg-png-and-latex-tikz) | Exports the drawing as a picture. | File > Export as | |
| [PNML](file-formats.md#pnml) | The standard Petri net exchange format, read and written. | File > Open…; File > Export as | |
| [Print](file-formats.md#printing) | Prints the current page. | File > Print… | Ctrl+P |
| [PRISM export](file-formats.md#prism) | Writes a stochastic net for the PRISM model checker. | File > Export as | |
| [Problems](editor.md#the-bottom-panel) | Errors and warnings with counts; also shown at the bottom of an element's properties. | Bottom panel, **Problems** tab | |
| [Properties panel](editor.md#the-properties-panel) | Every field of the selection, or of the net; shared fields for a multiple selection. | Right side (drawer or sheet on small screens) | |
| [Property templates](ctl.md#property-templates) | The 22 properties of chapter 7 of the thesis, filled in for you. | Model checking (CTL) | |

## Q

| Feature | What it does | Where | Key |
| --- | --- | --- | --- |
| [Quick guide](editor.md#help) | Short instructions and the most common shortcuts. | Help > Quick guide and shortcuts | ? |

## R

| Feature | What it does | Where | Key |
| --- | --- | --- | --- |
| [Random firing and running](simulation.md#random-firing-and-running) | Fires a random enabled transition, or keeps firing at 1 to 30 firings a second. | Token game | R, Space |
| [Reachability graph](analysis.md#reachability-graph) | Every reachable marking, drawn or as a table; click a state to replay the way to it; export as SVG, PNG, DOT or CSV. | Analyse > Reachability graph… | |
| [Read arc](net-classes.md#arc-types) | Needs the tokens but does not take them. | Arc type chooser | 2 |
| [Reconnect an arc](editor.md#reshaping-arcs) | Drag an end of a selected arc onto another node. | Canvas | |
| [Red token trail](simulation.md#the-red-token-trail-and-deadlocks) | Shows where the tokens went in the token game. | Token game controls | T |
| [Reset arc](net-classes.md#arc-types) | Empties the place when the transition fires. | Arc type chooser | 4 |
| [Reverse an arc](editor.md#reshaping-arcs) | Swaps a normal arc's source and target. | Right-click an arc; properties panel | |
| [Right-click menu](editor.md#the-right-click-menu) | What you can do with the thing under the pointer. | Right-click, or long-press on touch | |

## S

| Feature | What it does | Where | Key |
| --- | --- | --- | --- |
| [Safety slicing](slicing.md#the-algorithms) | Rakow's smaller slice for safety properties (AG, EF). | Analyse > Slice the net… | |
| [Save and Save as](file-formats.md#opening-importing-and-saving) | Writes the native `.pns.json` file. | File > Save, Save as… | Ctrl+S, Ctrl+Shift+S |
| [SBML export](file-formats.md#sbml) | Writes stochastic, continuous and hybrid nets for systems biology tools. | File > Export as | |
| [Select](editor.md#selecting-moving-and-arranging) | Click, Shift- or Ctrl-click, or drag a band; **Select only** picks all places, transitions or arcs. | Select tool; Edit > Select all, Select only | V, Ctrl+A |
| [Siphons and traps](analysis.md#siphons-and-traps) | Minimal siphons and traps and the siphon-trap property. | Net properties, **Siphons and traps** tab | |
| [Slice the net](slicing.md#slicing-a-net-in-the-editor) | Removes the parts that cannot influence the places a property reads, with twelve algorithms; compare state spaces, highlight, open or export the slice. | Analyse > Slice the net… | |
| [Snap to grid](editor.md#menus) | Nodes land on a 10 unit grid. | View > Snap to grid | G |
| [Snoopy files](file-formats.md#snoopy) | Reads and writes Snoopy files of every class. | File > Import…; File > Export as | |
| [Sound](simulation.md#music-nets) | Turns the notes of a music net on or off. | Token game controls | |
| [Step token game](ambient-petri-nets.md#playing-the-step-token-game) | Fires steps of colour modes in APNs and T-APNs, collected by hand or maximal. | Analyse > Ambient > Play the step token game | S, X |
| [Stochastic nets](net-classes.md#stochastic-nets) | Transitions fire after random delays given by rate functions. | File > New… | |
| [Stochastic simulation](simulation.md#stochastic-simulation) | Gillespie runs, averaged; a seed repeats a result. | Analyse > Simulate over time and plot… | |
| [Structural properties](analysis.md#structural-properties) | State machine, marked graph, free choice, pure, conservative, connected and more. | Net properties, **Structure** tab | |
| [Stubborn sets](slicing.md#stubborn-sets) | A reduced state space that keeps deadlocks and the markings of the places a property reads. | Slice and compare; framework pipeline | |
| [Subnets](editor.md#subnets-and-breadcrumbs) | Pages inside the net, drawn as coarse transitions; open, ungroup, hierarchy. | Edit > Group into subnet; double-click to open | Ctrl+G, Enter |
| [Switching class](net-classes.md#switching-class) | Changes the class of a Petri net, keeping what still fits. | Class badge in the toolbar | |

## T

| Feature | What it does | Where | Key |
| --- | --- | --- | --- |
| [T-APN](ambient-petri-nets.md#chapter-5-transformed-apns-t-apns) | The transformed APN of the thesis: guards and complementary colours instead of inhibitor arcs. | Construct T-APN; File > New… | |
| [Timed nets](net-classes.md#timed-nets) | Transitions with firing intervals; the timed token game has a clock. | File > New… | |
| [TINA export](file-formats.md#tina) | Writes the net for the TINA toolbox. | File > Export as | |
| [Token game](simulation.md#the-token-game) | Fire transitions by clicking them and see why others cannot fire. | Simulate switch; Analyse > Play the token game | S |
| [Touch gestures](editor.md#touch-gestures) | Tap, drag, pinch, double-tap, long-press on phones and tablets. | | |
| [Trace slicing](slicing.md#the-algorithms) | The firings of one sequence that feed the criterion. | Analyse > Slice the net… | |
| [Transition](net-classes.md#the-basic-firing-rule) | Moves tokens when it fires. | Palette > Transition | T |
| [Treat as an APN](ambient-petri-nets.md) | Reads a coloured net as an Ambient Petri net. | Analyse > Treat as an APN | |

## U

| Feature | What it does | Where | Key |
| --- | --- | --- | --- |
| [Undo and redo](editor.md#undo-auto-save-and-themes) | The last 300 steps. | Edit menu; toolbar | Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y |
| [Unfold](simulation.md#unfolding) | Turns a coloured net into an uncoloured one. | Analyse > Unfold to an uncoloured net | |
| [Ungroup subnet](editor.md#subnets-and-breadcrumbs) | Moves a subnet's contents back to the parent page. | Right-click a subnet | |

## V

| Feature | What it does | Where | Key |
| --- | --- | --- | --- |
| [Variables](net-classes.md#variables) | Named values of a colour set for inscriptions and guards. | Properties panel with nothing selected | |
| [Vertical transitions](editor.md#the-right-click-menu) | Draws a transition horizontally or vertically. | Right-click a transition; properties panel | |

## W

| Feature | What it does | Where | Key |
| --- | --- | --- | --- |
| [Wangyang slicing](slicing.md#the-algorithms) | Slices on the local reachability graph of the backward slice (survey Alg. 10). | Analyse > Slice the net… | |
| [Weights and inscriptions](net-classes.md#weights-markings-and-expressions) | How many tokens (or which colours) an arc moves. | Double-click an arc; properties panel | |

## Z

| Feature | What it does | Where | Key |
| --- | --- | --- | --- |
| [Zoom](editor.md#navigating-the-canvas) | 10% to 400%; fit the page or the selection. | View menu; toolbar; Ctrl+wheel or pinch | Ctrl++, Ctrl+−, F, Shift+F, Ctrl+0 |
