# PCB低频指令

这里的“低频”表示按特定任务调用，并非无用或未经验证。以下 76 条与[PCB高频指令](commands-pcb-high.md)合计覆盖当前 94 条 `pcb.*` 指令。参数和已知限制见[PCB详细说明](commands-pcb.md)、[PCB几何命令](commands-pcb-special.md)、[网络与导出命令](commands-pcb-special.md)及[下单检查](commands-pcb-special.md)。

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

v0.20.38 暂行政策也在写前检查全部 routeTrack 段、SES 输入段及规划差集段；任一段短于 1 mil（25.4 μm）都拒绝，即使该几何已存在。阈值是插件政策，不是 SDK 下限；细节见[PCB详细说明](commands-pcb.md)。

写入失败后，只有完整文档身份与源码比对确认内容未变时，才跳过恢复写入；命令仍报告失败。无法确认时继续原恢复流程。该候选行为尚待宿主验收。

v0.20.38 候选中，`pcb.autoRouteStatus` 只查询任务状态并停用自动回灌；禁用结果及槽位处理见[PCB详细说明](commands-pcb.md)。历史回灌后的 DRC 仍须单独运行，不把不可读的违规数当成 0 项。

历史 v0.20.29 记录：首次 SES 导入失败时五条短线段未出现，且恢复未确认。多行 `wire`、`path` 和坐标对输出曾作为格式兼容候选。手工 `importAutoRouteSes` 仍只追加当前板上尚不存在的几何；全部已存在时返回 `imported:false`、`alreadyPresent:true`。旧版 `autoRouteStatus` 曾按 SDK 锁定状态保留锁定图元并替换未锁定铜层路由；当前自动回灌已停用。其他层线和弧保留为非目标内容；重建的 wire/via 不携带原始 `type` 字段，不保证保留全部 wire metadata。

v0.20.36 的本地候选会写前自动选择后端；A15 先加并验证新内容再删旧路由，两种 SES 后端失败均走专用恢复钩子，详细条件见[PCB详细说明](commands-pcb.md)。该候选本地集中回归及最终审查通过，宿主验收待完成。
v0.20.37 仅调整三处内部 JSON 快照的局部深拷贝，不加 polyfill、不改几何或恢复语义；候选本地集中回归及最终审查通过，宿主复测待完成，详见[PCB详细说明](commands-pcb.md)。

成功回执的 `sesGeometryVerified:true` 仅表示 SES 几何读回核对通过；孔径缺省、原有过孔和恢复未确认的处理见上文。失败时可在 `cause.sesDiagnostic` 查看诊断引用、状态和内联记录；诊断阶段有 500 ms 上限，超时或存储失败不会阻断恢复。成功回执不附加大诊断记录。

## EDA 版本限制

用户已决定在当前 EDA 4.1.78 暂停下列11项功能。0.20.49 已逐项验证在调用目标接口前拒绝，测试PCB源码保持。保留命令入口及版本保护，不自动尝试旧版替代路径；恢复前须取得适用宿主和逐项验收结果。

EDA 4.1.78 实机调用下列 11 条指令均明确报需要 EDA 4.2。不要把拒绝执行记为功能通过。此前识别的 14 条 4.2 专用指令仍须在真实 EDA 4.2 环境逐项验证；本表所列命令的实际执行、保存和读回尚未验证。

| 类别 | 4.1.78 不支持的指令 |
| --- | --- |
| 当前层 | `pcb.getCurrentLayer` |
| 物理层叠 | `pcb.listStackingConfigs`、`pcb.getStackingConfig`、`pcb.applyStackingConfig`、`pcb.saveStackingConfig`、`pcb.renameStackingConfig`、`pcb.deleteStackingConfig`、`pcb.setDefaultStackingConfig` |
| 实时 DRC | `pcb.startRealTimeDrc`、`pcb.stopRealTimeDrc`、`pcb.getRealTimeDrcStatus` |

## PCB 层/铺铜/过孔/文字

| 指令 | 作用 | 使用时机 | 限制 |
| --- | --- | --- | --- |
| `pcb.addCustomLayer` / `pcb.removeCustomLayer` | 自定义层增删（CUSTOM_1=71 起，只能删 CUSTOM 层） | 设置或核对PCB工作层时使用。 | 只能删除CUSTOM自定义层。 |
| `pcb.modifyLayer` / `pcb.setLayerLocked` | 改层属性（名/类型/颜色/透明度）/ 锁定层 | 设置或核对PCB工作层时使用。 | 写入未知时停止后续写入。 |
| `pcb.listPours` / `pcb.modifyPour` / `pcb.rebuildPour` | 铺铜查/改/重铺（listPours 可按网络/层过滤） | 建立或检查覆铜区域时使用。 | v0.20.42 候选暂拒不同网络/名称（含混合字段）；source/fresh getter 须一致。同值字段跳过，其他允许属性照常核验。不能据此确认填充新鲜度。 |
| `pcb.listVias` / `pcb.modifyVia` | 过孔查/改（网络/位置/孔径/外径） | 核对或调整过孔时使用。 | 写入未知时停止后续写入。 |
| `pcb.listStrings` / `pcb.modifyString` / `pcb.placeString` | PCB 文字（丝印）查/改/放 | 增加图纸说明或丝印时使用。 | 写入未知时停止后续写入。 |
| `pcb.setPcbType` | 板子类型（刚性 NORMAL / 柔性 FPC） | 调整本节已有对象时使用。 | 只接受 normal 或 fpc；SDK 返回 false 时命令报失败。 |

## PCB 网络类/差分/层叠低频项

`pcb.deleteNetClass` 删除网络类，不执行成员网络颜色恢复。EDA 4.1.78 / ACE 0.20.24 的样例曾在删除后保留网络专用颜色，保存重开仍保持。`deleted:true` 不表示恢复到创建前的全部状态；不能据此认定当前所有版本必然保留颜色。


| 指令 | 作用 | 使用时机 | 限制 |
| --- | --- | --- | --- |
| `pcb.deleteNetClass` / `pcb.removeNetFromClass` / `pcb.renameNetClass` | 网络类删/移出/改名 | 按网络组管理规则时使用。 | 先核对目标并备份。 |
| `pcb.deleteDiffPair` | 删差分对（建/查见 PCB专题） | 配置或核对差分信号时使用。 | 先核对目标并备份。 |
| `pcb.deleteStackingConfig` / `pcb.setDefaultStackingConfig` | 层叠配置删/设默认（建/应用见 commands-pcb.md） | 配置或检查多层板层叠时使用。 | 按配置名称核对目标。 |
| `pcb.removeNetFromEqualLengthGroup` | 网络移出等长组 | 管理需要等长的网络时使用。 | 先核对目标并备份。 |
| `pcb.getNetPrimitives` | 查网络上的全部图元（走线/过孔/焊盘） | 分析指定网络连接对象时使用。 | 按目标实例帮助确认可用参数。 |
