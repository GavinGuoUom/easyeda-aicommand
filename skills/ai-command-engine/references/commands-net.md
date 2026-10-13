# Net, Differential-Pair, and Manufacturing Export Commands (PCB)

> The tables and parameter objects on this page describe commands and `params`; they are not complete HTTP requests. A `/command` request must include outer `cmd`, top-level `instanceId`, and required `params`. A macro routes only at the outer level; its steps inherit the instance. See [setup](setup.md) for a complete example.

Layer management, stackup, length-matching groups, and real-time DRC are covered in sections ③ and ⑥ of [commands-pcb.md](commands-pcb.md). This page covers nets and manufacturing workflows only.

## Net classes and differential pairs

| Command | Description | Key parameters |
| --- | --- | --- |
| `pcb.createNetClass` | Create a net class (apply shared rules/color to a group of nets) | `name`, `nets[]`, `color?` |
| `pcb.listNetClasses` | List net classes | None |
| `pcb.deleteNetClass` | Delete a net class | `name` |
| `pcb.renameNetClass` | Rename a net class | `name`, `newName` |
| `pcb.addNetToClass` / `removeNetFromClass` | Add/remove members of a net class | `netClass`, `nets[]` |
| `pcb.createDiffPair` | Create a differential pair (for example, USB D+/D-) | `name`, `positiveNet`, `negativeNet` |
| `pcb.listDiffPairs` / `deleteDiffPair` | List/delete differential pairs | delete: `name` |
| `pcb.getNetRules` | Read net rules in current design rules (width/clearance, etc.; **read-only** because the write interface is structurally complex and not yet exposed) | None |
| `pcb.getNetLength` | Total routed length of a net (for length matching) | `net` |
| `pcb.getNetInfo` / `getNetPrimitives` | Detailed net info / all primitives on a net (tracks/vias/pads) | `net` |
| `pcb.highlightNet` | Highlight/unhighlight a net for diagnosis | `net` or `all:true`, `highlight?` |

## Manufacturing exports (decode base64 to local files yourself)

| Command | Description | Key parameters |
| --- | --- | --- |
| `pcb.exportGerber` | Gerber fabrication files (usually ZIP) | `fileName?` |
| `pcb.exportPickPlace` | Pick-and-place coordinates | `fileName?`, `fileType?` (xlsx\|csv), `unit?` (mm\|mil) |
| `pcb.exportDsn` | Specctra DSN (first step for an external autorouter: `exportDsn` → external router → import with `importAutoRouteSes`) | `fileName?` |
| `pcb.exportNetlist` | PCB netlist; since 0.10.104, rejects zero-byte files and empty base64. Parse and check the export afterward. | `fileName?`, `netlistType?` (such as Protel2) |

## Selection and cross-probing

| Command | Description | Key parameters |
| --- | --- | --- |
| `pcb.select` / `pcb.clearSelection` / `pcb.getSelection` | Select by ID / clear / read current selection | select: `primitiveIds[]` |
| `pcb.crossProbe` | Cross-probe designators/pins/nets between schematic and PCB (locate via linked highlight and selection) | `components?`/`pins?`/`nets?`, `highlight?`, `select?` |

## Additional schematic commands

| Command | Description | Key parameters |
| --- | --- | --- |
| `schematic.setPinNoConnect` | Set/clear the pin's X no-connect marker (remove floating-pin DRC warnings) | `componentId`, `pinNumbers[]`, `noConnected?` |
| `schematic.getAttributes` / `setAttribute` | Read/modify primitive attributes (keys such as Designator/Value/Footprint) | `primitiveId` (`setAttribute` also needs `key`,`value`) |
| `schematic.getSelection` | Read selected primitives | None |
| `schematic.exportBom` | Export BOM (xlsx/csv, base64) | `fileName?`, `fileType?` |
| `schematic.exportPng` | Export schematic PNG (maximum 4096 px per side) | `fileName?`, `width?`/`height?` |
| `schematic.listNets` | List all schematic nets (`detail:true` includes wire details) | `detail?` |

