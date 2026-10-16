# PCB Operating Requirements

This file maintains specific requirements for drawing, modifying, and checking results.
The project supplies the confirmed scope, expected connections, and design conditions.

Manage stage acceptance and project records as agreed for the project.
For online commands and parameters, also read the relevant command reference selected from the skill entry point; use help for the currently installed version.
For offline generation or another backend, apply only the relevant drawing and design requirements; do not use them to initiate online writes.

## Board Outline and Manufacturing Rules

- Confirm the board outline, holes and slots, fixed interfaces, assembly side, and component heights first.
- Determine interface position and orientation from the mechanical drawing, mating connector, and assembly method.
- Check whether a fully inserted connector is blocked by the board edge, enclosure, or nearby components.
- Leave room for cable bends, latches, and insertion/removal tools.
- For board-to-board connectors, check the position, orientation, and height of the mating board.
- Leave clearance around mounting holes for the actual screws, washers, and standoffs.
- Check panel edges, fabrication rails, and placement space for the actual manufacturing method.
- Lock only components with explicit, confirmed position requirements.
- Set trace width, spacing, copper-to-edge, and hole rules for the actual process.
- Distinguish drill size from finished-hole size.
- Distinguish plated and non-plated holes, and requirements for plugged or filled vias.
- Check which objects are actually affected by net, layer, and region rules.
- Do not check only default rules.
- Separately verify the basis for any insulation, creepage, or impedance requirements.

## Stackup and Current Return

- Specify the purpose, material, copper thickness, and dielectric thickness of every layer.
- Record drawing copper thickness, copper thickness used for checks, and order copper thickness separately.
- If they differ, state the difference and how it is being handled.
- Mark unconfirmed order processes as pending confirmation.
- Mark confirmed but not yet submitted process settings as proposed order parameters.
- Changing check parameters does not change the drawing's stackup.
- Correct copper-layer count does not prove that the physical stackup is correct.
- Choose the stackup based on routing density, power delivery, and the board manufacturer's process.
- A low signal transition count does not mean every high-to-low or low-to-high transition is slow.
- For critical traces, identify the layer, reference plane, and return path.
- Check whether vias, slots, and traces interrupt the reference plane.
- A layer named GND does not prove that its copper plane is continuous.
- Return current spreads across the copper plane; it does not flow only along a single line in a diagram.

The following four-layer stackups can be compared; there is no universal best choice.
S means signal, G means ground, and P means power.

| Top to bottom | Main checks |
| --- | --- |
| S / G / P / S | Is the power reference plane continuous for bottom-layer traces? How does return current flow when changing reference planes? |
| S+P / G / G / S+P | Is the outer-layer power copper sufficient? How are the two ground layers connected? |
| S / G / P+limited S / G | Which layer is the actual reference for inner-layer signals? Do traces fragment the power region? |

- Check specific dielectric thicknesses and impedance even when the layer order is the same.
- On a two-layer board, check whether the actual copper planes can provide a return path.
- Do not judge a six-layer board as better based on layer count alone.
- Do not claim impedance has passed without the actual manufacturing stackup.
- Keep fast or sensitive signals from crossing gaps in their reference planes.
- When a signal changes layers, check how its return current changes layers.
- Place ground vias between ground reference planes as actually required.
- Do not connect reference planes at different potentials with a ground via.
- When changing from a ground reference to a power reference, check the AC return conditions or change the routing layer.
- Do not blindly add capacitors for every signal that changes layers.
- Differential pairs also carry common-direction current in both conductors; check their return path too.
- Do not split a ground plane solely because the names AGND and DGND differ.
- Do not damage isolation slots, antenna keep-outs, or special sensing structures to improve return current.

## Checks After Copying a Multilayer Board

- After copying a four-layer or other multilayer board, check the schematic association of the target board.
- Check the actual copper-layer order, dielectric layers, and total board thickness.
- Check that each layer's purpose and copper thickness meet the current design conditions.
- If the original board must be retained, confirm that it is still present and unchanged.

## Unconnected Pads

