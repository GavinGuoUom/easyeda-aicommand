# Symbol, Footprint, and Device Library Commands (`lib.*`, 22 commands in 0.10.34)

> The tables and parameter objects on this page describe commands and `params`, not complete HTTP requests. When sending `/command`, the outer request must include `cmd`, the top-level `instanceId`, and the required `params`. A macro routes only the outer request; its steps inherit the instance. See [setup](setup.md) for a complete example.

Personal and system library CRUD. The official default is to search the system library; **this command group defaults to the personal library** (`libraryUuid` omitted or empty = personal library).

## Common patterns

The `symbol`, `footprint`, and `device` groups share the same structure: `Create` (create an empty item → return read-back attributes including `uuid`), `UpdateSource` (write source back), `Search` (empty keyword lists all; supports `key`/`classification`/`page`/`itemsOfPage`), `Get`, `Copy` (fails on a duplicate name in the target library; `targetLibraryUuid` required), `Modify` (set a property value to `null` to clear it), and `Delete`. `Search` returns `[{uuid, name, description, ...}]`.

| Command | Description | Required parameters |
| --- | --- | --- |
| `lib.symbolCreate` | Create an empty symbol | `name`; optional `symbolType?` (`ELIB_SymbolType`, e.g. 2), `classification?`, `otherProperty?` |
| `lib.symbolUpdateSource` | Write a symbol document's source back to the library | `symbolUuid`, `documentSource` |
| `lib.symbolSearch` / `symbolGet` / `symbolCopy` / `symbolModify` / `symbolDelete` | Five corresponding symbol operations | search: none required; get/delete: `symbolUuid`; copy: plus `targetLibraryUuid` |
| `lib.footprintCreate` / `footprintUpdateSource` / `footprintSearch` / `footprintGet` / `footprintCopy` / `footprintModify` / `footprintDelete` | Seven corresponding footprint operations | Same pattern (UUID parameter is `footprintUuid`) |
| `lib.deviceCreate` | **Assemble a device**: bind an existing symbol, footprint, and optionally a 3D model into a complete device (cannot create without a symbol) | `name`, required `symbolUuid`; optional `footprintUuid?`, `model3DUuid?`, `property?` (e.g. designator/addIntoBom/addIntoPcb/manufacturer/supplier) |
| `lib.deviceSearch` / `deviceGet` / `deviceGetByLcscIds` / `deviceCopy` / `deviceModify` / `deviceDelete` | Six corresponding device operations | get/delete: `deviceUuid`; copy: plus `targetLibraryUuid` |
| `lib.symbolOpenInEditor` / `lib.footprintOpenInEditor` | Open a library item in the symbol/footprint editor for editing; after opening, use `project.getDocumentSource` to read its source | `symbolUuid*` / `footprintUuid*`, optional `libraryUuid?` |

Special cases:

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
