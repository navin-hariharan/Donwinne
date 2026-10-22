<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo/donwinne-logo-dark.svg">
    <img src="assets/logo/donwinne-logo-light.svg" alt="Donwinne, Petri nets studio" width="360">
  </picture>
</p>

# Donwinne documentation

These pages explain how to use Donwinne and how it works inside. Start with the [project README](../README.md) for an
overview, then read the page for what you want to do.

## Guides

| Page | Read it to learn |
| --- | --- |
| [The editor](editor.md) | The window, menus and palette; drawing and editing nets; subnets; the properties and bottom panels; keyboard shortcuts; touch gestures; phones, tablets and the desktop app |
| [Net classes](net-classes.md) | What each of the 24 net classes means, the six arc types, markings and expressions, Snoopy-style declarations, and fault trees |
| [Simulation](simulation.md) | The token game, the timed token game, stochastic, continuous, hybrid and fuzzy simulation, plots and unfolding |
| [Analysis](analysis.md) | The reachability graph, net properties, invariants, siphons and traps, structural properties, and fault tree analysis |
| [Ambient Petri nets](ambient-petri-nets.md) | Konios's thesis chapter by chapter: APNs, step semantics, the CRG, building blocks, T-APNs, the construction φ, equivalence, verification, and a full walkthrough of the ambient garage |
| [CTL model checking](ctl.md) | Formula syntax, semantics, witnesses and counterexamples, the 22 property templates, path queries and fault tolerance |
| [File formats](file-formats.md) | The native `.pns.json` format, Snoopy, PNML, ANDL / CANDL, and every export |
| [Architecture](architecture.md) | The packages, the data model, the store, the desktop app, building, testing and extending Donwinne |

## Suggested reading paths

