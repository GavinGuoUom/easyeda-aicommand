# PCB高频指令

这里的“高频”是按常见绘板流程推荐，并非调用次数统计。先按[连接与环境](setup.md)核对目标窗口。`GET /help?cmd=<命令名>` 使用代理当前选中的窗口；确认它与目标版本一致后再用返回的参数。完整限制见[PCB详细说明](commands-pcb.md)。特定规则、层叠和专题操作查[PCB低频指令](commands-pcb-low.md)。

| 阶段 | 推荐指令 | 作用 |
| --- | --- | --- |
| 看现状 | `pcb.listComponents`、`pcb.getComponentPads`、`pcb.listNets`、`pcb.listLayers` | 确认器件、焊盘网络和图层。 |
| 焊盘连接方式 | `pcb.connectComponentPadDirect` | 兼容入口暂时停用；调用会在访问工程或 SDK 前拒绝。 |
| 布局与板框 | `pcb.moveComponent`、`pcb.checkPlacement`、`pcb.drawOutline` | 先按[PCB操作要求](PCB操作要求.md)规划布局，再摆放、查间距和建立板框。 |
| 布线 | `pcb.routeTrack`、`pcb.placeVia` | 按[PCB操作要求](PCB操作要求.md)规划走线与换层。`routeTrack` 暂行插件政策要求每段至少 1 mil（25.4 μm），短段写前拒绝；不是 SDK 限制。 |
| 铺铜 | `pcb.pourCopper`、`pcb.listPours`、`pcb.rebuildPour` | 建立、检查和重铺铜区。 |
| 检查 | `pcb.runDrc`、`pcb.getNetInfo` | 检查规则和目标网络。 |
| 保存与生产 | `pcb.save`、`pcb.exportGerber`、`pcb.exportPickPlace` | 保存并按需生成生产资料。 |

本页共 18 条。PCB 坐标和长度使用 mil。`routeTrack` 的返回 ID 不单独证明线路已写入；应以图元读回为准，细节见[PCB详细说明](commands-pcb.md)。`pourCopper` 只建立覆铜边框；用 `rebuildPour` 检查实际填充，结果为 `no-fill` 时不报告铺铜完成。DRC 无错误不能单独证明可生产。

`pcb.connectComponentPadDirect` 名称和参数保留以兼容现有调用。必填 `documentUuid`、`componentId` 和 `padNumber`；可选 `padId` 用于区分同号焊盘。

命令当前始终抛出暂时停用错误，`error.cause` 为 `{ disabled:true, retryable:false, writeAttempted:false }`。拒绝发生在任何工程或 SDK 访问之前，因此本次调用没有执行读写，也不会返回 `partial` 写入结果。

暂时停用的原因是当前实测宿主的公开接口无法可靠读回热焊配置；这不代表整个宿主版本的所有 setter 均失效。待有可靠读回接口或官方修复后再评估恢复。`pcb.getComponentPads` 的只读诊断仍可用，布线、复制图页和模块复用不受影响。

`pcb.getComponentPads` 的 `heatWelding` 是逐焊盘只读诊断，状态区分 `null`、`config`、`unavailable`、`exception` 和 `invalid`。读取异常返回 `{status:"exception",error:{message}}`；无效返回值返回 `{status:"invalid",returnedType,reason}`。`config` 只表示读到配置，不证明规则优先级或宿主实际采用的连接规则。

`heatWelding.status:"invalid"` 时还带 `rawFields`，固定列出 `connectionMethod`、`divergenceSpacing`、`divergenceLineWidth` 和 `divergenceAngle`。每个字段独立返回 `status` 与 `type`；安全标量才返回 `value`。未定义、读取异常分别标为 `undefined`、`exception`。非有限数值只附 `finite:false`。对象、函数、Symbol 和 BigInt 只记录类型，不读取任意字段、不转换或序列化。每个 SDK 字段最多读取一次；该诊断不改变无效判定或直连写入行为。

`pcb.connectComponentPadDirect` 的可选 `_timeoutMs` 默认 290000 ms，最大 2147483647 ms；低于 1000 ms 的预算按 1000 ms 计算。