- Check the pin number, purpose, and confirmed connection of every unconnected pad individually.
- Distinguish an accidental omission, unused signal pin, function pin allowed to float, and mechanical pad.
- A function pin allowed to float must be supported by documentation for the exact part number.
- For mechanical pads, check whether grounding or another connection is needed for their actual use.
- If a tool cannot determine a net, that does not mean the design is necessarily wrong.
- Confirming a category does not mean the tool has fully checked that pad.
- Record each warning's category, basis for the decision, and checks still incomplete.
- Do not force a ground connection or change a net just to clear a warning.

## Component Placement

### Placement Order

1. Place fixed interfaces and mechanically constrained components first.
2. Determine which functional areas should be adjacent based on power, control, sensing, and external interfaces.
3. Place critical local circuits first, such as bypass, driver, bootstrap, feedback, and clock circuits.
4. Leave room for main current paths, important signals, layer-change vias, and return paths.
5. Adjust the main controller's position and orientation based on all used interfaces.
6. Check one repeated channel before laying out the others.
7. Check whether constrained pin escapes and shared channels can be routed.
8. Adjust spacing, orientation, and alignment of ordinary components last.

### Functional Areas and Supporting Components

- Check critical ICs against the manufacturer's layout requirements for the exact part, package, and operating conditions.
- Distinguish mandatory manufacturer requirements, recommendations, and choices adopted by this project.
- Apply requirements to specific pads, traces, and return paths.
- Do not copy example-board coordinates, fixed distances, grids, or rotation angles.
- Define functional areas from actual connectivity, not only by designator prefix or component type.
- Identify the pin, interface, or circuit served by each supporting component.
- Place supporting components relative to the actual pins and return paths; do not line them up around the IC center.
- First arrange adjacent positions and routing channels for functional areas that interconnect frequently.
- When moving or rotating the main controller, check all used interfaces, supporting components, and effects on neighboring areas.
- Airwire crossings, center-to-center distance, and total airwire length are only for screening candidate placements.

### Common Local Circuits

Requirements for specific part numbers are maintained by `component-pcb-profiles`.
For unverified part-specific requirements, first check the manufacturer's documentation for the exact part.

| Object | Placement checks |
| --- | --- |
| Decoupling and power supply | Check the actual path formed by the relevant power pin, pad, via, and return; do not consider capacitor distance alone. |
| Power conversion | Arrange paths for input, conversion, and output; check high-frequency loops, bootstrap, feedback, and thermal clearance. |
| Drivers and power switches | Check driver and switching loops; prevent power paths from interfering with gate-drive and sensing paths. |
| Crystal and clock | Place the crystal and load components around the clock pins; handle ground guard and routing underneath according to the specific guide. |
| Communication interfaces | Place protection, termination, and branches according to their actual function and interface topology. |
| Protection and freewheeling | Check the relative positions of the protection point, fault source, return, and protected path. |
| Analog and sensing | Keep input, reference, and filter paths away from interference; place and orient sensors to suit the measurement purpose. |
| Shunt and precision feedback | Place components according to actual sense points; check power drop and heat-source effects. |

### Thermal, Assembly, and Alignment

- Check actual temperature conditions and allowed drift for components near heat sources.
- Leave room for thermal copper, thermal vias, heat sinks, and actual airflow.
- Do not break apart a power or driver loop that must remain compact just to distribute heat sources.
- Check large components using their actual bodies and assembly space, not only pad bounding boxes.
- On double-sided and multilayer boards, check obstacles on every affected layer, through-hole leads, and mating structures.
- Check copper connections and heating differences at the two ends of small components for the actual soldering process.
- When electrical and mechanical conditions allow, components of the same type may share an orientation and spacing.
- Do not lengthen critical loops for neatness, or mark arbitrary angles and unequal spacing as errors by themselves.
- Make polarity and pin 1 markings easy to assemble and inspect.
- If mechanical, safety, electrical, and manufacturing requirements conflict, revise the design; do not exempt requirements using a fixed ranking.

### Repeated Channels and Copies

- Define inputs, outputs, controls, supporting components, and return relationships in the template first.
- For each instance, check pin numbers, polarity, nets, orientation, and local obstacles.
- Check shared power and shared returns separately.
- Channels may use different layouts when actual obstacles or operating conditions differ.
- After reusing a via layout, check nets, obstacles, current capacity, and thermal conditions for every channel.
- Passing the template does not replace checking every instance.

