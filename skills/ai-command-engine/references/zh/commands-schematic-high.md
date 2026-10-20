# 原理图高频指令

这里的“高频”是按常见绘图流程推荐，并非调用次数统计。先按[连接与环境](setup.md)核对目标窗口。`GET /help?cmd=<命令名>` 使用代理当前选中的窗口；确认它与目标版本一致后再用返回的参数。完整限制见[原理图详细说明](commands-schematic.md)。特殊操作查[原理图低频指令](commands-schematic-low.md)。

| 阶段 | 推荐指令 | 作用 |
| --- | --- | --- |
| 看现状 | `schematic.getPageInfo`、`schematic.listComponents`、`schematic.listPins` | 确认图页、器件与引脚。 |
| 放器件 | `schematic.placeDevice` | 先按[原理图操作要求](原理图操作要求.md)规划布局，再放置并核对资源。 |
| 接线 | `schematic.labelWire`、`schematic.linkWire`、`schematic.batchWire` | 分别处理单脚接网、两脚相连和批量接线；短桩间距和标签方向按[原理图操作要求](原理图操作要求.md)规划。 |
| 精确绘制 | `schematic.drawWire`、`schematic.placeNetLabel` | 需要指定导线几何或标签位置时使用。 |
| 修改 | `schematic.moveComponent`、`schematic.modifyComponent`、`schematic.setAttribute` | 改位置、器件或属性。 |
| 检查 | `schematic.listNets`、`schematic.listWires`、`schematic.runDrc`、`schematic.getNetlist` | 核对网络、导线、规则与连通性。 |
| 保存和视觉核对 | `schematic.save`、`schematic.exportPng` | 保存并检查实际图面。 |

本页共 18 条。`drawWire` 给导线命名后，不要再对同一段线使用 `placeNetLabel` 补同名标签。批量写入后核对返回结果与实际网表。DRC 无错误不能单独证明连接正确。

`drawWire` 相接时宿主可能合并旧导线；返回的 `primitiveIds` 为最终存活 ID，新增数看 `created`。0.20.21 起写前以关联 LINE 的原生 Y 轴转换后与 SDK 导线双向核对；核对失败即停在写前。部分写入或读回不明时停止后续画线并核对原图页，勿按原请求自动重试。
