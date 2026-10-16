# PCB低频指令

这里的“低频”表示按特定任务调用，并非无用或未经验证。以下 76 条与[PCB高频指令](commands-pcb-high.md)合计覆盖当前 93 条 `pcb.*` 指令。参数和已知限制见[PCB详细说明](commands-pcb.md)、[PCB几何命令](commands-pcb-special.md)、[网络与导出命令](commands-pcb-special.md)及[下单检查](commands-pcb-special.md)。

| 场景 | 指令 |
| --- | --- |
| 自动布线、扇出与局部几何 | `pcb.autoRouteStart`、`pcb.autoRouteStatus`、`pcb.autoRouteStop`、`pcb.importAutoRouteSes`、`pcb.exportDsn`、`pcb.getFanoutPlan`、`pcb.fanout`、`pcb.getPadExpansionPlan`、`pcb.expandPads`、`pcb.groupBySchematicRegions`、`pcb.sourceRollback` |
| 自动铜与丝印 | `pcb.getAutoCopperPlan`、`pcb.autoCopper`、`pcb.getPourFillReadback`、`pcb.getNetSilkscreenPlan`、`pcb.generateNetSilkscreen`、`pcb.listStrings`、`pcb.placeString`、`pcb.modifyString`、`pcb.modifyPour` |
| 规则、网络与检查 | `pcb.runDrcDetailed`、`pcb.runDfm`、`pcb.runSmtDfm`、`pcb.checkSameNetPadSpacing`、`pcb.getNetRules`、`pcb.getNetLength`、`pcb.getNetPrimitives`、`pcb.highlightNet`、`pcb.setNetLock`、`pcb.startRealTimeDrc`、`pcb.stopRealTimeDrc`、`pcb.getRealTimeDrcStatus` |
| 网络类、差分对与等长组 | `pcb.createDiffPair`、`pcb.listDiffPairs`、`pcb.deleteDiffPair`、`pcb.createNetClass`、`pcb.listNetClasses`、`pcb.addNetToClass`、`pcb.removeNetFromClass`、`pcb.deleteNetClass`、`pcb.renameNetClass`、`pcb.createEqualLengthGroup`、`pcb.listEqualLengthGroups`、`pcb.renameEqualLengthGroup`、`pcb.deleteEqualLengthGroup`、`pcb.addNetToEqualLengthGroup`、`pcb.removeNetFromEqualLengthGroup` |
| 图层与层叠 | `pcb.getCurrentLayer`、`pcb.selectLayer`、`pcb.setCopperLayers`、`pcb.setLayerVisible`、`pcb.setLayerLocked`、`pcb.listStackingConfigs`、`pcb.getStackingConfig`、`pcb.applyStackingConfig`、`pcb.saveStackingConfig`、`pcb.renameStackingConfig`、`pcb.deleteStackingConfig`、`pcb.setDefaultStackingConfig`、`pcb.addCustomLayer`、`pcb.removeCustomLayer`、`pcb.modifyLayer`、`pcb.setPcbType` |
| 定位、图元与选择 | `pcb.getSelection`、`pcb.select`、`pcb.clearSelection`、`pcb.crossProbe`、`pcb.listLines`、`pcb.modifyLine`、`pcb.listVias`、`pcb.modifyVia`、`pcb.getPrimitivesInRegion`、`pcb.getPrimitiveAtPoint`、`pcb.delete` |
| 工程同步与其他导出 | `pcb.importChanges`、`pcb.exportNetlist` |

`pcb.importChanges` 的现行操作边界见技能入口与[PCB详细说明](commands-pcb.md)。层叠、自动布线和批量几何操作先核对目标及结果。

## PCB 层/铺铜/过孔/文字

| 指令 | 作用 | 使用时机 | 限制 |
| --- | --- | --- | --- |
| `pcb.addCustomLayer` / `pcb.removeCustomLayer` | 自定义层增删（CUSTOM_1=71 起，只能删 CUSTOM 层） | 设置或核对PCB工作层时使用。 | 只能删除CUSTOM自定义层。 |
| `pcb.modifyLayer` / `pcb.setLayerLocked` | 改层属性（名/类型/颜色/透明度）/ 锁定层 | 设置或核对PCB工作层时使用。 | 写入未知时停止后续写入。 |
| `pcb.listPours` / `pcb.modifyPour` / `pcb.rebuildPour` | 铺铜查/改/重铺（listPours 可按网络/层过滤） | 建立或检查覆铜区域时使用。 | 不能据此确认填充新鲜度。 |
| `pcb.listVias` / `pcb.modifyVia` | 过孔查/改（网络/位置/孔径/外径） | 核对或调整过孔时使用。 | 写入未知时停止后续写入。 |
| `pcb.listStrings` / `pcb.modifyString` / `pcb.placeString` | PCB 文字（丝印）查/改/放 | 增加图纸说明或丝印时使用。 | 写入未知时停止后续写入。 |
| `pcb.setPcbType` | 板子类型（刚性 NORMAL / 柔性 FPC） | 调整本节已有对象时使用。 | 写入未知时停止后续写入。 |

## PCB 网络类/差分/层叠低频项

| 指令 | 作用 | 使用时机 | 限制 |
| --- | --- | --- | --- |
| `pcb.deleteNetClass` / `pcb.removeNetFromClass` / `pcb.renameNetClass` | 网络类删/移出/改名 | 按网络组管理规则时使用。 | 先核对目标并备份。 |
| `pcb.deleteDiffPair` | 删差分对（建/查见 PCB专题） | 配置或核对差分信号时使用。 | 先核对目标并备份。 |
| `pcb.deleteStackingConfig` / `pcb.setDefaultStackingConfig` | 层叠配置删/设默认（建/应用见 commands-pcb.md） | 配置或检查多层板层叠时使用。 | 按配置名称核对目标。 |
| `pcb.removeNetFromEqualLengthGroup` | 网络移出等长组 | 管理需要等长的网络时使用。 | 先核对目标并备份。 |
| `pcb.getNetPrimitives` | 查网络上的全部图元（走线/过孔/焊盘） | 分析指定网络连接对象时使用。 | 按目标实例帮助确认可用参数。 |