## Programming and Test Access

- During placement, leave room for programming fixtures, probes, and desoldering tools.
- Check whether pads remain accessible after assembly at the actual test stage.
- Avoid connectors, heat sinks, shields, and enclosures that block probe access.
- Set pad size, spacing, and contact surface for the probe or fixture being used.
- Expose solder mask in probe contact areas and check the actual manufacturing output.
- Bare probe pads normally do not need a solder-paste opening; set openings for wire soldering or other processes according to their purpose.
- Clearly mark required pin order, signal, and orientation in silkscreen without covering contact areas.
- Match the order and orientation of programming pads to the fixture, and consider reverse-connection protection.
- Provide a suitable reference-ground contact near measurement points.
- The reference ground must belong to the circuit under test; do not bridge separate isolation domains.
- First assess the effect of test pads and stubs on high-speed, RF, crystal, and sensitive analog nodes.
- Probe loading can change a signal, so consider the measurement method as well.
- Place 0 Ω resistors where they can be easily fitted or removed, leaving space to measure both ends.
- A connection that must be opened must not be bypassed by a copper plane or another branch.
- A 0 Ω resistor in a power path and the traces at both ends must meet actual current requirements.
- Check the actual pad net for every programming pad and test point.

## Plan Routing Paths

- Route critical loops and the hardest pin escapes first.
- Before final routing, test-route groups or inspect the actual geometry for uncertain constrained escapes and shared channels.
- Use actual pads, layers, trace widths, spacing, vias, and obstacles on all layers in the check.
- Non-overlapping components do not prove that the placement can be fully routed.
- A trial route applies only to the checked area; record predicted paths separately from completed routes.
- A shared channel must fit the related group of traces at the same time; do not route traces one by one through the same space as if it were reusable.
- Plan escapes at both ends, the main channel, branches, layer changes, and returns.
- Reserve escapes for unrouted pins, power, and ground as well.
- Do not change IC pin assignments or connector pin order just to make the layout look orderly.
- For a simple straight channel, estimate width from the sum of trace widths, spacing, and clearance on both sides.
- Calculate extra space for turns, branches, vias, and returns separately.
- Do not impose a universal rule to route horizontally on the top layer or vertically on the bottom layer.

## Power, Signals, and Sensing

- Check the current path segment by segment from the power source to the load and then to the return.
- Check components, connectors, pads, narrow copper, via groups, and copper planes.
- Check current, voltage drop, power loss, and temperature rise under operating conditions.
- Identify rapidly changing current loops for each switching state.
- Handle switch nodes, gates, and bootstrap loops according to the IC requirements.
- A large copper area does not replace checking the current loop.
- Check communication traces for the device, edge rate, load, protocol, and cable.
- Determine differential impedance and timing requirements from the actual interface and stackup.
- Measure actual paths from the source to each receiver.
- Total copper length for a net cannot replace endpoint path length or timing skew.
- For connectors with multiple pins on the same net, check every pin that must be connected.
- Check bidirectional buses for their actual drive states.
- Choose branch topology based on the interface and load.
- Ordinary control and PWM traces do not need serpentine length tuning when no equal-length requirement exists.
- Route positive and negative sense inputs from their actual sense points.
- Do not include a power-drop segment that must not be shared in the sense path.

## Record High-Current Paths by Segment

- Record connectors, wires or copper planes, component pads, layer-change via groups, and return paths in actual connection order.
- State continuous current, peak current, and the duration of each peak for every segment.
- Record the narrowest point, actual dimensions, and copper thickness for every segment.
- For via groups, also record drill diameter, via count, barrel plating thickness, and connection method.
- Distinguish drill size from finished-hole size.
- Mark missing parameters as pending confirmation; do not fill them with tool defaults.
- Record the basis for checking current capacity, voltage drop, and temperature rise for each segment, along with items still to verify.
- Outer-layer copper thickness cannot substitute for via-barrel plating thickness.
- Via count cannot substitute for checking current capacity and temperature rise of the via group.
- A large copper area and a clean DRC alone do not prove current capacity.
- Thermal-via requirements for specific components are maintained by `component-pcb-profiles`.

