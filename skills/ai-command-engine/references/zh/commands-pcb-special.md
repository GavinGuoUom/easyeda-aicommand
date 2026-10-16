# PCB几何命令

# PCB几何专题命令

本页只在扇出、局部铜皮、焊盘外扩或网络丝印任务中读取。命令名见[PCB低频指令](commands-pcb-low.md)；参数、默认值和返回字段查已核对所选窗口版本的 `/help?cmd=<命令名>`。

## 共同流程

1. 激活目标 PCB，读取当前器件、焊盘或过孔 ID；位号不能代替图元 ID。
2. 运行对应的只读计划命令。检查 `executable`、目标、网络、层、几何、`coverage` 和 `warnings`。不可执行或覆盖不完整时，不提交写入。
3. 将规划响应的**完整 `data`**原样放入执行命令的 `params.plan`。不要自行重组或删减计划字段。
4. 插件逐项写入和读回。部分失败时保留已创建对象，先查现场，不重放旧计划。命令不会自动完成板级 DRC、保存或制造验收。
5. 运行适用检查并保存；需要持久性证据时关闭重开后再核对。

| 任务 | 计划 → 执行 | 必须另外确认 |
| --- | --- | --- |
| 密脚焊盘扇出 | `pcb.getFanoutPlan` → `pcb.fanout` | 只完成焊盘到出口通孔，后续网络仍须布线。 |
| 局部铜皮 | `pcb.getAutoCopperPlan` → `pcb.autoCopper` | 区分边框覆铜 `pour` 与固定铜 `fill`，确认实际填充。 |
| 焊盘外扩 | `pcb.getPadExpansionPlan` → `pcb.expandPads` | 生成禁铺铜、禁填充或阻焊区域，不改变焊盘铜尺寸。 |
| 网络文字丝印 | `pcb.getNetSilkscreenPlan` → `pcb.generateNetSilkscreen` | 文字可读、不压焊盘；底层检查镜像。 |

## 扇出范围

目标按器件、焊盘或网络选择，ID 必须来自当前 PCB。线宽、过孔铜外径、钻孔、引出长度和间距按当前设计给定，单位 mil；钻孔小于铜外径。多层或通孔焊盘明确选择顶层或底层，当前实现创建通孔，不能称盲孔或埋孔。板框、障碍、焊盘形状或规则无法安全解析时，计划不可执行。扇出不证明全网连通、DRC 或制造合格。

## 局部铜皮和实填充

`pour` 会受覆铜规则裁剪，可能只剩边框或零填充；`fill` 是固定导电形状。两种模式不能自动互换。计划按网络和铜层分组，不把不同网络合成同一铜片。当前板框只接受已核实的单一闭环；曲线、多环或缺少完整障碍信息时，不把部分计划当安全几何。

新建或重建覆铜后可用 `pcb.getPourFillReadback` 只读核对关联填充、父边框、网络和层。填充路径非空不证明几何正确或满足制造要求。读回失败或未知时停止依赖写入；旧命令的部分失败不能改称成功。

## 焊盘外扩和网络丝印

焊盘外扩的模式为禁止铺铜、禁止固定填充或阻焊外扩，均不增加导电铜。计划仅支持明确覆盖的焊盘形状；曲线为近似结果，实际阻焊开窗仍须核对生产输出。计划中的完整轮廓和分片不能删减。

网络丝印是可编辑文字，不建立电气连接。核对目标焊盘网名、文字层、旋转和底层镜像；执行后还要检查与焊盘、板框和其他文字的视觉间距。


---

# DFM与SMT检查

# 嘉立创下单检查（PCB DFM）

> 本页说明 `pcb.runDfm`、`pcb.runSmtDfm`、`pcb.checkSameNetPadSpacing` 及 PCB 菜单“嘉立创下单检查”。
> 命令经现有 `/command` 通道执行。
> 请求外层仍须带 `instanceId`。

## 1. 确认工艺输入与图纸对照

