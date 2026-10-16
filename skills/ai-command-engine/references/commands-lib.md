# Library

# Symbol, footprint, and device library commands (`lib.*`)

> This page preserves use cases and limitations. Use `/help?cmd=<command-name>` from the verified target window version for parameters, return fields, and examples.
> A `/command` request must include outer `cmd`, top-level `instanceId`, and the required `params`.
> A macro routes only at the outer level; its steps inherit the instance.
> See [setup](setup.md) for a complete example.

`lib` commands maintain personal and system library resources. Official commands search the system library by default; **this command group defaults to the personal library** (`libraryUuid` omitted means personal library).

## 1. Select parts for a project

| Command | Purpose | When to use | Limitation |
| --- | --- | --- | --- |
| `library.searchDevice` | Search device libraries (LCSC Mall parts). | Select parts or verify library resources. | Check available parameters in the target instance's help. |
| `library.getDeviceByLcsc` | Find a device by LCSC part number. | Select parts or verify library resources. | Check available parameters in the target instance's help. |

For ordinary placement, look up an existing device first. Creating a personal library resource does not mean it has been placed in a project.

## 2. Create or maintain personal library resources

| Command | Purpose | When to use | Limitation |
| --- | --- | --- | --- |
| `lib.symbolCreate` | Create a blank symbol. | Maintain personal library resources. | If the write result is unknown, stop later writes. |
| `lib.symbolUpdateSource` | Write symbol document source back to the library. | Maintain personal library resources. | Save the original content before writing. |
| `lib.symbolSearch` / `symbolGet` / `symbolCopy` / `symbolModify` / `symbolDelete` | Search, read, copy, modify, or delete symbols. | Search or maintain similar library resources. | UUID may change after modification. |
| `lib.footprintCreate` / `footprintUpdateSource` / `footprintSearch` / `footprintGet` / `footprintCopy` / `footprintModify` / `footprintDelete` | Create, read/write, search, copy, modify, or delete footprints. | Search or maintain similar library resources. | UUID may change after modification. |
| `lib.footprintGetSource` | Read raw library footprint source for content analysis or format diagnosis. Does not open the editor or modify the library. | Select parts or verify library resources. | Check available parameters in the target instance's help. |
| `lib.deviceCreate` | Assemble a library device: bind an existing symbol or create a blank one, then associate a footprint and 3D model. | Maintain personal library resources. | If the write result is unknown, stop later writes. |
| `lib.deviceSearch` / `deviceGet` / `deviceGetByLcscIds` / `deviceCopy` / `deviceModify` / `deviceDelete` | Search, read, copy, modify, or delete devices. | Search or maintain similar library resources. | UUID may change after modification. |
| `lib.symbolOpenInEditor` / `lib.footprintOpenInEditor` | Open a library item in the symbol or footprint editor for editing; afterward, use `project.getDocumentSource` to read its source. | Search or maintain similar library resources. | Check available parameters in the target instance's help. |

Symbols, footprints, and devices share the same operation categories:

- `Create` creates a blank resource and returns a UUID.
- `UpdateSource` writes document source back to the library.
- `Search` searches by keyword, category, and pagination.
- An empty `key` lists all resources.
- `classification` limits the category.
- `page` selects the page number.
- `itemsOfPage` sets the number of results per page.
- `Get` reads a specified resource.
- `Copy` copies a resource to a target library.
- `Modify` changes resource properties.
- `Delete` removes a specified resource.
- `Copy` requires `targetLibraryUuid`.
- A copy may fail if a resource with the same name exists in the target library.
- Setting a property to `null` in `Modify` clears it.

`Search` returns `[{uuid, name, description, ...}]`.

Exceptions and details:

- `lib.deviceCreate` binds a symbol and footprint into a library device.
- For cross-library resources, provide `symbolLibraryUuid` and `footprintLibraryUuid` separately; if omitted, `libraryUuid` of the new device is used.
- Example: `{"libraryUuid":"target library UUID","name":"Test resistor","symbolUuid":"symbol UUID","symbolLibraryUuid":"symbol library UUID","footprintUuid":"footprint UUID","footprintLibraryUuid":"footprint library UUID"}`.
- For a new ordinary blank symbol, pass `symbolType:2`; `symbolUuid` is not required in this case.
- Verify this branch's availability against the installed version's help and readback.
- After creation, prefer reading it back with `get`.
- If project-library lookup does not support the query, search by name and match against the UUID returned by creation; do not create it again.
- Cross-library resources were confirmed to enter a project in version 134, but the final `get` in that old version could report a false error.
- Successful creation does not replace complete acknowledgment and resource checks.

- `lib.deviceGetByLcscIds`: `lcscIds` accepts one value or an array for batch lookup, such as `"C1523"` or `["C1523","C17168"]`.
- `allowMultiMatch?` returns all matches when one C-number has multiple results.
- ⚠️ Not available in private deployments.
- `lib.deviceModify` supports rebinding: use `symbolUuid` or `footprintUuid` to change associations, and `property` to change designator, manufacturer, supplier, and similar fields.

⚠️ Key guidance:

- Do not use this group for ordinary placement. To select an LCSC Mall part for placement in a project, use `library.searchDevice` or `library.getDeviceByLcsc`.
- This group is for creating and maintaining **custom library components**.
1. Create a symbol with `symbolCreate`.
2. Draw the symbol in the editor.
3. Write the symbol content back with `symbolUpdateSource`.
4. Create a footprint using the same process.
5. Bind the symbol and footprint with `deviceCreate`.
6. Find the bound device with `library.searchDevice`.
