# Knowledge Base Commands

> The tables and parameter objects on this page describe commands and `params`, not complete HTTP requests. When sending `/command`, the outer request must include `cmd`, the top-level `instanceId`, and the required `params`. A macro routes only the outer request; its steps inherit the instance. See [setup](setup.md) for a complete example.

| Command | Description | Key parameters |
| --- | --- | --- |
| `knowledge.query` | Search routing rules and practical guidance | `query`, optional `limit?` |
| `knowledge.listRules` | List all rule topics | None |
| `knowledge.widthForCurrent` | Convert current to trace width | `currentA` |

## JLC Open Platform (executed locally by the proxy; EDA does not need to be online)

| Command | Description | Key parameters |
| --- | --- | --- |
| `smt.queryComponent` | Search SMT components available for assembly | `queryString`, optional `pageNum?`, `pageSize?` |

- The returned `components[].code` is the LCSC part number and can be used directly with `schematic.placeDevice`.
- First-time setup: have the user open `http://127.0.0.1:49720/smt` and enter `appId`, `accessKey`, and `secretKey`. They are stored in `bridge/jlc-credentials.json`, persist across upgrades, and take effect immediately when saved; restarting the proxy is not needed. This page also supports manual searches.
- **Obtaining credentials** (guide the user here if they see “嘉立创开放平台密钥未配置” / “JLC Open Platform credentials are not configured”): visit https://open.jlc.com → sign in to the JLC account → “快速接入” (“Quick Access”) → “创建应用” (“Create Application”). Generate the three values (`appId` / `accessKey` / `secretKey`) in one step; this takes about one minute. Credentials are stored only locally (in the proxy directory's `jlc-credentials.json`, excluded by `.gitignore`); do not commit them to Git or share them externally.
