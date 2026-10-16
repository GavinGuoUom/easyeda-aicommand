# Knowledge base

# Design knowledge and SMT parts lookup

## 1. Search design information

> This page preserves use cases and limitations. Use `/help?cmd=<command-name>` from the verified target window version for parameters, return fields, and examples.
> Requests sent to EDA must include `cmd`, `instanceId`, and the required `params`.
> A macro routes only at the outer level; its steps inherit the instance.
> See [setup](setup.md) for a complete example.

| Command | Purpose | When to use | Limitation |
| --- | --- | --- | --- |
| `knowledge.query` | Search design rules and experience. | When design rationale is needed. | Evaluate results against the project and component documentation. |
| `knowledge.listRules` | List knowledge-base rule topics. | When choosing a topic to search. | A topic list is not a specific design conclusion. |
| `knowledge.widthForCurrent` | Estimate trace width from current. | For an initial PCB trace-width choice. | The estimate does not replace full thermal and manufacturing checks. |

## 2. Search SMT-assemblable parts

`smt.queryComponent` runs locally through the proxy. It does not require EDA to be online or an `instanceId`. The proxy must be running and its local credentials configured.

| Command | Purpose | When to use | Limitation |
| --- | --- | --- | --- |
| `smt.queryComponent` | Search parts available for SMT assembly. | When selecting parts for an assembly process. | The proxy must have local credentials for the open platform configured. |

- `components[].code` in the response is the LCSC part number and can be passed directly to `schematic.placeDevice`.
- For first-time setup, ask the user to open `http://127.0.0.1:49720/smt` and enter `appId`, `accessKey`, and `secretKey`. They are stored in `bridge/jlc-credentials.json`, retained across upgrades, and take effect immediately without restarting the proxy.
- The page also supports manual searches.
- If credentials are missing, ask the user to open https://open.jlc.com.
- After signing in, select “Quick Access → Create Application”.
- The application provides `appId`, `accessKey`, and `secretKey`.
- Credentials are stored locally in the proxy directory's `jlc-credentials.json`, which is excluded by `.gitignore`. Do not commit or share them.
