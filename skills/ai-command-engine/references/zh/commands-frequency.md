# 指令使用频率分类

本分类覆盖当前源码注册的 205 条指令。高频表示常见任务的优先入口，低频表示遇到特定任务再查。这里没有实际调用次数数据，也不以频率判断指令有效性。

原理图 49 条见[高频](commands-schematic-high.md)和[低频](commands-schematic-low.md)。PCB 93 条见[高频](commands-pcb-high.md)和[低频](commands-pcb-low.md)。其余 63 条按下表分类。参数以目标实例的帮助为准。

| 范围 | 高频入口 | 低频入口 | 详细说明 |
| --- | --- | --- | --- |
| 工程与图页（26） | `project.getInfo`、`project.list`、`project.open`、`project.getInfoOf`、`project.exportFile`、`project.importFile`、`project.listSchematicPages`、`project.listPcbs` | `project.getBoardInfo`、`project.associateBoard`、`project.create`、`project.moveToFolder`、`project.getDocumentSource`、`project.createSchematic`、`project.createSchematicPage`、`project.deleteSchematicPage`、`project.copySchematicPage`、`project.renameSchematicPage`、`project.reorderSchematicPages`、`project.modifyTitleBlock`、`project.createPcb`、`project.copyPcb`、`project.deletePcb`、`project.copyBoard`、`project.deleteBoard`、`project.renameBoard` | [工程与图页指令](commands-project.md) |
| 简易器件查询（2） | `library.searchDevice`、`library.getDeviceByLcsc` | 无 | [器件库指令](commands-lib.md) |
| 器件库管理（24） | `lib.symbolSearch`、`lib.symbolGet`、`lib.footprintSearch`、`lib.footprintGet`、`lib.deviceSearch`、`lib.deviceGet`、`lib.deviceGetByLcscIds` | `lib.symbolCreate`、`lib.symbolUpdateSource`、`lib.symbolCopy`、`lib.symbolModify`、`lib.symbolDelete`、`lib.symbolOpenInEditor`、`lib.footprintOpenInEditor`、`lib.footprintCreate`、`lib.footprintGetSource`、`lib.footprintUpdateSource`、`lib.footprintCopy`、`lib.footprintModify`、`lib.footprintDelete`、`lib.deviceCreate`、`lib.deviceCopy`、`lib.deviceModify`、`lib.deviceDelete` | [器件库指令](commands-lib.md) |
| 编辑器（6） | `editor.openDocument`、`editor.closeDocument`、`editor.screenshot`、`editor.listTabs` | `editor.zoomToAll`、`editor.zoomToRegion` | [连接与环境](setup.md) |
| 知识规则（3） | `knowledge.query` | `knowledge.listRules`、`knowledge.widthForCurrent` | [知识与物料指令](commands-knowledge.md) |
| 长任务恢复（2） | `task.get`、`task.list` | 无 | [问题排查](pitfalls.md) |

工程、器件库和编辑器命令只在对应任务中读取；高频不是每次都执行。
