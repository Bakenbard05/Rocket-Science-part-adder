// Component registry: the game modules a part can carry, with typed fields.
//
// Every entry mirrors one module of the stock parts ("Model.XModule" in
// docs/MODULES.md). `config` fields are written to part.json "modules", `state`
// fields to "state". Labels are bilingual (en/ru) because they are data, not UI
// chrome; the interface strings live in i18n.js.
//
// Field types:
//   number, text, bool, enum, vector2, vector3, vector4, quat, rotation,
//   numbers (list of numbers), strings (list of strings), json, object (nested)

export const COMPONENT_GROUPS = [
  { id: 'propulsion', label: { en: 'Propulsion', ru: 'Тяга' } },
  { id: 'energy', label: { en: 'Energy', ru: 'Энергия' } },
  { id: 'control', label: { en: 'Control', ru: 'Управление' } },
  { id: 'structure', label: { en: 'Structure', ru: 'Конструкция' } },
  { id: 'misc', label: { en: 'Misc', ru: 'Прочее' } },
];

// The engine sounds and the flame prefabs of the game. The flames are prefabs
// of the game that are placed at the force point of the engine, not objects of
// the mesh.
export const ENGINE_SOUNDS = [
  'rocket_engine_heavy',
  'rocket_engine_medium',
  'rocket_engine_weale_gasburner',
  'rocket_booster_light',
  'rocket_booster_medium',
  'rocket_booster_huge',
  'propeller_engine_loop_00',
  'propeller_engine_loop_00_start',
  'propeller_engine_loop_00_stop',
  'thruster_flickering_flame_mono',
  'thruster_deep_burning_air_muffled_flickering_flames_mono',
  'spacecraft_03_strong_burn_mono',
  'spacecraft_04_smooth_burn_mono',
  'spacecraft_05_powerful_burn_mono',
];

// The vfx of the RCS thrusters: the two VisualEffect assets the stock parts
// name in Model.ContinuousEffectModule (ModuleContinuousVFX looks them up in
// the vfx cache of the game).
export const RCS_VFX = ['rcs_0', 'rcs_1'];

export const ENGINE_FLAMES = [
  'engine_0_flame',
  'engine_1_flame',
  'engine_2_flame_forward',
  'engine_2_flame_backward',
  'engine_3_flame',
  'engine_4_flame',
  'engine_5_flame',
  'engine_6_flame',
  'engine_7_flame',
  'engine_8_flame',
  'engine_9_flame',
  'engine_10_flame',
  'engine_11_flame',
  'engine_12_flame',
  'engine_skycrane_flame',
];

