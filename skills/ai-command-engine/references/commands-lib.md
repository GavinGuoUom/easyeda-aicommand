# Symbol, Footprint, and Device Library Commands (`lib.*`)

> The tables and parameter objects on this page describe commands and `params`, not complete HTTP requests. When sending `/command`, the outer request must include `cmd`, the top-level `instanceId`, and the required `params`. A macro routes only the outer request; its steps inherit the instance. See [setup](setup.md) for a complete example.

CRUD commands for personal and system libraries. Official search defaults to the system library; **this command group defaults to the personal library** (`libraryUuid` omitted or empty = personal library).

## Common patterns

The `symbol`, `footprint`, and `device` groups use a common pattern: `Create`, `UpdateSource`, `Search` (an empty keyword lists all; supports `key`/`classification`/`page`/`itemsOfPage`), `Get`, `Copy` (a duplicate name in the target library fails; `targetLibraryUuid` is required), `Modify` (set a property value to `null` to clear it), and `Delete`. `Search` returns `[{uuid, name, description, ...}]`.

| Command | Description | Required parameters |
| --- | --- | --- |
| `lib.symbolCreate` | Create an empty symbol | `name`; optional `symbolType?` (`ELIB_SymbolType`, e.g. 2), `classification?`, `otherProperty?` |
| `lib.symbolUpdateSource` | Write a symbol document's source back to the library | `symbolUuid`, `documentSource` |
| `lib.symbolSearch` / `symbolGet` / `symbolCopy` / `symbolModify` / `symbolDelete` | Five corresponding symbol operations | search: none required; get/delete: `symbolUuid`; copy: plus `targetLibraryUuid` |
| `lib.footprintCreate` / `footprintUpdateSource` / `footprintSearch` / `footprintGet` / `footprintCopy` / `footprintModify` / `footprintDelete` | Seven corresponding footprint operations | Same pattern (UUID parameter is `footprintUuid`) |
| `lib.footprintGetSource` | Read raw library footprint source for content analysis or format diagnosis; does not open the editor or modify the library | `footprintUuid`, optional `libraryUuid?`; returns `{footprintUuid,libraryUuid,source}` |
| `lib.deviceCreate` | Assemble a library device by binding an existing symbol, or by creating an empty symbol, then optionally associating a footprint and 3D model | `name`; for an existing symbol, `symbolUuid`; for a new empty symbol, `symbolType`; optional `symbolLibraryUuid?`, `footprintUuid?`, `footprintLibraryUuid?`, `model3DUuid?`, `property?` |
| `lib.deviceSearch` / `deviceGet` / `deviceGetByLcscIds` / `deviceCopy` / `deviceModify` / `deviceDelete` | Six corresponding device operations | get/delete: `deviceUuid`; copy: plus `targetLibraryUuid` |
| `lib.symbolOpenInEditor` / `lib.footprintOpenInEditor` | Open a library item in the symbol/footprint editor for editing; after opening, use `project.getDocumentSource` to read its source | `symbolUuid*` / `footprintUuid*`, optional `libraryUuid?` |

Special cases:
- `lib.deviceCreate`: to bind across libraries, pass `symbolLibraryUuid` and `footprintLibraryUuid` separately. If omitted, each defaults to the `libraryUuid` used to create the device. For example: `{"libraryUuid":"target-library-UUID","name":"test resistor","symbolUuid":"symbol-UUID","symbolLibraryUuid":"symbol-library-UUID","footprintUuid":"footprint-UUID","footprintLibraryUuid":"footprint-library-UUID"}`.
- To create an ordinary empty symbol, pass `symbolType:2`; `symbolUuid` is not required. Version 0.10.135 includes this SDK-supported branch; the project-library result has not been tested on the host.
- After creation, first try `get` for readback. If project libraries do not support that query, search by name and match the UUID returned by creation; do not create a second item. Version 0.10.134 proved that cross-library resources can enter the project, but the old final `get` falsely reported an error. Full receipt verification after the 0.10.135 adaptation remains pending.

- `lib.deviceGetByLcscIds`: `lcscIds` accepts one value or an array for batch lookup (e.g. `"C1523"` or `["C1523","C17168"]`); `allowMultiMatch?` returns all matches when a C-number has multiple matches. ⚠️ Not available in private deployments.
- `lib.deviceModify` supports rebinding: use `symbolUuid`/`footprintUuid` to change bindings and `property` to change designator/manufacturer/supplier, etc.

⚠️ Key points:

- Get library UUIDs from `cbb.listLibraries` (personal and system libraries use the same UUID format).
- Do not use these commands for ordinary placement. For LCSC Marketplace parts, use `library.searchDevice`/`library.getDeviceByLcsc` to place a part in the project. This group manages **custom library items** for storage and maintenance.
- Library creation flow: `symbolCreate` → draw in the editor → `symbolUpdateSource` to save to the library; repeat for a footprint → `deviceCreate` to bind them → the item can then be found in the project with `library.searchDevice`.

## Select parts in a project (official library, not custom)

| Command | Description | Key parameters |
| --- | --- | --- |
| `library.searchDevice` | Search the component library for LCSC Marketplace parts | `keyword`, optional `limit?` |
| `library.getDeviceByLcsc` | Look up a part by its LCSC number | `lcscId` |



