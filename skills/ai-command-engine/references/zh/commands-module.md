# 独立模块插件入口（module.*）

**当前流程：** 原理图变更导入 PCB 必须由用户在 EDA 界面发起并确认。AI 可在前后只读检查，但不得调用`pcb.importChanges`或官方导入接口。下文历史候选记录仅描述当时的软件行为，不授权 AI 执行导入。

0.1.10保存后的复用路径已通过小样本；0.1.13已实测通过独立放置、内部网映射、引用对齐、未手动保存连续两实例保留，以及SCH/PCB保存重开。两实例证据限3器件模板。MCU功能区已提取为原生文件，恢复后20器件、82真实焊盘、203段走线、40个过孔及资源引用通过核对和保存重开。MCU在主工程的网络映射、引用对齐及PCB导入仍待验证。通用自动提取、替换与完整R1–R8尚未完成；旧unknown记录保留，不重发。0.1.14的CBB PCB检索与改网名样式保留已通过MCU实测及SCH保存重开。MCU完整布局布线复用仍待通道与自定义封装关联修复验证。

普通工程与CBB工程接收同一已保存文件均已实测。CBB库重开后选取配对仍一致，但导入板仍为普通Schematic/PCB，未获得模块符号。资源引用闭合，符号/封装几何一致；A4器件分类标签变化已单列，不称所有资源元数据无损。接受范围见项目验证记录，不能将这些人工核对结果当作每次命令自动验证。

2026-10-12在4.1.71小样本通过现有CBB图页放置，再对齐隔离工程的PCB模板名称，经一次原理图导入和宿主应用确认，带入了3器件、走线、过孔、板框与铺铜。保存重开物理对象保持，部分显示与层叠默认字段变化已记录。该早期手工过程不代替后续命令实测；当前两实例小样本和MCU提取结果见本页开头，替换尚未完成。

2026-10-12 实测：0.10.120/0.1.1 的状态查询与同板来源捕获通过。首次跨工程原理图复制返回空 UUID，目标未观察到来源电路；操作保持 unknown，未执行后续 PCB 复制。旧代理曾拦截保护下的记录查询。确认插件调用已结束、两次目标完整导出内容稳定后，主代理按既有 `write.acknowledge` 恢复该通道，再读回未知记录并核对来源 SCH/PCB 有效记录与此前一致。这不改变复制结果，不允许重发；不能用重启丢失保护代替核查。

| 指令 | 参数 | 返回 |
| --- | --- | --- |
| `module.getStatus` | 无 | 原样报告独立插件实际状态与 `capabilities`，不要求固定能力数量或完整列表 |
| `module.getContext` | `projectUuid`、`documentUuid`，均为非空字符串 | `{ project, document }` |
| `module.capturePair` | `projectUuid`、`schematicPageUuid`、`pcbUuid` | 同一 Board 的来源捕获 `captureId` 与文档摘要 |
| `module.probeNativeCopy` | `operationId`、`captureId`、`targetProjectUuid`、`documentType`；原理图另需 `targetSchematicUuid` | 单次原生复制的副本 UUID、内容比较和阶段 |
| `module.getCopyOperation` | `operationId` | 已持久记录的操作状态，不继续写入 |
| `module.restoreFile` | `operationId`、`targetProjectUuid`、`fileName`、`base64` | 原生文件导入到明确现有工程；仅核对导入返回与工程树元数据 |
| `module.getRestoreOperation` | `operationId` | 文件恢复的持久记录，不继续写入 |
| `module.exportTemplateFile` | `projectUuid`、`cbbUuid`、`libraryUuid`、`templateSchematicUuid`、`templatePcbUuid`、`fileName` | 指定同板模板导出原生文件；只读，不登记模板或放置 |
| `module.placeSchematicPage` | `operationId`、`cbbUuid`、`libraryUuid`、`sourceSchematicUuid`、`sourcePcbUuid`、`targetProjectUuid`、`targetSchematicUuid`、`targetSchematicPageUuid`、`targetPcbUuid`、`x`、`y`、`reimportWhenNameRepeated` | 当前目标页加入模块内容；返回已确认placed与读回证据，模板配对另行核对 |
| `module.alignTemplatePcb` | `operationId`、`placementOperationId`、`targetProjectUuid`、`targetSchematicPageUuid`、`templateSchematicUuid`、`templatePcbUuid` | 对齐本次新增器件的PCB模板引用，0.1.10样本已通过，保留模板内容 |
| `module.mapInstanceNets` | `operationId`、`placementOperationId`、`targetProjectUuid`、`targetSchematicPageUuid`、`netMap` | 按明确映射更新新增WIRE网名；两实例内部网映射与连续放置已通过小样本实测 |
| `module.getPlacementOperation` | `operationId`、`targetProjectUuid` | 按记录自身工程身份读取持久状态，不要求当前打开该工程 |

