"use strict";

const { api, react } = sandkit;

const MOD_ID = "fg.filtered_sensors";


const PRESENCE_SENSOR_ID = "filteredPresenceSensor";
const FULL_SENSOR_ID = "filteredFullSensor";
const PRESENCE_SENSOR_SPRITE = "filtered_presence_sensor";
const FULL_SENSOR_SPRITE = "filtered_full_sensor";
const SENSOR_SIZE = 4;

let sensorEditor = null;
const sensorUiListeners = new Set();

function setSensorEditor(value) {
  sensorEditor = value;
  sensorUiListeners.forEach((notify) => notify());
}

function sensorFrame() {
  return [
    [1, 1, 1, 1],
    [1, 0, 0, 1],
    [1, 0, 0, 1],
    [1, 1, 1, 1],
  ];
}

function registerSensorStructure(id, name, description, sprite) {
  const definition = {
    id,
    blockGridType: id,
    name,
    description,
    categoryKey: "logic",
    order: 30,
    alwaysUnlocked: false,
    rejectWhenBlocked: true,
    buildModes: [{ type: "single" }],
    variants: [{ id, angles: [0] }],
    shape: sensorFrame(),
    defaultData: { allowed: [] },
    render: {
      imageName: sprite,
      size: { width: 16, height: 16 },
      ui: { outline: true },
    },
  };
  try {
    api.structures.register(definition);
  } catch (error) {
    console.warn("[Filtered Sensors] Could not use the logic menu (" + error.message + "). Using logistics.");
    definition.categoryKey = "logistics";
    api.structures.register(definition);
  }
}

function interiorCells(structure) {
  const cells = [];
  for (let dy = 1; dy < SENSOR_SIZE - 1; dy++) {
    for (let dx = 1; dx < SENSOR_SIZE - 1; dx++) {
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
  const cells = interiorCells(structure);
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

function unlockSensors() {
  try { api.player.buildings.unlockByType(PRESENCE_SENSOR_ID); } catch (error) {}
  try { api.player.buildings.unlockByType(FULL_SENSOR_ID); } catch (error) {}
}

function registerAdvancedSignalsTech() {
  const parentId = sandkit.enums && sandkit.enums.Tech && sandkit.enums.Tech.SignalControls;
  try {
    api.i18n.register("en", {
      "tech|advancedSignals|name": "Advanced Signals",
      "tech|advancedSignals|description": "Unlocks filterable presence and full-tile sensors.",
    });
  } catch (error) {}

  if (safe(() => api.tech.getDefinitionById("advancedSignals"))) {
    console.log("[Filtered Sensors] Advanced Signals is already registered.");
    return;
  }

  if (parentId == null) {
    console.error("[Filtered Sensors] Signal Controls tech id was missing. Sensors unlocked without research.");
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

  const spots = [null];
  const base = safe(() => api.tech.getGridPositionById(parentId));
  if (base && Number.isInteger(base.row) && Number.isInteger(base.col)) {
    spots.length = 0;
    for (let row = base.row + 1; row <= base.row + 3; row++) {
      for (let col = base.col; col <= base.col + 5; col++) spots.push({ row, col });
    }
    spots.push(null);
  }

  let registered = false;
  let lastError = null;
  for (const preferredPosition of spots) {
    try {
      const options = { parentId };
      if (preferredPosition) options.preferredPosition = preferredPosition;
      api.tech.registerNode("advancedSignals", definition, options);
      registered = true;
      console.log("[Filtered Sensors] Advanced Signals added beside Signal Controls.", preferredPosition || "auto");
      break;
    } catch (error) {
      lastError = error;
    }
  }

  if (!registered) {
    console.error("[Filtered Sensors] Advanced Signals was not added:", lastError);
    unlockSensors();
  }
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
