# Modules

Rocket Science parts are data-driven: every part schema carries a `config` object and a
`state` object keyed by module type. A stock battery, for example, uses:

```json
"config": {
  "Model.ElectricityModule": { "maxAmount": 2000000 }
},
"state": {
  "Model.ElectricityModule": { "amount": 2000000 }
}
```

PartAdder copies `modules` into `RocketPartSchema.config` and `state` into
`RocketPartSchema.state` without interpreting them, so every module the game knows
about can be used from `part.json`. A part may combine several modules at once, for
example a probe core with `Model.CommandModule`, `Model.ElectricityModule` and
`Model.AntennaModule`.

The examples below are generated from the 199 stock part schemas in `AllParts.txt`.
They show the exact shape of each module as the game serializes it; they are
reference data, not balance recommendations.

Modules that drive visuals or animations (`Model.PartStateModule`,
`Model.PhysicsStateModule`, `Model.PartStateSoundsModule`, ...) expect objects with
specific names inside the model. They only work when your mesh is exported with the
same object hierarchy the stock part uses.

## Supported modules

| Module key | Stock parts using it | Purpose |
| --- | --- | --- |
| `Model.AeroProtectionModule` | 18 | Heat shield / ablative protection for reentry. |
| `Model.AeroSurfaceModule` | 6 | Aerodynamic surface (wing, fin). |
| `Model.AntennaModule` | 16 | Antenna: frequencies, bandwidth, transmission power, direction. |
| `Model.CockpitModule` | 1 | Cockpit / crew cabin interior. |
| `Model.CommandModule` | 15 | Crewed command pod. |
| `Model.CommandModuleProxy` | 2 | Delegates command behaviour to another part. |
| `Model.ContinuousEffectModule` | 2 | Loops a particle or audio effect while active. |
| `Model.ControlSurfaceModule` | 6 | Control surface driven by an input axis. |
| `Model.CraftSpawnerModule` | 5 | Spawns a craft when activated (fairings, cargo). |
| `Model.CryocoolerModule` | 1 | Actively cools a connected tank. |
| `Model.DecouplerModule` | 14 | Separates the part from the stack with a given force. |
| `Model.DockingPortModule` | 2 | Docking port behaviour and alignment. |
| `Model.DragCubeModifer` | 26 | Adjusts how the drag cube is computed for this model. |
| `Model.ElectricityModule` | 17 | Stores electrical charge and reports it to the power grid. |
| `Model.EngineEffectsModule` | 15 | Plume and smoke effects for an engine. |
| `Model.EngineGenerator` | 10 | Turns engine output into electricity. |
| `Model.EngineGimbalModule` | 9 | Gimbal range and speed for an engine. |
| `Model.EngineModule` | 15 | Rocket engine: thrust, propellant mix, throttle range. |
| `Model.HeatShieldModule` | 3 | Heat shield material and ablation. |
| `Model.InstrumentModule` | 16 | Flight instrument readout. |
| `Model.JettisonModule` | 3 | Jettisons a child part on command. |
| `Model.JointProducerModule` | 3 | Creates a joint between two parts. |
| `Model.LandingStrutModule` | 2 | Extendable landing leg. |
| `Model.LightModule` | 3 | Lamp with colour temperature, range and power draw. |
| `Model.MirrorModule` | 6 | Mirror surface rendered by the game. |
| `Model.N2H4Module` | 5 | Hydrazine (N2H4) monopropellant tank. |
| `Model.O2Module` | 1 | Oxygen supply. |
| `Model.ParachuteModule` | 1 | Parachute deployment and drag. |
| `Model.ParachuteSpawnerModule` | 1 | Spawns parachute objects from the part. |
| `Model.PartStateModule` | 38 | Named part states, including animation objects. |
| `Model.PartStateSoundsModule` | 29 | Sounds played on part state changes. |
| `Model.PayloadFairingCapModule` | 3 | Fairing nose cap. |
| `Model.PayloadFairingModule` | 4 | Payload fairing shell. |
| `Model.PhysicsStateModule` | 15 | Physics behaviour per part state. |
| `Model.PilotChuteModule` | 1 | Drogue / pilot chute. |
| `Model.ProbeCoreModule` | 8 | Uncrewed probe core. |
| `Model.RCSBlockModule` | 2 | RCS block with fixed nozzle layout. |
| `Model.RCSModule` | 2 | Reaction control thrusters. |
| `Model.ReactionWheelModule` | 13 | Attitude control torque without propellant. |
| `Model.ResourceSeparatorModule` | 26 | Splits resources / detaches the listed connections. |
| `Model.RitegModule` | 3 | Riteg (solid) motor behaviour. |
| `Model.RotationalSuspensionModule` | 1 | Rotating suspension joint. |
| `Model.RotationTrackingModule` | 4 | Rotates the part to track a target. |
| `Model.RoverModule` | 2 | Rover body / seat logic. |
| `Model.SelfDestructionModule` | 1 | Self-destruct sequence. |
| `Model.SolarPanelModule` | 7 | Generates electricity from sunlight. |
| `Model.SplitedDecouplerModule` | 3 | Decoupler that splits into several pieces. |
| `Model.TurbopropModule` | 1 | Turboprop engine. |
| `Model.VerticalAlignerModule` | 4 | Keeps a part vertical (landing legs, boosters). |
| `Model.WheelModule` | 4 | Driven wheel. |
| `Model.WheelMultiModule` | 1 | Several wheels driven as one part. |