```json
{"instanceId":"当前核实的窗口 ID","cmd":"module.getStatus","params":{}}
```

```json
{"instanceId":"当前核实的窗口 ID","cmd":"module.getContext","params":{"projectUuid":"目标工程 UUID","documentUuid":"当前目标文档 UUID"}}
```

每次发送前刷新 `/connections` 并核对窗口身份。`getContext` 在转发前后核对工程与文档，独立插件也核对同一目标，不自动切页。成功只证明本次身份读取，不证明原理图与 PCB 成套关系。

请求走既有代理。代理源码将 `module.getCopyOperation`、`module.getRestoreOperation`、`module.getPlacementOperation` 归入只读查询；运行中的旧代理可能尚未加载，须核实。其余沿用默认顺序队列与未知写入保护。独立插件不建立第二条 WebSocket。不要仅为查询清除保护，不直接调用公共消息总线绕过正常命令路径。

插件未安装、RPC调用失败、协议或插件身份不符、数据不完整时明确失败。写入仍核对实际目标。公共RPC协议为1，topic为`module-reuse:rpc:v1`。版本号只作诊断信息，不按某个补丁版本拒绝响应。

状态查询返回实际能力，不要求刚好11项或包含全部命令。`nativeCapabilities`可省略；提供时核对实际布尔值，不要求固定两项。没有新增握手、预检调用或能力缓存。

`capturePair` 会切换并读取来源文档，不修改设计内容。捕获存于独立插件的配置中，不等于可移植模块文件。

`probeNativeCopy` 的目标工程必须不同于来源。`documentType` 仅接受 `schematic` 或 `pcb`；PCB 不接受目标板名。每次命令只调用一次原生复制。原理图会新增图页，PCB 会新增游离 PCB，不自动删除目标占位文档。

同一 `operationId`、相同参数只返回已有状态；不同参数拒绝。写入前必须完成操作记录的持久化与读回。SDK 调用后任何异常或身份、内容校验失败均停止，保留副本 UUID 和未知结果，不重试。用 `getCopyOperation` 检查记录，不以更换 `operationId` 绕过未知状态。

`copyConfirmed` 只表示副本归属与有效对象内容比较通过。`dependenciesVerified`、`persisted`、`pairAssociationVerified` 仍为 false，必须另做资源、保存重开和成套关联验收。跨工程复制首测未通过。本地资料库仍是独立 Node.js 组件，不编造保存、功能区提取或替换指令。

## 原生文件恢复

先保存原生文件，再从磁盘重新读取其内容并传入 `base64`。`fileName` 只接受不带路径的 `.epro` 或 `.epro2` 文件名。独立插件固定使用 `JLCEDA Pro` 与 `Existing Project`，不由 AI 任意选择文件类型或导入模式。

`targetProjectUuid` 必须是当前核实的隔离目标工程。写入前持久记录操作和文件内容摘要，再次核对目标后只调用一次导入。相同 `operationId` 与输入只查已有结果；同 ID 不同文件或目标拒绝。SDK 空返回、目标不符、读回或存储异常均停止，不换 ID 重试。

`fileImported` / `metadataVerified:true` 只表示 SDK 返回目标 UUID 且工程树出现可核对变化。`contentVerified:false` 明确表示未核对全部设计内容。新增板子不代表已合入目标现有原理图或 PCB；完整资源、两实例独立性、CBB 模板关系及保存重开必须另验。

查询 `module.getRestoreOperation` 获取已有记录。未知状态不会因查询或重启变成成功。独立文件必须包含所需资源，不能借原工程或云库 UUID 临时补回缺失内容后称为独立恢复。

## 指定模板只读导出

