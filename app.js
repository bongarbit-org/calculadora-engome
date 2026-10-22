import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { MATERIALS, BOM, DIM_KEYS } from "./bom.js";

const DIMS_STORAGE_KEY = "engome-dims-v1";
const CHECKLIST_STORAGE_KEY = "engome-checklist-v1";

function loadDims() {
  try {
    const raw = localStorage.getItem(DIMS_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* ignore */ }
  return null;
}
function saveDims(dims) {
  localStorage.setItem(DIMS_STORAGE_KEY, JSON.stringify(dims));
}

function fmt(n) {
  if (!isFinite(n)) return "—";
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 1, minimumFractionDigits: 0 });
}

/* Lengths above 1 m are shown in meters (2 decimals); below that, in mm. */
function formatLength(mm) {
  if (!isFinite(mm)) return "—";
  if (Math.abs(mm) >= 1000) {
    const meters = mm / 1000;
    return `${meters.toLocaleString("pt-BR", { maximumFractionDigits: 2, minimumFractionDigits: 0 })} m`;
  }
  return `${fmt(mm)} mm`;
}

/* First-fit-decreasing bin packing: how many stock bars are needed to cut a list of lengths. */
function binPack(lengths, stockLength) {
  const sorted = [...lengths].sort((a, b) => b - a);
  const bins = []; // remaining space per bin
  for (const len of sorted) {
    if (len > stockLength) {
      bins.push(0); // doesn't fit at all, counted as its own (oversized) bar
      continue;
    }
    let placed = false;
    for (let i = 0; i < bins.length; i++) {
      if (bins[i] >= len) {
        bins[i] -= len;
        placed = true;
        break;
      }
    }
    if (!placed) bins.push(stockLength - len);
  }
  return bins.length;
}

/* =========================================================================
 * Tabs
 * ========================================================================= */
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
  });
});

/* =========================================================================
 * Calculator
 * ========================================================================= */
const dimInputs = {};
DIM_KEYS.forEach((k) => { dimInputs[k] = document.getElementById(`dim-${k}`); });
const stockLengthInput = document.getElementById("stock-length");
const partsTableWrap = document.getElementById("parts-table-wrap");
const materialsTableWrap = document.getElementById("materials-table-wrap");
let currentUnit = "mm";

function getUnitFactorToMm() {
  return currentUnit === "cm" ? 10 : 1;
}

function readDimsInMm() {
  const factor = getUnitFactorToMm();
  const dims = {};
  let allFilled = true;
  DIM_KEYS.forEach((k) => {
    const raw = parseFloat(dimInputs[k].value);
    if (isNaN(raw)) allFilled = false;
    dims[k] = isNaN(raw) ? 0 : raw * factor;
  });
  return { dims, allFilled };
}