`pcb.runDfm` 以本次输入的铜厚选档检查支持性：第 5 项检查所选外层铜厚，第 6 项检查所选内层铜厚。

第 12/13 项根据设计铜层及设计层数，分别使用外层或内层所选铜厚从原工艺表取阈值。

工艺表数值和几何算法不变。

其他检查中的有效铜层数量仍按原有含铜图元启发式判断。

PCB 结果另含 `reportedCopper`，与 DFM 判定分开：`status` 为 `available`、`partial` 或 `unavailable`。

`layers` 为 `[{layerId:number, thicknessMil:number|null, copperOz:number|null}]`。

`matchesTarget` 为布尔值或 `null`。

`differences` 为 `[{layerId, requestedOz, reportedOz}]`。

`messages` 为铜厚源采集诊断字符串数组。

请求铜厚仍列在 `inputs`。

检查标准值反映本次外/内铜厚输入及对应阈值。

图纸铜厚与本次输入不一致、缺少 `LAYER_PHYS` 记录或无法解析时，只在 `reportedCopper` 表示，不单独加入 `issues`，也不因此把 DFM 判为失败。

若源读取异常影响必要几何、身份或 API 数据，则仍须按既有规则进入 `issues` 并令检查不完整。

不能被铜厚旁证豁免。

0.10.91 实机报告中的图纸外/内 1oz 是源读数，不代表用户下单请求了 1oz。

差异本身也不构成 DFM 失败。

## 2. 运行适用检查

| 指令 | 作用 | 使用时机 | 限制 |
| --- | --- | --- | --- |
| `pcb.runDfm` | 执行PCB工艺检查。 | 材料、板厚和铜厚确定后。 | 只覆盖返回的18项检查。 |
| `pcb.runSmtDfm` | 执行SMT贴装检查。 | 选定贴装工艺后。 | 只覆盖返回的7项检查。 |
| `pcb.checkSameNetPadSpacing` | 检查同网焊盘间距。 | 核对同网工艺间距时。 | 只覆盖该项间距检查。 |

- material接受`FR4`、`HDI板`、`高频板`、`铝基板`或`铜基板`。
- thickness使用mm，必须为有限正数。
- outerCopperOz必须是数字1或2。
- innerCopperOz必须是数字1。
- 铜厚由用户按本次下单要求明确给出。
- 不从图纸读数或默认值代填请求铜厚。
- standard接受`economy`或`standard`。
- minSpacingMm使用mm，必须为有限正数。
板材枚举以复用的上游 core 导出 `JLC_SUPPORTED_MATERIALS` 为准。

