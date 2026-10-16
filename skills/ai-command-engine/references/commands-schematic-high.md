# High-frequency schematic commands

“High-frequency” means recommended for common drawing workflows, not invocation-count statistics. Check the target window using [Connection and setup](setup.md). `GET /help?cmd=<command-name>` uses the proxy's currently selected window. Confirm it matches the target version before using the returned parameters. Full limitations are in the [detailed schematic reference](commands-schematic.md). For special operations, see [low-frequency schematic commands](commands-schematic-low.md).

| Stage | Recommended commands | Purpose |
| --- | --- | --- |
| Inspect current state | `schematic.getPageInfo`, `schematic.listComponents`, `schematic.listPins` | Confirm the page, components, and pins. |
| Place components | `schematic.placeDevice` | Place one component and verify its resources. |
| Connect | `schematic.labelWire`, `schematic.linkWire`, `schematic.batchWire` | Connect one pin to a named net, connect two pins, or wire a batch, respectively. |
| Draw precisely | `schematic.drawWire`, `schematic.placeNetLabel` | Use when wire geometry or label position must be specified. |
| Modify | `schematic.moveComponent`, `schematic.modifyComponent`, `schematic.setAttribute` | Change position, component properties, or attributes. |
| Check | `schematic.listNets`, `schematic.listWires`, `schematic.runDrc`, `schematic.getNetlist` | Check nets, wires, rules, and connectivity. |
| Save and inspect visually | `schematic.save`, `schematic.exportPng` | Save and inspect the rendered page. |

This page covers 18 commands. If `drawWire` names a wire, do not add a same-name label to that same segment using `placeNetLabel`. After batch writes, check the returned results and actual netlist. Zero DRC errors alone do not prove that connections are correct.
