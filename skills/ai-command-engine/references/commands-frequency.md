# Command frequency categories

This page covers the 205 commands registered in the current source. High-frequency means a recommended entry point for common tasks; low-frequency means consult when a specific task calls for it. No invocation-count data is available, and frequency does not indicate whether a command is valid.

See [high-frequency](commands-schematic-high.md) and [low-frequency](commands-schematic-low.md) for 49 schematic commands; [high-frequency](commands-pcb-high.md) and [low-frequency](commands-pcb-low.md) for 93 PCB commands. The remaining 63 commands are grouped below. Use the target instance's help for parameters.

| Area | High-frequency entry points | Low-frequency entry points | Details |
| --- | --- | --- | --- |
| Projects and schematic pages (26) | `project.getInfo`, `project.list`, `project.open`, `project.getInfoOf`, `project.exportFile`, `project.importFile`, `project.listSchematicPages`, `project.listPcbs` | `project.getBoardInfo`, `project.associateBoard`, `project.create`, `project.moveToFolder`, `project.getDocumentSource`, `project.createSchematic`, `project.createSchematicPage`, `project.deleteSchematicPage`, `project.copySchematicPage`, `project.renameSchematicPage`, `project.reorderSchematicPages`, `project.modifyTitleBlock`, `project.createPcb`, `project.copyPcb`, `project.deletePcb`, `project.copyBoard`, `project.deleteBoard`, `project.renameBoard` | [Project and page commands](commands-project.md) |
| Basic device lookup (2) | `library.searchDevice`, `library.getDeviceByLcsc` | None | [Library commands](commands-lib.md) |
| Library management (24) | `lib.symbolSearch`, `lib.symbolGet`, `lib.footprintSearch`, `lib.footprintGet`, `lib.deviceSearch`, `lib.deviceGet`, `lib.deviceGetByLcscIds` | `lib.symbolCreate`, `lib.symbolUpdateSource`, `lib.symbolCopy`, `lib.symbolModify`, `lib.symbolDelete`, `lib.symbolOpenInEditor`, `lib.footprintOpenInEditor`, `lib.footprintCreate`, `lib.footprintGetSource`, `lib.footprintUpdateSource`, `lib.footprintCopy`, `lib.footprintModify`, `lib.footprintDelete`, `lib.deviceCreate`, `lib.deviceCopy`, `lib.deviceModify`, `lib.deviceDelete` | [Library commands](commands-lib.md) |
| Editor (6) | `editor.openDocument`, `editor.closeDocument`, `editor.screenshot`, `editor.listTabs` | `editor.zoomToAll`, `editor.zoomToRegion` | [Connection and setup](setup.md) |
| Design knowledge and rules (3) | `knowledge.query` | `knowledge.listRules`, `knowledge.widthForCurrent` | [Knowledge and parts commands](commands-knowledge.md) |
| Long-task recovery (2) | `task.get`, `task.list` | None | [Troubleshooting](pitfalls.md) |

Read project, library, and editor commands only for the relevant task. High-frequency does not mean a command must be run every time.
