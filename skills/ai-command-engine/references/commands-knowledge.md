# Knowledge base

# Design knowledge and SMT part lookup

## 1. Search design knowledge

> This table preserves use cases and limitations. Use `/help?cmd=<command-name>` from the verified target window version for parameters, return fields, and examples.
> Requests sent to EDA must include `cmd`, `instanceId`, and required `params`.
> A macro routes only at the outer level; its steps inherit the instance.
> See [setup](setup.md) for complete examples.

| Command | Purpose | When to use | Limitation |
| --- | --- | --- | --- |
| `knowledge.query` | Search design rules and guidance. | Find design rationale. | `limit` defaults to 3; if provided, it must be a positive integer. Evaluate results against the project and component documentation. |
| `knowledge.listRules` | List design-knowledge rule topics. | Choose a query topic. | A topic list is not a design conclusion. |
| `knowledge.widthForCurrent` | Estimate trace width from current. | Initial PCB trace-width selection. | `currentA` must be a finite number greater than 0. The estimate does not replace full temperature-rise and manufacturing checks. |

## 2. Search SMT assembly parts

`smt.queryComponent` runs locally in the proxy. It does not require EDA to be online or an `instanceId`. The proxy must be running and configured with local credentials.

| Command | Purpose | When to use | Limitation |
| --- | --- | --- | --- |
| `smt.queryComponent` | Search surface-mount parts. | Select parts by assembly process. | The proxy must have local Open Platform credentials configured. |

- `components[].code` in the response is the LCSC part number and can be used directly with `schematic.placeDevice`.
- For first use, ask the user to open `http://127.0.0.1:49720/smt` and enter `appId`, `accessKey`, and `secretKey`. They are stored in `bridge/jlc-credentials.json`, survive upgrades, and take effect immediately without restarting the proxy.
- The page also supports manual lookup.
- If credentials are missing, ask the user to open https://open.jlc.com, sign in, and choose “Quick Access → Create Application.”
- After creating the application, obtain `appId`, `accessKey`, and `secretKey`.
- Credentials remain local in the proxy directory's `jlc-credentials.json` (excluded by `.gitignore`); never commit or share them.
