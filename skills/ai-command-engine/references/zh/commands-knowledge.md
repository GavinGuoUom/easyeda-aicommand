# 知识库

# 设计知识与SMT物料查询

## 1. 查询设计资料

> 本页表格保留选用场景和限制；参数、返回字段与示例以已核对所选窗口版本的 `/help?cmd=<命令名>` 为准。
> 发往EDA的请求必须带cmd、instanceId和所需params。
> 宏仅外层路由，步骤继承实例。
> 完整示例见 [setup](setup.md)。

| 指令 | 作用 | 使用时机 | 限制 |
| --- | --- | --- | --- |
| `knowledge.query` | 检索设计规则和经验。 | 需要查找设计依据时。 | `limit` 省略时为3；提供时须为正整数。结果仍需结合项目与器件资料判断。 |
| `knowledge.listRules` | 列出知识库规则主题。 | 选择查询主题时。 | 主题列表不等于具体设计结论。 |
| `knowledge.widthForCurrent` | 根据电流初估线宽。 | 初选PCB线宽时。 | `currentA` 须大于0且为有限数值；估算不能代替完整温升与制造校核。 |

## 2. 查询SMT可贴装物料

smt.queryComponent由代理本地执行。
不要求EDA在线或提供instanceId。
代理仍须运行并配置本机凭证。

| 指令 | 作用 | 使用时机 | 限制 |
| --- | --- | --- | --- |
| `smt.queryComponent` | 查询可贴装物料。 | 需要按工艺选料时。 | 代理须已配置本机开放平台凭证。 |

- 返回 `components[].code` 即立创编号，可直接用于 `schematic.placeDevice`。
- 首次使用：让用户打开 `http://127.0.0.1:49720/smt` 填 appId / accessKey / secretKey（存于 `bridge/jlc-credentials.json`，升级不丢失，保存即时生效不用重启代理）。
- 该页面也支持人工查询。
- 缺少密钥时，让用户打开https://open.jlc.com。
- 登录后选择“快速接入→创建应用”。
- 创建后取得appId、accessKey和secretKey。
- 密钥只存本机（代理目录 jlc-credentials.json，.gitignore 已排除），勿提交 git、勿外发。