`module.exportTemplateFile`只接受表中的六个必需参数。`fileName`必须是不带路径的`.epro2`文件名。导出前后核对当前工程、所选SCH/PCB的同板关系、CBB库条目的对应关系；变化即拒绝，不回传可使用的文件。

独立插件固定调用官方CBB文件导出，明确指定两个模板UUID。不会切工程、改库模板、导入或放置。返回`exported:true`以及文件名、大小、类型和base64。`contentVerified:false`和`templateBindingVerified:false`表示模板内容和复用关系尚待检查。

将返回文件落盘，检查宿主实际选择的模板与资源，再分别验收从文件恢复和从云库引用。不能把成功导出当作库模板已修改。代理源码将该指令归入只读；运行中的旧代理可能尚未加载，不能为此重启丢弃未知写保护。

## 原生放置与模板引用

`placeSchematicPage`严格接受表中十二个参数。`x/y`为有限数字，单位10mil。`reimportWhenNameRepeated`必须明确；false不保证网络隔离或防重复。

`sourceSchematicUuid`仍是`cbb.get().boards[].schematic`中的父原理图UUID，用于核对来源SCH/PCB同板。0.1.8修正候选在来源CBB完整工程树中解析其唯一子图页，恢复目标并复核后，将子图页UUID交给放置SDK。目标工程、主SCH、当前图页与PCB仍须同板；解析或恢复不明确时不调用放置。0.1.8图页放置及保存重开已通过指定三测试点样本。

当前4.1.71运行SDK未转发第四个重名选项。`reimportWhenNameRepeated`仍保留在既有参数中，不能据其值认定该宿主的重名策略或内部网隔离已生效。

操作先持久记录参数，再只调用一次原生放置。SDK true后核对当前页新增记录，已有记录不得改动。目标页读回通过后持久记录`outcome:placed,placementVerified:true`并正常返回；`pairAssociationVerified:false`说明本步骤未验证PCB配对，不使页面放置本身失败。旧pending记录仅在重新读回确认后升级，不再次调用放置SDK；读取操作记录仍是纯只读查询。真实未知结果保留partial并停止，不换操作ID重发。

0.1.5候选在放置后不重新打开或激活文档。它核对当前工程与页身份，直接读取源码并有限等待新增内容。身份变化、既有记录变化或等待超时均保持unknown。失败收尾只记录状态，不切换文档。此修正消除观察干扰风险，尚未证明0.1.4失败的根因。

执行期间保持同一工程只有一个写入者，不同时手工增删图页或板子。`introducedBoards`是该次工程树差集，名称对齐前还要核对本次新增组件的模块属性和指定模板内容。

`alignTemplatePcb`沿用六参数并引用放置的`placementOperationId`。所选模板SCH/PCB须为该记录引入的同板副本。仅将这次新增器件的`Reuse Block`改为模板PCB实际名称；不修改来源或模板名称。模板PCB名称须能唯一确定本次副本，防止导入引用错误PCB。

引用修改使用公开属性接口并逐项读回。组号、通道号、唯一标识、坐标和连接须保持；目标页仅允许指定属性值改变，模板PCB内容须保持。原放置记录保留为历史，对齐另存记录。写入开始后结果不明即停止，不自动回退或重发。

`outcome:reference-aligned`只证明引用与内容读回，`phase:already-aligned`表示引用已正确且没有修改。返回`affectedIDs`、`referenceBeforeAfter`、`contentsVerified`、`templateContentsUnchanged`和`geometryUnchanged`，不证明主PCB已导入。桥接保留旧`renamed`/`no-op`响应兼容。

`getPlacementOperation`核对请求工程编号与操作记录的工程编号，不核对当前打开的工程。它只读取已有状态，不切文档、不重试、不把unknown变成成功。`getStatus.nativeCapabilities`的布尔值只表示方法存在。

原理图变更导入PCB时，必须由用户在EDA界面发起并确认。AI不得调用`pcb.importChanges`或官方导入接口。用户操作前后，AI可以只读核对器件、焊盘网络、每组相对布局、布线和铺铜。持久性检查须由用户保存并重开工程后进行。Group ID不同不能代替内部网隔离验证。

## 实例网络映射候选

