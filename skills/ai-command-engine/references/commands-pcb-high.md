# Frequently Used PCB Commands

“Frequently used” refers to recommendations for common board-design workflows, not command-call statistics. First confirm the target window using [Connection and environment](setup.md). `GET /help?cmd=<command-name>` uses the window currently selected by the proxy; confirm that it matches the target version before using the returned parameters. See [PCB command reference](commands-pcb.md) for all limitations. For specific rules, stackups, and specialized operations, see [Less frequently used PCB commands](commands-pcb-low.md).

| Stage | Recommended commands | Purpose |
| --- | --- | --- |
| Inspect current state | `pcb.listComponents`, `pcb.getComponentPads`, `pcb.listNets`, `pcb.listLayers` | Confirm components, pad nets, and layers. |
| Placement and board outline | `pcb.moveComponent`, `pcb.checkPlacement`, `pcb.drawOutline` | Place components, check spacing, and create the board outline. |
| Routing | `pcb.routeTrack`, `pcb.placeVia` | Draw tracks and change layers. |
| Copper pours | `pcb.pourCopper`, `pcb.listPours`, `pcb.rebuildPour` | Create, inspect, and rebuild copper regions. |
| Checks | `pcb.runDrc`, `pcb.getNetInfo` | Check design rules and target nets. |
| Save and manufacture | `pcb.save`, `pcb.exportGerber`, `pcb.exportPickPlace` | Save and generate manufacturing files as needed. |

This page lists 17 commands. PCB coordinates and lengths use mil. `pourCopper` creates only a copper-pour boundary; use `rebuildPour` to check the actual fill. If the result is `no-fill`, do not report the copper pour as complete. A clean DRC alone does not prove that the board is manufacturable.
