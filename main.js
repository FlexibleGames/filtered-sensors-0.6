"use strict";

const { api, react } = sandkit;

const MOD_ID = "fg.filtered_sensors";


const PRESENCE_SENSOR_ID = "filteredPresenceSensor";
const FULL_SENSOR_ID = "filteredFullSensor";
const PRESENCE_SENSOR_SPRITE = "filtered_presence_sensor";
const FULL_SENSOR_SPRITE = "filtered_full_sensor";
let sensorShape = [
  [0, 0, 0, 0],
  [0, 0, 0, 0],
  [0, 0, 0, 0],
  [0, 0, 0, 0],
];

let sensorEditor = null;
const sensorUiListeners = new Set();

function setSensorEditor(value) {
  sensorEditor = value;
  sensorUiListeners.forEach((notify) => notify());
}

function sensorFrame() {
  return sensorShape.map((row) => row.slice());
}

function vanillaSensorDefinition() {
  const ids = [];
  const structureTypes = sandkit.enums && sandkit.enums.StructureType;
  if (structureTypes) {
    Object.keys(structureTypes).forEach((key) => {
      if (/sensor|presence|pulse/i.test(key)) {
        ids.push(structureTypes[key]);
        ids.push(key);
      }
    });
  }
  [
    "presenceSensor",
    "signalSensor",
    "pulseSensor",
    "sensorPresence",
    "sensorSignal",
    "sensorPulse",
  ].forEach((id) => ids.push(id));

  for (const id of ids) {
    const def = safe(() => api.structures.getDefinitionByType(id));
    if (!def || !def.shape) continue;
    console.log("[Filtered Sensors] Using vanilla sensor footprint from " + id, JSON.stringify({
      shape: def.shape,
      categoryKey: def.categoryKey,
      rejectWhenBlocked: def.rejectWhenBlocked,
    }));
    return def;
  }
  console.warn("[Filtered Sensors] No vanilla sensor definition found. Using a non-solid 4x4 footprint.");
  return null;
}

function registerSensorStructure(id, name, description, sprite) {
  const vanilla = vanillaSensorDefinition();
  if (vanilla && vanilla.shape) sensorShape = vanilla.shape;
  const shape = sensorFrame();
  const raw = shape.some((row) => row.some((cell) => cell !== 0 && cell !== 1));
  const definition = {
    id,
    blockGridType: id,
    name,
    description,
    categoryKey: (vanilla && vanilla.categoryKey) || "logic",
    order: 30,
    alwaysUnlocked: false,
    rejectWhenBlocked: false,
    buildModes: [{ type: "single" }],
    variants: [{ id, angles: [0] }],
    shape,
    defaultData: { allowed: [] },
    render: {
      imageName: sprite,
      size: { width: shape[0].length * 4, height: shape.length * 4 },
      ui: { outline: true },
    },
  };
  try {
    api.structures.register(definition, raw ? { useRawShape: true } : undefined);
  } catch (error) {
    console.warn("[Filtered Sensors] Could not use the logic menu (" + (error && error.message) + "). Using logistics.");
    definition.categoryKey = "logistics";
    api.structures.register(definition, raw ? { useRawShape: true } : undefined);
  }
}

function sensorCells(structure) {
  const cells = [];
  const height = sensorShape.length;
  const width = sensorShape[0].length;
  for (let dy = 0; dy < height; dy++) {
    for (let dx = 0; dx < width; dx++) {
      cells.push({ x: structure.x + dx, y: structure.y + dy });
    }
  }
  return cells;
}

function allowedElements(structure) {
  const allowed = structure && structure.data && structure.data.allowed;
  return Array.isArray(allowed) ? allowed : [];
}

function cellMatchesFilter(cell, allowed) {
  if (!allowed.length) return false;
  let elementType = null;
  try {
    elementType = api.elements.getResolvedTypeAtCell(cell.x, cell.y);
  } catch (error) {
    return false;
  }
  if (elementType == null) return false;
  return allowed.some((entry) => entry === elementType || String(entry) === String(elementType));
}

function sensorIsOn(structure, mode) {
  const allowed = allowedElements(structure);
  const cells = sensorCells(structure);
  if (!allowed.length || !cells.length) return false;
  if (mode === "full") return cells.every((cell) => cellMatchesFilter(cell, allowed));
  return cells.some((cell) => cellMatchesFilter(cell, allowed));
}

function publishSensorOutput() {
  const modes = [
    [PRESENCE_SENSOR_ID, "presence"],
    [FULL_SENSOR_ID, "full"],
  ];
  for (const [id, mode] of modes) {
    try {
      api.structures.forEachOfType(id, (structure) => {
        api.signals.setOutputAtCell(structure.x, structure.y, sensorIsOn(structure, mode));
      });
    } catch (error) {}
  }
}

