# Low-Frequency Command Appendix (32 commands, 0.10.62 reference)

> The tables and parameter objects on this page describe commands and `params`, not complete HTTP requests. When sending `/command`, the outer request must include `cmd`, the top-level `instanceId`, and the required `params`. A macro routes only the outer request; its steps inherit the instance. See [setup](setup.md) for a complete example.

Commands used infrequently and not listed in detail in the main documentation are grouped by object and described briefly. **Always use `GET /help?cmd=<name>` to look up parameter details online; do not guess.**

## Additional schematic commands

| Command | Description |
| --- | --- |
| `schematic.getPrimitiveAtPoint` | Find a primitive at the specified coordinates (returns ID and type); useful for checking “what is at this location?” |
| `schematic.setAttribute` | Change a component attribute (e.g. reference designator R? → R4, with `key=Designator`). ⚠️ Can only change an existing attribute. Do not set `Footprint` to a bare name or an empty string (see pitfalls G1/G2). |

## Library management (`lib.*`; remember across all families: UUID may change after Modify—since 0.10.62 all three Modify commands perform a built-in lookup and return `uuid`/`uuidChanged`/`verify`; Copy/Delete still trust the returned value, so verify failures by name)

| Command | Description |
| --- | --- |
| `lib.symbolGet` / `lib.symbolModify` / `lib.symbolCopy` / `lib.symbolDelete` | Four symbol operations (Modify includes a UUID lookup since 0.10.62) |
| `lib.footprintGet` / `lib.footprintModify` / `lib.footprintCopy` / `lib.footprintDelete` / `lib.footprintUpdateSource` | Four footprint operations plus source write-back (Get rejects an unknown UUID instead of returning empty; an error does not mean the item is gone—search by name) |
| `lib.deviceGet` / `lib.deviceCopy` / `lib.deviceDelete` | Three device operations (fails if the target library already contains the name) |

## PCB layers, copper pours, vias, and text

| Command | Description |
| --- | --- |
| `pcb.addCustomLayer` / `pcb.removeCustomLayer` | Add/remove a custom layer (`CUSTOM_1` starts at 71; only `CUSTOM` layers can be removed) |
| `pcb.modifyLayer` / `pcb.setLayerLocked` | Change layer properties (name/type/color/opacity) / lock a layer |
| `pcb.listPours` / `pcb.modifyPour` / `pcb.rebuildPour` | List/change/rebuild copper pours (`listPours` can filter by net/layer) |
| `pcb.listVias` / `pcb.modifyVia` | List/change vias (net/location/hole diameter/outer diameter) |
| `pcb.listStrings` / `pcb.modifyString` / `pcb.placeString` | List/change/place PCB text (silkscreen) |
| `pcb.setPcbType` | Set board type (rigid `NORMAL` / flexible `FPC`) |

## Low-frequency PCB net, differential-pair, and stackup commands

| Command | Description |
| --- | --- |
| `pcb.deleteNetClass` / `pcb.removeNetFromClass` / `pcb.renameNetClass` | Delete a net class / remove a net from a class / rename a class |
| `pcb.deleteDiffPair` | Delete a differential pair (see commands-net.md for creation and lookup) |
| `pcb.deleteStackingConfig` / `pcb.setDefaultStackingConfig` | Delete a stackup configuration / set the default (see commands-pcb.md for creation and application) |
| `pcb.removeNetFromEqualLengthGroup` | Remove a net from an equal-length group |
| `pcb.getNetPrimitives` | Get all primitives on a net (tracks/vias/pads) |

## Maintenance

Add new commands to the main reference (`commands-*.md`) or this appendix first. Remove a command from this appendix when it is promoted to a main reference. Check documentation coverage with `t_docdiff.py` in the workspace; the remaining differences should be false positives only.
