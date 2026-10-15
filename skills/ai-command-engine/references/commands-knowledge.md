# Knowledge Base Commands

> The table describes commands and `params`, not a complete HTTP request. A `/command` request must include `cmd`, top-level `instanceId`, and required `params`. A macro routes only at the outer level; its steps inherit the instance. See [setup](setup.md) for a complete example.

| Command | Description | Key parameters |
| --- | --- | --- |
| `knowledge.query` | Search routing rules and experience | `query`, `limit?` |
| `knowledge.listRules` | List all rule topics | None |
| `knowledge.widthForCurrent` | Convert current to trace width | `currentA` |

## JLC Open Platform (executed locally by the proxy; EDA need not be online)

| Command | Description | Key parameters |
| --- | --- | --- |
| `smt.queryComponent` | Search SMT-assemblable parts | `queryString`, `pageNum?`, `pageSize?` |

- `components[].code` in the response is the JLC part number and can be used with `schematic.placeDevice`.
- First use: ask the user to open `http://127.0.0.1:49720/smt` and enter `appId`, `accessKey`, and `secretKey`. They are stored in `bridge/jlc-credentials.json`, survive upgrades, and take effect immediately without restarting the proxy. The page also supports manual searches.
- To obtain credentials when the user sees “JLC Open Platform credentials are not configured,” direct them to <https://open.jlc.com>, sign into their JLC account, choose “快速接入” (“Quick Access”) → “创建应用” (“Create App”), and generate the three values (`appId`, `accessKey`, `secretKey`). It takes about one minute. Credentials are stored locally in the proxy directory's `jlc-credentials.json`, which `.gitignore` excludes. Do not commit or share them.
