const state = {
  regions: [],
  byId: new Map(),
  byName: new Map(),
  adjacency: new Map(),
  map: null,
  layerById: new Map(),
  startId: null,
  endId: null,
  currentId: null,
  visited: [],
  finished: false,
  easyMode: true,
};

const EASY_MODE_STORAGE_KEY = "azegez-easy-mode";

const ui = {
  status: document.getElementById("status"),
  challenge: document.getElementById("challenge"),
  startName: document.getElementById("startName"),
  endName: document.getElementById("endName"),
  currentName: document.getElementById("currentName"),
  guessForm: document.getElementById("guessForm"),
  guessInput: document.getElementById("guessInput"),
  regionList: document.getElementById("regionList"),
  actions: document.getElementById("actions"),
  newGameButton: document.getElementById("newGameButton"),
  revealButton: document.getElementById("revealButton"),
  easyModeToggle: document.getElementById("easyModeToggle"),
  moveLog: document.getElementById("moveLog"),
  logWrap: document.getElementById("logWrap"),
};

const defaultStyle = {
  color: "#9ca3af",
  weight: 1,
  opacity: 1,
  fillColor: "#1f2937",
  fillOpacity: 0.45,
};

const startStyle = {
  color: "#10b981",
  weight: 2,
  opacity: 1,
  fillColor: "#065f46",
  fillOpacity: 0.65,
};

const targetStyle = {
  color: "#f59e0b",
  weight: 2,
  opacity: 1,
  fillColor: "#78350f",
  fillOpacity: 0.65,
};

const currentStyle = {
  color: "#22d3ee",
  weight: 3,
  opacity: 1,
  fillColor: "#155e75",
  fillOpacity: 0.75,
};

const visitedStyle = {
  color: "#c084fc",
  weight: 2,
  opacity: 1,
  fillColor: "#581c87",
  fillOpacity: 0.6,
};

const hiddenStyle = {
  color: "#000000",
  weight: 0,
  opacity: 0,
  fillColor: "#000000",
  fillOpacity: 0,
};

init();

async function init() {
  try {
    loadEasyModePreference();

      const response = await fetch("https://gist.githubusercontent.com/KalasLavas/26de97ddeadebe3724e860a8c774b933/raw/ddfa1bfd883a0e2c061a9802a002ef049d029946/db.json");
    if (!response.ok) {
      throw new Error("Unable to load db.json");
    }

    const rawRegions = await response.json();
    state.regions = rawRegions.map((entry, index) => ({
      id: index,
      name: entry.name,
      nameEn: entry.name_en,
      polygons: entry.polygons,
    }));

    for (const region of state.regions) {
      state.byId.set(region.id, region);
      state.byName.set(region.name.toLocaleLowerCase(), region.id);
      state.byName.set(region.nameEn.toLocaleLowerCase(), region.id);
      state.byName.set(formatRegionName(region).toLocaleLowerCase(), region.id);
    }

    state.adjacency = buildAdjacency(state.regions);

    createMap();
    fillDatalist();
    bindEvents();
    startNewGame();
  } catch (error) {
    ui.status.textContent = `Failed to initialize game: ${error.message}`;
    ui.status.className = "status bad";
    console.error(error);
  }
}

function createMap() {
  state.map = L.map("map", {
    zoomSnap: 0.5,
    zoomControl: true,
  });

  const features = state.regions.map((region) => ({
    type: "Feature",
    properties: {
      id: region.id,
      name: region.name,
      nameEn: region.nameEn,
    },
    geometry: {
      type: "Polygon",
      coordinates: region.polygons,
    },
  }));

  const collection = {
    type: "FeatureCollection",
    features,
  };

  const geoLayer = L.geoJSON(collection, {
    style: () => defaultStyle,
    onEachFeature: (feature, layer) => {
      const { id } = feature.properties;
      state.layerById.set(id, layer);
    },
  }).addTo(state.map);

  state.map.fitBounds(geoLayer.getBounds(), { padding: [20, 20] });
}

function fillDatalist() {
  ui.regionList.innerHTML = "";
  const sorted = [...state.regions].sort((left, right) =>
    left.name.localeCompare(right.name)
  );

  for (const region of sorted) {
    const option = document.createElement("option");
    option.value = formatRegionName(region);
    ui.regionList.appendChild(option);
  }
}

function bindEvents() {
  ui.guessForm.addEventListener("submit", (event) => {
    event.preventDefault();
    submitGuess(ui.guessInput.value);
  });

  ui.easyModeToggle.addEventListener("change", (event) => {
    state.easyMode = event.target.checked;
    localStorage.setItem(EASY_MODE_STORAGE_KEY, state.easyMode ? "1" : "0");
    paintRegions();
  });

  ui.newGameButton.addEventListener("click", () => {
    startNewGame();
  });

  ui.revealButton.addEventListener("click", () => {
    revealShortestPath();
  });
}