- **New to Petri nets:** [Net classes](net-classes.md#the-basic-firing-rule), then [The editor](editor.md#drawing-a-net), then [Simulation](simulation.md).
- **Coming from Snoopy:** [Net classes](net-classes.md#summary-of-classes), [File formats](file-formats.md#snoopy) and the [keyboard shortcuts](editor.md#keyboard-shortcuts).
- **Studying ambient systems:** the [thesis](thesis/Konios-2015-Modelling-and-Verification-of-Ambient-Systems-using-Petri-Nets.pdf), then [Ambient Petri nets](ambient-petri-nets.md) and [CTL model checking](ctl.md).
- **Contributing code:** [Architecture](architecture.md), then the source of the package you want to change.

## The thesis

[`thesis/Konios-2015-Modelling-and-Verification-of-Ambient-Systems-using-Petri-Nets.pdf`](thesis/Konios-2015-Modelling-and-Verification-of-Ambient-Systems-using-Petri-Nets.pdf)

A. Konios. *Modelling and Verification of Ambient Systems using Petri Nets.* PhD thesis, School of Computing Science,
Newcastle University, June 2015. Donwinne's ambient features implement it; [Ambient Petri nets](ambient-petri-nets.md)
maps every definition, figure and result to the app.

## Assets

Everything in `assets/` can be reused in talks, posters and coursework about Donwinne, under the terms of the
[licence](../LICENSE.md).

### Logo (`assets/logo/`)

The mark draws a "D" as a Petri net: the stem is a transition, and two arcs lead to and from a place.

| File | Use |
| --- | --- |
| [`donwinne-logo-light.svg`](assets/logo/donwinne-logo-light.svg), [`.png`](assets/logo/donwinne-logo-light.png) | Logo with wordmark, for light backgrounds |
| [`donwinne-logo-dark.svg`](assets/logo/donwinne-logo-dark.svg), [`.png`](assets/logo/donwinne-logo-dark.png) | Logo with wordmark, for dark backgrounds |
| [`donwinne-icon.svg`](assets/logo/donwinne-icon.svg) | App icon (rounded square) |
| [`donwinne-icon-512.png`](assets/logo/donwinne-icon-512.png), [`donwinne-icon-1024.png`](assets/logo/donwinne-icon-1024.png) | App icon as PNG |
| [`donwinne-mark.svg`](assets/logo/donwinne-mark.svg) | The mark alone, in one colour |
| [`donwinne-favicon.svg`](assets/logo/donwinne-favicon.svg) | Browser tab icon |

| Light | Dark | Icon |
| :---: | :---: | :---: |
| <img src="assets/logo/donwinne-logo-light.svg" alt="Light logo" width="240"> | <img src="assets/logo/donwinne-logo-dark.png" alt="Dark logo" width="240"> | <img src="assets/logo/donwinne-icon.svg" alt="Icon" width="72"> |

### Diagrams (`assets/diagrams/`)

| File | Shows | Used in |
| --- | --- | --- |
| [`architecture.svg`](assets/diagrams/architecture.svg) | The packages and how they depend on each other | [Architecture](architecture.md) |
| [`apn-pipeline.svg`](assets/diagrams/apn-pipeline.svg) | From building blocks to an APN, its CRG, the T-APN, equivalence and verification | [Ambient Petri nets](ambient-petri-nets.md) |

### Animations (`assets/gifs/`)

| File | Shows | Used in |
| --- | --- | --- |
| [`draw-a-net.gif`](assets/gifs/draw-a-net.gif) | Drawing places, transitions and arcs with the **+** handle | [The editor](editor.md#drawing-a-net) |
| [`arc-menu.gif`](assets/gifs/arc-menu.gif) | Choosing an arc type from the palette | [The editor](editor.md#the-arc-type-chooser) |
| [`auto-layout.gif`](assets/gifs/auto-layout.gif) | Auto layout | [The editor](editor.md#auto-layout) |
| [`phone.gif`](assets/gifs/phone.gif) | Donwinne on a phone | [The editor](editor.md#phones-tablets-and-desktops) |
| [`token-game.gif`](assets/gifs/token-game.gif) | Firing transitions in the token game | [Simulation](simulation.md) |
| [`simulation-plot.gif`](assets/gifs/simulation-plot.gif) | Running a simulation and watching the plot | [Simulation](simulation.md) |
| [`step-game.gif`](assets/gifs/step-game.gif) | Firing steps in an Ambient Petri net | [Ambient Petri nets](ambient-petri-nets.md#playing-the-step-token-game) |
| [`ctl-replay.gif`](assets/gifs/ctl-replay.gif) | Checking a CTL formula and replaying its witness | [CTL model checking](ctl.md#witnesses-and-counterexamples) |

### Screenshots (`assets/images/`)

| Topic | Files |
| --- | --- |
| Overview | `hero-light.png`, `hero-dark.png`, `editor-tour.png`, `dark-mode.png`, `desktop-app.png` |
| Editing | `new-dialog.png`, `class-menu.png`, `arc-menu.png`, `file-menu.png`, `properties-panel.png`, `declarations.png`, `element-table.png`, `subnets.png`, `subnet-parent.png`, `help.png` |
| Simulation | `token-game.png`, `token-trail.png`, `timed-token-game.png`, `coloured-simulation-dark.png`, `stochastic-plot.png`, `continuous-plot.png`, `hybrid-plot.png` |
| Analysis | `reachability-graph.png`, `net-properties.png`, `invariants.png`, `fault-tree.png`, `fault-tree-analysis.png` |
| Ambient Petri nets | `fig-3-1.png`, `ambient-garage.png`, `ambient-conference.png`, `step-game.png`, `crg.png`, `apn-properties.png`, `building-blocks.png`, `compose.png`, `tapn-construction.png`, `tapn-net.png`, `equivalence.png` |
| Verification | `ctl-dialog.png`, `ctl-templates.png`, `paths.png`, `fault-tolerance.png` |
| Devices | `phone-portrait.png`, `phone-landscape.png`, `tablet.png` |
