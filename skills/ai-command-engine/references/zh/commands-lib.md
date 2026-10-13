# 符号/封装/器件库管理指令（lib.*）

> 本页表格/参数对象描述命令及 `params`，不是完整 HTTP 请求。发送 `/command` 时外层必须带 `cmd`、顶层 `instanceId` 和所需 `params`；宏仅外层路由，步骤继承实例。完整示例见 [setup](setup.md)。

个人库（默认）与系统库的元件库 CRUD。官方默认搜系统库，**本组指令默认个人库**（libraryUuid 留空=个人库）。

## 通用模式

三组（symbol/footprint/device）结构同构：`Create`（建空白→返回读回属性含 uuid）/ `UpdateSource`（源码写回）/ `Search`（空关键字列全部，`key`/`classification`/`page`/`itemsOfPage`）/ `Get` / `Copy`（目标库重名失败，`targetLibraryUuid` 必填）/ `Modify`（属性值设 null=清除）/ `Delete`。Search 返回 `[{uuid, name, description, ...}]`。

| 指令 | 说明 | 必填参数 |
| --- | --- | --- |
| `lib.symbolCreate` | 建空白符号 | `name`；`symbolType?`（ELIB_SymbolType，如 2）、`classification?`、`otherProperty?` |
| `lib.symbolUpdateSource` | 符号文档源码写回库 | `symbolUuid`, `documentSource` |
| `lib.symbolSearch` / `symbolGet` / `symbolCopy` / `symbolModify` / `symbolDelete` | 同构五件套 | search: 无必填；get/delete: `symbolUuid`；copy: +`targetLibraryUuid` |
| `lib.footprintCreate` / `footprintUpdateSource` / `footprintSearch` / `footprintGet` / `footprintCopy` / `footprintModify` / `footprintDelete` | 封装同构七件套 | 同上（uuid 名为 footprintUuid） |
| `lib.footprintGetSource` | 直接读取库封装原始源码，用于封装内容分析或格式问题定位；不打开编辑器、不修改库 | `footprintUuid`，`libraryUuid?`；返回 `{footprintUuid,libraryUuid,source}` |
| `lib.deviceCreate` | 组装库器件：绑定已有符号，或新建空符号，再关联封装及3D | `name`；复用符号传`symbolUuid`，新建符号传`symbolType`；`symbolLibraryUuid?`、`footprintUuid?`、`footprintLibraryUuid?`、`model3DUuid?`、`property?` |
| `lib.deviceSearch` / `deviceGet` / `deviceGetByLcscIds` / `deviceCopy` / `deviceModify` / `deviceDelete` | 器件六件套 | get/delete: `deviceUuid`；copy: +`targetLibraryUuid` |
| `lib.symbolOpenInEditor` / `lib.footprintOpenInEditor` | 在符号/封装编辑器中打开库元件（编辑内容用；打开后配合 project.getDocumentSource 读源码） | `symbolUuid*`/`footprintUuid*`，`libraryUuid?` |

特例：

- `lib.deviceCreate` 用于把符号和封装绑定成库器件。跨库时分别提供 `symbolLibraryUuid` 和 `footprintLibraryUuid`，省略时使用创建器件的 `libraryUuid`。例如 `{"libraryUuid":"目标库UUID","name":"测试电阻","symbolUuid":"符号UUID","symbolLibraryUuid":"符号库UUID","footprintUuid":"封装UUID","footprintLibraryUuid":"封装库UUID"}`。
- 新建普通空符号可传`symbolType:2`，此时无需`symbolUuid`。135包含这一SDK支持的分支，工程库实机结果待验证。
- 创建后优先`get`读回；工程库不支持该查询时，按名称搜索并匹配创建返回的UUID读回，不会再次创建。134已证明跨库资源可以进入工程，但旧版末尾`get`会误报；135适配后的完整回执待实测。

- `lib.deviceGetByLcscIds`：`lcscIds` 支持单值或数组批量查（如 "C1523" 或 ["C1523","C17168"]）；`allowMultiMatch?` 同 C 号多匹配时全返回。⚠️ 私有化部署环境不可用。
- `lib.deviceModify` 支持改绑：`symbolUuid`/`footprintUuid` 换绑，`property` 改 designator/manufacturer/supplier 等。

⚠️ 要点：

- 库 UUID 来源：`cbb.listLibraries`（个人库/系统库同一套 UUID）。
- 普通放置别走这里：从立创商城选料用 `library.searchDevice`/`library.getDeviceByLcsc`（工程内放置）；本组管的是**自建库元件**的沉淀与维护。
- 建库流程：symbolCreate →（在编辑器画）→ symbolUpdateSource 写回 → footprint 同理 → deviceCreate 组装绑定 → 之后 `library.searchDevice` 能在工程里搜到。

## 工程内选料（官方库，非自建）

| 指令 | 说明 | 关键参数 |
| --- | --- | --- |
| `library.searchDevice` | 搜索器件库（立创商城料） | `keyword`, `limit?` |
| `library.getDeviceByLcsc` | 按立创编号查器件 | `lcscId` |
