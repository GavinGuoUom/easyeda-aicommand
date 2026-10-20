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

`schematic.modifyWire` 在 v0.20.12 宿主对已命名导线改样式曾清空 NET，v0.20.16 又证实省略线宽/线型会将其清空。v0.20.18 同次传完整样式及必要的显式 NET，并保留空值 NET 属性；空 NET 单线和两条显式同名导线批量改色已在当前宿主保存重开通过。逐根及批量末尾核对对象和源码，失败停止并尝试恢复。v0.20.19 的主动线型仅接受已核实的 `0/SOLID`、`1/SHORT_DASH`、`2/DOT`；单根命名线依次主动变更并各自保存重开已在当前 4.1.78 宿主通过。其它源编码写前拒绝，批量主动变更与复杂多段线未验收。

修复指令先看目标对象和支持的 `dryRun`。结果不明时不要重复写入。

## EDA 版本限制

用户已决定在当前 EDA 4.1.78 暂停下列3项功能。0.20.49 已逐项验证在调用目标接口前拒绝，测试原理图源码保持。保留命令入口及版本保护，不自动尝试旧版替代路径；恢复前须取得适用宿主和逐项验收结果。

EDA 4.1.78 实机调用下列 3 条指令均明确报需要 EDA 4.2。`schematic.modifyText` 在 4.1.78 的官方修改还会在保存重开后回退。EDA 4.2 的实际执行与持久化尚未验证。

| 指令 | 4.1.78 状态 |
| --- | --- |
| `schematic.modifyText` | 本插件拒绝执行；官方修改保存重开后回退。 |
| `schematic.getPrimitivesInRegion` | 本插件拒绝执行。 |
| `schematic.getPrimitiveAtPoint` | 本插件拒绝执行。 |

`schematic.getPrimitivesInRegion` 只返回完全包含在指定矩形内的图元；与边界相交但未完全包含的图元不会返回。EDA 4.2 尚未实机验收。


## 原理图补充

| 指令 | 作用 | 使用时机 | 限制 |
| --- | --- | --- | --- |
| `schematic.getPrimitiveAtPoint` | 查询指定坐标处的图元（返回 id+类型），排查"这个位置是什么" | 按区域或坐标定位对象时使用。 | 按目标实例帮助确认可用参数。 |
| `schematic.setAttribute` | 改器件属性（如位号 R?→R4，key=Designator）。<br>⚠️ 只能改已存在属性。<br>Footprint 别写裸名/空串（见 pitfalls G1/G2） | 调整本节已有对象时使用。 | primitiveId、key 须为非空字符串；value 须为字符串，可显式用空串清值。只能修改已有属性。 |

`schematic.connectPin` v0.20.51 保留引脚坐标精度，不再取整连接端点；EDA 4.1.78 的半格四方向及整数共五例已核对端点、网表和保存重开结果。此结论不代表整图 DRC 或其他接线功能通过。
