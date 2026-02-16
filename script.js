// script.js — supports new verbs.json schema where the same verb text can appear multiple times,
// AND also supports verbs appearing across multiple Bloom levels via stemsByLevel / levelGuidance keys.
// (No JSON changes required.)

let RAW = null; // loaded verbs.json (new schema)
let APP = null; // adapted view-model used by the UI

// -------------------- Utilities --------------------
function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function slugify(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function clearResults() {
  $("#resultsArea").empty();
}

function showInfo(message) {
  $("#resultsArea").html(`<div class="alert alert-info">${escapeHtml(message)}</div>`);
}

function showError(message) {
  $("#resultsArea").html(`<div class="alert alert-danger">${escapeHtml(message)}</div>`);
}

function defaultBloomColors() {
  return {
    remember: "#0d6efd",
    understand: "#198754",
    apply: "#20c997",
    analyse: "#6f42c1",
    evaluate: "#fd7e14",
    create: "#dc3545",
  };
}

// -------------------- Adapter: NEW schema -> UI model --------------------
// Key behaviour change:
// A verb entry will be shown under ANY level referenced by:
// - primaryLevelId
// - alsoFitsLevelIds
// - stemsByLevel keys
// - levelGuidance keys
function adaptNewSchema(raw) {
  const bloom = raw?.taxonomies?.bloom;
  if (!bloom?.levels?.length) throw new Error("Missing taxonomies.bloom.levels[]");
  const colorMap = defaultBloomColors();

  const bloomLevels = bloom.levels
    .slice()
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
    .map((lvl) => ({
      id: lvl.id,
      name: lvl.label || lvl.id,
      order: lvl.order ?? 999,
      color: colorMap[lvl.id] || "#6c757d",
      description: lvl.shortDefinition || "",
      prompts: lvl.prompts || [],
      guardrails: lvl.verbGuardrails || null,
    }));

  const levelIdToName = new Map(bloomLevels.map((l) => [l.id, l.name]));
  const levelNameToMeta = new Map(bloomLevels.map((l) => [l.name, l]));
  const knownLevelIds = new Set(bloomLevels.map((l) => l.id));

  const assessmentFormats = (raw.assessmentFormats || []).map((f) => ({
    id: f.id,
    name: f.label || f.id,
    category: f.category,
    typicalEvidence: f.typicalEvidence || [],
    scalability: f.scalability || null,
    aiRisk: f.aiRisk || null,
  }));
  const formatIdToName = new Map(assessmentFormats.map((f) => [f.id, f.name]));

  const verbs = (raw.verbs || []).map((v, idx) => {
    const id = v.id || `${slugify(v.primaryLevelId)}-${slugify(v.verb)}-${idx}`;

    const stemsLevelIds =
      v.stemsByLevel && typeof v.stemsByLevel === "object" ? Object.keys(v.stemsByLevel) : [];
    const guidanceLevelIds =
      v.levelGuidance && typeof v.levelGuidance === "object" ? Object.keys(v.levelGuidance) : [];

    // Expand membership across levels from stems/guidance
    const levelIds = Array.from(
      new Set(
        [
          v.primaryLevelId,
          ...(Array.isArray(v.alsoFitsLevelIds) ? v.alsoFitsLevelIds : []),
          ...stemsLevelIds,
          ...guidanceLevelIds,
        ].filter(Boolean)
      )
    )
      // Optional safety: only keep ids that exist in taxonomy
      .filter((lvlId) => knownLevelIds.has(lvlId));

    const levels = levelIds.map((lvlId) => levelIdToName.get(lvlId) || lvlId);

    const formatMappings = Array.isArray(v.formatMappings) ? v.formatMappings : [];
    const assessmentFormatIds = formatMappings
      .map((m) => m.assessmentFormatId)
      .filter(Boolean);

    return {
      id,
      verb: v.verb,
      taxonomyId: v.taxonomyId || "bloom-revised",

      primaryLevelId: v.primaryLevelId,
      alsoFitsLevelIds: Array.isArray(v.alsoFitsLevelIds) ? v.alsoFitsLevelIds : [],
      levelIds,
      levels, // display names for UI

      meaning: v.meaning || null,
      synonyms: Array.isArray(v.synonyms) ? v.synonyms : [],
      searchKeywords: Array.isArray(v.searchKeywords) ? v.searchKeywords : [],

      stemsByLevel: v.stemsByLevel || null,
      levelGuidance: v.levelGuidance || null,
      diagnosticStrength: v.diagnosticStrength || null,

      taskIdeas: Array.isArray(v.taskIdeas) ? v.taskIdeas : [],
      tags: v.tags || null,

      assessmentFormatIds,
      formatMappings: formatMappings.map((m) => ({
        assessmentFormatId: m.assessmentFormatId,
        formatName: formatIdToName.get(m.assessmentFormatId) || m.assessmentFormatId,
        suitability: m.suitability || "medium",
        rationale: m.rationale || "",
        designNotes: Array.isArray(m.designNotes) ? m.designNotes : [],
      })),
    };
  });

  return {
    disclaimer: raw?.meta?.disclaimer || "",
    bloomLevels,
    levelIdToName,
    levelNameToMeta,
    assessmentFormats,
    formatIdToName,
    verbs,
  };
}

// -------------------- Lookup helpers (ID-first) --------------------
function getVerbById(id) {
  return APP.verbs.find((v) => v.id === id) || null;
}

function getVerbMatchesByText(query) {
  const q = (query || "").trim().toLowerCase();
  if (!q) return [];
  return APP.verbs.filter((v) => (v.verb || "").toLowerCase() === q);
}

function byBloomOrder(levelName) {
  const meta = APP.levelNameToMeta.get(levelName);
  return meta ? meta.order : 999;
}

function getLevelMetaById(levelId) {
  return APP.bloomLevels.find((l) => l.id === levelId) || null;
}

function formatNamesFromIds(ids) {
  const idSet = new Set(ids || []);
  return APP.assessmentFormats
    .filter((f) => idSet.has(f.id))
    .map((f) => f.name);
}

function renderLevelPills(levelNames) {
  const all = [...APP.bloomLevels].sort((a, b) => a.order - b.order);
  const active = new Set(levelNames || []);

  return all
    .map((lvl) => {
      const isActive = active.has(lvl.name);
      const color = isActive ? lvl.color : "#C0C0C0";
      const disabled = isActive ? "" : "disabled";
      return `
        <button class="btn btn-sm me-2 mb-2" style="background-color:${color}; color:#fff" ${disabled}
          title="${escapeHtml(lvl.description || "")}">
          ${escapeHtml(lvl.name)}
        </button>
      `;
    })
    .join("");
}

// -------------------- Mode control --------------------
function setMode(mode) {
  // mode: "start" | "lo" | "assessment"
  const startChoice = $("#startChoice");
  const workflowArea = $("#workflowArea");
  const loFlow = $("#loFlow");
  const assessmentFlow = $("#assessmentFlow");
  const backBtn = $("#backBtn");

  if (mode === "start") {
    startChoice.removeClass("d-none");
    workflowArea.addClass("d-none");
    clearResults();
  } else {
    startChoice.addClass("d-none");
    workflowArea.removeClass("d-none");
    loFlow.addClass("d-none");
    assessmentFlow.addClass("d-none");

    if (mode === "lo") {
      loFlow.removeClass("d-none");
      $("#verbSearch").focus();
      showInfo(
        "Type/select a verb (or click one on the left) to see meaning, Bloom level(s), LO stems, task ideas, and commonly suitable assessment formats."
      );
    }

    if (mode === "assessment") {
      assessmentFlow.removeClass("d-none");
      showInfo("Choose an assessment format to see verb entries grouped by Bloom level. Click a verb for details.");
    }

    backBtn.off("click").on("click", () => setMode("start"));
  }
}

// -------------------- Verb selection --------------------
function selectVerbById(verbId, { switchToLO = true, selectedLevelId = null } = {}) {
  const v = getVerbById(verbId);
  if (!v) {
    showInfo("That verb entry could not be found.");
    return;
  }
  if (switchToLO) setMode("lo");

  $("#verbSearch").val(v.verb);
  renderVerbDetails(v, { selectedLevelId });

  try {
    document.getElementById("resultsArea")?.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) {}
}

function renderVerbChoiceList(matches) {
  const rows = matches
    .slice()
    .sort((a, b) => (byBloomOrder(a.levels?.[0] || "") - byBloomOrder(b.levels?.[0] || "")))
    .map((v) => {
      const primaryMeta = getLevelMetaById(v.primaryLevelId);
      const label = primaryMeta ? primaryMeta.name : (v.levels?.[0] || v.primaryLevelId || "—");
      return `
        <button class="list-group-item list-group-item-action verb-choice"
          data-verb-id="${escapeHtml(v.id)}"
          data-level-id="${escapeHtml(v.primaryLevelId || "")}">
          <strong>${escapeHtml(v.verb)}</strong>
          <span class="text-muted">— ${escapeHtml(label)}</span>
          ${
            v.diagnosticStrength
              ? `<span class="badge bg-light text-dark ms-2">${escapeHtml(v.diagnosticStrength)}</span>`
              : ""
          }
        </button>
      `;
    })
    .join("");

  $("#resultsArea").html(`
    <div class="alert alert-warning">
      Multiple entries found for that verb (it can legitimately sit at different Bloom levels).
      Choose the one you mean:
    </div>
    <div class="list-group mb-3">
      ${rows}
    </div>
  `);

  $(".verb-choice").on("click", function () {
    const id = String($(this).data("verb-id") || "");
    const levelId = String($(this).data("level-id") || "");
    selectVerbById(id, { switchToLO: false, selectedLevelId: levelId || null });
  });
}

// -------------------- Bloom hierarchy (always visible) --------------------
function renderBloomHierarchy() {
  const accordionId = "bloomAccordion";

  // Build levelId -> verb entries
  const groupsByLevelId = new Map();
  for (const lvl of APP.bloomLevels) groupsByLevelId.set(lvl.id, []);

  // IMPORTANT: use expanded v.levelIds (includes stemsByLevel/levelGuidance keys)
  for (const v of APP.verbs) {
    const ids = new Set((v.levelIds || []).filter(Boolean));
    for (const lvlId of ids) {
      if (!groupsByLevelId.has(lvlId)) groupsByLevelId.set(lvlId, []);
      groupsByLevelId.get(lvlId).push(v);
    }
  }

  // Sort each group by verb text, keep duplicates as distinct entries
  for (const [lvlId, arr] of groupsByLevelId.entries()) {
    arr.sort((a, b) => (a.verb || "").localeCompare(b.verb || ""));
  }

  const items = [...APP.bloomLevels]
    .sort((a, b) => a.order - b.order)
    .map((lvl, idx) => {
      const verbEntries = groupsByLevelId.get(lvl.id) || [];

      const verbButtons = verbEntries.length
        ? verbEntries
            .map((v) => {
              const tip = [
                v.meaning?.short ? v.meaning.short : "",
                v.diagnosticStrength ? `Strength: ${v.diagnosticStrength}` : "",
              ]
                .filter(Boolean)
                .join(" • ");

              return `
                <button class="btn btn-sm btn-outline-secondary me-2 mb-2 nav-verb"
                  data-verb-id="${escapeHtml(v.id)}"
                  data-level-id="${escapeHtml(lvl.id)}"
                  title="${escapeHtml(tip || "Click to view details")}"
                >
                  ${escapeHtml(v.verb)}
                </button>
              `;
            })
            .join("")
        : `<div class="text-muted small">No verb entries mapped for this level yet.</div>`;

      return `
        <div class="accordion-item">
          <h2 class="accordion-header" id="b-h-${idx}">
            <button class="accordion-button ${idx === 0 ? "" : "collapsed"}" type="button" data-bs-toggle="collapse"
              data-bs-target="#b-c-${idx}" aria-expanded="${idx === 0 ? "true" : "false"}" aria-controls="b-c-${idx}">
              <span class="badge me-2" style="background:${lvl.color}; color:#fff">${escapeHtml(lvl.name)}</span>
              <span class="text-muted">${escapeHtml(lvl.description || "")}</span>
            </button>
          </h2>
          <div id="b-c-${idx}" class="accordion-collapse collapse ${idx === 0 ? "show" : ""}"
            aria-labelledby="b-h-${idx}" data-bs-parent="#${accordionId}">
            <div class="accordion-body">
              ${verbButtons}
            </div>
          </div>
        </div>
      `;
    })
    .join("");

  $("#" + accordionId).html(items);

  $(".nav-verb")
    .off("click")
    .on("click", function () {
      const verbId = String($(this).data("verb-id") || "");
      const levelId = String($(this).data("level-id") || "");
      selectVerbById(verbId, { switchToLO: true, selectedLevelId: levelId || null });
    });

  $("#collapseAll")
    .off("click")
    .on("click", function () {
      $("#" + accordionId + " .accordion-collapse.show").each(function () {
        const bsCollapse = bootstrap.Collapse.getOrCreateInstance(this, { toggle: false });
        bsCollapse.hide();
      });
    });
}

// -------------------- Verb detail renderer --------------------
function renderVerbDetails(verbObj, { selectedLevelId = null } = {}) {
  if (!verbObj) return;

  const levelNames = [...(verbObj.levels || [])].sort((a, b) => byBloomOrder(a) - byBloomOrder(b));
  const formatsSimple = formatNamesFromIds(verbObj.assessmentFormatIds || []);

  // Prefer stemsByLevel for the clicked level, then primaryLevelId, then first available stems bucket
  let stems = [];
  if (verbObj.stemsByLevel && selectedLevelId && verbObj.stemsByLevel[selectedLevelId]) {
    stems = verbObj.stemsByLevel[selectedLevelId];
  } else if (verbObj.stemsByLevel && verbObj.primaryLevelId && verbObj.stemsByLevel[verbObj.primaryLevelId]) {
    stems = verbObj.stemsByLevel[verbObj.primaryLevelId];
  } else if (verbObj.stemsByLevel && typeof verbObj.stemsByLevel === "object") {
    const firstKey = Object.keys(verbObj.stemsByLevel)[0];
    if (firstKey && Array.isArray(verbObj.stemsByLevel[firstKey])) stems = verbObj.stemsByLevel[firstKey];
  }

  // Prefer levelGuidance for the clicked level, then primaryLevelId, then any
  let guidance = "";
  if (verbObj.levelGuidance && selectedLevelId && verbObj.levelGuidance[selectedLevelId]) {
    guidance = verbObj.levelGuidance[selectedLevelId];
  } else if (verbObj.levelGuidance && verbObj.primaryLevelId && verbObj.levelGuidance[verbObj.primaryLevelId]) {
    guidance = verbObj.levelGuidance[verbObj.primaryLevelId];
  } else if (verbObj.levelGuidance && typeof verbObj.levelGuidance === "object") {
    const firstKey = Object.keys(verbObj.levelGuidance)[0];
    if (firstKey && typeof verbObj.levelGuidance[firstKey] === "string") guidance = verbObj.levelGuidance[firstKey];
  }

  const guidanceHtml = guidance
    ? `<div class="alert alert-secondary small mb-3"><strong>Level guidance:</strong> ${escapeHtml(guidance)}</div>`
    : "";

  const strengthHtml = verbObj.diagnosticStrength
    ? `<div class="mb-2"><span class="badge bg-light text-dark">Strength: ${escapeHtml(verbObj.diagnosticStrength)}</span></div>`
    : "";

  const meaningHtml =
    verbObj.meaning?.short || verbObj.meaning?.expanded
      ? `<div class="card mb-3">
          <div class="card-header">What this verb means</div>
          <div class="card-body">
            ${verbObj.meaning?.short ? `<div class="mb-2"><strong>${escapeHtml(verbObj.meaning.short)}</strong></div>` : ""}
            ${verbObj.meaning?.expanded ? `<div class="text-muted">${escapeHtml(verbObj.meaning.expanded)}</div>` : ""}
          </div>
        </div>`
      : "";

  const synonymsHtml =
    (verbObj.synonyms || []).length
      ? `<div class="card mb-3">
          <div class="card-header">Related verbs (synonyms)</div>
          <div class="card-body">
            ${(verbObj.synonyms || []).map((s) => `<span class="badge bg-light text-dark me-2 mb-2">${escapeHtml(s)}</span>`).join("")}
          </div>
        </div>`
      : "";

  const stemsHtml =
    stems.length
      ? `<div class="card mb-3">
          <div class="card-header">Example LO stems</div>
          <div class="card-body">
            <ul class="list-group list-group-flush">
              ${stems.map((s) => `<li class="list-group-item">${escapeHtml(s)}</li>`).join("")}
            </ul>
          </div>
        </div>`
      : `<div class="card mb-3">
          <div class="card-header">Example LO stems</div>
          <div class="card-body text-muted">
            No stems added yet for this level. (This is where enrichment will have the most impact.)
          </div>
        </div>`;

  const tasksHtml =
    (verbObj.taskIdeas || []).length
      ? `<div class="card mb-3">
          <div class="card-header">Task ideas</div>
          <div class="card-body">
            <ul class="list-group list-group-flush">
              ${verbObj.taskIdeas
                .map((t) => {
                  const title = t.title ? `<strong>${escapeHtml(t.title)}</strong>` : "";
                  const desc = t.description ? `<div class="text-muted">${escapeHtml(t.description)}</div>` : "";
                  const ev =
                    Array.isArray(t.evidenceProduced) && t.evidenceProduced.length
                      ? `<div class="small mt-2"><em>Evidence:</em> ${t.evidenceProduced.map(escapeHtml).join(", ")}</div>`
                      : "";
                  return `<li class="list-group-item">${title}${desc}${ev}</li>`;
                })
                .join("")}
            </ul>
          </div>
        </div>`
      : "";

  const mappingRows =
    (verbObj.formatMappings || []).length
      ? verbObj.formatMappings
          .slice()
          .sort((a, b) => {
            const rank = { high: 0, "context-dependent": 1, medium: 2, low: 3 };
            return (rank[a.suitability] ?? 9) - (rank[b.suitability] ?? 9);
          })
          .map((m) => {
            const notes = (m.designNotes || []).length
              ? `<ul class="mb-0">${m.designNotes.map((n) => `<li>${escapeHtml(n)}</li>`).join("")}</ul>`
              : `<span class="text-muted">—</span>`;
            return `
              <tr>
                <td><strong>${escapeHtml(m.formatName)}</strong></td>
                <td>${escapeHtml(m.suitability)}</td>
                <td>${escapeHtml(m.rationale || "")}</td>
                <td>${notes}</td>
              </tr>
            `;
          })
          .join("")
      : "";

  const formatsHtml =
    (verbObj.formatMappings || []).length
      ? `<div class="card mb-3">
          <div class="card-header">Commonly suitable assessment formats</div>
          <div class="card-body">
            <div class="table-responsive">
              <table class="table table-sm align-middle">
                <thead>
                  <tr>
                    <th>Format</th>
                    <th>Suitability</th>
                    <th>Rationale</th>
                    <th>Design notes</th>
                  </tr>
                </thead>
                <tbody>${mappingRows}</tbody>
              </table>
            </div>
            <div class="text-muted small mt-2">${escapeHtml(APP.disclaimer || "")}</div>
          </div>
        </div>`
      : `<div class="card mb-3">
          <div class="card-header">Commonly suitable assessment formats</div>
          <div class="card-body">
            ${
              formatsSimple.length
                ? `<ul class="list-group list-group-flush">${formatsSimple
                    .map((n) => `<li class="list-group-item">${escapeHtml(n)}</li>`)
                    .join("")}</ul>`
                : `<div class="text-muted">No formats mapped yet for this verb entry.</div>`
            }
            <div class="text-muted small mt-2">${escapeHtml(APP.disclaimer || "")}</div>
          </div>
        </div>`;

  $("#resultsArea").html(`
    <div class="text-center mb-3">
      <h2 class="h4 mb-2">${escapeHtml(verbObj.verb)}</h2>
      ${strengthHtml}
      <div>${renderLevelPills(levelNames)}</div>
    </div>

    <div class="row g-3">
      <div class="col-12 col-lg-6">
        ${formatsHtml}
      </div>
      <div class="col-12 col-lg-6">
        ${guidanceHtml}
        ${meaningHtml}
        ${synonymsHtml}
        ${stemsHtml}
        ${tasksHtml}
      </div>
    </div>
  `);
}

// -------------------- Assessment-first view --------------------
function renderVerbsForAssessment(formatId) {
  clearResults();

  if (!formatId) {
    showInfo("Choose an assessment format to see verb entries grouped by Bloom level.");
    return;
  }

  const matching = APP.verbs.filter((v) => (v.assessmentFormatIds || []).includes(formatId));

  if (!matching.length) {
    showInfo("No verbs mapped to that assessment format yet.");
    return;
  }

  // Group by levelId using expanded v.levelIds
  const groupsByLevelId = new Map();
  for (const lvl of APP.bloomLevels) groupsByLevelId.set(lvl.id, []);

  for (const v of matching) {
    const ids = new Set((v.levelIds || []).filter(Boolean));
    for (const lvlId of ids) {
      if (!groupsByLevelId.has(lvlId)) groupsByLevelId.set(lvlId, []);
      groupsByLevelId.get(lvlId).push(v);
    }
  }

  for (const [lvlId, arr] of groupsByLevelId.entries()) {
    arr.sort((a, b) => (a.verb || "").localeCompare(b.verb || ""));
  }

  const accordionId = "verbsAccordion";

  const items = [...APP.bloomLevels]
    .sort((a, b) => a.order - b.order)
    .map((lvl, idx) => {
      const verbsHere = groupsByLevelId.get(lvl.id) || [];
      if (!verbsHere.length) return "";

      const pills = verbsHere
        .map(
          (v) => `
          <button class="btn btn-sm btn-outline-secondary me-2 mb-2 verb-pill"
            data-verb-id="${escapeHtml(v.id)}"
            data-level-id="${escapeHtml(lvl.id)}"
            title="${escapeHtml(v.meaning?.short || "Click for details")}"
          >
            ${escapeHtml(v.verb)}
          </button>
        `
        )
        .join("");

      return `
        <div class="accordion-item">
          <h2 class="accordion-header" id="h-${idx}">
            <button class="accordion-button ${idx === 0 ? "" : "collapsed"}" type="button" data-bs-toggle="collapse"
              data-bs-target="#c-${idx}" aria-expanded="${idx === 0 ? "true" : "false"}" aria-controls="c-${idx}">
              <span class="badge me-2" style="background:${lvl.color}; color:#fff">${escapeHtml(lvl.name)}</span>
              <span class="text-muted">${escapeHtml(lvl.description || "")}</span>
            </button>
          </h2>
          <div id="c-${idx}" class="accordion-collapse collapse ${idx === 0 ? "show" : ""}" aria-labelledby="h-${idx}" data-bs-parent="#${accordionId}">
            <div class="accordion-body">
              ${pills}
            </div>
          </div>
        </div>
      `;
    })
    .join("");

  $("#resultsArea").html(`
    <div class="mb-3">
      <div class="alert alert-secondary mb-3">${escapeHtml(APP.disclaimer || "")}</div>
      <div class="accordion" id="${accordionId}">
        ${items}
      </div>
    </div>
  `);

  $(".verb-pill").on("click", function () {
    const verbId = String($(this).data("verb-id") || "");
    const levelId = String($(this).data("level-id") || "");
    selectVerbById(verbId, { switchToLO: false, selectedLevelId: levelId || null });
  });
}

// -------------------- NFQ Guidance (Standalone) --------------------
const NFQ_TIPS = {
  "6": {
    title: "NFQ Level 6 (Higher Certificate / Advanced Certificate)",
    focus: ["Understand", "Apply (straightforward contexts)"],
    characteristics: [
      "Build confidence with core concepts and routines.",
      "Use clear, observable outcomes with concrete contexts.",
      "Assessment should prioritise correct application of taught methods.",
    ],
    tips: [
      "Use verbs like: describe, explain, outline, apply, demonstrate, use.",
      "Keep criteria explicit: what ‘good’ looks like in the procedure/answer.",
      "Use worked examples and practice → then assess similar-but-not-identical tasks.",
      "Avoid overstating outcomes (e.g., ‘critically evaluate’) unless the module truly supports it.",
    ],
  },
  "7": {
    title: "NFQ Level 7 (Ordinary Bachelor Degree)",
    focus: ["Apply", "Analyse (supported)"],
    characteristics: [
      "Move beyond routine application into selecting and using appropriate methods.",
      "Introduce analysis of scenarios, trade-offs, and constraints.",
      "Assessment can start to require justification (lightweight criteria).",
    ],
    tips: [
      "Use verbs like: apply, implement, analyse, compare, examine, interpret.",
      "Ask for brief justification: ‘why this method/approach?’",
      "Use case-based tasks with structured prompts (criteria tables help).",
      "Design rubrics that reward reasoning, not just the final answer.",
    ],
  },
  "8": {
    title: "NFQ Level 8 (Honours Bachelor Degree / Higher Diploma)",
    focus: ["Analyse", "Evaluate (with criteria)", "Create (bounded)"],
    characteristics: [
      "Students should analyse complex material and justify decisions using evidence.",
      "Evaluation becomes more explicit: judgement using criteria.",
      "Creation can appear as design within constraints (requirements, standards, users).",
    ],
    tips: [
      "Use verbs like: analyse, evaluate, justify, synthesise, design, develop.",
      "Make ‘criteria’ visible: require learners to state and apply evaluation criteria.",
      "Use authenticity: projects, case studies, portfolios with reflective commentary.",
      "Avoid ‘create’ tasks that are just template filling—include constraints and originality.",
    ],
  },
  "9": {
    title: "NFQ Level 9 (Master’s / Postgraduate Diploma)",
    focus: ["Analyse", "Evaluate", "Create"],
    characteristics: [
      "Emphasis on critical analysis of complex information and datasets.",
      "Evaluation & synthesis: critique, judge, defend complex theories or produce original work.",
      "Advanced application in new/unfamiliar contexts (often managing complexity/projects).",
    ],
    tips: [
      "Write outcomes that require justification using explicit criteria and evidence.",
      "Build in synthesis: integrate multiple sources/perspectives into a defensible position.",
      "Design assessment that demonstrates originality (e.g., novel analysis, design decisions, research-informed artefact).",
      "Use mechanisms like milestones, viva-style questioning, or process evidence to validate authorship and thinking.",
      "Avoid outcomes that sit mainly at ‘remember/understand’ unless they are prerequisites and clearly framed as such.",
    ],
  },
};

function renderNfqTips(level) {
  const target = document.getElementById("nfqTipsArea");
  if (!target) return;

  if (!level || !NFQ_TIPS[level]) {
    target.innerHTML = `<div class="text-muted small">Select a level above to see guidance.</div>`;
    return;
  }

  const data = NFQ_TIPS[level];

  const focusBadges = (data.focus || [])
    .map((f) => `<span class="badge bg-secondary me-1 mb-1">${escapeHtml(f)}</span>`)
    .join("");

  const characteristics = (data.characteristics || []).map((x) => `<li class="small">${escapeHtml(x)}</li>`).join("");
  const tips = (data.tips || []).map((x) => `<li class="small">${escapeHtml(x)}</li>`).join("");

  target.innerHTML = `
    <div class="mb-2">
      <h6 class="mb-2">${escapeHtml(data.title)}</h6>
      <div class="mb-2">${focusBadges}</div>
    </div>

    <div class="mb-3">
      <strong class="small d-block mb-2">Key characteristics:</strong>
      <ul class="mb-2 ps-3">${characteristics}</ul>
    </div>

    <div>
      <strong class="small d-block mb-2">Practical tips:</strong>
      <ul class="ps-3">${tips}</ul>
    </div>
  `;
}

function initNfqGuidance() {
  const sel = document.getElementById("nfqSelect");
  if (!sel) return;

  sel.addEventListener("change", () => renderNfqTips(sel.value));
  renderNfqTips(sel.value);
}

// -------------------- Dark Mode --------------------
function initDarkMode() {
  const toggle = document.getElementById("darkModeToggle");
  const icon = document.getElementById("darkModeIcon");
  const isDark = localStorage.getItem("darkMode") === "true";

  if (isDark) {
    document.documentElement.classList.add("dark-mode");
    icon.textContent = "☀️";
  }

  if (toggle) {
    toggle.addEventListener("click", () => {
      const isDarkNow = document.documentElement.classList.toggle("dark-mode");
      localStorage.setItem("darkMode", isDarkNow);
      icon.textContent = isDarkNow ? "☀️" : "🌙";
    });
  }
}

// -------------------- UI init --------------------
function initUI() {
  if (document.getElementById("disclaimerText")) {
    $("#disclaimerText").text(APP.disclaimer ? `(${APP.disclaimer})` : "");
  }

  // Autocomplete: unique verb texts (duplicates exist as entries)
  const uniqueVerbTexts = Array.from(new Set(APP.verbs.map((v) => v.verb).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  $("#verbSearch").autocomplete({ source: uniqueVerbTexts });

  // Populate assessment select
  const select = $("#assessmentSelect");
  select.empty();
  select.append(`<option value="">-- choose --</option>`);
  for (const f of APP.assessmentFormats) {
    select.append(`<option value="${escapeHtml(f.id)}">${escapeHtml(f.name)}</option>`);
  }

  // Bloom hierarchy
  renderBloomHierarchy();

  // Start choice handlers
  $("#startLO").off("click").on("click", () => setMode("lo"));
  $("#startAssessment").off("click").on("click", () => setMode("assessment"));

  // LO search
  function doVerbSearch() {
    const q = $("#verbSearch").val();
    if (!q || !q.trim()) {
      showInfo("Type a verb (e.g., analyse, evaluate) and select from the dropdown, or click a verb on the left.");
      return;
    }

    const matches = getVerbMatchesByText(q);

    if (matches.length === 0) {
      showInfo("No exact match. Tip: choose a verb from the autocomplete suggestions (or click a verb on the left).");
      return;
    }

    if (matches.length === 1) {
      selectVerbById(matches[0].id, { switchToLO: false, selectedLevelId: matches[0].primaryLevelId || null });
      return;
    }

    renderVerbChoiceList(matches);
  }

  $("#verbSearchBtn").off("click").on("click", doVerbSearch);
  $("#verbSearch").off("keypress").on("keypress", (e) => {
    if (e.key === "Enter") doVerbSearch();
  });

  // Assessment selection
  $("#assessmentSelect").off("change").on("change", function () {
    renderVerbsForAssessment($(this).val());
  });

  // NFQ guidance
  initNfqGuidance();

  setMode("start");
}

// -------------------- Boot --------------------
async function boot() {
  try {
    initDarkMode();
    
    const res = await fetch("verbs.json", { cache: "no-store" });
    if (!res.ok) throw new Error("Failed to load verbs.json");
    RAW = await res.json();

    APP = adaptNewSchema(RAW);

    if (!APP || !Array.isArray(APP.verbs) || !Array.isArray(APP.assessmentFormats) || !Array.isArray(APP.bloomLevels)) {
      throw new Error("Adapted verbs.json has an unexpected structure.");
    }

    initUI();
  } catch (err) {
    console.error(err);
    showError("Data could not be loaded. Check that verbs.json is valid JSON and is being served correctly.");
  }
}

boot();