`module.mapInstanceNets`沿用放置记录限定本次新增导线，不按全页网名批量改动。五参数中的`netMap`为数组，每行明确`sourceNet`、`targetNet`、`kind`（`internal`或`interface`）；实际非空WIRE.NET来源须全部分类，不猜电源或接口。interface可保留同名共享，internal目标不得与其他实例或映射行合并。当前实现覆盖WIRE的NET属性，不能据此认定NET_FLAG及其它命名来源已支持。

只对变化的WIRE调用公开`sch_PrimitiveWire.modify({net})`，逐项核对typed WIRE和源码NET值，整页其它有效内容保持。返回`mappedNetworks`、`bindings`、`confirmedIDs`、`pendingIDs`；`outcome:mapped`与`contentsVerified/geometryUnchanged/namedSourcesMapped:true`仅表示该步读回，`netlistVerified:false`仍需独立连通性核对。相同操作ID只读原记录，未知写入不重发。

宿主生成网表可能自动改重复位号、Unique ID并保存，不能用于只读来源；仅在隔离目标允许该变化时导出。网表导出应在网名映射的源码比较区间之外。

## 目标内容保存候选

0.1.13在打开来源CBB前保存目标原理图完整内存源码快照。关闭参数取当前文档真实tabId，重开取图页UUID；不拼接标签ID，不要求标签ID跨重开保持。它调用公开`sch_Document.save()`，确认保存与源码读回后，在目标工程内关闭重开目标页并再次核对，随后才切换来源工程。保存失败或状态不明时不切来源，不要求用户预热或手动保存。宿主保存流程可能保存其它未保存标签，不能宣称只保存单页。

含元器件或导线的页面仍严格比较有效内容。仅空白Drawing-Symbol图框允许属性zIndex压缩，要求ID、归属、其它字段和所有兄弟排序保持。发生组件、导线或属性丢失时保持unknown，留存原始快照；快照只是目标页源码，不等于含完整资源的原生工程文件。`not_started`只说明模块放置SDK尚未调用，不能推断预处理没有保存或切页。旧操作ID不续写。该保存保护已通过小样本未手动保存连续两实例验收（638–691）；不扩展为所有模板已验。

## 放置成功响应的桥接适配

ACE源码已修复：独立插件完整读回确认placed后直接返回，不再重复调用当前工程/文档SDK。新增板的空pageUuids仅是摘要，不证明模板配对。RPC失败或响应不完整仍保留operationId及不可重试的未知结果；后置身份读取失败保留两层错误。此修复已通过桥接回归、类型和lint检查，尚待安装后实测。已确认的同operation记录只证明该次操作曾完成读回，不保证页面随后未被修改。


0.1.14源码及MCU指定两项适配实测已通过，回归81项：模板检索同时识别PCB与CBB PCB，保持实际工程归属和同名检查。按ID修改网名时先读取导线原颜色、线宽和线型并显式传回，避免SDK把省略值清成null；仍只允许指定NET变化。MCU 928映射操作为unknown，首条网名与线宽变化现场已保留，不重发。CBB PCB引用与25条WIRE映射已实测通过；不代表MCU完整布局布线已复用。

## 自动复用继续开发状态（2026-10-13）

0.1.15已由用户安装，并在新验收窗口核对实际加载版本。首次放置已带入3器件，但原来源直接对应未确认；本次引入模板与实例同符号且有唯一平移。正在按同工程模板补充独立对齐确认，保留原放置历史。Channel对齐、网络映射和连续两实例仍待实测，不把旧名称对齐结果当作通道已经一致。

完整自定义封装引用路径已在隔离MCU副本通过保存、关闭、重开：目标测试点保持39.4mil，对照保持19.7mil，344有效记录仅指定Footprint属性改变。只改typed PAD形状会在重开后丢失，不能用于持久恢复封装。完整封装采集及仅新增器件属性恢复已接入内部host函数，尚未注册为自动复用业务指令，也未安装实测该函数。公开库接口读取的105有效资源记录与原生文件逐项一致。

4.1.71运行SDK的公开importChanges第二参数force=true已在隔离空板自动导入3器件，不用手点应用。SDK返回true时内容尚未更新；后续流程必须等待预期物理器件、引脚网络和既有内容确认后才能接续封装处理。该小样本不证明模板布局布线、已有复杂PCB或两实例保留已通过。完整自动复用及R1–R8仍待完成。

