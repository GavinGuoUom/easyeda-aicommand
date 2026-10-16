# Low-frequency schematic commands

“Low-frequency” means commands used for specific tasks; it does not mean they are useless or unverified. These 31 commands plus the [high-frequency schematic commands](commands-schematic-high.md) cover the current 49 `schematic.*` commands. See the [detailed schematic reference](commands-schematic.md) for parameters and known limitations.

| Scenario | Commands |
| --- | --- |
| Functional regions and locating objects | `schematic.listRects`, `schematic.modifyRect`, `schematic.checkRectOverlap`, `schematic.placeRegion`, `schematic.getComponentsInRect`, `schematic.getPrimitivesInRegion`, `schematic.getPrimitiveAtPoint`, `schematic.getSelection` |
| Special creation and diagnostics | `schematic.buildBlock`, `schematic.getPlacementResourcesDiagnostic`, `schematic.connectPin`, `schematic.setPinNoConnect` |
| Wire and label repair | `schematic.setWireNet`, `schematic.modifyWire`, `schematic.dedupeWireNets`, `schematic.repairNet`, `schematic.listNetLabels`, `schematic.pruneFloatingLabels`, `schematic.fixNetLabels`, `schematic.modifyNetLabel`, `schematic.moveLabel` |
| Layout, audit, and details | `schematic.autoLayout`, `schematic.structuralAudit`, `schematic.runDrcDetailed` |
| Attributes, deletion, and text | `schematic.getAttributes`, `schematic.delete`, `schematic.placeText`, `schematic.listTexts`, `schematic.modifyText` |
| Export | `schematic.exportBom`, `schematic.exportNetlist` |

Before using a repair command, inspect the target object and whether `dryRun` is supported. Do not repeat a write when its result is unknown.

## Schematic additions

| Command | Purpose | When to use | Limitation |
| --- | --- | --- | --- |
| `schematic.getPrimitiveAtPoint` | Query the primitive at given coordinates (returns its ID and type) to answer “what is at this location?” | Locate an object by region or coordinates. | Check available parameters in the target instance's help. |
| `schematic.setAttribute` | Change a component attribute (for example, designator `R?` → `R4`, `key=Designator`). ⚠️ Only existing attributes can be changed. Do not set `Footprint` to a bare name or empty string (see G1/G2 in [pitfalls](pitfalls.md)). | Adjust attributes of existing objects described on this page. | Can modify only attributes already present on the primitive. |
