# PCB Workflow

First use [Connection and environment](setup.md) to confirm the window, project, PCB document, and units. Common entry points are [Frequently used PCB commands](commands-pcb-high.md); specialized entry points are [Less frequently used PCB commands](commands-pcb-low.md). Check parameters and return fields using `/help?cmd=<command-name>` for the confirmed version of the selected window. `/help` uses the window currently selected by the proxy.

## Receive the Design and Inspect the Current State

The user initiates and confirms schematic-to-PCB updates in the EDA interface. AI must not call `pcb.importChanges` or the official import API. Before and after an update, use `pcb.listComponents`, `getComponentPads`, and `listNets` to check component identity, footprint associations, each pad's net, and non-target objects. A successful plugin response does not replace saving, reopening, or checking the whole board.

## Board Outline, Layers, and Placement

- Public coordinates for `pcb.drawOutline` use the lower-left corner as the origin and mil as the unit. Before drawing a duplicate outline, inspect the actual primitive type and ID; do not assume it is a Region.
- Check layer count and stackup separately. `getStackingConfig` reads the complete configuration; read it back after `applyStackingConfig`. Setting a default stackup does not mean it has been applied to the current PCB. Reactivate the PCB after changing custom layers. Do not guess unknown layer names or numbers.
- After `pcb.moveComponent`, use `checkPlacement` to check spacing. It uses pad bounding boxes and cannot replace checks of component bodies, silkscreen, and mechanical dimensions. If `complete:false` or objects were skipped, do not report all placement checks as passing.
- Use `pcb.groupBySchematicRegions` when explicitly asked to organize by schematic functional regions. First inspect `dryRun`, whether the board outline can contain the placement, and the source of the dimensions; then execute and read back. It is not the entry point for moving an ordinary individual component.

## Fanout, Routing, and Autorouting

After fixing the position of a fine-pitch component, use `pcb.getFanoutPlan` to inspect the target, layer, dimensions, and `executable`; then pass the complete `data` as `params.plan` to `pcb.fanout`. See [PCB geometry commands](commands-pcb-special.md) for geometric scope.

Use `pcb.routeTrack` for manual routing and `pcb.placeVia` to change layers. First confirm that the net exists, then select trace width and drill size based on current, rules, and board layers. A failed segmented write may have applied some segments; use returned IDs and current primitives to inspect the board, and do not resend immediately. An equal-length group records grouping only; it does not prove that the routes are equal in length.

Use autorouting only when the task requires it: lock the nets that must be retained, submit `autoRouteStart`, use `autoRouteStatus` to confirm the task and imported results, then inspect the actual tracks and DRC. Successful submission does not mean that routing is running. Automatic import may clear unlocked tracks; confirm the original task and target before importing. External DSN/SES import is a separate workflow; do not infer that it has the same track-clearing behavior.

## Copper Pours and Silkscreen

`pcb.pourCopper` creates a boundary. Rebuild with `rebuildPour`, then use `listPours` or `getPourFillReadback` to confirm the actual fill. If fill status is `empty` or `unknown`, do not report the pour as complete. A `completed` result from `rebuildPour` does not prove that the fill is fresh, saved, or manufacturable. Check the fill again after changing the boundary, priority, or nearby routing. If the result is unclear, stop; do not present an old fill as the result of this operation.

For local copper, first distinguish `pour` (clipped by rules) from `fill` (fixed fill), then plan and execute as described in [PCB geometry commands](commands-pcb-special.md). An arbitrary priority value in `modifyPour` is not guaranteed to be attainable; use the source readback after writing. Do not assume success from the API response.

After `placeString` or `modifyString`, check readability, mirroring, orientation, pad obstruction, and distance from the board edge. Net silkscreen still requires the planning command and a check of the actual board view.

## Checks, Saving, and Manufacturing Exports

After routing and copper pours, run `pcb.runDrc`; use `runDrcDetailed` to locate specific issues. DRC does not cover component bodies, all mechanical requirements, or all manufacturing requirements. See [Order checks](commands-pcb-special.md) for materials, units, and coverage of `runDfm`, `runSmtDfm`, and same-net pad spacing. Do not report a pass when the checks do not fully cover the required scope.

After saving at each stage, check target and non-target objects. To establish persistence, close and reopen the document, then read it back again. After exporting Gerber, pick-and-place coordinates, or a netlist, check that the files match the PCB version and verify their format, units, and actual contents; see [Networks and manufacturing exports](commands-pcb-special.md).

Before deleting, inspect the target primitive IDs and make a backup. If the readback after `pcb.delete` is unknown, stop further deletions. Use `pcb.sourceRollback` only when a specific backup must be restored. Confirm the PCB UUID before restoring, then read back and save after restoration. Closing a tab is not a reliable rollback.
