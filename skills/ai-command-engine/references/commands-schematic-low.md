# Schematic low-frequency commands

“Low-frequency” means used for specific tasks; it does not mean invalid or unverified. These 31 commands and the [18 high-frequency schematic commands](commands-schematic-high.md) cover the current 49 `schematic.*` commands. See [Schematic workflow](commands-schematic.md) for parameters and known limitations.

| Scenario | Commands |
| --- | --- |
| Functional areas and navigation | `schematic.listRects`, `schematic.modifyRect`, `schematic.checkRectOverlap`, `schematic.placeRegion`, `schematic.getComponentsInRect`, `schematic.getPrimitivesInRegion`, `schematic.getPrimitiveAtPoint`, `schematic.getSelection` |
| Specialized creation and diagnostics | `schematic.buildBlock`, `schematic.getPlacementResourcesDiagnostic`, `schematic.connectPin`, `schematic.setPinNoConnect` |
| Wire and label repair | `schematic.setWireNet`, `schematic.modifyWire`, `schematic.dedupeWireNets`, `schematic.repairNet`, `schematic.listNetLabels`, `schematic.pruneFloatingLabels`, `schematic.fixNetLabels`, `schematic.modifyNetLabel`, `schematic.moveLabel` |


| Layout, audit, and details | `schematic.autoLayout`, `schematic.structuralAudit`, `schematic.runDrcDetailed` |
| Attributes, deletion, and text | `schematic.getAttributes`, `schematic.delete`, `schematic.placeText`, `schematic.listTexts`, `schematic.modifyText` |
| Export | `schematic.exportBom`, `schematic.exportNetlist` |

In v0.20.12, changing the style of a named wire with `schematic.modifyWire` on the host cleared its NET. In v0.20.16, omitting line width or style was also confirmed to clear it. Since v0.20.18, pass the complete style in the same call, including an explicit NET when needed, and preserve an empty NET attribute. On the current host, changing the color of one empty-NET wire and two explicitly same-name wires in a batch passed save/reopen checks. Verify each wire and the source at the end of single or batch operations; stop on failure and attempt recovery. Since v0.20.19, actively changing a line type accepts only the verified values `0/SOLID`, `1/SHORT_DASH`, and `2/DOT`. On the current EDA 4.1.78 host, actively changing a single named wire through each type and saving/reopening passed. Other source encodings are rejected before writing. Batch active changes and complex multi-segment wires have not been accepted.

Before repair commands, inspect the target object and supported `dryRun` option. If the result is unknown, do not repeat the write.

`schematic.getPrimitivesInRegion` returns only primitives fully contained in the specified rectangle. A primitive that intersects the boundary without being fully contained is not returned. EDA 4.2 has not been accepted on a real host.

## EDA version limitations

The user has decided to pause the following three features on the current EDA 4.1.78 host. v0.20.49 verified that each is rejected before calling the target interface, leaving the schematic source unchanged. Keep the command entry and version guard; do not try an older fallback path automatically. Resumption requires an applicable host and individual acceptance results.

Real calls on EDA 4.1.78 explicitly reported that all three commands below require EDA 4.2. The official `schematic.modifyText` operation on 4.1.78 also reverts after save and reopen. Actual execution and persistence on EDA 4.2 have not been verified.

| Command | EDA 4.1.78 status |
| --- | --- |
| `schematic.modifyText` | The plugin rejects it; the official modification reverts after save and reopen. |
| `schematic.getPrimitivesInRegion` | The plugin rejects it. |
| `schematic.getPrimitiveAtPoint` | The plugin rejects it. |

## Additional schematic notes

| Command | Purpose | When to use | Limitation |
| --- | --- | --- | --- |
| `schematic.getPrimitiveAtPoint` | Query the primitive at a coordinate (returns ID and type) to investigate “what is at this position?” | Locate an object by region or coordinate. | Check parameters in the target instance's help. |
| `schematic.setAttribute` | Change a component attribute, such as designator `R?` to `R4` with `key=Designator`.<br>Only changes an existing attribute.<br>Do not use a bare or empty footprint name; see pitfalls G1/G2. | Adjust an existing object. | `primitiveId` and `key` must be non-empty strings; `value` must be a string and may be empty to clear the value. Only existing attributes can be changed. |

`schematic.connectPin` in v0.20.51 preserves pin-coordinate precision instead of rounding connection endpoints. Five EDA 4.1.78 cases—half-grid offsets in four directions and an integer-aligned case—passed endpoint, netlist, and save/reopen checks. This does not establish whole-design DRC or acceptance of other wiring features.