## 0.1.16候选对应适配

0.1.16在`alignTemplatePcb`中使用本次引入模板与新增实例做同工程严格配对，另存`alignmentComponentPairing`。它核对模板页/SCH/PCB身份、器件UID、分部、符号、方向及唯一平移。`mapInstanceNets`和内部PCB对应读取可消费完整且当前读回一致的对齐证据。原placement的直接配对为false时，历史保持不变，不重放放置，也不把跨工程不同符号UUID直接当作等价。

`module.getStatus`新增`data.pluginVersion`，取实际加载包的版本。ACE既有入口原样透传该字段，无需打开界面确认版本。此字段及同工程配对适配已通过0.1.16指定三测试点实例实测；连续两实例仍待修复验证。

公开force导入等待/核对函数已加入内部源码。它只在预期物理UID、逐编号焊盘网络与既有设计内容确认后报告器件导入完成；尚未注册业务RPC，也不代表模板布局布线、已有复杂PCB或保存重开已通过。

## 0.1.16安装后指定实测

新窗口接口已确认实际加载0.1.16。已有三测试点实例的同工程严格对应、Reuse Block及Channel核对、明确内部WIRE网名映射和保存返回成功。旧placement直接对应false历史保留，后续alignment对应独立记录。第二实例在来源解析恢复目标时尚未放置：工程Board配对集合一致，仅返回顺序改变，当前顺序敏感比较存在误报，正修复内部比较；两实例与完整PCB连续流程尚未通过，不要求使用者预热或手动重启。

## 0.1.17候选目标恢复适配

恢复目标工程的SCH/PCB配对键比较忽略Board返回排列顺序，保留每个配对的出现数量；目标Board名称、SCH/PCB身份、页面及源码仍逐项核对。配对异常以target_project_tree_restore报告预期、实际、缺失、新增或重复，不修改历史记录或重放未知放置。136项回归、类型检查、构建与限定审查通过，候选尚未安装实测。

0.1.16第一实例保存重开补充审计：96条有效记录仅三处Reuse Block值与一处内部NET值按预期改变，其余字段相同；第二实例未发生放置。

## 0.1.17两实例指定实测

0.1.17在新窗口实际加载后完成第二实例放置、同工程模板对应与Channel核对、独立WIRE网名映射。第一实例96有效记录逐项保持。两实例158记录保存重开后，第二实例只补默认isSwitchClose:false与strikeout:false字段，设计属性值及几何保持。公开JLCEDA网表文件包含6物理测试点、6引脚，两个命名内部网分别属于第一与第二实例。导出自动将第二实例UID/位号改为gge2–gge4/TP4–TP6；源码逐项仅6属性value变化，随后保存关闭重开158记录完全一致。该证据限本三测试点模板的SCH两实例，不代表PCB整块自动复用或全部R1–R8完成。后续PCB流程的合法改号确认与封装恢复正在内部集成，不要求用户手改UID。

## PCB实例导入开发候选（独立0.1.18）

新增 `module.importPcbInstances` 接受 `operationId`、`targetProjectUuid`、`targetSchematicUuid`、`targetSchematicPageUuid`、`targetPcbUuid`、`placementOperationIds`。插件内部读取已确认放置与对齐、保护同父SCH全部页面，导出一次JLCEDA网表，核对仅绑定器件UID/位号属性值的宿主改号，并独立保存身份确认；不由调用方提交UID映射。随后激活同板目标PCB，一次原生force导入，等待器件、焊盘网络和模板物理对象读回，再恢复本次新增器件的完整封装引用并重查焊盘网络。结果阶段为 `pcb_component_import_and_footprint_reference`，完整布局布线、铜皮重建及保存重开分别保持未验收；仍待候选实机。

`module.getPcbImportOperation` 只接受 `operationId` 与 `targetProjectUuid`，读取持久记录，不切工程、不重发写入。相同操作ID返回原状态，参数变化拒绝；明确未写失败与结果未知分别报告。正常导入仅传已放置实例ID，已在业务外导出而发生改号的旧现场不倒填成插件曾执行过导出。

独立入口与ACE桥接源码已接入；运行中的旧ACE及代理尚未加载新增入口/只读查询分类，不能据源码宣称当前HTTP入口可调用。

