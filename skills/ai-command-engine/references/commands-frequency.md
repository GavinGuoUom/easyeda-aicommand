# Command frequency categories

This classification covers 206 registered entries in the frozen command-source inventory, including one disabled PCB compatibility entry. It does not count how many commands are currently enabled or available. “High-frequency” means a recommended entry point for common tasks; “low-frequency” means consult it for a specific task. These labels are not based on actual invocation counts and do not determine whether a command is valid.

The 49 schematic commands are listed in [high-frequency](commands-schematic-high.md) and [low-frequency](commands-schematic-low.md). The PCB inventory has 94 registered entries: 93 other entries and one disabled compatibility entry. Active commands are listed in [high-frequency](commands-pcb-high.md) and [low-frequency](commands-pcb-low.md). The remaining 63 are grouped below. Use help from the target instance for parameters.

| Scope | High-frequency entry points | Low-frequency entry points | Details |
| --- | --- | --- | --- |
| Projects and pages (26) | `project.getInfo`, `project.list`, `project.open`, `project.getInfoOf`, `project.exportFile`, `project.importFile`, `project.listSchematicPages`, `project.listPcbs` | `project.getBoardInfo`, `project.associateBoard`, `project.create`, `project.moveToFolder`, `project.getDocumentSource`, `project.createSchematic`, `project.createSchematicPage`, `project.deleteSchematicPage`, `project.copySchematicPage`, `project.renameSchematicPage`, `project.reorderSchematicPages`, `project.modifyTitleBlock`, `project.createPcb`, `project.copyPcb`, `project.deletePcb`, `project.copyBoard`, `project.deleteBoard`, `project.renameBoard` | [Project and page commands](commands-project.md) |
| Basic device lookup (2) | `library.searchDevice`, `library.getDeviceByLcsc` | None | [Library commands](commands-lib.md) |
| Library management (24) | `lib.symbolSearch`, `lib.symbolGet`, `lib.footprintSearch`, `lib.footprintGet`, `lib.deviceSearch`, `lib.deviceGet`, `lib.deviceGetByLcscIds` | `lib.symbolCreate`, `lib.symbolUpdateSource`, `lib.symbolCopy`, `lib.symbolModify`, `lib.symbolDelete`, `lib.symbolOpenInEditor`, `lib.footprintOpenInEditor`, `lib.footprintCreate`, `lib.footprintGetSource`, `lib.footprintUpdateSource`, `lib.footprintCopy`, `lib.footprintModify`, `lib.footprintDelete`, `lib.deviceCreate`, `lib.deviceCopy`, `lib.deviceModify`, `lib.deviceDelete` | [Library commands](commands-lib.md) |
| Editor (6) | `editor.openDocument`, `editor.closeDocument`, `editor.screenshot`, `editor.listTabs` | `editor.zoomToAll`, `editor.zoomToRegion` | [Connection and setup](setup.md) |
| Knowledge rules (3) | `knowledge.query` | `knowledge.listRules`, `knowledge.widthForCurrent` | [Knowledge and parts commands](commands-knowledge.md) |
| Long-task recovery (2) | `task.get`, `task.list` | None | [Troubleshooting](pitfalls.md) |

Read project, library, and editor commands only when the task needs them. High-frequency does not mean they should be executed every time.