function elementChoices() {
  let types = [];
  try {
    types = api.elements.getRegisteredTypes() || [];
  } catch (error) {
    types = [];
  }
  const matterNames = sandkit.enums && sandkit.enums.MatterType ? sandkit.enums.MatterType : {};
  const choices = [];
  for (const entry of types) {
    const elementType = entry && typeof entry === "object" ? (entry.elementType != null ? entry.elementType : entry.id) : entry;
    if (elementType == null || elementType === "") continue;
    let name = String(elementType);
    try {
      name = api.elements.getNameByType(elementType) || name;
    } catch (error) {}
    let matter = "";
    try {
      const def = api.elements.getDefinitionByType(elementType) || (typeof entry === "object" ? entry : null);
      const matterValue = def && (def.matterType != null ? def.matterType : def.matter);
      matter = Object.keys(matterNames).find((key) => matterNames[key] === matterValue) || "";
    } catch (error) {}
    choices.push({ elementType, name: String(name), matter });
  }
  choices.sort((a, b) => a.name.localeCompare(b.name));
  return choices;
}

function openSensorEditor(structure, mode) {
  const data = structure.data || {};
  if (!Array.isArray(data.allowed)) {
    try { api.structures.setData(structure, { allowed: [] }); } catch (error) {}
  }
  setSensorEditor({
    x: structure.x,
    y: structure.y,
    mode,
    query: "",
  });
}

function editedSensor() {
  if (!sensorEditor) return null;
  try {
    return api.structures.getAtCell(sensorEditor.x, sensorEditor.y);
  } catch (error) {
    return null;
  }
}

function toggleSensorElement(elementType) {
  const structure = editedSensor();
  if (!structure) return;
  const allowed = allowedElements(structure).slice();
  const index = allowed.findIndex((entry) => entry === elementType || String(entry) === String(elementType));
  if (index >= 0) allowed.splice(index, 1);
  else allowed.push(elementType);
  api.structures.setData(structure, { allowed });
  setSensorEditor(Object.assign({}, sensorEditor));
}

function SensorFilterUI() {
  const [, setTick] = react.useState(0);
  react.useEffect(() => {
    const notify = () => setTick((value) => value + 1);
    sensorUiListeners.add(notify);
    return () => sensorUiListeners.delete(notify);
  }, []);

  if (!sensorEditor || !editedSensor()) return null;
  const structure = editedSensor();
  const allowed = allowedElements(structure);
  const query = (sensorEditor.query || "").trim().toLowerCase();
  const choices = elementChoices().filter((choice) => {
    if (!query) return true;
    return choice.name.toLowerCase().includes(query) || choice.matter.toLowerCase().includes(query);
  });
  const accent = sensorEditor.mode === "full" ? "#dc2626" : "#f97316";
  const title = sensorEditor.mode === "full" ? "Full Sensor" : "Presence Sensor";

  return react.createElement(
    "div",
    {
      onMouseDown: (event) => event.stopPropagation(),
      style: {
        position: "fixed",
        right: "18px",
        bottom: "118px",
        width: "240px",
        maxHeight: "360px",
        display: "flex",
        flexDirection: "column",
        padding: "10px",
        border: "2px solid " + accent,
        borderRadius: "5px",
        background: "rgba(5, 24, 34, 0.97)",
        color: "white",
        boxShadow: "0 8px 24px rgba(0, 0, 0, 0.65)",
        fontFamily: "sans-serif",
        zIndex: 10000,
      },
    },
    react.createElement("div", { style: { fontWeight: 700, color: accent, marginBottom: "4px" } }, title),
    react.createElement(
      "div",
      { style: { fontSize: "11px", color: "#aaa", marginBottom: "8px" } },
      allowed.length ? allowed.length + " selected" : "Select one or more elements"
    ),
    react.createElement("input", {
      value: sensorEditor.query || "",
      placeholder: "Search elements",
      onChange: (event) => setSensorEditor(Object.assign({}, sensorEditor, { query: event.target.value })),
      style: {
        marginBottom: "8px",
        background: "#08202b",
        color: "white",
        border: "1px solid #31566b",
        borderRadius: "3px",
        padding: "4px 6px",
      },
    }),
    react.createElement(
      "div",
      { style: { overflow: "auto", display: "flex", flexDirection: "column", gap: "2px" } },
      choices.map((choice) => {
        const checked = allowed.some((entry) => entry === choice.elementType || String(entry) === String(choice.elementType));
        return react.createElement(
          "label",
          {
            key: String(choice.elementType),
            style: { display: "flex", gap: "6px", alignItems: "center", fontSize: "12px", cursor: "pointer" },
          },
          react.createElement("input", {
            type: "checkbox",
            checked,
            onChange: () => toggleSensorElement(choice.elementType),
          }),
          react.createElement("span", null, choice.matter ? choice.name + " (" + choice.matter + ")" : choice.name)
        );
      })
    ),
    react.createElement(
      "button",
      {
        onClick: () => setSensorEditor(null),
        style: { marginTop: "8px", background: "#123", color: "white", border: "1px solid #31566b", borderRadius: "3px", padding: "4px" },
      },
      "Close"
    )
  );
}