独立0.1.18当前已支持的模板解释为LINE、VIA、STRING、POUR边界及POURED父对象/网络/层归属；ARC、非板框POLY及其他区域/阻焊结构仍是待实现项，不能声称完整R4。178项完整回归、类型检查与限定审查通过；ACE桥接回归及定向lint通过，140采用139基线资源和隔离版本构建，保留另一个任务的139源版本与候选包。两个新候选尚未安装实测。

2026-10-13实机确认独立0.1.18与ACE140已加载。新隔离工程两实例放置、对应及不同内部网映射通过；内部JLCEDA身份导出仅合法修改第二实例3 UID/3位号，保存重开保持。PCB业务在模板封装捕获停止，未执行force：实际COMPONENT为footprintPrimitives:true，缺Footprint ATTR和完整实例body。不能用Device默认封装替代实例修改；正在完善正常capture的实际资源取证，完整PCB复用仍待验。历史查询桥接发现stored args不含operationId的契约误报，源码已修，回归/类型/lint通过，未安装修正版。

0.1.19候选在正常模板capture内部读取缺Footprint ATTR组件的真实getter、实际焊盘及完整documentFootprintSources目录，只有精确唯一key匹配才确认resourceBindingVerified，instanceBodyVerified仍false；诊断持久在操作记录，阶段template_footprint_body_unverified，在force前停止，不生成假ATTR。配套142修正getPcbImportOperation及成功响应中实际5字段stored args的校验，顶层operationId独立核对；未知记录保持原状态。两者尚待安装取证和正常PCB流程验收。

## 0.1.20 完整封装继承候选

0.1.19已在隔离工程实测取得真实getter、焊盘及显式旧格式epro中的完整资源。缺Footprint ATTR是合法继承；文档资源列表为空不等于封装缺失。其PCB业务在force前停止，未完成完整复用。

0.1.20在正常采集内部只读导出epro，以当前Board名、SCH身份、PCB名、组件UID/几何和实际getter绑定旧格式重编的PCB与完整FOOTPRINT，核对基础封装及全部已解析实例覆盖、ATTR/PROP/CONNECT和焊盘网络。原生结果完整一致时零补偿写入；仅明确资源引用及派生master不同、其余实例状态一致时复用单次引用恢复，随后重新导出并严格核对完整body。引用值正规化不放过Footprint ATTR样式/位置；无法建立覆盖引用映射时报告具体缺口。失败或未知不重试，不要求用户先补属性。

公开参数及14个RPC入口保持。配套ACE142/143桥接可沿用，不需要另造ACE升级包。结果阶段仍为pcb_component_import_and_footprint_reference，layoutRoutingVerified和saveReloadVerified保持false；0.1.20尚待安装实机，ARC、非板框POLY及区域/阻焊和完整R1–R8仍待完成。

正常Channel比较先以独立网表确认值严格核对原生组件，再允许旧格式导出的目标别名不同于模板；空状态及全部组件的同值/不同值分组关系必须双向保持，Group ID与Reuse Block仍按实际确认值精确比较。

## 0.1.21 宿主克隆兼容候选

0.1.20已在隔离工程实际完成三TP放置、对应、内部网映射、插件内JLCEDA身份确认和完整旧格式封装采集。后续POUR/POURED物理预检因扩展运行域没有structuredClone停止，尚未force导入；该错误属于宿主运行环境兼容，不是模板含不支持的铺铜格式。

0.1.21将四处数据克隆替换为插件内部纯JSON递归复制，保留数值精度、-0、嵌套对象/数组和__proto__自有字段，不添加依赖或全局修改。非法非JSON输入按字段路径明确失败，原物理格式检查保持。公共调用参数及ACE桥接不变，无需用户补属性、改模板或执行额外预热；21仍待安装实机，20完整采集证据不能替代21的导入后封装/物理内容/保存重开验收。

## 0.1.22 正常实例物理读回候选

0.1.21在新隔离工程实际通过完整封装采集、铺铜预检及一次force导入；三测试点和编号焊盘网络正确。结果在物理后验停止，因正常分组重编、复制板框、铺铜顺序编号与计算尾差尚未适配。旧unknown不重放，不把实际对象出现当作整条业务成功。