function startNewGame() {
  state.finished = false;
  ui.moveLog.innerHTML = "";
  const challenge = pickChallenge();
  state.startId = challenge.startId;
  state.endId = challenge.endId;
  state.currentId = challenge.startId;
  state.visited = [challenge.startId, challenge.endId];

  ui.startName.textContent = formatRegionName(state.byId.get(state.startId));
  ui.endName.textContent = formatRegionName(state.byId.get(state.endId));
  ui.currentName.textContent = formatRegionName(state.byId.get(state.currentId));
  ui.status.textContent = "Enter any regions to build a connected path from start to target.";
  ui.status.className = "status";

  ui.challenge.hidden = false;
  ui.guessForm.hidden = false;
  ui.actions.hidden = false;
  ui.logWrap.hidden = false;
  ui.guessInput.value = "";
  ui.guessInput.focus();

  paintRegions();
}

function submitGuess(rawInput) {
  if (state.finished) {
    return;
  }

  const normalized = rawInput.trim();
  if (!normalized) {
    return;
  }

  const guessedId = resolveRegionId(normalized);
  if (guessedId === undefined) {
    logMove(`Unknown region: ${rawInput}`, "bad");
    ui.status.textContent = "That region name was not found.";
    ui.status.className = "status bad";
    return;
  }

  if (state.visited.includes(guessedId)) {
    logMove("That region is already in your selected list.", "bad");
    ui.status.textContent = "Pick a region you have not already added.";
    ui.status.className = "status bad";
    return;
  }

  state.currentId = guessedId;
  state.visited.push(guessedId);
  ui.currentName.textContent = formatRegionName(state.byId.get(state.currentId));
  logMove(`Added ${formatRegionName(state.byId.get(guessedId))}`, "ok");
  ui.guessInput.value = "";

  const selectedPath = findShortestPath(
    state.startId,
    state.endId,
    new Set(state.visited)
  );

  if (selectedPath.length > 0) {
    finishGame(selectedPath);
  } else {
    ui.status.textContent = "Region added. Keep selecting regions to connect start and target.";
    ui.status.className = "status ok";
  }

  paintRegions();
}

function finishGame(selectedPath) {
  state.finished = true;
  const shortestPath = findShortestPath(state.startId, state.endId);
  const playerSteps = Math.max(0, selectedPath.length - 2);
  const shortestSteps = Math.max(0, shortestPath.length - 2);
  const extra = Math.max(0, playerSteps - shortestSteps);

  ui.status.textContent =
    extra === 0
      ? `Perfect! You reached the target in ${playerSteps} steps (optimal).`
      : `Finished in ${playerSteps} steps. Shortest possible is ${shortestSteps} (extra ${extra}).`;
  ui.status.className = "status ok";
}

function revealShortestPath() {
  if (state.startId === null || state.endId === null) {
    return;
  }

  const path = findShortestPath(state.startId, state.endId);
  if (path.length === 0) {
    ui.status.textContent = "No path found between selected regions.";
    ui.status.className = "status bad";
    return;
  }

  const names = path.map((id) => formatRegionName(state.byId.get(id))).join(" → ");
  logMove(`Shortest path: ${names}`, "ok");
}

function paintRegions() {
  for (const [regionId, layer] of state.layerById) {
    const region = state.byId.get(regionId);
    const isGuessed = state.visited.includes(regionId);
    const isAlwaysVisible = regionId === state.startId || regionId === state.endId;
    const isVisible = state.easyMode || isGuessed || isAlwaysVisible;

    layer.setStyle(isVisible ? defaultStyle : hiddenStyle);

    if (isGuessed) {
      layer.setStyle(visitedStyle);
    }
    if (regionId === state.startId) {
      layer.setStyle(startStyle);
    }
    if (regionId === state.endId) {
      layer.setStyle(targetStyle);
    }
    if (regionId === state.currentId) {
      layer.setStyle(currentStyle);
    }

    if (isGuessed) {
      if (!layer.getTooltip()) {
        layer.bindTooltip(formatRegionName(region));
      }
    } else if (layer.getTooltip()) {
      layer.unbindTooltip();
    }
  }
}

function logMove(text, className) {
  const item = document.createElement("li");
  item.textContent = text;
  item.className = className;
  ui.moveLog.appendChild(item);
}