## Vias and Copper Pours

- Check signal vias, ground vias, current-carrying vias, and thermal vias separately.
- Preserve necessary return and thermal paths when reducing layer changes.
- Do not estimate parallel-via capacity by simply multiplying by via count.
- Via-in-pad requires support from the footprint and selected manufacturing process.
- Check the net, layer, boundary, clearance, and connection method of copper pours.
- Check priority, island handling, and manufacturing optimization settings.
- Thermal-pad connections must consider current, heat dissipation, and soldering.
- Rebuild copper pours after changing related geometry.
- Confirm that automatic rebuild settings are effective.
- Check that the generated copper is actually continuous.

## Rerouting and Comparison

- First state which components may move, which traces may change, and which connections must remain.
- For a single escape issue, start with a local adjustment.
- If a shared channel is the problem, inspect the related functional group together.
- If a route repeatedly goes around the same obstacle, first check whether placement is the cause.
- After deletion or shove routing, check segmentation, clipping, adjacent traces, and endpoints outside the area.
- Compare alternatives using the same endpoints, operating conditions, and scope.
- Record path, layer changes, returns, and neighboring-area costs for all affected interfaces.
- Failure to find a better route does not prove that the current layer change is necessary.
- A shorter route or fewer vias cannot offset electrical, mechanical, or manufacturing problems.

## Compare Before and After Changes

Follow [PCB workflow](commands-pcb.md) for modifications, deletions, and save/readback. Compare nets and geometric positions before and after; retain unexplained differences.
- After merging same-net traces, check endpoints, path, layer, and width.
- If copper-fill primitive IDs change, separately check the boundary, fill geometry, and connections.
- Report generated-ID changes separately from actual copper changes.

## Silkscreen and Interface Labels

- Check standalone text, component designators, and markings within footprints separately.
- Check text height, stroke width, and minimum spacing for the actual process.
- After enlarging text, recheck its spacing from pads, solder-mask openings, board edges, and nearby text.
- Check the orientation and pin order of bottom-side text in the actual bottom view.
- For inverse text, check the background area and that all characters are complete.
- If the tool cannot change component attributes, list the objects that remain unfinished.
- Passing dimension checks does not replace checking the actual board view.

## Completion Checks

- Check connectivity, designators, footprints, polarity, and all repeated channels.
- Check critical loops, sensing, and return paths.
- Check manufacturing spacing, holes, solder mask, silkscreen, and board edges.
- Check component bodies, height, insertion/removal, and assembly clearance.
- Check test access, pin order, openings, and tool access.
- Run a complete design rule check (DRC) before determining the final version.
- Real-time DRC and custom DRC must not be represented as a complete check.
- Clearing an error marker does not mean the issue was repaired.
- Before a height check, confirm that rules, models, and height attributes are valid.
- Inspect the actual objects behind estimated warnings; do not ignore all warnings or treat them all as errors.
- After changes, recheck affected areas and record the saved version and remaining issues.

## Run DFM After DRC

After a complete DRC passes, run PCB DFM and applicable SMT manufacturing/assembly checks for the process intended for this order.
Select the DFM command reference directly from the skill entry point and confirm the current version, parameters, and coverage limitations.

- Confirm the target PCB, saved version, material, board thickness, copper thickness, stackup, and assembly process.
- Compare the drawing, check inputs, and proposed order process; record differences and how they were handled.
- Check response completeness, individual results, and coverage; API success alone is insufficient.
- Use an appropriate method to check required items that the tool skips, does not support, or approximates, and retain the basis for the additional check.
- Do not substitute a tool-supported default process for an unsupported process to obtain a pass.
- After repairs, rerun the checks; retain complete DRC and applicable DFM results for the final submitted version.
- If a check requires manufacturer parsing, first export the check file and upload it under existing authorization.
- Do not submit the order until parsing passes.

Report the version, process inputs, individual results, basis for supplementary checks, and unresolved items for project-stage acceptance.
Passing within the tool's coverage does not mean all manufacturing requirements have passed.