检查实现复用[上游项目](https://github.com/easyeda/eext-jlc-order-dfm-checker) v1.0.4，来源提交 `afd538786d510f537ad4fa47c6329e6a99dc7625`，许可证 Apache-2.0。

没有新增依赖。

工艺参数表及几何算法来自该上游版本，不表示与嘉立创网站当前工艺实时同步。

上游 v1.0.4 原接口只有板材与板厚。

`outerCopperOz`、`innerCopperOz` 是本地增强字段。

本次仅支持外层 1/2 oz、内层 1 oz，不代表厂家全部工艺选项。

`pcb.runSmtDfm` 与 `pcb.checkSameNetPadSpacing` 不增加铜厚输入。

菜单中的 PCB DFM 表单由用户明确选择外层 1 或 2 oz、内层 1 oz。

这些选项仅适用于 PCB DFM。

使用前须确认已安装 0.10.92 或后续含此增强的版本，并在在线命令帮助中看到这两个铜厚参数。

旧版 0.10.91 不支持它们，可能忽略额外字段。

仅向旧版请求添加参数不能证明已按本次铜厚检查。

新报告必须回显 `inputs.outerCopperOz`、`inputs.innerCopperOz` 及 `reportedCopper`。

## 3. 判断结果与完整性

命令成功回包的 `data` 中保留 `results`、`expectedCount`、`issues` 和 `coverage`。

`issues` 项包含 `code`、`message` 和可选 `item`。

`data` 另含 `documentUuid`、`checkType`、`inputs`、`timestamp`、`upstream` 及汇总字段 `upstreamPassed`、`complete`、`passed`。

`upstreamPassed` 为兼容保留的字段名，表示复用并适配后的各项结果是否全部为 `success`。

不表示官方在线服务已通过，也不表示算法逐行保持原样。

菜单与 TXT 将其标为“逐项检查通过”。

单项检查通过不等于整项检查通过。

只在 `complete:true` 且 `passed:true` 时可报告该命令覆盖范围内通过。

`complete:false` 必须同时为 `passed:false`。

命令回包 `ok:true` 只代表处理器成功返回，不代表 `data.passed:true`。

三类检查分别保留预期的 18、7、1 项原始结果。

若用于本次检查的必要输入不完整、读取失败或使用回退/推断值，适配层会标记未完整。

不能报告完整通过。

例如源码读取失败、网络数据只部分可读、焊盘尺寸缺失或无板框而使用回退，都不能变成通过结论。

铜厚请求参数不会默认。

图纸源铜厚按下一节单独处理。

查看 `coverage`、完整性标记及 `upstream` 说明，勿只看 `passed` 或问题数。

## 4. 核对未覆盖内容

这些检查复用上游插件的参数表和算法，不是嘉立创在线 DFM 服务的全量检查，也不是可制造性放行。

当前几何覆盖有明确近似：线间距只计算 `Line` 的正间隙，不覆盖接触、重叠、`Arc` 或 `Polyline`。

长圆及不等边焊环按最大轴近似。

同网焊盘间距采用胶囊体和内接圆近似。

有效铜层按存在铜图元的层启发式计算。

EIA/BGA 类型依据名称识别。

定位 ID 由两组列表索引辅助匹配，问题位置可能有偏差。

菜单定位仅辅助查看。

不能自动改图。

请把原始结果和 `coverage` 一并交由工程人员审阅。

## 5. 菜单定位与报告导出

PCB 顶部“嘉立创下单检查”菜单提供上述三项检查，与 AI 命令共用同一检查处理和结果汇总。

菜单可显示逐项结果及问题位置。

用户点击“导出TXT”或“导出JSON”后，宿主保存对话框用于选择报告保存位置。

AI 命令不弹窗、不清日志、不自动写报告。

命令执行本身不保存、修复、上传或下单。

定位是辅助查看。

不会修改图纸。

菜单或命令开始后若当前焦点或 PCB 身份变化，后续读取及报告交付会停止。

定位前先核对目标 PCB 与当前板一致。

不要把另一板上的坐标用于定位。

旧 DFM 窗口会话失效时，关闭旧窗口并从 PCB 菜单重新打开。

菜单表单、AI 命令及 TXT/JSON 导出应显示相同的 `inputs`、外/内层阈值和 `reportedCopper` 对照。


---

# 网络与生产导出

# 网络类·差分对·生产导出（PCB）

> 本页表格保留选用场景和限制；参数、返回字段与示例以已核对所选窗口版本的 `/help?cmd=<命令名>` 为准。
> 发送 `/command` 时外层必须带 `cmd`、顶层 `instanceId` 和所需 `params`。
> 宏仅外层路由，步骤继承实例。
> 完整示例见 [setup](setup.md)。

本文说明网络约束与生产导出。

## 网络类（NetClass）与差分对

| 指令 | 作用 | 使用时机 | 限制 |
| --- | --- | --- | --- |
| `pcb.createNetClass` | 建网络类（一组网统一设规则/颜色） | 按网络组管理规则时使用。 | 写入未知时停止后续写入。 |
| `pcb.listNetClasses` | 列出网络类 | 按网络组管理规则时使用。 | 按目标实例帮助确认可用参数。 |
| `pcb.deleteNetClass` | 删除网络类 | 按网络组管理规则时使用。 | 先核对目标并备份。 |
| `pcb.renameNetClass` | 重命名网络类 | 按网络组管理规则时使用。 | 写入未知时停止后续写入。 |
| `pcb.addNetToClass` / `removeNetFromClass` | 网络类增删成员 | 按网络组管理规则时使用。 | 先核对目标并备份。 |
| `pcb.createDiffPair` | 建差分对（USB D+/D- 等） | 配置或核对差分信号时使用。 | 写入未知时停止后续写入。 |
| `pcb.listDiffPairs` / `deleteDiffPair` | 列出/删除 | 配置或核对差分信号时使用。 | 先核对目标并备份。 |
| `pcb.getNetRules` | 读当前设计规则中的网络规则（线宽/间距等，**只读**——写入接口结构复杂暂未开放） | 核对当前线宽和间距规则时使用。 | 只读规则，不提供规则写入。 |
| `pcb.getNetLength` | 网络已布线总长度（等长检查用） | 比较实际布线长度时使用。 | 按目标实例帮助确认可用参数。 |
| `pcb.getNetInfo` / `getNetPrimitives` | 网络详细信息 / 网络上全部图元（走线/过孔/焊盘） | 分析指定网络连接对象时使用。 | 按目标实例帮助确认可用参数。 |
| `pcb.highlightNet` | 高亮/取消高亮网络（排查用） | 定位对象或排查连接时使用。 | 按目标实例帮助确认可用参数。 |

## 选择/交叉探针

| 指令 | 作用 | 使用时机 | 限制 |
| --- | --- | --- | --- |
| `pcb.select` / `pcb.clearSelection` / `pcb.getSelection` | 按 ID 选中/清空/读当前选择 | 读取或调整当前选择时使用。 | 按目标实例帮助确认可用参数。 |
| `pcb.crossProbe` | 交叉探针：位号/引脚/网络在原理图↔PCB 间联动定位（高亮+选中） | 定位对象或排查连接时使用。 | 按目标实例帮助确认可用参数。 |

## 原理图NC、属性与图像

| 指令 | 作用 | 使用时机 | 限制 |
| --- | --- | --- | --- |
| `schematic.setPinNoConnect` | 给引脚打/取消 X 非连接标识（消除悬空引脚 DRC 提示） | 标明合法悬空引脚时使用。 | 标NC的引脚不能继续接线。 |
| `schematic.getAttributes` / `setAttribute` | 读/改图元属性（key=Designator/Value/Footprint 等） | 核对或更新图元已有属性时使用。 | 只能修改图元已有属性。 |
| `schematic.getSelection` | 读当前选中的图元 | 读取或调整当前选择时使用。 | 按目标实例帮助确认可用参数。 |
| `schematic.exportBom` | 导 BOM（xlsx/csv，base64） | 备份、交付或独立检查时使用。 | 导出成功不等于内容验收通过。 |
| `schematic.exportPng` | 导原理图 PNG（单边最大 4096px） | 备份、交付或独立检查时使用。 | 单边尺寸不超过4096px。 |
| `schematic.listNets` | 原理图全部网络（`detail:true` 带导线明细） | 核对已有网络范围时使用。 | 按目标实例帮助确认可用参数。 |

## 生产导出（base64 自行落盘）

| 指令 | 作用 | 使用时机 | 限制 |
| --- | --- | --- | --- |
| `pcb.exportGerber` | Gerber 打板文件（通常 zip） | 备份、交付或独立检查时使用。 | 导出成功不等于内容验收通过。 |
| `pcb.exportPickPlace` | 贴片坐标（Pick&Place） | 备份、交付或独立检查时使用。 | 导出成功不等于内容验收通过。 |
| `pcb.exportDsn` | Specctra DSN（外部自动布线第一步：`exportDsn` → 外部布线器 → `importAutoRouteSes` 导回） | 交给外部自动布线器时使用。 | 导出成功不等于内容验收通过。 |
| `pcb.exportNetlist` | PCB 网表。<br>0.10.104 起拒绝零字节文件及空 base64，导出后仍须解析核对 | 备份、交付或独立检查时使用。 | 0.10.104 起拒绝零字节文件及空 base64，导出后仍须解析核对。 |