function renderCalculator() {
  const { dims, allFilled } = readDimsInMm();
  const stockLength = parseFloat(stockLengthInput.value) || 6000;

  if (!allFilled) {
    partsTableWrap.innerHTML = '<p class="empty-hint">Preencha todas as dimensões acima para calcular os cortes.</p>';
    materialsTableWrap.innerHTML = "";
    return;
  }

  // Parts table
  let rows = "";
  BOM.forEach((item) => {
    const lenMm = item.length(dims);
    rows += `<tr>
      <td>${item.label}</td>
      <td class="num">${item.qty}</td>
      <td class="num">${formatLength(lenMm)}</td>
      <td class="num">${formatLength(lenMm * item.qty)}</td>
    </tr>`;
  });
  partsTableWrap.innerHTML = `
    <table>
      <thead><tr><th>Peça</th><th class="num">Qtd.</th><th class="num">Comp. unitário</th><th class="num">Total</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;

  // Materials totals
  let matsHtml = "";
  Object.entries(MATERIALS).forEach(([matKey, matInfo]) => {
    const items = BOM.filter((i) => i.material === matKey);
    if (!items.length) return;
    const lengths = [];
    let total = 0;
    items.forEach((item) => {
      const lenMm = item.length(dims);
      for (let i = 0; i < item.qty; i++) lengths.push(lenMm);
      total += lenMm * item.qty;
    });
    const barsNeeded = binPack(lengths, stockLength);
    matsHtml += `
      <h3 class="material-group-title">${matInfo.label}</h3>
      <table>
        <thead><tr><th>Peça</th><th class="num">Qtd.</th><th class="num">Comp. unitário</th></tr></thead>
        <tbody>
          ${items.map((item) => `<tr><td>${item.label}</td><td class="num">${item.qty}</td><td class="num">${formatLength(item.length(dims))}</td></tr>`).join("")}
          <tr class="total-row"><td>Total de material</td><td class="num">${lengths.length} peça(s)</td><td class="num">${formatLength(total)}</td></tr>
          <tr><td colspan="3">≈ <strong>${barsNeeded}</strong> barra(s)/vergalhão(ões) de ${formatLength(stockLength)} necessária(s)</td></tr>
        </tbody>
      </table>`;
  });
  materialsTableWrap.innerHTML = matsHtml;

  // persist
  saveDims({ unit: currentUnit, values: DIM_KEYS.reduce((acc, k) => { acc[k] = dimInputs[k].value; return acc; }, {}), stockLength });

  updateChecklistHints(dims);
}

DIM_KEYS.forEach((k) => dimInputs[k].addEventListener("input", renderCalculator));
stockLengthInput.addEventListener("input", renderCalculator);
document.querySelectorAll('input[name="unit"]').forEach((radio) => {
  radio.addEventListener("change", (e) => {
    currentUnit = e.target.value;
    renderCalculator();
  });
});

// restore persisted dims
(function restoreDims() {
  const saved = loadDims();
  if (!saved) return;
  currentUnit = saved.unit || "mm";
  document.querySelector(`input[name="unit"][value="${currentUnit}"]`).checked = true;
  DIM_KEYS.forEach((k) => {
    if (saved.values && saved.values[k] !== undefined) dimInputs[k].value = saved.values[k];
  });
  if (saved.stockLength) stockLengthInput.value = saved.stockLength;
  renderCalculator();
})();

/* =========================================================================
 * Checklist
 * ========================================================================= */
// Expand BOM into individually-trackable pieces.
const CHECKLIST_GROUPS = BOM.map((item) => ({
  id: item.id,
  label: item.label,
  material: item.material,
  qty: item.qty,
  length: item.length,
}));

function loadChecklistState() {
  try {
    const raw = localStorage.getItem(CHECKLIST_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* ignore */ }
  return {};
}
let checklistState = loadChecklistState();
function saveChecklistState() {
  localStorage.setItem(CHECKLIST_STORAGE_KEY, JSON.stringify(checklistState));
}

const checklistGroupsWrap = document.getElementById("checklist-groups");
const progressFill = document.getElementById("progress-fill");
const progressText = document.getElementById("progress-text");

function pieceKey(groupId, index) {
  return `${groupId}__${index}`;
}

function renderChecklist() {
  let html = "";
  let totalPieces = 0;
  let donePieces = 0;

  CHECKLIST_GROUPS.forEach((group) => {
    let itemsHtml = "";
    for (let i = 0; i < group.qty; i++) {
      const key = pieceKey(group.id, i);
      const done = !!checklistState[key];
      totalPieces++;
      if (done) donePieces++;
      const pieceLabel = group.qty > 1 ? `${i + 1}` : "feito";
      itemsHtml += `<label class="checklist-item ${done ? "done" : ""}" data-key="${key}">
        <input type="checkbox" ${done ? "checked" : ""} />
        ${pieceLabel}
      </label>`;
    }
    html += `<div class="checklist-group">
      <h3>${group.label} <span class="count">${group.qty > 1 ? group.qty + " un." : ""}</span></h3>
      <div class="length-hint" data-hint-for="${group.id}"></div>
      <div class="checklist-items">${itemsHtml}</div>
    </div>`;
  });

  checklistGroupsWrap.innerHTML = html;
  checklistGroupsWrap.querySelectorAll(".checklist-item").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      const key = el.dataset.key;
      checklistState[key] = !checklistState[key];
      saveChecklistState();
      renderChecklist();
      const { dims, allFilled } = readDimsInMm();
      if (allFilled) updateChecklistHints(dims);
    });
  });

  progressFill.style.width = totalPieces ? `${(donePieces / totalPieces) * 100}%` : "0%";
  progressText.textContent = `${donePieces} / ${totalPieces} peças concluídas`;
}

function updateChecklistHints(dims) {
  CHECKLIST_GROUPS.forEach((group) => {
    const el = checklistGroupsWrap.querySelector(`[data-hint-for="${group.id}"]`);
    if (!el) return;
    const lenMm = group.length(dims);
    el.textContent = `comprimento de corte: ${formatLength(lenMm)} cada`;
  });
}

document.getElementById("reset-checklist").addEventListener("click", () => {
  if (!confirm("Reiniciar todo o progresso do checklist?")) return;
  checklistState = {};
  saveChecklistState();
  renderChecklist();
});

renderChecklist();

/* =========================================================================
 * 3D Viewer
 * ========================================================================= */
const GROUP_LABELS = {
  bojo: "Bojo (casco de madeira)",
  arquilha_externa: "Arquilha externa de sustentação do bojo",
  arquilha_interna: "Arquilha interna de sustentação do bojo",
  aro_cima: "Aro de cima",
  suporte: "Suportes para o bojo no aro de baixo",
  aro_baixo: "Aro de baixo",
  orelha: "Orelhas furadas",
  esticador: "Esticadores",
  arquilha_couro: "Arquilha do couro",
  base_circular: "Base circular",
  pe: "Pés",
  bojo_aro_topo: "Aba superior do bojo (madeira)",
};
const GROUP_QTY = { bojo: 1, arquilha_externa: 1, arquilha_interna: 1, aro_cima: 1, suporte: 3, aro_baixo: 1, orelha: 15, esticador: 6, arquilha_couro: 1, base_circular: 1, pe: 3, bojo_aro_topo: 1 };
const WOOD_GROUPS = new Set(["bojo", "bojo_aro_topo"]);

const canvasWrap = document.getElementById("viewer-canvas");
const partLabelEl = document.getElementById("part-label");
const partsListEl = document.getElementById("parts-list");
const woodToggle = document.getElementById("toggle-wood");

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
canvasWrap.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x11151a);

const camera = new THREE.PerspectiveCamera(45, 1, 1, 10000);
camera.position.set(1200, 900, 1400);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 300, 0);

scene.add(new THREE.AmbientLight(0xffffff, 0.55));
const key = new THREE.DirectionalLight(0xffffff, 1.1);
key.position.set(600, 900, 700);
scene.add(key);
const fill = new THREE.DirectionalLight(0xffffff, 0.5);
fill.position.set(-700, 400, -500);
scene.add(fill);
const rim = new THREE.DirectionalLight(0xffffff, 0.4);
rim.position.set(0, -400, -800);
scene.add(rim);

const modelRoot = new THREE.Group();
// Source STEP data is Z-up; rotate to three.js's Y-up convention.
modelRoot.rotation.x = -Math.PI / 2;
scene.add(modelRoot);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let hoverMesh = null;
let selectedGroup = null;
const meshesByGroup = {};
const originalMaterials = new Map();

const highlightColor = new THREE.Color(0xffb703);

function resizeRenderer() {
  const w = canvasWrap.clientWidth;
  const h = canvasWrap.clientHeight;
  if (w === 0 || h === 0) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resizeRenderer);

function setMeshHighlight(mesh, on) {
  if (!mesh.material) return;
  if (on) {
    if (!originalMaterials.has(mesh)) originalMaterials.set(mesh, mesh.material);
    if (!mesh.userData.__highlightMat) {
      mesh.userData.__highlightMat = mesh.material.clone();
      mesh.userData.__highlightMat.emissive = highlightColor;
      mesh.userData.__highlightMat.emissiveIntensity = 0.55;
    }
    mesh.material = mesh.userData.__highlightMat;
  } else {
    if (originalMaterials.has(mesh)) mesh.material = originalMaterials.get(mesh);
  }
}

function clearSelection() {
  if (selectedGroup && meshesByGroup[selectedGroup]) {
    meshesByGroup[selectedGroup].forEach((m) => setMeshHighlight(m, false));
  }
  selectedGroup = null;
  partLabelEl.classList.add("hidden");
  partsListEl.querySelectorAll("li").forEach((li) => li.classList.remove("active"));
}

function selectGroup(group, opts = {}) {
  clearSelection();
  selectedGroup = group;
  (meshesByGroup[group] || []).forEach((m) => setMeshHighlight(m, true));
  const label = GROUP_LABELS[group] || group;
  const qty = GROUP_QTY[group] || 1;
  partLabelEl.textContent = qty > 1 ? `${label} (${qty} peças)` : label;
  partLabelEl.classList.remove("hidden");
  const li = partsListEl.querySelector(`li[data-group="${group}"]`);
  if (li) {
    li.classList.add("active");
    if (opts.scrollIntoView) li.scrollIntoView({ block: "nearest" });
  }
}

function buildPartsList(metadata) {
  // group order: follow first-seen order in metadata / BOM-ish priority
  const order = ["bojo", "arquilha_externa", "arquilha_interna", "aro_cima", "aro_baixo", "suporte", "orelha", "esticador", "arquilha_couro", "base_circular", "pe", "bojo_aro_topo"];
  const groupColor = {};
  Object.values(metadata).forEach((info) => {
    if (!(info.group in groupColor)) groupColor[info.group] = colorForGroup(info.group);
  });

  let html = "";
  order.forEach((group) => {
    if (!meshesByGroup[group]) return;
    const label = GROUP_LABELS[group] || group;
    const qty = GROUP_QTY[group] || 1;
    html += `<li data-group="${group}">
      <span class="swatch" style="background:${groupColor[group]}"></span>
      <span>${label}</span>
      <span class="qty">${qty > 1 ? qty + "x" : ""}</span>
    </li>`;
  });
  partsListEl.innerHTML = html;
  partsListEl.querySelectorAll("li").forEach((li) => {
    li.addEventListener("click", () => selectGroup(li.dataset.group));
    li.addEventListener("mouseenter", () => {
      (meshesByGroup[li.dataset.group] || []).forEach((m) => setMeshHighlight(m, true));
    });
    li.addEventListener("mouseleave", () => {
      if (selectedGroup === li.dataset.group) return;
      (meshesByGroup[li.dataset.group] || []).forEach((m) => setMeshHighlight(m, false));
    });
  });
}

function colorForGroup(group) {
  const colors = {
    wood: "#8a6240", chata: "#b0b4b8", cantoneira: "#6f7a86",
    varao14: "#d7b25c", varao12: "#8fae6b", esticador: "#5c9ec9", pe: "#c96b5c",
  };
  // map GROUP (semantic) to material-group used at export time
  const semanticToExportGroup = {
    bojo: "wood", bojo_aro_topo: "wood",
    arquilha_externa: "chata", arquilha_interna: "chata", aro_cima: "chata", aro_baixo: "chata", suporte: "chata",
    orelha: "cantoneira", arquilha_couro: "varao14", base_circular: "varao12",
    esticador: "esticador", pe: "pe",
  };
  return colors[semanticToExportGroup[group]] || "#cccccc";
}

async function loadModel() {
  const [gltf, metadata] = await Promise.all([
    new GLTFLoader().loadAsync("assets/engome.glb"),
    fetch("assets/engome-parts.json").then((r) => r.json()),
  ]);

  gltf.scene.traverse((obj) => {
    if (!obj.isMesh) return;
    const info = metadata[obj.name];
    if (!info) return;
    obj.userData.info = info;
    const group = info.group;
    // remap export-time group -> semantic list group for esticador/pe (already same key)
    let semanticGroup = group;
    if (info.key.startsWith("suporte")) semanticGroup = "suporte";
    else if (info.key.startsWith("orelha")) semanticGroup = "orelha";
    else if (info.key.startsWith("esticador")) semanticGroup = "esticador";
    else if (info.key.startsWith("pe_")) semanticGroup = "pe";
    else semanticGroup = info.key;

    obj.userData.semanticGroup = semanticGroup;
    if (!meshesByGroup[semanticGroup]) meshesByGroup[semanticGroup] = [];
    meshesByGroup[semanticGroup].push(obj);
  });

  modelRoot.add(gltf.scene);
  buildPartsList(metadata);
  fitCameraToObject(modelRoot);
  applyWoodVisibility();
}

function fitCameraToObject(object) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const fitDist = maxDim / (2 * Math.tan((Math.PI * camera.fov) / 360)) * 1.5;
  camera.position.set(center.x + fitDist * 0.7, center.y + fitDist * 0.5, center.z + fitDist * 0.7);
  controls.target.copy(center);
  controls.update();
}

function applyWoodVisibility() {
  const show = woodToggle.checked;
  ["bojo", "bojo_aro_topo"].forEach((g) => {
    (meshesByGroup[g] || []).forEach((m) => { m.visible = show; });
  });
}
woodToggle.addEventListener("change", applyWoodVisibility);

renderer.domElement.addEventListener("pointermove", (e) => {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
});

renderer.domElement.addEventListener("click", (e) => {
  raycaster.setFromCamera(pointer, camera);
  const intersects = raycaster.intersectObjects(modelRoot.children, true).filter((i) => i.object.visible);
  if (intersects.length === 0) {
    clearSelection();
    return;
  }
  const mesh = intersects[0].object;
  const group = mesh.userData.semanticGroup;
  if (!group) return;
  selectGroup(group, { scrollIntoView: true });
});

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

resizeRenderer();
loadModel().then(animate).catch((err) => {
  console.error("Falha ao carregar modelo 3D:", err);
  canvasWrap.innerHTML = `<p style="padding:1rem;color:#c96b5c">Não foi possível carregar o modelo 3D (assets/engome.glb). Detalhe: ${err.message}</p>`;
});
new ResizeObserver(resizeRenderer).observe(canvasWrap);