## Module reference

### Model.AeroProtectionModule

Heat shield / ablative protection for reentry.

Stock parts using it: 18.

`config`:

```json
{"notOccluded":"forward, down, up"}
```

`state`:

```json
{}
```

### Model.AeroSurfaceModule

Aerodynamic surface (wing, fin).

Stock parts using it: 6.

`config`:

```json
{"aeroSurface":{"liftSlope":6.28,"skinFriction":0.02,"zeroLiftAoA":0.0,"stallAngle":{"x":-18,"y":18},"chord":1.41,"flapFraction":0.361,"span":1.5},"centerOffset":{"x":-0.75,"y":-0.163,"z":0}}
```

`state`:

```json
{}
```

### Model.AntennaModule

Antenna: frequencies, bandwidth, transmission power, direction.

Stock parts using it: 16.

`config`:

```json
{"frequencies":[2400000000],"bandwidths":[1000000],"transmisionPower":[8],"efficiency":0.9,"type":"monopole","direction":{"x":1}}
```

`state`:

```json
{"flags":"isEnabled","bandwidthLimiter":0.5}
```

### Model.CockpitModule

Cockpit / crew cabin interior.

Stock parts using it: 1.

`config`:

```json
{}
```

`state`:

```json
{}
```

### Model.CommandModule

Crewed command pod.

Stock parts using it: 15.

`config`:

```json
{"headingPid":{"x":14.945,"y":0.02,"z":0.394},"angularVelocityPid":{"x":2.35,"y":0.001,"z":0.369}}
```

`state`:

```json
{"autoCorrection":"enabled","currThrustLimiter":1,"currRotation":{"value":{"x":0,"y":0,"z":0,"w":1}},"targetRotation":{"value":{"x":0,"y":0,"z":0,"w":1}}}
```

### Model.CommandModuleProxy

Delegates command behaviour to another part.

Stock parts using it: 2.

`config`:

```json
{}
```

`state`:

```json
{}
```

### Model.ContinuousEffectModule

Loops a particle or audio effect while active.

Stock parts using it: 2.

`config`:

```json
{"sound":"rcs_micro","vfx":"rcs_0"}
```

`state`:

```json
{}
```

### Model.ControlSurfaceModule

Control surface driven by an input axis.

Stock parts using it: 6.

`config`:

