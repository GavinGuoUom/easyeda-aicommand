# EasyEDA AI Command

**English:** [README.md](README.md) | **简体中文：** [README_ZH.md](README_ZH.md)

EasyEDA AI Command is an AI operation extension for JLCEDA Pro. An AI uses concise instructions from the companion skill, and a local proxy forwards them to a connected EDA window. The extension supports schematic, PCB, project, and component-library queries and editing. Always check the results against the project requirements; the user remains responsible for final acceptance.

Describe a task to your AI tool, such as “check this chip’s stock and price breaks,” “group the PCB components by schematic function block,” “combine this symbol and footprint into a library component,” or “place the MCU and its supporting parts, wire them, and organize the net labels.” The AI can inspect the current project, look up components and pins, call drawing commands, and read back the results. The extension brings **parts lookup, custom component libraries, batch drawing, PCB functional grouping, and result checks** into one workflow.

> This README is the primary English guide. Some linked documents and captions embedded in the demonstration animations may be in Chinese. This describes the documentation language only; it does not claim that the extension interface supports an English language switch.

## Key features

### 1. Component stock, pricing, and SMT parts lookup

During component selection, look up JLC SMT parts by **part number, model, package, brand, stock, reference unit price, and price breaks**. You can also query details for multiple part numbers at once to compare availability and prices for different order quantities.

- **AI lookup:** Ask the AI to find parts by keywords or query stock, parameter descriptions, and price breaks for a list of part numbers.
- **Separate lookup window:** Open the SMT parts lookup page from the extension menu and view results directly.
- **Lookup while drawing:** Combine parts-library search with placement by JLC part number to use candidate parts in a schematic.