function registerFilterableSensors() {
  registerSensorStructure(
    PRESENCE_SENSOR_ID,
    "Filter Presence Sensor",
    "Sends a signal while any open cell inside contains a selected element. Click the sensor to choose elements.",
    PRESENCE_SENSOR_SPRITE
  );
  registerSensorStructure(
    FULL_SENSOR_ID,
    "Filter Full Sensor",
    "Sends a signal while every open cell inside contains a selected element. Click the sensor to choose elements.",
    FULL_SENSOR_SPRITE
  );

  try {
    api.signals.registerSenderType(PRESENCE_SENSOR_ID, (structure) => sensorIsOn(structure, "presence"));
    api.signals.registerSenderType(FULL_SENSOR_ID, (structure) => sensorIsOn(structure, "full"));
  } catch (error) {
    console.warn("[Filtered Sensors] Sensor signal registration failed:", error.message);
  }

  try {
    api.signals.interactables.register(PRESENCE_SENSOR_ID, (structure) => openSensorEditor(structure, "presence"));
    api.signals.interactables.register(FULL_SENSOR_ID, (structure) => openSensorEditor(structure, "full"));
  } catch (error) {
    console.warn("[Filtered Sensors] Sensor filter UI failed:", error.message);
  }

  api.ui.inject("filtered-sensor-ui", SensorFilterUI);
  setInterval(publishSensorOutput, 100);
}

function lockSensors() {
  try { api.player.buildings.removeById(PRESENCE_SENSOR_ID); } catch (error) {}
  try { api.player.buildings.removeById(FULL_SENSOR_ID); } catch (error) {}
}

function unlockSensors() {
  try { api.player.buildings.unlockByType(PRESENCE_SENSOR_ID); } catch (error) {}
  try { api.player.buildings.unlockByType(FULL_SENSOR_ID); } catch (error) {}
}

function signalControlsId() {
  const fromEnum = sandkit.enums && sandkit.enums.Tech && sandkit.enums.Tech.SignalControls;
  if (fromEnum != null && safe(() => api.tech.getDefinitionById(fromEnum))) return fromEnum;
  if (safe(() => api.tech.getDefinitionById("SignalControls"))) return "SignalControls";
  return fromEnum;
}

function registerAdvancedSignalsTech() {
  const techId = "advancedSignals";
  try {
    api.i18n.register("en", {
      "tech|advancedSignals|name": "Advanced Signals",
      "tech|advancedSignals|description": "Unlocks filterable presence and full-tile sensors.",
    });
  } catch (error) {}

  const parentId = signalControlsId();
  if (!safe(() => api.tech.getDefinitionById(techId))) {
    if (parentId == null) {
      console.error("[Filtered Sensors] Signal Controls was not found. Sensors left unlocked.");
      unlockSensors();
      return;
    }
    const parent = safe(() => api.tech.getDefinitionById(parentId)) || {};
    const definition = {
      name: "Advanced Signals",
      nameKey: "tech|advancedSignals|name",
      description: "Unlocks filterable presence and full-tile sensors.",
      descriptionKey: "tech|advancedSignals|description",
      cost: 50,
      currencyType: parent.currencyType || "ticket",
      requires: [parentId],
      unlocks: { structures: [PRESENCE_SENSOR_ID, FULL_SENSOR_ID] },
    };
    if (parent.branch) definition.branch = parent.branch;

    try {
      api.tech.registerNode(techId, definition, { parentId });
      console.log("[Filtered Sensors] Advanced Signals placed under Signal Controls.");
    } catch (error) {
      console.warn("[Filtered Sensors] Could not place Advanced Signals on the grid:", error);
    }
    if (!safe(() => api.tech.getDefinitionById(techId))) {
      try {
        api.tech.registerDefinition(techId, definition);
        console.log("[Filtered Sensors] Advanced Signals registered as a ticket tech.");
      } catch (error) {
        console.error("[Filtered Sensors] Advanced Signals was not created:", error);
        unlockSensors();
        return;
      }
    }
  }

  if (!safe(() => api.tech.isResearchedById(techId))) lockSensors();
}


function safe(fn, fallback = null) {
  try {
    return fn();
  } catch (error) {
    return fallback;
  }
}

async function loadImage(spriteName) {
  try {
    await api.sprites.loadFromMod(spriteName, "assets/" + spriteName + ".png");
  } catch (error) {
    console.warn("[Filtered Sensors] Sprite failed to load: " + spriteName, error);
  }
}

// Register during script load. Waiting on sprites used to run this after
// the game had already built the research list, so nothing showed up.
registerFilterableSensors();
registerAdvancedSignalsTech();

async function initialize() {
  await loadImage(PRESENCE_SENSOR_SPRITE);
  await loadImage(FULL_SENSOR_SPRITE);
  console.log("[Filtered Sensors] loaded");
}

initialize().catch((error) => console.error("[Filtered Sensors] Init failed:", error));