0.1.22在插件内部通过UID和原生组件组绑定新增GROUP及完整成员，按相同刚体变换核对明确板框层POLY、LINE/VIA/STRING/POUR；多余板框、错网/错层、线宽/孔径变化和旧对象变动仍拒绝。铺铜编号允许重编，但同一实例的大小/相等顺序关系必须保持；原目标铺铜order严格不变。坐标只容许计算量级尾差，不按固定小数截断。已解释的新增对象按明确type/id交给导入外层，合法POURED须独立通过父对象/网络/层/payload核验才进入解释集合。

完整封装比较消费上述独立分组证据，复核目标native成员快照及旧格式UID对应后的分组别名；不以目标读回组值自行生成预期。属性Group ID、Reuse Block和Channel ID仍按身份确认核对。公共参数不变，无需用户手改组、删除模板板框或预热。22候选仍待安装实机；仅模板带入的板框一致不代表生产板框验收，跨实例铺铜优先关系及全部R1–R8仍待完成。

合法既有非零空组无需重建：只在源/目标组身份及定义一致、全部旧组引用为空、原组记录保持、导入后成员恰为本次已匹配新增对象且无跨实例共享时接受，证明区分new_group和reused_empty_group。未分组0不要求GROUP行，不能被当成可复用空组。

## 0.1.23 工程树瞬时读取适配候选

0.1.22已实机完成第一实例正常PCB业务，返回confirmed/completed：物理对象/实例组/完整基础封装及覆盖/焊盘网络均核对通过，封装保留无需补写；外部保存关闭重开后设计内容保持，宿主层默认值与显示字段变化单列。第二实例SCH放置、对应、内部网映射通过，PCB流程在身份导出前的官方工程树getter瞬时空返回停止，第一PCB166有效记录不变。

0.1.23在身份准备内部有限重读getCurrentProjectInfo的特定boardsArr空返回异常，按实机完整TypeError文本识别并支持跨Realm错误对象，不笼统重试其他错误。每次仍核对实际工程UUID/目录结构，不用缓存树替代；同一身份操作共享额外读取次数和退避等待预算，正常开页/导出耗时不扣恢复预算。诊断保存阶段、预期工程/文档、尝试和原始错误。只重读失败getter，不重跑开页、网表导出或force；导出后无法恢复仍unknown，旧失败操作不重放。不要求用户预热、切工程或重启；23仍待安装实机，两实例PCB及MCU连续流程尚待完成。

## 0.1.24 铺铜名称自动编号适配候选

0.1.23第二实例已实际导入，六个焊盘网络正确，两实例内部网独立，第一实例166条有效记录保持。保存关闭重开后187条有效记录无差异。完整回执停在宿主给同名铺铜自动编号；特定工程树重读分支未证明在本轮触发。

0.1.24先按几何、网络、图层和其他属性建立唯一对应，再用导入前完整铺铜名称池按官方大写及末尾数字递增规则核对名称。分配后立即占用新名称，返回来源/目标ID、名称、碰撞链和顺序证据。同序对象在几何对应确定后检查兼容分配顺序，不用名称消歧。旧对象仍严格核对，不接受任意改名。公共参数不变，无需手改铺铜名称。

230项回归、类型检查、构建和限定审查通过。真实23归档经24物理及完整封装联合比较通过，封装noOp；没有重放现场未知写入。24仍待用户升级后的实机连续业务，两实例完整回执、MCU和R1–R8仍待完成。

## 0.1.24 双实例实机结果

三测试点模板两实例分别正常导入PCB，均返回confirmed/completed。两个内部网独立，六个焊盘逐项核对通过。第二实例铺铜名称自动编号为2、3，插件按旧名称池与官方规则确认。两次完整封装均保留，无需补写。PCB保存关闭重开187条有效记录无差异；原理图仅补宿主默认显示字段。第一实例设计内容保持，宿主层显示和规则默认值差异另列。此结果限当前模板，MCU完整流程、通用提取、ARC与其它区域、替换及全部R1–R8仍待完成。

## 0.1.25 MCU 模板子页解析候选

0.1.24已实测通过三测试点两实例正常PCB业务及保存重开。MCU的21个原理图分部放置成功，但放置时模板子页列表暂时为空，之后当前工程树已有唯一子页；24在模板对齐写前拒绝，没有进入MCU PCB导入。

