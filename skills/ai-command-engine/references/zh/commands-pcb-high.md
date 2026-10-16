# PCB高频指令

这里的“高频”是按常见绘板流程推荐，并非调用次数统计。先按[连接与环境](setup.md)核对目标窗口。`GET /help?cmd=<命令名>` 使用代理当前选中的窗口；确认它与目标版本一致后再用返回的参数。完整限制见[PCB详细说明](commands-pcb.md)。特定规则、层叠和专题操作查[PCB低频指令](commands-pcb-low.md)。

| 阶段 | 推荐指令 | 作用 |
| --- | --- | --- |
| 看现状 | `pcb.listComponents`、`pcb.getComponentPads`、`pcb.listNets`、`pcb.listLayers` | 确认器件、焊盘网络和图层。 |
| 布局与板框 | `pcb.moveComponent`、`pcb.checkPlacement`、`pcb.drawOutline` | 摆放、查间距和建立板框。 |
| 布线 | `pcb.routeTrack`、`pcb.placeVia` | 绘制走线与换层。 |
| 铺铜 | `pcb.pourCopper`、`pcb.listPours`、`pcb.rebuildPour` | 建立、检查和重铺铜区。 |
| 检查 | `pcb.runDrc`、`pcb.getNetInfo` | 检查规则和目标网络。 |
| 保存与生产 | `pcb.save`、`pcb.exportGerber`、`pcb.exportPickPlace` | 保存并按需生成生产资料。 |

本页共 17 条。PCB 坐标和长度使用 mil。`pourCopper` 只建立覆铜边框；用 `rebuildPour` 检查实际填充，结果为 `no-fill` 时不报告铺铜完成。DRC 无错误不能单独证明可生产。