function pickChallenge() {
  const ids = state.regions.map((region) => region.id);
  const attempts = 500;

  for (let index = 0; index < attempts; index += 1) {
    const startId = ids[Math.floor(Math.random() * ids.length)];
    const endId = ids[Math.floor(Math.random() * ids.length)];
    if (startId === endId) {
      continue;
    }

    const path = findShortestPath(startId, endId);
    if (path.length >= 4) {
      return { startId, endId };
    }
  }

  for (const startId of ids) {
    for (const endId of ids) {
      if (startId === endId) {
        continue;
      }
      const path = findShortestPath(startId, endId);
      if (path.length >= 2) {
        return { startId, endId };
      }
    }
  }

  return { startId: ids[0], endId: ids[0] };
}

function findShortestPath(startId, endId, allowedIds = null) {
  if (startId === endId) {
    return [startId];
  }

  if (allowedIds && (!allowedIds.has(startId) || !allowedIds.has(endId))) {
    return [];
  }

  const queue = [startId];
  const previous = new Map([[startId, null]]);
  let cursor = 0;

  while (cursor < queue.length) {
    const current = queue[cursor];
    cursor += 1;

    const neighbors = state.adjacency.get(current) || new Set();
    for (const next of neighbors) {
      if (allowedIds && !allowedIds.has(next)) {
        continue;
      }

      if (previous.has(next)) {
        continue;
      }

      previous.set(next, current);
      if (next === endId) {
        return reconstructPath(previous, endId);
      }
      queue.push(next);
    }
  }

  return [];
}

function reconstructPath(previous, endId) {
  const path = [];
  let current = endId;
  while (current !== null) {
    path.push(current);
    current = previous.get(current);
  }
  return path.reverse();
}

function buildAdjacency(regions) {
  const edgeToRegions = new Map();
  const adjacency = new Map();

  for (const region of regions) {
    adjacency.set(region.id, new Set());
  }

  for (const region of regions) {
    for (const ring of region.polygons) {
      if (!Array.isArray(ring) || ring.length < 2) {
        continue;
      }

      const ringLength = ring.length;
      for (let index = 0; index < ringLength; index += 1) {
        const a = ring[index];
        const b = ring[(index + 1) % ringLength];
        if (!isValidPoint(a) || !isValidPoint(b)) {
          continue;
        }

        const key = edgeKey(a, b);
        if (!edgeToRegions.has(key)) {
          edgeToRegions.set(key, new Set());
        }
        edgeToRegions.get(key).add(region.id);
      }
    }
  }

  for (const regionSet of edgeToRegions.values()) {
    const ids = [...regionSet];
    if (ids.length < 2) {
      continue;
    }

    for (let left = 0; left < ids.length; left += 1) {
      for (let right = left + 1; right < ids.length; right += 1) {
        adjacency.get(ids[left]).add(ids[right]);
        adjacency.get(ids[right]).add(ids[left]);
      }
    }
  }

  return adjacency;
}

function edgeKey(a, b) {
  const p1 = pointKey(a);
  const p2 = pointKey(b);
  return p1 < p2 ? `${p1}|${p2}` : `${p2}|${p1}`;
}

function pointKey(point) {
  const lon = Number(point[0]).toFixed(5);
  const lat = Number(point[1]).toFixed(5);
  return `${lon},${lat}`;
}

function isValidPoint(point) {
  return (
    Array.isArray(point) &&
    point.length >= 2 &&
    Number.isFinite(point[0]) &&
    Number.isFinite(point[1])
  );
}

function formatRegionName(region) {
  return `${region.name} (${region.nameEn})`;
}

function resolveRegionId(input) {
  const exactKey = input.toLocaleLowerCase();
  const exactMatchId = state.byName.get(exactKey);
  if (exactMatchId !== undefined) {
    return exactMatchId;
  }

  const query = normalizeForSearch(input);
  if (!query) {
    return undefined;
  }

  const matchingIds = new Set();

  for (const region of state.regions) {
    const aliases = [region.name, region.nameEn, formatRegionName(region)];
    const hasMatch = aliases.some((alias) =>
      normalizeForSearch(alias).includes(query)
    );

    if (hasMatch) {
      matchingIds.add(region.id);
      if (matchingIds.size > 1) {
        return undefined;
      }
    }
  }

  if (matchingIds.size === 1) {
    return [...matchingIds][0];
  }

  return undefined;
}

function normalizeForSearch(value) {
  return value
    .toLocaleLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function loadEasyModePreference() {
  const savedMode = localStorage.getItem(EASY_MODE_STORAGE_KEY);

  if (savedMode === "1" || savedMode === "0") {
    state.easyMode = savedMode === "1";
  } else {
    state.easyMode = Boolean(ui.easyModeToggle?.checked);
  }

  if (ui.easyModeToggle) {
    ui.easyModeToggle.checked = state.easyMode;
  }
}