```json
{"controlSurface":"model/fin_0/eleron","surfaceTip":"model/fin_0/back_tip","responseTime":0.4}
```

`state`:

```json
{"control":{"x":0,"y":0,"z":0,"w":0},"maxAngle":0}
```

### Model.CraftSpawnerModule

Spawns a craft when activated (fairings, cargo).

Stock parts using it: 5.

`config`:

```json
{"parts":[{"id":1,"defindex":99010}],"connections":[]}
```

`state`:

```json
{}
```

### Model.CryocoolerModule

Actively cools a connected tank.

Stock parts using it: 1.

`config`:

```json
{"gas":"helium","coolantMass":10,"leakRatio":0.003,"massAtTargetRatio":0.6,"flowSpeed":1,"tubeRadius":0.05,"pressure":{"x":2000000,"y":10000},"consumption":65,"eceCoeff":0.9}
```

`state`:

```json
{"massRatio":1,"flowRatio":1,"temperature":{"x":600,"y":600},"flags":"isEnabled","targetPartId":0}
```

### Model.DecouplerModule

Separates the part from the stack with a given force.

Stock parts using it: 14.

`config`:

```json
{"force":28000}
```

`state`:

```json
{"decoupleMode":"undock","forcePercent":1}
```

### Model.DockingPortModule

Docking port behaviour and alignment.

Stock parts using it: 2.

`config`:

```json
{"force":50,"captureRange":0.45,"resourceTransferFlow":10}
```

`state`:

```json
{"resourceTransfer":{}}
```

### Model.DragCubeModifer

Adjusts how the drag cube is computed for this model.

Stock parts using it: 26.

`config`:

```json
{"3":{"x":0,"y":0.2,"z":0,"w":0}}
```

`state`:

```json
{}
```

### Model.ElectricityModule

Stores electrical charge and reports it to the power grid.

Stock parts using it: 17.

`config`:

```json
{"maxAmount":2000000}
```

`state`:

```json
{"amount":2000000}
```

### Model.EngineEffectsModule

Plume and smoke effects for an engine.

Stock parts using it: 15.

`config`:

```json
{"sound":"rocket_engine_heavy","flames":["engine_0_flame"]}
```

`state`:

```json
{}
```

### Model.EngineGenerator

Turns engine output into electricity.

Stock parts using it: 10.

`config`:

```json
{"charge":22000}
```

`state`:

```json
{}
```

### Model.EngineGimbalModule

Gimbal range and speed for an engine.

Stock parts using it: 9.

`config`:

```json
{"range":3,"combustionChambers":["model/engine_1/combustion_chamber"]}
```

`state`:

```json
{}
```

### Model.EngineModule

Rocket engine: thrust, propellant mix, throttle range.

Stock parts using it: 15.

`config`:

```json
{"chamberHeatTransfer":0.021,"burnTime":230,"maxThrustAsl":1669201,"maxThrustVac":1831485,"fuel":{"type":"udmh","amount":187},"oxidizer":{"type":"n2o4","amount":307.054},"throttleLimits":{"x":0.05,"y":1},"forcePoint":{"x":0,"y":-3.57,"z":0}}
```

`state`:

```json
{"thrustLimiter":1.0}
```

### Model.HeatShieldModule

Heat shield material and ablation.

Stock parts using it: 3.

`config`:

```json
{"shadowDir":"up, down","protectionDistance":15,"area":4.3355}
```

`state`:

```json
{"thickness":0.1}
```

### Model.InstrumentModule

Flight instrument readout.

Stock parts using it: 16.

`config`:

```json
{"instruments":[{"type":"navball","consumption":5,"eceCoef":0.95,"dataRate":128},{"type":"speedometer","consumption":5,"eceCoef":0.95,"dataRate":32},{"type":"altimeter","consumption":5,"eceCoef":0.95,"dataRate":32},{"type":"resources","consumption":1,"eceCoef":0.95,"dataRate":64},{"type":"common","consumption":1,"eceCoef":0.95,"dataRate":128}]}
```

