# 复用模块指令（cbb.*，0.10.34 共 12 条）

> 本页表格/参数对象描述命令及 `params`，不是完整 HTTP 请求。发送 `/command` 时外层必须带 `cmd`、顶层 `instanceId` 和所需 `params`；宏仅外层路由，步骤继承实例。完整示例见 [setup](setup.md)。

复用模块（CBB，官方"模块"功能）的库管理、放置与导出。库 UUID 一律先 `cbb.listLibraries` 获取（system/personal/project/favorite 四类）；官方默认搜系统库，个人库是自己沉淀的模块。

| 指令 | 说明 | 关键参数 |
| --- | --- | --- |
| `cbb.listLibraries` | 四类库 UUID（其他 cbb.* 的 libraryUuid 来源） | 无 |
| `cbb.search` | 搜模块（空关键字列全部） | `key?`, `libraryUuid?`, `page?`, `itemsOfPage?` |
| `cbb.get` | 模块详细属性 | `cbbUuid`, `libraryUuid?` |
| `cbb.create` | 指定库建空白模块工程（之后 openProject 打开往里画） | `libraryUuid`, `name`, `description?` |
| `cbb.copy` | 模块复制到另一库（如官方模块复制到个人库再改造；目标库重名失败） | `cbbUuid`, `libraryUuid`, `targetLibraryUuid`, `newName?` |
| `cbb.delete` | 删模块 | `cbbUuid`, `libraryUuid` |
| `cbb.openProject` | ⚠️ 打开模块工程（**会切换当前工程，未保存修改丢失**；打开后 editor.listTabs 拿图页/PCB uuid） | `cbbUuid`, `libraryUuid` |
| `cbb.placeSymbol` | 当前原理图放模块符号（层次化设计入口；SCH 坐标 10mil 单位） | `libraryUuid`, `cbbUuid`, `x`, `y`, `rotation?`, `mirror?` |
| `cbb.placeSchematicPage` | 把指定源图页的模块内容铺进当前图页；uuid 为源图页 UUID，先核对其所属原理图 | `libraryUuid`, `cbbUuid`, `uuid`, `x`, `y`, `reimportWhenNameRepeated?` |
| `cbb.placePcb` | **复用价值最大的一条**：把模块的 PCB（含布局布线）整体铺进当前 PCB——电源/最小系统等成熟布局直接搬入（坐标 mil） | `libraryUuid`, `cbbUuid`, `uuid`, `x`, `y`, `reimportWhenNameRepeated?` |
| `cbb.openSymbolInEditor` | 打开模块符号编辑（⚠️ 须先 openProject） | `cbbUuid`, `libraryUuid`, `splitScreenId?` |
| `cbb.exportFile` | 导出模块为 epro（base64；需团队模块下载权限） | `cbbUuid`, `libraryUuid?`, `fileName?` |

⚠️ 要点：

- `cbb.openProject`/`cbb.openSymbolInEditor` 会切工程/焦点，用完回自己工程要重新 `editor.openDocument` 激活。
- `reimportWhenNameRepeated`在较新SDK中用于重名模块重新引入。当前4.1.71运行SDK未转发该选项，不能据参数值认定重名策略或网络隔离生效。
- 放置后读回核对：`cbb.placePcb` 后用 `pcb.listComponents`+`getComponentPads` 审计网络。

2026-10-12 在 EDA 4.1.71 隔离样本明确传源图页 UUID，读回三个测试点、一条导线并保存。当前运行SDK按页面UUID查找，传父原理图UUID未命中时会回退选择第一页；此前父UUID成功样本不能证明其准确选择了指定页。SDK true只表示调用返回，须检查实际内容。

原生转 PCB 使用元件的 `Reuse Block` 名称匹配 PCB 模板。测试工程中将配套 PCB 副本名称与该值对齐后，单次 `pcb.importChanges` 和宿主“应用修改”带入了布局、走线、过孔、板框和铺铜。保留分组与通道标识后再核对保存重开结果。这个结果只覆盖已测小样本；分别直接放置 SCH 与 PCB 不能证明关联。
