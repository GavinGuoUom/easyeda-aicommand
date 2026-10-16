# 原理图高频指令

这里的“高频”是按常见绘图流程推荐，并非调用次数统计。先按[连接与环境](setup.md)核对目标窗口。`GET /help?cmd=<命令名>` 使用代理当前选中的窗口；确认它与目标版本一致后再用返回的参数。完整限制见[原理图详细说明](commands-schematic.md)。特殊操作查[原理图低频指令](commands-schematic-low.md)。

| 阶段 | 推荐指令 | 作用 |
| --- | --- | --- |
| 看现状 | `schematic.getPageInfo`、`schematic.listComponents`、`schematic.listPins` | 确认图页、器件与引脚。 |
| 放器件 | `schematic.placeDevice` | 放单个器件并核对资源。 |
| 接线 | `schematic.labelWire`、`schematic.linkWire`、`schematic.batchWire` | 分别处理单脚接网、两脚相连和批量接线。 |
| 精确绘制 | `schematic.drawWire`、`schematic.placeNetLabel` | 需要指定导线几何或标签位置时使用。 |
| 修改 | `schematic.moveComponent`、`schematic.modifyComponent`、`schematic.setAttribute` | 改位置、器件或属性。 |
| 检查 | `schematic.listNets`、`schematic.listWires`、`schematic.runDrc`、`schematic.getNetlist` | 核对网络、导线、规则与连通性。 |
| 保存和视觉核对 | `schematic.save`、`schematic.exportPng` | 保存并检查实际图面。 |

本页共 18 条。`drawWire` 给导线命名后，不要再对同一段线使用 `placeNetLabel` 补同名标签。批量写入后核对返回结果与实际网表。DRC 无错误不能单独证明连接正确。