`state`:

```json
{"enabledState":0}
```

### Model.JettisonModule

Jettisons a child part on command.

Stock parts using it: 3.

`config`:

```json
{"force":1500}
```

`state`:

```json
{}
```

### Model.JointProducerModule

Creates a joint between two parts.

Stock parts using it: 3.

`config`:

```json
{"originalAttachmentIds":[1,2,3,4],"spawnedAttachmentIds":[0],"visuals":{"radius":0.025,"length":29},"linearLimit":30,"projectionMode":"None"}
```

`state`:

```json
{}
```

### Model.LandingStrutModule

Extendable landing leg.

Stock parts using it: 2.

`config`:

```json
{}
```

`state`:

```json
{}
```

### Model.LightModule

Lamp with colour temperature, range and power draw.

Stock parts using it: 3.

`config`:

```json
{"consumption":40,"eceCoeff":0.4,"luminousEfficacy":85,"maxRange":30,"colorTemperature":4400,"lightBulb":"model/light/lamp_bulb/lamp_bulb_{0}"}
```

`state`:

```json
{"isEnabled":false}
```

### Model.MirrorModule

Mirror surface rendered by the game.

Stock parts using it: 6.

`config`:

```json
{"rootDir":{"x":0,"y":0,"z":1},"rootUp":{"x":0,"y":1,"z":0},"partDir":{"x":0,"y":0,"z":1},"mirrorScale":{"x":1,"y":1,"z":1}}
```

`state`:

```json
{}
```

### Model.N2H4Module

Hydrazine (N2H4) monopropellant tank.

Stock parts using it: 5.

`config`:

```json
{"maxAmount":100,"type":"n2h4"}
```

`state`:

```json
{"amount":100}
```

### Model.O2Module

Oxygen supply.

Stock parts using it: 1.

`config`:

```json
{"maxAmount":30}
```

`state`:

```json
{"amount":30}
```

### Model.ParachuteModule

Parachute deployment and drag.

Stock parts using it: 1.

`config`:

```json
{"dragStateModifiers":[{"3":{"x":0.261276425,"y":0.942068022,"z":0,"w":0}},{"0":{"x":50,"y":0,"z":0,"w":0},"1":{"x":50,"y":0,"z":0,"w":0},"3":{"x":133,"y":0.962068022,"z":0,"w":0},"4":{"x":50,"y":0,"z":0,"w":0},"5":{"x":50,"y":0,"z":0,"w":0}}],"deployedSound":"parachute_flapping"}
```

`state`:

```json
{}
```

### Model.ParachuteSpawnerModule

Spawns parachute objects from the part.

Stock parts using it: 1.

`config`:

```json
{"parachutePartId":2,"pilotChutePartId":2}
```

`state`:

```json
{"parachute":{"minPressure":0.5,"altitude":1000,"minPressureRange":{"x":0.01,"y":50},"altitudeRange":{"x":50,"y":5000}}}
```

### Model.PartStateModule

Named part states, including animation objects.

Stock parts using it: 38.

`config`:

```json
{"states":["coupled","decoupled"],"triggersData":[{"transition":{"x":0,"y":1},"trigger":"decouple"}]}
```

`state`:

```json
{}
```

### Model.PartStateSoundsModule

Sounds played on part state changes.

Stock parts using it: 29.

`config`:

```json
{"sounds":{"decouple":"air_explosion"},"range":{"x":3,"y":4}}
```

`state`:

```json
{}
```

### Model.PayloadFairingCapModule

Fairing nose cap.

Stock parts using it: 3.

`config`:

```json
{"direction":"back","forcePerUnitMass":30}
```

`state`:

```json
{}
```

### Model.PayloadFairingModule

Payload fairing shell.

Stock parts using it: 4.

`config`:

```json
{"forcePerUnitMass":2.5}
```

`state`:

```json
{}
```

### Model.PhysicsStateModule

Physics behaviour per part state.

