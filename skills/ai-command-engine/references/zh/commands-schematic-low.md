# 原理图低频指令

这里的“低频”表示按特定任务调用，并非无用或未经验证。以下 31 条与[原理图高频指令](commands-schematic-high.md)合计覆盖当前 49 条 `schematic.*` 指令。参数和已知限制见[原理图详细说明](commands-schematic.md)。

| 场景 | 指令 |
| --- | --- |
| 功能区与定位 | `schematic.listRects`、`schematic.modifyRect`、`schematic.checkRectOverlap`、`schematic.placeRegion`、`schematic.getComponentsInRect`、`schematic.getPrimitivesInRegion`、`schematic.getPrimitiveAtPoint`、`schematic.getSelection` |
| 特殊创建与诊断 | `schematic.buildBlock`、`schematic.getPlacementResourcesDiagnostic`、`schematic.connectPin`、`schematic.setPinNoConnect` |
| 导线与标签修复 | `schematic.setWireNet`、`schematic.modifyWire`、`schematic.dedupeWireNets`、`schematic.repairNet`、`schematic.listNetLabels`、`schematic.pruneFloatingLabels`、`schematic.fixNetLabels`、`schematic.modifyNetLabel`、`schematic.moveLabel` |
| 布局、审计与详情 | `schematic.autoLayout`、`schematic.structuralAudit`、`schematic.runDrcDetailed` |
| 属性、删除与文字 | `schematic.getAttributes`、`schematic.delete`、`schematic.placeText`、`schematic.listTexts`、`schematic.modifyText` |
| 导出 | `schematic.exportBom`、`schematic.exportNetlist` |

修复指令先看目标对象和支持的 `dryRun`。结果不明时不要重复写入。


## 原理图补充

| 指令 | 作用 | 使用时机 | 限制 |
| --- | --- | --- | --- |
| `schematic.getPrimitiveAtPoint` | 查询指定坐标处的图元（返回 id+类型），排查"这个位置是什么" | 按区域或坐标定位对象时使用。 | 按目标实例帮助确认可用参数。 |
| `schematic.setAttribute` | 改器件属性（如位号 R?→R4，key=Designator）。<br>⚠️ 只能改已存在属性。<br>Footprint 别写裸名/空串（见 pitfalls G1/G2） | 调整本节已有对象时使用。 | 只能修改图元已有属性。 |
