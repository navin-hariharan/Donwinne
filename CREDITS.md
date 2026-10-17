# Credits

Donwinne is a Petri nets studio. It stands on the work of others, credited here.

## Snoopy: the inspiration

Donwinne is inspired by **Snoopy**, the Petri net modelling and simulation tool developed by the Data Structures and
Software Dependability group at Brandenburg University of Technology Cottbus-Senftenberg. Donwinne's net classes (from
place/transition nets to coloured, stochastic, continuous, hybrid and fuzzy nets, and fault trees), its declarations and
much of its file support follow Snoopy's design, and it reads and writes Snoopy files.

> M. Heiner, M. Herajy, F. Liu, C. Rohr and M. Schwarick. *Snoopy – a unifying Petri net tool.* In: Application and
> Theory of Petri Nets (PETRI NETS 2012), Lecture Notes in Computer Science, vol. 7347, pp. 398–407. Springer, 2012.

Snoopy website: <https://www-dssz.informatik.tu-cottbus.de/DSSZ/Software/Snoopy>

The net properties analysis (invariants, siphons and traps, structural and behavioural properties) follows the
property set of **Charlie**, the analysis tool from the same group:

> M. Heiner, M. Schwarick and J.-T. Wegener. *Charlie – an extensible Petri net analysis tool.* In: Application and
> Theory of Petri Nets and Concurrency (PETRI NETS 2015), Lecture Notes in Computer Science, vol. 9115, pp. 200–211.
> Springer, 2015.

Donwinne is an independent project and is not affiliated with or endorsed by the authors of Snoopy or Charlie.

## Alexandros Konios's thesis: the additional features

The Ambient Petri Net features (Ambient Petri Nets with colour-sensitive inhibitor arcs, step semantics, building
blocks and their composition, the construction of T-APNs from APNs, and the verification of ambient systems) are based
on the PhD thesis of Alexandros Konios:

> A. Konios. *Modelling and Verification of Ambient Systems using Petri Nets.* PhD thesis, School of Computing
> Science, Newcastle University, June 2015. Supervised by Marta Pietkiewicz-Koutny.

The example "Konios Fig. 3.1: colour-sensitive inhibitor arc" reproduces Figure 3.1 of the thesis.

## Open-source libraries

Donwinne is built with React, Zustand, Vite, elkjs (Eclipse Layout Kernel), Electron and Vitest. Each is used under
its own licence.