Stock parts using it: 15.

`config`:

```json
{}
```

`state`:

```json
{}
```

### Model.PilotChuteModule

Drogue / pilot chute.

Stock parts using it: 1.

`config`:

```json
{"mainParachutePartId":2,"dragStateModifiers":[{"3":{"x":0.261276425,"y":0.942068022,"z":0,"w":0}},{"2":{"x":23,"y":0.0,"z":0,"w":-1.5},"3":{"x":26,"y":0.962068022,"z":0,"w":0}}],"deployedSound":"parachute_flapping"}
```

`state`:

```json
{}
```

### Model.ProbeCoreModule

Uncrewed probe core.

Stock parts using it: 8.

`config`:

```json
{"consumption":240}
```

`state`:

```json
{"state":100}
```

### Model.RCSBlockModule

RCS block with fixed nozzle layout.

Stock parts using it: 2.

`config`:

```json
{}
```

`state`:

```json
{}
```

### Model.RCSModule

Reaction control thrusters.

Stock parts using it: 2.

`config`:

```json
{"maxThrustAsl":100,"maxThrustVac":238,"monopropellant":{"type":"n2h4","amount":0.1}}
```

`state`:

```json
{"thrustLimiter":1.0,"isEnabled":true}
```

### Model.ReactionWheelModule

Attitude control torque without propellant.

Stock parts using it: 13.

`config`:

```json
{"maxTorque":2000,"consumption":2500,"eceCoeff":0.8}
```

`state`:

```json
{"isEnabled":true}
```

### Model.ResourceSeparatorModule

Splits resources / detaches the listed connections.

Stock parts using it: 26.

`config`:

```json
{"detachConnIds":[1]}
```

`state`:

```json
{"passResources":false}
```

### Model.RitegModule

Riteg (solid) motor behaviour.

Stock parts using it: 3.

`config`:

```json
{"charge":110,"thermoProduction":2000,"decline":4}
```

`state`:

```json
{}
```

### Model.RotationalSuspensionModule

Rotating suspension joint.

Stock parts using it: 1.

`config`:

```json
{"rotSign":[-1,1],"hordLength":0.3,"rotAxis":{"x":1,"y":0,"z":0}}
```

`state`:

```json
{}
```

### Model.RotationTrackingModule

Rotates the part to track a target.

Stock parts using it: 4.

`config`:

```json
{"type":"YX","rotatorPaths":["model/antenna/y_rotator","model/antenna/y_rotator/x_rotator"],"limits":{"x":0,"y":15},"rotationSpeed":{"x":20,"y":10},"consumption":5,"eceCoef":0.8}
```

`state`:

```json
{"flags":"isEnabled","filter":"relay","target":{}}
```

### Model.RoverModule

Rover body / seat logic.

Stock parts using it: 2.

`config`:

```json
{}
```

`state`:

```json
{}
```

### Model.SelfDestructionModule

Self-destruct sequence.

Stock parts using it: 1.

`config`:

```json
{"detonateRange":{"x":1,"y":10}}
```

`state`:

```json
{"delay":5}
```

### Model.SolarPanelModule

Generates electricity from sunlight.

Stock parts using it: 7.

`config`:

```json
{"energyConversion":0.123,"area":1.1,"panelDirections":[{"x":0,"y":1,"z":0},{"x":0,"y":1,"z":0}],"occlusionFactors":[1,1]}
```

`state`:

```json
{}
```

### Model.SplitedDecouplerModule

Decoupler that splits into several pieces.

Stock parts using it: 3.

`config`:

```json
{"force":400,"directions":["forward","back"],"reduceMass":0.5,"coupleSpawnedConnId":-1}
```

`state`:

```json
{}
```

### Model.TurbopropModule

Turboprop engine.

Stock parts using it: 1.

`config`:

```json
{"aeroSurfaces":[{"aeroSurface":{"liftSlope":6.78,"skinFriction":0.01,"zeroLiftAoA":0,"stallAngle":{"x":-15,"y":15},"chord":0.15,"flapFraction":0.0,"span":0.95},"centerOffset":{"x":-0.63,"y":0.23,"z":0},"refRotation":{"x":47,"y":-180,"z":0}},{"aeroSurface":{"liftSlope":6.78,"skinFriction":0.01,"zeroLiftAoA":0,"stallAngle":{"x":-15,"y":15},"chord":0.15,"flapFraction":0.0,"span":0.95},"centerOffset":{"x":0.63,"y":0.23,"z":0},"refRotation":{"x":47,"y":0,"z":0}}],"rotatorPath":"model/turboprop_0/motor","maxRpm":2700,"timeToFullSpeed":4}
```

`state`:

```json
{}
```

### Model.VerticalAlignerModule

Keeps a part vertical (landing legs, boosters).

Stock parts using it: 4.

`config`:

```json
{"rotatorPath":"model/landing_gear_1/rotator","rotatorMaxAngle":60,"mirrorRange":{"x":-60,"y":0},"axis":{"x":0,"y":0,"z":1}}
```

`state`:

```json
{}
```

### Model.WheelModule

Driven wheel.

Stock parts using it: 4.

`config`:

```json
{"name":"РЁР°СЃСЃРё","wheel":{"mass":10,"radius":0.185,"suspensionLength":0.14,"dampingRatio":0.95,"targetPosition":0.4,"suspensionSpringExp":0.25,"suspensionForceOffset":0.15,"rollingResistanceCoef":0.01,"rotationalResistanceCoef":0.005,"forwardFrictionCoef":1,"sideFrictionCoef":1},"wheelDynamic":{"maxSteeringAngle":20,"steeringResponseTime":0.25},"wheelPosition":{"x":0,"y":-0.2346828,"z":0},"suspensionPosition":{"x":0,"y":-0.2004887,"z":0.06164241},"modelPath":"model/landing_gear_0/steer/suspension/wheel","suspensionPath":"model/landing_gear_0/steer/suspension","steeringPath":"model/landing_gear_0/steer"}
```

`state`:

```json
{"steeringSign":1,"steeringAngle":20}
```

### Model.WheelMultiModule

Several wheels driven as one part.

Stock parts using it: 1.

`config`:

```json
{"name":"РљРѕР»РµСЃР°","wheels":[{"mass":10,"radius":0.266,"suspensionLength":0.145,"dampingRatio":0.85,"targetPosition":0.4,"suspensionSpringExp":0.25,"suspensionForceOffset":0.15,"rollingResistanceCoef":0.05,"rotationalResistanceCoef":0.01,"forwardFrictionCoef":1,"sideFrictionCoef":1},{"mass":10,"radius":0.266,"suspensionLength":0.145,"dampingRatio":0.8,"targetPosition":0.4,"suspensionSpringExp":0.25,"suspensionForceOffset":0.15,"rollingResistanceCoef":0.05,"rotationalResistanceCoef":0.01,"forwardFrictionCoef":1,"sideFrictionCoef":1}],"wheelDynamic":{"maxMotorTorque":35,"maxBrakeTorque":100,"maxSteeringAngle":10,"ece":0.85,"motorResponseTime":1,"steeringResponseTime":0.5},"wheelPosition":[{"x":-0.21,"y":0.06506093,"z":-0.284931},{"x":-0.21,"y":0.06506093,"z":0.284931}],"suspensionPosition":[{"x":-0.1315017,"y":-0.2491009,"z":-0.03},{"x":-0.1315017,"y":-0.2491009,"z":0.03}],"modelPath":["model/wheel_0/steer/back/wheel","model/wheel_0/steer/forward/wheel"],"suspensionPath":["model/wheel_0/steer/back","model/wheel_0/steer/forward"],"steeringPath":"model/wheel_0/steer"}
```

`state`:

```json
{"steeringSign":1,"steeringAngle":10}
```

