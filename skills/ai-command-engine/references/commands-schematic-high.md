# Schematic high-frequency commands

“High-frequency” means recommended for common drawing workflows, not a count of actual invocations. Verify the target window using [Connection and setup](setup.md). `GET /help?cmd=<command-name>` uses the proxy's currently selected window; confirm it matches the target version before using its parameters. See [Schematic workflow](commands-schematic.md) for full limitations and [low-frequency commands](commands-schematic-low.md) for specialized operations.

| Stage | Recommended commands | Purpose |
| --- | --- | --- |
| Inspect current state | `schematic.getPageInfo`, `schematic.listComponents`, `schematic.listPins` | Verify the page, components, and pins. |
| Place a component | `schematic.placeDevice` | Place one component and verify its resources. |
| Connect | `schematic.labelWire`, `schematic.linkWire`, `schematic.batchWire` | Connect a pin to a named net, connect two pins, or make batch connections. |
| Draw precisely | `schematic.drawWire`, `schematic.placeNetLabel` | Specify wire geometry or label position. |
| Modify | `schematic.moveComponent`, `schematic.modifyComponent`, `schematic.setAttribute` | Change position, component, or attribute. |
| Check | `schematic.listNets`, `schematic.listWires`, `schematic.runDrc`, `schematic.getNetlist` | Verify nets, wires, rules, and connectivity. |
| Save and inspect visually | `schematic.save`, `schematic.exportPng` | Save and inspect the actual drawing. |

This page lists 18 commands. After naming a wire with `drawWire`, do not add a same-name label to the same segment. After batch writes, check the returned results and actual netlist. Zero DRC errors alone does not prove the connections are correct.

The host may merge existing wires where `drawWire` connects to them. `primitiveIds` contains IDs that survive in the final result; use `created` for the number created. Since v0.20.21, before writing, compare the associated LINE after native Y-axis conversion with the SDK wire in both directions; stop before writing if they disagree. If a write is partial or readback is uncertain, stop further wire drawing and inspect the original page; do not automatically retry the original request.