export const COMPONENTS = [
  // ---------------------------------------------------------------- propulsion
  {
    key: 'Model.EngineModule',
    group: 'propulsion',
    label: { en: 'Engine', ru: 'Двигатель' },
    config: [
      { path: 'maxThrustAsl', label: { en: 'Max thrust (ASL), N', ru: 'Макс. тяга (ASL), Н' }, type: 'number', default: 1669201 },
      { path: 'maxThrustVac', label: { en: 'Max thrust (vacuum), N', ru: 'Макс. тяга (вакуум), Н' }, type: 'number', default: 1831485 },
      { path: 'burnTime', label: { en: 'Burn time, s', ru: 'Время работы, с' }, type: 'number', default: 230 },
      {
        path: 'chamberHeatTransfer',
        label: { en: 'Chamber heat transfer', ru: 'Передача тепла в камере' },
        type: 'number',
        step: 0.001,
        default: 0.021,
      },
      {
        path: 'fuel',
        label: { en: 'Fuel', ru: 'Топливо' },
        type: 'object',
        fields: [
          { path: 'type', label: { en: 'Type', ru: 'Тип' }, type: 'text', default: 'udmh' },
          { path: 'amount', label: { en: 'Amount', ru: 'Количество' }, type: 'number', default: 187 },
        ],
      },
      {
        path: 'oxidizer',
        label: { en: 'Oxidizer', ru: 'Окислитель' },
        type: 'object',
        fields: [
          { path: 'type', label: { en: 'Type', ru: 'Тип' }, type: 'text', default: 'n2o4' },
          { path: 'amount', label: { en: 'Amount', ru: 'Количество' }, type: 'number', default: 307.054 },
        ],
      },
      {
        path: 'throttleLimits',
        label: { en: 'Throttle limits (min, max)', ru: 'Диапазон тяги (мин, макс)' },
        type: 'vector3',
        default: { x: 0.05, y: 1, z: 0 },
      },
      {
        path: 'forcePoint',
        label: { en: 'Force point', ru: 'Точка приложения тяги' },
        type: 'vector3',
        default: { x: 0, y: -0.5, z: 0 },
        hint: { en: 'Keep it at the nozzle end.', ru: 'Держите её на конце сопла.' },
      },
    ],
    state: [
      { path: 'thrustLimiter', label: { en: 'Throttle', ru: 'Тяга (0..1)' }, type: 'number', default: 1 },
    ],
  },
  {
    key: 'Model.EngineGenerator',
    group: 'propulsion',
    label: { en: 'Generator', ru: 'Генератор' },
    config: [
      { path: 'charge', label: { en: 'Charge per second', ru: 'Заряд в секунду' }, type: 'number', default: 22000 },
    ],
    state: [],
  },
  {
    key: 'Model.EngineEffectsModule',
    group: 'propulsion',
    label: { en: 'Engine effects', ru: 'Эффекты двигателя' },
    config: [
      {
        path: 'sound',
        label: { en: 'Sound', ru: 'Звук' },
        type: 'enum',
        options: ENGINE_SOUNDS,
        default: 'rocket_engine_heavy',
      },
      {
        path: 'startSound',
        label: { en: 'Start sound', ru: 'Звук запуска' },
        type: 'enum',
        options: ['', ...ENGINE_SOUNDS],
        default: '',
      },
      {
        path: 'endSound',
        label: { en: 'Stop sound', ru: 'Звук остановки' },
        type: 'enum',
        options: ['', ...ENGINE_SOUNDS],
        default: '',
      },
      {
        path: 'flames',
        label: { en: 'Flame prefabs', ru: 'Префабы пламени' },
        type: 'strings',
        default: ['engine_0_flame'],
        hint: { en: 'Flame prefabs of the game, placed at the force point of the engine.', ru: 'Префабы пламени игры, они ставятся в точку тяги двигателя.' },
      },
    ],
    state: [],
  },
  {
    key: 'Model.EngineGimbalModule',
    group: 'propulsion',
    label: { en: 'Engine gimbal', ru: 'Качание двигателя' },
    config: [
      { path: 'range', label: { en: 'Range, degrees', ru: 'Диапазон, градусы' }, type: 'number', default: 3 },
      {
        path: 'combustionChambers',
        label: { en: 'Nozzles (nodes that turn)', ru: 'Сопла (узлы, которые качаются)' },
        type: 'nodes',
        default: [],
        hint: {
          en: 'The node has to be a separate object of the mesh with its origin at the hinge, otherwise the nozzle swings around the wrong point',
          ru: 'Узел должен быть отдельным объектом меша, а его начало — на оси качания, иначе сопло будет ходить вокруг не той точки',
        },
      },
    ],
    state: [],
  },
  {
    key: 'Model.TurbopropModule',
    group: 'propulsion',
    label: { en: 'Turboprop', ru: 'Турбовинт' },
    config: [
      { path: 'maxRpm', label: { en: 'Max RPM', ru: 'Макс. об/мин' }, type: 'number', default: 2700 },
      { path: 'timeToFullSpeed', label: { en: 'Spin-up time, s', ru: 'Время раскрутки, с' }, type: 'number', default: 4 },
      { path: 'rotatorPath', label: { en: 'Rotor path', ru: 'Путь ротора' }, type: 'text', default: 'model/turboprop_0/motor' },
      { path: 'aeroSurfaces', label: { en: 'Aero surfaces', ru: 'Аэродинамические поверхности' }, type: 'json', default: [] },
    ],
    state: [],
  },

  // -------------------------------------------------------------------- energy
  {
    key: 'Model.ElectricityModule',
    group: 'energy',
    label: { en: 'Battery', ru: 'Батарея' },
    config: [
      { path: 'maxAmount', label: { en: 'Capacity, J', ru: 'Ёмкость, Дж' }, type: 'number', default: 2000000 },
    ],
    state: [
      { path: 'amount', label: { en: 'Charge, J', ru: 'Заряд, Дж' }, type: 'number', default: 2000000 },
    ],
  },
  {
    key: 'Model.SolarPanelModule',
    group: 'energy',
    label: { en: 'Solar panel', ru: 'Солнечная панель' },
    config: [
      { path: 'energyConversion', label: { en: 'Efficiency', ru: 'КПД' }, type: 'number', step: 0.001, default: 0.123 },
      { path: 'area', label: { en: 'Area, m2', ru: 'Площадь, м2' }, type: 'number', step: 0.01, default: 1.1 },
      {
        path: 'panelDirections',
        label: { en: 'Panel directions', ru: 'Направления панелей' },
        type: 'json',
        default: [{ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 0 }],
        hint: { en: 'Local +Y of every panel surface.', ru: 'Локальная +Y каждой поверхности панели.' },
      },
      { path: 'occlusionFactors', label: { en: 'Occlusion factors', ru: 'Коэффициенты затенения' }, type: 'numbers', default: [1, 1] },
    ],
    state: [],
  },
  {
    key: 'Model.RitegModule',
    group: 'energy',
    label: { en: 'RTG', ru: 'РТИ' },
    config: [
      { path: 'charge', label: { en: 'Charge per second', ru: 'Заряд в секунду' }, type: 'number', default: 110 },
      { path: 'thermoProduction', label: { en: 'Heat output', ru: 'Тепловыделение' }, type: 'number', default: 2000 },
      { path: 'decline', label: { en: 'Decline', ru: 'Затухание' }, type: 'number', step: 0.001, default: 4 },
    ],
    state: [],
  },
  {
    key: 'Model.CryocoolerModule',
    group: 'energy',
    label: { en: 'Cryocooler', ru: 'Криоохладитель' },
    config: [
      {
        path: 'gas',
        label: { en: 'Gas', ru: 'Газ' },
        type: 'enum',
        options: ['helium', 'nitrogen'],
        default: 'helium',
      },
      { path: 'coolantMass', label: { en: 'Coolant mass', ru: 'Масса хладагента' }, type: 'number', default: 10 },
      { path: 'leakRatio', label: { en: 'Leak ratio', ru: 'Утечка' }, type: 'number', step: 0.001, default: 0.003 },
      { path: 'massAtTargetRatio', label: { en: 'Mass at target', ru: 'Масса у цели' }, type: 'number', step: 0.01, default: 0.6 },
      { path: 'flowSpeed', label: { en: 'Flow speed', ru: 'Скорость потока' }, type: 'number', default: 1 },
      { path: 'tubeRadius', label: { en: 'Tube radius', ru: 'Радиус трубки' }, type: 'number', step: 0.001, default: 0.05 },
      { path: 'pressure', label: { en: 'Pressure (min, max)', ru: 'Давление (мин, макс)' }, type: 'vector2', default: { x: 2000000, y: 10000 } },
      { path: 'consumption', label: { en: 'Power consumption', ru: 'Потребление энергии' }, type: 'number', default: 65 },
      { path: 'eceCoeff', label: { en: 'ECE coefficient', ru: 'Коэффициент ECE' }, type: 'number', step: 0.01, default: 0.9 },
    ],
    state: [
      { path: 'massRatio', label: { en: 'Mass ratio', ru: 'Отношение массы' }, type: 'number', default: 1 },
      { path: 'flowRatio', label: { en: 'Flow ratio', ru: 'Отношение потока' }, type: 'number', default: 1 },
      { path: 'temperature', label: { en: 'Temperature (min, max)', ru: 'Температура (мин, макс)' }, type: 'vector2', default: { x: 600, y: 600 } },
      { path: 'flags', label: { en: 'Flags', ru: 'Флаги' }, type: 'text', default: 'isEnabled' },
      { path: 'targetPartId', label: { en: 'Target part id', ru: 'Id цели' }, type: 'number', default: 0 },
    ],
  },

  // ------------------------------------------------------------------- control
  {
    key: 'Model.CommandModule',
    group: 'control',
    label: { en: 'Command pod', ru: 'Командный модуль' },
    config: [
      { path: 'headingPid', label: { en: 'Heading PID', ru: 'ПИД по курсу' }, type: 'vector3', default: { x: 14.945, y: 0.02, z: 0.394 } },
      {
        path: 'angularVelocityPid',
        label: { en: 'Angular velocity PID', ru: 'ПИД по угловой скорости' },
        type: 'vector3',
        default: { x: 2.35, y: 0.001, z: 0.369 },
      },
    ],
    state: [
      {
        path: 'autoCorrection',
        label: { en: 'Auto correction', ru: 'Автокоррекция' },
        type: 'enum',
        options: ['enabled', 'disabled'],
        default: 'enabled',
      },
      { path: 'currThrustLimiter', label: { en: 'Throttle', ru: 'Тяга (0..1)' }, type: 'number', default: 1 },
      { path: 'currRotation', label: { en: 'Current rotation', ru: 'Текущее вращение' }, type: 'rotation', default: { x: 0, y: 0, z: 0, w: 1 } },
      { path: 'targetRotation', label: { en: 'Target rotation', ru: 'Целевое вращение' }, type: 'rotation', default: { x: 0, y: 0, z: 0, w: 1 } },
    ],
  },
  {
    key: 'Model.CockpitModule',
    group: 'control',
    label: { en: 'Cockpit', ru: 'Кабина' },
    config: [],
    state: [],
  },
  {
    key: 'Model.CommandModuleProxy',
    group: 'control',
    label: { en: 'Command proxy', ru: 'Прокси командного модуля' },
    config: [],
    state: [],
  },
  {
    key: 'Model.RCSModule',
    group: 'control',
    label: { en: 'RCS thrusters', ru: 'Реактивные двигатели' },
    config: [
      { path: 'maxThrustAsl', label: { en: 'Max thrust (ASL), N', ru: 'Макс. тяга (ASL), Н' }, type: 'number', default: 100 },
      { path: 'maxThrustVac', label: { en: 'Max thrust (vacuum), N', ru: 'Макс. тяга (вакуум), Н' }, type: 'number', default: 238 },
      {
        path: 'monopropellant',
        label: { en: 'Monopropellant', ru: 'Монопропеллент' },
        type: 'object',
        fields: [
          { path: 'type', label: { en: 'Type', ru: 'Тип' }, type: 'text', default: 'n2h4' },
          { path: 'amount', label: { en: 'Amount', ru: 'Количество' }, type: 'number', default: 0.1 },
        ],
      },
    ],
    state: [
      { path: 'thrustLimiter', label: { en: 'Throttle', ru: 'Тяга (0..1)' }, type: 'number', default: 1 },
      { path: 'isEnabled', label: { en: 'Enabled', ru: 'Включено' }, type: 'bool', default: true },
    ],
  },
  {
    key: 'Model.RCSBlockModule',
    group: 'control',
    label: { en: 'RCS block', ru: 'Блок РСУ' },
    config: [],
    state: [],
  },
  {
    key: 'Model.ReactionWheelModule',
    group: 'control',
    label: { en: 'Reaction wheel', ru: 'Маховик' },
    config: [
      { path: 'maxTorque', label: { en: 'Max torque', ru: 'Макс. момент' }, type: 'number', default: 2000 },
      { path: 'consumption', label: { en: 'Power consumption', ru: 'Потребление энергии' }, type: 'number', default: 2500 },
      { path: 'eceCoeff', label: { en: 'ECE coefficient', ru: 'Коэффициент ECE' }, type: 'number', step: 0.01, default: 0.8 },
    ],
    state: [{ path: 'isEnabled', label: { en: 'Enabled', ru: 'Включено' }, type: 'bool', default: true }],
  },
  {
    key: 'Model.ControlSurfaceModule',
    group: 'control',
    label: { en: 'Control surface', ru: 'Руль управления' },
    config: [
      { path: 'controlSurface', label: { en: 'Surface path', ru: 'Путь поверхности' }, type: 'text', default: 'model/fin_0/eleron' },
      { path: 'surfaceTip', label: { en: 'Tip path', ru: 'Путь окончания' }, type: 'text', default: 'model/fin_0/back_tip' },
      { path: 'responseTime', label: { en: 'Response time, s', ru: 'Время отклика, с' }, type: 'number', step: 0.01, default: 0.4 },
    ],
    state: [
      { path: 'control', label: { en: 'Control rotation', ru: 'Вращение управления' }, type: 'quat', default: { x: 0, y: 0, z: 0, w: 0 } },
      { path: 'maxAngle', label: { en: 'Max angle', ru: 'Макс. угол' }, type: 'number', default: 0 },
    ],
  },
  {
    key: 'Model.AeroSurfaceModule',
    group: 'control',
    label: { en: 'Aero surface', ru: 'Аэродинамическая поверхность' },
    config: [
      {
        path: 'aeroSurface',
        label: { en: 'Surface', ru: 'Поверхность' },
        type: 'object',
        fields: [
          { path: 'liftSlope', label: { en: 'Lift slope', ru: 'Наклон подъёмной силы' }, type: 'number', step: 0.01, default: 6.28 },
          { path: 'skinFriction', label: { en: 'Skin friction', ru: 'Трение обшивки' }, type: 'number', step: 0.001, default: 0.02 },
          { path: 'zeroLiftAoA', label: { en: 'Zero lift AoA', ru: 'Угол нулевой подъёмной силы' }, type: 'number', step: 0.01, default: 0 },
          { path: 'stallAngle', label: { en: 'Stall angle (min, max)', ru: 'Угол срыва (мин, макс)' }, type: 'vector2', default: { x: -18, y: 18 } },
          { path: 'chord', label: { en: 'Chord', ru: 'Хорда' }, type: 'number', step: 0.01, default: 1.41 },
          { path: 'flapFraction', label: { en: 'Flap fraction', ru: 'Доля закрылка' }, type: 'number', step: 0.01, default: 0.361 },
          { path: 'span', label: { en: 'Span', ru: 'Размах' }, type: 'number', step: 0.01, default: 1.5 },
        ],
      },
      { path: 'centerOffset', label: { en: 'Center offset', ru: 'Смещение центра' }, type: 'vector3', default: { x: -0.75, y: -0.163, z: 0 } },
    ],
    state: [],
  },
  {
    key: 'Model.RotationTrackingModule',
    group: 'control',
    label: { en: 'Rotation tracking', ru: 'Слежение за вращением' },
    config: [
      {
        path: 'type',
        label: { en: 'Order', ru: 'Порядок осей' },
        type: 'enum',
        options: ['YX', 'XY', 'ZX', 'XZ'],
        default: 'YX',
      },
      { path: 'rotatorPaths', label: { en: 'Rotator paths', ru: 'Пути вращателей' }, type: 'strings', default: ['model/antenna/y_rotator'] },
      { path: 'limits', label: { en: 'Limits (min, max)', ru: 'Пределы (мин, макс)' }, type: 'vector2', default: { x: 0, y: 15 } },
      { path: 'rotationSpeed', label: { en: 'Rotation speed', ru: 'Скорость вращения' }, type: 'vector2', default: { x: 20, y: 10 } },
      { path: 'consumption', label: { en: 'Power consumption', ru: 'Потребление энергии' }, type: 'number', default: 5 },
      { path: 'eceCoeff', label: { en: 'ECE coefficient', ru: 'Коэффициент ECE' }, type: 'number', step: 0.01, default: 0.8 },
    ],
    state: [
      { path: 'flags', label: { en: 'Flags', ru: 'Флаги' }, type: 'text', default: 'isEnabled' },
      { path: 'filter', label: { en: 'Filter', ru: 'Фильтр' }, type: 'text', default: 'relay' },
      { path: 'target', label: { en: 'Target', ru: 'Цель' }, type: 'json', default: {} },
    ],
  },
  {
    key: 'Model.VerticalAlignerModule',
    group: 'control',
    label: { en: 'Vertical aligner', ru: 'Вертикальный стабилизатор' },
    config: [
      { path: 'rotatorPath', label: { en: 'Rotator path', ru: 'Путь вращателя' }, type: 'text', default: 'model/landing_gear_1/rotator' },
      { path: 'rotatorMaxAngle', label: { en: 'Max angle', ru: 'Макс. угол' }, type: 'number', default: 60 },
      { path: 'mirrorRange', label: { en: 'Mirror range (min, max)', ru: 'Диапазон зеркала (мин, макс)' }, type: 'vector2', default: { x: -60, y: 0 } },
      { path: 'axis', label: { en: 'Axis', ru: 'Ось' }, type: 'vector3', default: { x: 0, y: 0, z: 1 } },
    ],
    state: [],
  },
  {
    key: 'Model.RotationalSuspensionModule',
    group: 'control',
    label: { en: 'Rotational suspension', ru: 'Вращающаяся подвеска' },
    config: [
      { path: 'rotSign', label: { en: 'Rotation sign', ru: 'Знак вращения' }, type: 'numbers', default: [-1, 1] },
      { path: 'hordLength', label: { en: 'Horn length', ru: 'Длина рога' }, type: 'number', step: 0.01, default: 0.3 },
      { path: 'rotAxis', label: { en: 'Rotation axis', ru: 'Ось вращения' }, type: 'vector3', default: { x: 1, y: 0, z: 0 } },
    ],
    state: [],
  },
  {
    key: 'Model.PartStateModule',
    group: 'control',
    label: { en: 'Part states', ru: 'Состояния детали' },
    config: [
      {
        path: 'states',
        label: { en: 'States', ru: 'Состояния' },
        type: 'strings',
        default: ['folded', 'deployed'],
        hint: { en: 'The names of the states. The first one is the state the part starts in.', ru: 'Имена состояний. Первое — состояние, в котором деталь начинает полёт.' },
      },
      {
        path: 'triggersData',
        label: { en: 'Transitions', ru: 'Переходы' },
        type: 'transitions',
        default: [{ transition: { x: 0, y: 1 }, trigger: 'deploy' }],
        hint: { en: 'Every state change needs a trigger, otherwise the game refuses the change.', ru: 'Каждый переход состояния должен иметь триггер, иначе игра не даст сменить состояние.' },
      },
    ],
    state: [
      { path: 'state', label: { en: 'Current state', ru: 'Текущее состояние' }, type: 'number', default: 0 },
    ],
  },
  {
    key: 'Model.PhysicsStateModule',
    group: 'control',
    label: { en: 'Physics states', ru: 'Физические состояния' },
    config: [],
    state: [],
  },

  // ----------------------------------------------------------------- structure
  {
    key: 'Model.DecouplerModule',
    group: 'structure',
    label: { en: 'Decoupler', ru: 'Декаплер' },
    config: [{ path: 'force', label: { en: 'Separation force, N', ru: 'Сила отделения, Н' }, type: 'number', default: 28000 }],
    state: [
      {
        path: 'decoupleMode',
        label: { en: 'Mode', ru: 'Режим' },
        type: 'enum',
        options: ['undock', 'jettison'],
        default: 'undock',
      },
      { path: 'forcePercent', label: { en: 'Force percent', ru: 'Процент силы' }, type: 'number', default: 1 },
    ],
  },
  {
    key: 'Model.SplitedDecouplerModule',
    group: 'structure',
    label: { en: 'Stage decoupler', ru: 'Декаплер ступени' },
    config: [
      { path: 'force', label: { en: 'Separation force, N', ru: 'Сила отделения, Н' }, type: 'number', default: 400 },
      { path: 'directions', label: { en: 'Directions', ru: 'Направления' }, type: 'strings', default: ['forward', 'back'] },
      { path: 'reduceMass', label: { en: 'Mass reduction', ru: 'Снижение массы' }, type: 'number', step: 0.01, default: 0.5 },
      { path: 'coupleSpawnedConnId', label: { en: 'Spawned connection id', ru: 'Id создаваемого соединения' }, type: 'number', default: -1 },
    ],
    state: [],
  },
  {
    key: 'Model.JettisonModule',
    group: 'structure',
    label: { en: 'Jettison', ru: 'Сброс груза' },
    config: [{ path: 'force', label: { en: 'Force, N', ru: 'Сила, Н' }, type: 'number', default: 1500 }],
    state: [],
  },
  {
    key: 'Model.PayloadFairingModule',
    group: 'structure',
    label: { en: 'Payload fairing', ru: 'Обтекатель' },
    config: [{ path: 'forcePerUnitMass', label: { en: 'Force per unit mass', ru: 'Сила на единицу массы' }, type: 'number', step: 0.1, default: 2.5 }],
    state: [],
  },
  {
    key: 'Model.PayloadFairingCapModule',
    group: 'structure',
    label: { en: 'Fairing cap', ru: 'Головка обтекателя' },
    config: [
      { path: 'direction', label: { en: 'Direction', ru: 'Направление' }, type: 'text', default: 'back' },
      { path: 'forcePerUnitMass', label: { en: 'Force per unit mass', ru: 'Сила на единицу массы' }, type: 'number', step: 0.1, default: 30 },
    ],
    state: [],
  },
  {
    key: 'Model.ResourceSeparatorModule',
    group: 'structure',
    label: { en: 'Resource separator', ru: 'Разделитель ресурсов' },
    config: [{
      path: 'detachConnIds',
      label: { en: 'Detached connections', ru: 'Отсоединяемые соединения' },
      type: 'numbers',
      default: [],
      hint: {
        en: 'Ids of the attachments of this part that break off (0, 1…) — the game throws when an id is not a connection of the part',
        ru: 'Id креплений этой детали, которые отсоединяются (0, 1…) — игра падает, если такого крепления у детали нет',
      },
    }],
    state: [{ path: 'passResources', label: { en: 'Pass resources', ru: 'Передавать ресурсы' }, type: 'bool', default: false }],
  },
  {
    key: 'Model.LandingStrutModule',
    group: 'structure',
    label: { en: 'Landing strut', ru: 'Посадочная опора' },
    config: [],
    state: [],
  },
  {
    key: 'Model.WheelModule',
    group: 'structure',
    label: { en: 'Wheel', ru: 'Колесо' },
    config: [
      { path: 'name', label: { en: 'Name', ru: 'Имя' }, type: 'text', default: 'Wheel' },
      {
        path: 'wheel',
        label: { en: 'Wheel', ru: 'Колесо' },
        type: 'object',
        fields: [
          { path: 'mass', label: { en: 'Mass, kg', ru: 'Масса, кг' }, type: 'number', step: 0.1, default: 10 },
          { path: 'radius', label: { en: 'Radius, m', ru: 'Радиус, м' }, type: 'number', step: 0.001, default: 0.185 },
          { path: 'suspensionLength', label: { en: 'Suspension length', ru: 'Длина подвески' }, type: 'number', step: 0.001, default: 0.14 },
          { path: 'dampingRatio', label: { en: 'Damping ratio', ru: 'Демпфирование' }, type: 'number', step: 0.01, default: 0.95 },
          { path: 'targetPosition', label: { en: 'Target position', ru: 'Целевое положение' }, type: 'number', step: 0.01, default: 0.4 },
        ],
      },
      {
        path: 'wheelDynamic',
        label: { en: 'Steering', ru: 'Руление' },
        type: 'object',
        fields: [
          { path: 'maxSteeringAngle', label: { en: 'Max steering angle', ru: 'Макс. угол руления' }, type: 'number', default: 20 },
          { path: 'steeringResponseTime', label: { en: 'Response time', ru: 'Время отклика' }, type: 'number', step: 0.01, default: 0.25 },
        ],
      },
      { path: 'wheelPosition', label: { en: 'Wheel position', ru: 'Положение колеса' }, type: 'vector3', default: { x: 0, y: -0.2346828, z: 0 } },
      { path: 'suspensionPosition', label: { en: 'Suspension position', ru: 'Положение подвески' }, type: 'vector3', default: { x: 0, y: -0.2004887, z: 0.06164241 } },
      { path: 'modelPath', label: { en: 'Model path', ru: 'Путь модели' }, type: 'text', default: 'model/landing_gear_0/steer/suspension/wheel' },
      { path: 'suspensionPath', label: { en: 'Suspension path', ru: 'Путь подвески' }, type: 'text', default: 'model/landing_gear_0/steer/suspension' },
      { path: 'steeringPath', label: { en: 'Steering path', ru: 'Путь руления' }, type: 'text', default: 'model/landing_gear_0/steer' },
    ],
    state: [
      { path: 'steeringSign', label: { en: 'Steering sign', ru: 'Знак руления' }, type: 'number', default: 1 },
      { path: 'steeringAngle', label: { en: 'Steering angle', ru: 'Угол руления' }, type: 'number', default: 20 },
    ],
  },
  {
    key: 'Model.HeatShieldModule',
    group: 'structure',
    label: { en: 'Heat shield', ru: 'Теплозащита' },
    config: [
      { path: 'shadowDir', label: { en: 'Shadow directions', ru: 'Направления тени' }, type: 'text', default: 'up, down' },
      { path: 'protectionDistance', label: { en: 'Protection distance', ru: 'Дальность защиты' }, type: 'number', default: 15 },
      { path: 'area', label: { en: 'Area, m2', ru: 'Площадь, м2' }, type: 'number', step: 0.01, default: 4.3355 },
    ],
    state: [{ path: 'thickness', label: { en: 'Thickness, m', ru: 'Толщина, м' }, type: 'number', step: 0.01, default: 0.1 }],
  },
  {
    key: 'Model.AeroProtectionModule',
    group: 'structure',
    label: { en: 'Aero protection', ru: 'Аэрозащита' },
    config: [{ path: 'notOccluded', label: { en: 'Not occluded by', ru: 'Не закрывается' }, type: 'text', default: 'forward, down, up' }],
    state: [],
  },
  {
    key: 'Model.DockingPortModule',
    group: 'structure',
    label: { en: 'Docking port', ru: 'Стыковочный узел' },
    config: [
      { path: 'force', label: { en: 'Docking force, N', ru: 'Сила стыковки, Н' }, type: 'number', default: 50 },
      { path: 'captureRange', label: { en: 'Capture range, m', ru: 'Дальность захвата, м' }, type: 'number', step: 0.01, default: 0.45 },
      { path: 'resourceTransferFlow', label: { en: 'Resource transfer flow', ru: 'Поток передачи ресурсов' }, type: 'number', default: 10 },
    ],
    state: [{ path: 'resourceTransfer', label: { en: 'Resource transfer', ru: 'Передача ресурсов' }, type: 'json', default: {} }],
  },
  {
    key: 'Model.JointProducerModule',
    group: 'structure',
    label: { en: 'Joint producer', ru: 'Производитель соединений' },
    config: [
      { path: 'originalAttachmentIds', label: { en: 'Original attachments', ru: 'Исходные аттачменты' }, type: 'numbers', default: [1, 2, 3, 4] },
      { path: 'spawnedAttachmentIds', label: { en: 'Spawned attachments', ru: 'Создаваемые аттачменты' }, type: 'numbers', default: [0] },
      {
        path: 'visuals',
        label: { en: 'Visuals', ru: 'Внешний вид' },
        type: 'object',
        fields: [
          { path: 'radius', label: { en: 'Radius', ru: 'Радиус' }, type: 'number', step: 0.001, default: 0.025 },
          { path: 'length', label: { en: 'Length', ru: 'Длина' }, type: 'number', default: 29 },
        ],
      },
      { path: 'linearLimit', label: { en: 'Linear limit', ru: 'Линейный предел' }, type: 'number', default: 30 },
      { path: 'projectionMode', label: { en: 'Projection mode', ru: 'Режим проекции' }, type: 'text', default: 'None' },
    ],
    state: [],
  },

  // ---------------------------------------------------------------------- misc
  {
    key: 'Model.AntennaModule',
    group: 'misc',
    label: { en: 'Antenna', ru: 'Антенна' },
    config: [
      { path: 'frequencies', label: { en: 'Frequencies, Hz', ru: 'Частоты, Гц' }, type: 'numbers', default: [2400000000] },
      { path: 'bandwidths', label: { en: 'Bandwidths, Hz', ru: 'Полосы, Гц' }, type: 'numbers', default: [1000000] },
      { path: 'transmisionPower', label: { en: 'Transmit power', ru: 'Мощность передачи' }, type: 'numbers', default: [8] },
      { path: 'efficiency', label: { en: 'Efficiency', ru: 'КПД' }, type: 'number', step: 0.01, default: 0.9 },
      {
        path: 'type',
        label: { en: 'Type', ru: 'Тип' },
        type: 'enum',
        options: ['monopole', 'dipole'],
        default: 'monopole',
      },
      { path: 'direction', label: { en: 'Direction', ru: 'Направление' }, type: 'vector3', default: { x: 1, y: 0, z: 0 } },
    ],
    state: [
      { path: 'flags', label: { en: 'Flags', ru: 'Флаги' }, type: 'text', default: 'isEnabled' },
      { path: 'bandwidthLimiter', label: { en: 'Bandwidth limiter', ru: 'Ограничитель полосы' }, type: 'number', step: 0.01, default: 0.5 },
    ],
  },
  {
    key: 'Model.LightModule',
    group: 'misc',
    label: { en: 'Light', ru: 'Прожектор' },
    config: [
      { path: 'consumption', label: { en: 'Power consumption', ru: 'Потребление энергии' }, type: 'number', default: 40 },
      { path: 'eceCoeff', label: { en: 'ECE coefficient', ru: 'Коэффициент ECE' }, type: 'number', step: 0.01, default: 0.4 },
      { path: 'luminousEfficacy', label: { en: 'Luminous efficacy', ru: 'Световая отдача' }, type: 'number', default: 85 },
      { path: 'maxRange', label: { en: 'Max range, m', ru: 'Дальность, м' }, type: 'number', default: 30 },
      { path: 'colorTemperature', label: { en: 'Colour temperature, K', ru: 'Цветовая температура, К' }, type: 'number', default: 4400 },
      { path: 'lightBulb', label: { en: 'Bulb path', ru: 'Путь лампы' }, type: 'text', default: 'model/light/lamp_bulb/lamp_bulb_{0}' },
    ],
    state: [{ path: 'isEnabled', label: { en: 'Enabled', ru: 'Включено' }, type: 'bool', default: false }],
  },
  {
    key: 'Model.InstrumentModule',
    group: 'misc',
    label: { en: 'Instruments', ru: 'Приборы' },
    config: [
      {
        path: 'instruments',
        label: { en: 'Instruments', ru: 'Приборы' },
        type: 'json',
        default: [
          { type: 'navball', consumption: 5, eceCoef: 0.95, dataRate: 128 },
          { type: 'speedometer', consumption: 5, eceCoef: 0.95, dataRate: 32 },
          { type: 'altimeter', consumption: 5, eceCoef: 0.95, dataRate: 32 },
        ],
      },
    ],
    state: [{ path: 'enabledState', label: { en: 'Enabled state', ru: 'Состояние включения' }, type: 'number', default: 0 }],
  },
  {
    key: 'Model.ProbeCoreModule',
    group: 'misc',
    label: { en: 'Probe core', ru: 'Ядро зонда' },
    config: [{ path: 'consumption', label: { en: 'Power consumption', ru: 'Потребление энергии' }, type: 'number', default: 240 }],
    state: [{ path: 'state', label: { en: 'State', ru: 'Состояние' }, type: 'number', default: 100 }],
  },
  {
    key: 'Model.ContinuousEffectModule',
    group: 'misc',
    label: { en: 'Continuous effect (RCS)', ru: 'Постоянный эффект (RCS)' },
    config: [
      { path: 'sound', label: { en: 'Sound', ru: 'Звук' }, type: 'enum', options: ['', ...ENGINE_SOUNDS], default: 'rcs_micro' },
      { path: 'startSound', label: { en: 'Start sound', ru: 'Звук запуска' }, type: 'enum', options: ['', ...ENGINE_SOUNDS], default: '' },
      { path: 'endSound', label: { en: 'Stop sound', ru: 'Звук остановки' }, type: 'enum', options: ['', ...ENGINE_SOUNDS], default: '' },
      { path: 'vfx', label: { en: 'VFX', ru: 'Эффект' }, type: 'enum', options: ['', ...RCS_VFX], default: 'rcs_0' },
    ],
    state: [],
  },
  {
    key: 'Model.PartStateSoundsModule',
    group: 'misc',
    label: { en: 'State sounds', ru: 'Звуки состояний' },
    config: [
      { path: 'sounds', label: { en: 'Sounds', ru: 'Звуки' }, type: 'json', default: { decouple: 'air_explosion' } },
      { path: 'range', label: { en: 'Range (min, max)', ru: 'Дальность (мин, макс)' }, type: 'vector2', default: { x: 3, y: 4 } },
    ],
    state: [],
  },
  {
    key: 'Model.ParachuteModule',
    group: 'misc',
    label: { en: 'Parachute', ru: 'Парашют' },
    config: [
      { path: 'dragStateModifiers', label: { en: 'Drag modifiers', ru: 'Модификаторы сопротивления' }, type: 'json', default: [] },
      { path: 'deployedSound', label: { en: 'Deployed sound', ru: 'Звук раскрытия' }, type: 'text', default: 'parachute_flapping' },
    ],
    state: [],
  },
  {
    key: 'Model.PilotChuteModule',
    group: 'misc',
    label: { en: 'Pilot chute', ru: 'Вытяжной парашют' },
    config: [
      { path: 'mainParachutePartId', label: { en: 'Main parachute id', ru: 'Id основного парашюта' }, type: 'number', default: 2 },
      { path: 'dragStateModifiers', label: { en: 'Drag modifiers', ru: 'Модификаторы сопротивления' }, type: 'json', default: [] },
      { path: 'deployedSound', label: { en: 'Deployed sound', ru: 'Звук раскрытия' }, type: 'text', default: 'parachute_flapping' },
    ],
    state: [],
  },
  {
    key: 'Model.ParachuteSpawnerModule',
    group: 'misc',
    label: { en: 'Parachute spawner', ru: 'Спасатель парашютов' },
    config: [
      { path: 'parachutePartId', label: { en: 'Parachute part id', ru: 'Id парашюта' }, type: 'number', default: 2 },
      { path: 'pilotChutePartId', label: { en: 'Pilot chute part id', ru: 'Id вытяжного парашюта' }, type: 'number', default: 2 },
    ],
    state: [
      {
        path: 'parachute',
        label: { en: 'Deployment', ru: 'Раскрытие' },
        type: 'object',
        fields: [
          { path: 'minPressure', label: { en: 'Min pressure', ru: 'Мин. давление' }, type: 'number', step: 0.01, default: 0.5 },
          { path: 'altitude', label: { en: 'Altitude, m', ru: 'Высота, м' }, type: 'number', default: 1000 },
          { path: 'minPressureRange', label: { en: 'Pressure range', ru: 'Диапазон давления' }, type: 'vector2', default: { x: 0.01, y: 50 } },
          { path: 'altitudeRange', label: { en: 'Altitude range', ru: 'Диапазон высоты' }, type: 'vector2', default: { x: 50, y: 5000 } },
        ],
      },
    ],
  },
  {
    key: 'Model.SelfDestructionModule',
    group: 'misc',
    label: { en: 'Self destruction', ru: 'Самоликвидация' },
    config: [{ path: 'detonateRange', label: { en: 'Detonate range (min, max)', ru: 'Дальность подрыва (мин, макс)' }, type: 'vector2', default: { x: 1, y: 10 } }],
    state: [{ path: 'delay', label: { en: 'Delay, s', ru: 'Задержка, с' }, type: 'number', default: 5 }],
  },
  {
    key: 'Model.CraftSpawnerModule',
    group: 'misc',
    label: { en: 'Craft spawner', ru: 'Спавнер конструкций' },
    config: [
      { path: 'parts', label: { en: 'Parts', ru: 'Детали' }, type: 'json', default: [] },
      { path: 'connections', label: { en: 'Connections', ru: 'Соединения' }, type: 'json', default: [] },
    ],
    state: [],
  },
  {
    key: 'Model.MirrorModule',
    group: 'misc',
    label: { en: 'Mirror', ru: 'Зеркало' },
    config: [
      { path: 'rootDir', label: { en: 'Root direction', ru: 'Направление корня' }, type: 'vector3', default: { x: 0, y: 0, z: 1 } },
      { path: 'rootUp', label: { en: 'Root up', ru: 'Вверх корня' }, type: 'vector3', default: { x: 0, y: 1, z: 0 } },
      { path: 'partDir', label: { en: 'Part direction', ru: 'Направление детали' }, type: 'vector3', default: { x: 0, y: 0, z: 1 } },
      { path: 'mirrorScale', label: { en: 'Mirror scale', ru: 'Масштаб зеркала' }, type: 'vector3', default: { x: 1, y: 1, z: 1 } },
    ],
    state: [],
  },
  {
    key: 'Model.RoverModule',
    group: 'misc',
    label: { en: 'Rover', ru: 'Ровер' },
    config: [],
    state: [],
  },
  {
    key: 'Model.DragCubeModifer',
    group: 'misc',
    label: { en: 'Drag cube modifier', ru: 'Модификатор drag cube' },
    config: [{ path: 'value', label: { en: 'Value', ru: 'Значение' }, type: 'json', default: {} }],
    state: [],
  },

  // ------------------------------------------------------------- propellants
  {
    key: 'Model.KeroseneModule',
    group: 'energy',
    label: { en: 'Kerosene', ru: 'Керосин' },
    config: [{ path: 'maxAmount', label: { en: 'Amount, kg', ru: 'Количество, кг' }, type: 'number', default: 100000 }],
    state: [{ path: 'amount', label: { en: 'Amount, kg', ru: 'Количество, кг' }, type: 'number', default: 100000 }],
  },
  {
    key: 'Model.O2Module',
    group: 'energy',
    label: { en: 'Oxygen', ru: 'Кислород' },
    config: [{ path: 'maxAmount', label: { en: 'Amount, kg', ru: 'Количество, кг' }, type: 'number', default: 125000 }],
    state: [{ path: 'amount', label: { en: 'Amount, kg', ru: 'Количество, кг' }, type: 'number', default: 125000 }],
  },
  {
    key: 'Model.N2H4Module',
    group: 'energy',
    label: { en: 'Hydrazine', ru: 'Гидразин' },
    config: [
      { path: 'maxAmount', label: { en: 'Amount, kg', ru: 'Количество, кг' }, type: 'number', default: 100000 },
      { path: 'type', label: { en: 'Type', ru: 'Тип' }, type: 'text', default: 'n2h4' },
    ],
    state: [{ path: 'amount', label: { en: 'Amount, kg', ru: 'Количество, кг' }, type: 'number', default: 100000 }],
  },
  {
    key: 'Model.UDMHModule',
    group: 'energy',
    label: { en: 'UDMH', ru: 'УДМХ' },
    config: [{ path: 'maxAmount', label: { en: 'Amount, kg', ru: 'Количество, кг' }, type: 'number', default: 81800 }],
    state: [{ path: 'amount', label: { en: 'Amount, kg', ru: 'Количество, кг' }, type: 'number', default: 81800 }],
  },
  {
    key: 'Model.N2O4Module',
    group: 'energy',
    label: { en: 'N2O4', ru: 'N2O4' },
    config: [{ path: 'maxAmount', label: { en: 'Amount, kg', ru: 'Количество, кг' }, type: 'number', default: 134315 }],
    state: [{ path: 'amount', label: { en: 'Amount, kg', ru: 'Количество, кг' }, type: 'number', default: 134315 }],
  },
  {
    key: 'Model.WheelMultiModule',
    group: 'structure',
    label: { en: 'Wheels (several)', ru: 'Колёса (несколько)' },
    config: [
      { path: 'name', label: { en: 'Name', ru: 'Имя' }, type: 'text', default: 'Wheels' },
      { path: 'wheels', label: { en: 'Wheels', ru: 'Колёса' }, type: 'json', default: [] },
      { path: 'wheelDynamic', label: { en: 'Steering and motors', ru: 'Руление и моторы' }, type: 'json', default: {} },
      { path: 'wheelPosition', label: { en: 'Wheel positions', ru: 'Положения колёс' }, type: 'json', default: [] },
      { path: 'suspensionPosition', label: { en: 'Suspension positions', ru: 'Положения подвесок' }, type: 'json', default: [] },
      { path: 'modelPath', label: { en: 'Model paths', ru: 'Пути моделей' }, type: 'json', default: [] },
      { path: 'suspensionPath', label: { en: 'Suspension paths', ru: 'Пути подвесок' }, type: 'json', default: [] },
      { path: 'steeringPath', label: { en: 'Steering paths', ru: 'Пути руления' }, type: 'json', default: [] },
    ],
    state: [
      { path: 'steeringSign', label: { en: 'Steering sign', ru: 'Знак руления' }, type: 'number', default: 1 },
      { path: 'steeringAngle', label: { en: 'Steering angle', ru: 'Угол руления' }, type: 'number', default: 10 },
    ],
  },
];

export const COMPONENT_BY_KEY = Object.fromEntries(COMPONENTS.map((component) => [component.key, component]));

export const COMPONENT_GROUP_LABEL = Object.fromEntries(
  COMPONENT_GROUPS.map((group) => [group.id, group.label]),
);