25在历史子页列表为合法空数组时，按历史保存的SCH/PCB UUID同板配对读取当前唯一子页。仍核对工程归属、子页父SCH、文档身份、组件几何及PCB通道。新解析证据保存于对齐记录，历史placement不修改；后续身份准备及PCB上下文使用相同证据核对。历史已有子页必须继续一致，多页或错误配对不能自动修正。无需用户预热、重新放置或手改模板。

模板子页解析及归属核对的写前拒绝持久化not_started和阶段，对外保留明确未写状态；写后无法确认仍unknown。25已实测通过历史空子页解析、21分部对齐、八个内部网和七个接口网映射。一次MCU PCB导入实际带入20器件、82焊盘、40过孔和6项文字，但完整核验仍为unknown，不重放。六个测试点来源39.4mil、目标初始19.7mil；完整封装恢复尚未执行。26已形成共线合并、短线铜覆盖、嵌入封装和完整实例状态恢复候选，已交付但尚待实机。


## 0.1.26 MCU 完整实例恢复候选

26在插件内核对同实例、同网、同层、同线宽的连续共线链与宿主合并后的长线。源段必须真实连续，不能用计算容差吞掉缺口或重叠。

缺失短线必须在来源与目标的明确组件/焊盘绑定下，被同网同层普通矩形焊盘铜面完整覆盖。证明包含整个线宽和两端圆帽。封装恢复后重新读取最新焊盘并复核覆盖；不按短线长度直接放行。

旧格式PCB可前置完整FOOTPRINT区块。插件分区解析，保留原始记录，并区分有效PAD网络与无编号、无网名且没有实例覆盖的缓存行。原生封装引用与导出后的封装UUID分别保存，恢复使用原生精确引用。跨格式板关联保存工程/Board/SCH/PCB配对、归档与源码摘要、UID和姿态；导出后重新读取完整有效PCB记录，确认设计内容保持。COMP方向按有限数值的360度周期核对，不改变坐标或ARC扫角。

本次实际丢失的三颗器件锁定和六个Footprint属性显式颜色，通过独立实例状态计划恢复。预检投影只判断修复资格。先恢复封装引用，再从最新源码按UID重新绑定组件与属性并恢复状态。已正确字段不补写；旧组件和其他字段保持。任一阶段写入不明即停止，分别保留已完成与未确认阶段，不重放或回滚。最终重新读取真实完整封装和实际焊盘，不使用投影验收。

公共RPC参数保持不变。261项完整回归、类型检查、构建、限定审查和四文件包核验通过。实际MCU数据的九项状态离线恢复仅改变计划字段；没有把该探针当作EDA实测。26已安装并实测通过MCU放置和模板对齐，网络映射部分停止；完整PCB和封装恢复尚未实机验证。六测试点39.4mil最终尺寸、完整MCU正常业务及R1–R8余项仍待验证；旧unknown导入不重放。

## 0.1.27 网名映射逐条读回候选

26已在新隔离工程实测通过MCU放置和模板对齐。一次网络映射因整批WIRE共用5秒截止时间而停止，持久记录confirmed24/pending1，结果unknown。11条内部导线已改名，1条内部导线未改；13条接口导线保持。已保存备份，未重放、未进入PCB导入。

27移除跨WIRE共享截止。每条modify返回或抛错后，开始本条的原5秒读回窗口，至少读回一次，未确认时最多重轮询20次、间隔不超过250ms。前序导线的正常执行、读取和持久化耗时不占用后续窗口。当前导线须经源码NET属性与typed WIRE共同确认并保存进度，才写下一条。modify抛错时即使本条已生效也停止，保持unknown；不重试setter、不并行。

公共参数不变。`module.getPlacementOperation`已实机确认也能读取网名映射记录，使用映射operationId及对应targetProjectUuid；查询不重发映射。旧unknown保持，不以新ID继续同一部分实例。

70项定向和264项完整回归、类型检查、构建、限定只读审查与包核验通过。假时钟回归覆盖多条正常累计耗时超过5秒、单setter超过5秒仍首次读回，以及持续不匹配时停止后续WIRE。27候选已统一交付，尚待升级实机。MCU完整PCB/封装恢复及R1–R8余项仍未完成。