Stock and pricing come from the JLC Open Platform query results. The response at the time of the query and the information shown when ordering are authoritative; a reference unit price is not the transaction price for every order quantity. This feature requires separate Open Platform credentials. See [Parts lookup setup](https://github.com/quhuii-lgtm/easyeda-aicommand/blob/main/docs/QUICKSTART.md#5-可选-smt-物料查询). These credentials are not needed for ordinary drawing features.

### 2. PCB grouping and initial placement by schematic function blocks

Convert rectangular function blocks in a schematic, such as “Power,” “MCU,” “Driver,” and “Interface,” into corresponding PCB component groups. The extension reads the block boundaries and component membership, groups and arranges components, and creates group borders and names to help organize a scattered board.

- Includes PCB component grouping, with a placement engine adapted from the official `eext-pcb-component-grouping` project, callable by AI.
- Reads function blocks across schematic pages or from a specified page; components are arranged in rows by category within each group, and groups are arranged in separate regions.
- **Preview before execution:** By default, the extension returns a grouping and placement plan. During execution it checks the board boundary, avoids existing components, creates a backup before writing, and reads component positions back for verification.

This feature is intended for grouping and initial placement after importing a schematic into a PCB. Function blocks must first be drawn in the schematic. After grouping, continue adjusting the layout for decoupling, return paths, heat, RF, and mechanical constraints. Grouping does not complete final placement or automatic routing.

### 3. Custom component libraries: symbols, footprints, and complete components

Use AI to manage personal symbol, footprint, and component libraries alongside existing marketplace parts. Save custom components for reuse in later projects. Library operations target the personal library by default, or another library the user is authorized to access.

- **Create and edit symbols and footprints:** Create library entries, open the corresponding editor, and write edited symbol or footprint content back to the library.
- **Combine complete components:** Link an existing schematic symbol to a PCB footprint, optionally attach an existing 3D model, and set reference designator prefix, manufacturer, supplier, BOM, and PCB conversion properties.
- **Copy and derive variants:** Copy an existing symbol, footprint, or component to a specified library under a new name to maintain a project-specific version.
- **Search and maintain:** Search, read, modify, or delete library entries; change component-to-symbol and component-to-footprint links; and maintain commonly used parts.

For example, combine a custom connector symbol with a footprint whose dimensions have been checked, then place that library component in a schematic. Creating a library entry does not design its pins or footprint automatically. Before use, check pin numbers, pad mapping, and dimensions. Attaching a 3D model also does not generate a model automatically.

### 4. Batch schematic drawing from a parts list and connection relationships

Place components by JLC part number, read their actual pins, edit reference designators and properties, and create function blocks in batches. Given a parts list and connection relationships, AI can place, connect, name, and check components step by step, reducing repetitive searching, clicking, and typing.

For an existing schematic, preview an organization plan for selected components or regions before rearranging them and rebuilding connections. This is suitable for repeated channels, MCU peripherals, interface modules, and other drawing tasks with clear connection relationships.

### 5. Batch wiring, net labels, and connection checks

Create direct pin-to-pin wires, short wires with net labels, or a mixture of both. Manage net-label names, mark pins as no-connect, query net members, and export netlists.

When wiring, the extension can use actual pin locations to form paths. After creating a label, it checks whether the label is attached to a wire. Batch wiring checks the resulting netlist connections. This helps create a readable drawing and confirm whether the intended pins really belong to the same net. The MCU demonstration below shows short wire stubs, aligned labels on both sides, and a save/reopen check.

### 6. PCB drawing, copper areas, and net management

Draw board outlines, move and rotate components, create tracks from coordinates, place vias, create or modify copper areas, and read back fill status after rebuilding copper. Manage net classes and differential pairs, query net lengths, read tracks and pads on a net, and use highlighting or schematic-to-PCB cross-probing to help investigate issues.

Use these features for batches of operations with clear rules, such as “route along these coordinates,” “create and rebuild GND copper in this region,” or “add these signals to a net class.” An external autorouter workflow can use DSN export and SES import. The resulting routing still needs inspection.

### 7. Project checks, exports, and multi-window operation

- **Result checks:** Read component, pin, wire, label, and copper-fill states; run schematic and PCB DRC; and export a netlist to check connections. The available DRC details depend on the EDA host version.
- **Exports:** Export BOMs, schematic images, PCB Gerber files, pick-and-place coordinates, and other design materials for review and manufacturing preparation.
- **Multi-window targeting:** Select the operation target by instance and document identity when several projects are open.
- **Combined operations:** Macro commands can run component placement, wiring, and checks in sequence and return each step’s result. If a write result is uncertain, later dependent operations stop.

These capabilities work together with the local proxy and companion AI skill. The extension provides project operations and result readback; circuit design decisions and final acceptance still depend on the actual project requirements.

### 8. JLC manufacturing checks (DFM)

PCB DFM, SMT, and same-net spacing checks return 18, 7, and 1 check items respectively, along with completeness and geometry coverage information. A DFM run requires explicit outer and inner copper thickness inputs: `outerCopperOz` and `innerCopperOz`. Copper thickness read from the design is reported separately and does not replace these inputs. Results do not constitute manufacturing approval or a complete online DFM service. See [DFM check details](skills/ai-command-engine/references/commands-dfm.md).

### 9. Pad fanout and local copper generation

`pcb.getFanoutPlan` and `pcb.getAutoCopperPlan` first produce read-only plans. `pcb.fanout` and `pcb.autoCopper` execute the complete plans. Fanout length, track width, via outer diameter, drill diameter, and clearance must all be specified explicitly in mils. Supported geometry, conservative approximations, and rejection conditions are described in [Geometry command details](skills/ai-command-engine/references/commands-geometry.md). These geometry features have local regression and algorithm comparison results only; writes and save/reopen behavior have not been verified in a real EDA project.

### 10. Pad expansion and net-name silkscreen text

Use `pcb.getPadExpansionPlan` / `pcb.expandPads` to plan and perform pad expansion. Use `pcb.getNetSilkscreenPlan` / `pcb.generateNetSilkscreen` to create editable silkscreen text for pad nets. Supported shapes, region splitting and persistence limits for expansion, and placement and clearance limits for net text are described in [Geometry command details](skills/ai-command-engine/references/commands-geometry.md). These features do not replace checks of the actual graphics, clearances, or manufacturing output.

## Operation demonstrations

Both animations were recorded with extension v0.10.89 and EDA Pro 4.1.60. They demonstrate existing operations and are not hands-on acceptance records for v0.10.116.

### Schematic: multi-pin MCU, supporting parts, short wires, and labels

![48-pin MCU schematic: place supporting parts, add short wires, align net labels, and check after save and reopen](images/demo-schematic.gif)

The demonstration draws an STM32F103C8T6 and six supporting components. Short wires connect the reset and BOOT0 branches; equal-length short stubs extend from the other pins, and net labels are aligned in columns. After saving and reopening, **all 57 labels remained attached and the 60 pin-to-net memberships remained consistent**. This demonstrates drawing operations; it is not a complete MCU minimum system. The DRC reported 0 fatal errors and 37 warnings. Recorded with extension v0.10.89 and EDA Pro 4.1.60. See [steps and verification details](docs/DEMO-SCHEMATIC.md).

### PCB: board outline, tracks, vias, and copper

![AI-directed PCB drawing: board outline, tracks, vias, copper, and checks after save and reopen](images/demo-pcb.gif)

In a separate demonstration PCB, AI commands create a board outline, draw top-layer tracks, place a via and continue routing on the bottom layer, create and rebuild a copper area, then save, close, reopen, and read back the results. After reopening, **six track segments were read back and the copper area was filled**.

The animation uses screenshots from real EDA operations; command descriptions are later-added captions. Account details and the project list were cropped out. A GND pad and net were set up in advance. This is a feature demonstration board, not a complete circuit design. It was recorded on **2026-10-09 with extension v0.10.89 and EDA Pro 4.1.60**; verification applies only to the demonstration objects described. The animation is about 18 seconds long. See the [demonstration notes](docs/DEMO.md) for steps and verification scope.

## Before installation

**You must separately install Node.js >=20.17.0, the local command proxy, and the AI skill.** Installing the extension from the marketplace does not install or start the proxy, or install the skill for you. After enabling the extension, allow external interaction in EDA, start the local proxy, install the corresponding skill, and check the connection target.

The extension, proxy, and AI skill are installed separately. The proxy runs locally by default at `http://127.0.0.1:49720`. An optional issue-reporting tool can collect the information needed for a report and submit a GitHub Issue using the user’s authenticated local [GitHub CLI](https://cli.github.com/). The AI informs the user before submission. Issue reporting is never triggered automatically by an EDA command and does not upload project data in the background.

## Release status

**v0.10.116 was formally released on 2026-10-11.** Local targeted regression and build checks passed. The installation check read back 218 commands and separately checked four removed entry points; this does not mean every command was tested. Ordinary native placement, component movement, and layout features remain available. Real EDA writes were not performed for this release, and not all features and scenarios were verified. A GitHub release does not mean the EDA marketplace has approved the extension. Historical marketplace error `103014` (“entry cannot be empty”) has not been rechecked. See the [v0.10.116 release notes](docs/releases/v0.10.116.md).

The “little robot drawing a circuit board” shown on the page is the project logo. The marketplace icon file is `images/logo-marketplace.png`.

<a id="v010116-下载与安装"></a>

## v0.10.116 downloads and installation

The plugin retains version `v0.10.116`. The English-first documentation and skill were added on 2026-10-13; the original tag and source archive remain unchanged:

- [Extension package: ai-command-engine_v0.10.116.eext](https://github.com/quhuii-lgtm/easyeda-aicommand/releases/download/v0.10.116/ai-command-engine_v0.10.116.eext)
- [Companion skill package: ai-command-engine-skill_en-zh_v0.10.116.zip](https://github.com/quhuii-lgtm/easyeda-aicommand/releases/download/v0.10.116/ai-command-engine-skill_en-zh_v0.10.116.zip)
- [English-first skill checksum: SHA256SUMS-docs-20261013.txt](https://github.com/quhuii-lgtm/easyeda-aicommand/releases/download/v0.10.116/SHA256SUMS-docs-20261013.txt)
- [SHA256SUMS.txt](https://github.com/quhuii-lgtm/easyeda-aicommand/releases/download/v0.10.116/SHA256SUMS.txt)
- [v0.10.116 source ZIP](https://github.com/quhuii-lgtm/easyeda-aicommand/archive/refs/tags/v0.10.116.zip)

The English-first skill ZIP includes `SKILL.md` and English references, plus `SKILL_ZH.md` and `references/zh/` as the Chinese fallback. These are two documentation versions inside one installed skill; do not install the fallback as a second automatic skill. The original Chinese skill attachment remains available in the release. Verify the new ZIP with `SHA256SUMS-docs-20261013.txt`.

After extracting the skill ZIP, install the entire `ai-command-engine/` directory in your AI tool’s skill directory, keeping subdirectories such as `references/` and scripts; do not copy only `SKILL.md`. The original tagged source ZIP contains the original Chinese skill at `skills/ai-command-engine/`. Use the new skill ZIP or current main branch for the English-first edition. The proxy is not packaged separately. Download the source ZIP, then follow the [installation and usage guide](docs/QUICKSTART.md) to install Node.js dependencies and run the local proxy. The extension, proxy, and skill are separate installs; the extension marketplace will not install the proxy or skill for you.

## First use

Follow the [installation and usage guide](https://github.com/quhuii-lgtm/easyeda-aicommand/blob/main/docs/QUICKSTART.md) to install Node.js and proxy dependencies, install the EDA extension, allow external interaction, perform the first read-only check, and install the AI skill. To run the proxy, execute these commands in the repository directory:

```powershell
git clone https://github.com/quhuii-lgtm/easyeda-aicommand.git
Set-Location easyeda-aicommand
npm ci
node bridge/command-proxy.mjs
```

If you downloaded a ZIP, run `npm ci` and `node bridge/command-proxy.mjs` from the extracted repository directory. Keep the proxy terminal open. Then download the `.eext` package from [Releases](https://github.com/quhuii-lgtm/easyeda-aicommand/releases), import and enable it in the EDA extension manager, and allow external interaction. Install the complete [`skills/ai-command-engine/`](https://github.com/quhuii-lgtm/easyeda-aicommand/tree/main/skills/ai-command-engine) directory in your AI tool’s skill directory, then click AI Command → Start Bridge in the EDA menu. Installing the extension does not deploy the proxy locally or install the skill in your AI tool. See the [first-use guide](https://github.com/quhuii-lgtm/easyeda-aicommand/blob/main/docs/QUICKSTART.md) for complete instructions.

Windows users can optionally start the proxy through a URL protocol. See the [bridge lifecycle documentation](https://github.com/quhuii-lgtm/easyeda-aicommand/blob/main/docs/BRIDGE-LIFECYCLE.md) for registration and lifecycle details. GitHub CLI is not needed for ordinary use; it is needed only if you choose the optional issue-reporting feature. SMT parts lookup also requires [JLC Open Platform](https://open.jlc.com) credentials; see the [parts lookup guide](https://github.com/quhuii-lgtm/easyeda-aicommand/blob/main/docs/QUICKSTART.md#5-可选-smt-物料查询).

## Safety and verification limits

- Every `/command` request must include a top-level `instanceId`. First query the connections and confirm the target window. For schematic-page operations, also confirm the page identity.
- A write timeout does not mean the operation was cancelled. If the result is unknown or the document is write-protected, verify using read-only operations before proceeding; do not retry blindly.
- Plugin/API responses, readback after saving, readback after closing and reopening, and manufacturing acceptance are different levels of evidence. A successful command, DRC result, or simulation regression alone does not prove that a circuit is correct.
- Issue reports use only necessary evidence that has already been obtained and can be made public. Inform the user before submission. GitHub CLI, issue creation, and sign-in are optional. The submission entry point is [GitHub Issues](https://github.com/quhuii-lgtm/easyeda-aicommand/issues).

## Developer resources

See the [repository](https://github.com/quhuii-lgtm/easyeda-aicommand) for source code, the proxy, and the complete AI skill. Local regression, build, and host verification details are stated separately in the relevant release notes. See the project [CHANGELOG](https://github.com/quhuii-lgtm/easyeda-aicommand/blob/main/CHANGELOG.md) and [SDK changelog](https://github.com/quhuii-lgtm/easyeda-aicommand/blob/main/docs/SDK-CHANGELOG.md) for project and build-framework history.

[Apache-2.0 License](https://github.com/quhuii-lgtm/easyeda-aicommand/blob/main/LICENSE).
