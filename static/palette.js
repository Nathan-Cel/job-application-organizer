// ---------- Palette de commandes (Ctrl K ou ⌘ K) ----------
// Une seule zone de recherche pour aller à une page, ouvrir une candidature ou lancer une action.

const palette = { dialog: null, query: "", selected: 0, items: [] };

// Minuscules sans accents, pour que « societe » trouve « Société ».
function fold(text) {
  return String(text ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function paletteCommands() {
  const dark = document.documentElement.dataset.theme === "dark";
  const goBox = (v) => () => {
    box.view = v;
    try {
      localStorage.setItem("boxView", v);
    } catch {}
    location.hash === "#/" || location.hash === "" ? rerender() : (location.hash = "#/");
  };
  const actions = [
    { icon: "plus", label: t("box.new"), hint: t("palette.newHint"), run: () => { form = null; location.hash = "#/new"; } },
    { icon: "board", label: t("palette.board"), run: goBox("board") },
    { icon: "inbox", label: t("palette.list"), run: goBox("date") },
    { icon: "clock", label: t("followup.filter"), hint: String(apps.filter(needsFollowUp).length),
      run: () => { box.filter = "followup"; goBox("date")(); } },
    { icon: dark ? "sun" : "moon", label: t(dark ? "theme.light" : "theme.dark"), run: toggleTheme },
  ];
  const pages = [["", "inbox", "nav.box"], ...NAV, me?.admin ? ["stats", "chart", "nav.stats"] : ["review", "star", "nav.review"]]
    .map(([key, ic, label]) => ({ icon: ic, label: t(label), hint: t("palette.page"), run: () => { location.hash = `#/${key}`; } }));
  const found = apps.map((a) => ({
    app: a, label: a.company, sub: a.jobTitle || "", hint: t("status." + a.status),
    run: () => { location.hash = `#/a/${a.id}`; },
  }));
  return [[t("palette.actions"), actions], [t("palette.pages"), pages], [t("palette.applications"), found]];
}

function openPalette() {
  if (!userId) return;
  if (!palette.dialog) {
    palette.dialog = document.body.appendChild(document.createElement("dialog"));
    palette.dialog.className = "palette";
    palette.dialog.setAttribute("aria-label", t("palette.open"));
    palette.dialog.onclose = () => track("palette_closed");
    palette.dialog.onclick = (e) => {
      if (e.target === palette.dialog) return palette.dialog.close(); // clic sur le fond
      const item = e.target.closest("[data-i]");
      if (item) runItem(Number(item.dataset.i));
    };
    palette.dialog.onmousemove = (e) => {
      const item = e.target.closest("[data-i]");
      if (item && Number(item.dataset.i) !== palette.selected) select(Number(item.dataset.i));
    };
    palette.dialog.oninput = (e) => {
      palette.query = e.target.value;
      palette.selected = 0;
      renderPaletteList();
    };
    palette.dialog.onkeydown = onPaletteKey;
  }
  palette.query = "";
  palette.selected = 0;
  palette.dialog.innerHTML = `
    <div class="palette-search">${icon("search", 18)}<input type="text" placeholder="${t("palette.placeholder")}" aria-label="${t("palette.placeholder")}" role="combobox" aria-expanded="true" aria-controls="palette-list" autocomplete="off"></div>
    <ul class="palette-list" id="palette-list" role="listbox"></ul>
    <div class="palette-foot"><span><kbd>↑</kbd><kbd>↓</kbd>${t("palette.move")}</span><span><kbd>↵</kbd>${t("palette.choose")}</span><span><kbd>Esc</kbd>${t("palette.close")}</span></div>`;
  renderPaletteList();
  palette.dialog.showModal();
  palette.dialog.querySelector("input").focus();
  track("palette_opened");
}

function renderPaletteList() {
  const words = fold(palette.query).split(/\s+/).filter(Boolean);
  const matches = (item) => words.every((w) => fold(`${item.label} ${item.sub ?? ""} ${item.hint ?? ""}`).includes(w));
  palette.items = [];
  let html = "";
  for (const [title, items] of paletteCommands()) {
    // Sans recherche, la liste des candidatures se limite aux plus récentes.
    const shown = items.filter(matches).slice(0, words.length ? 20 : items[0]?.app ? 5 : 20);
    if (!shown.length) continue;
    html += `<li class="palette-group" role="presentation">${title}</li>`;
    for (const item of shown) {
      const i = palette.items.push(item) - 1;
      const lead = item.app ? logo(item.app.company) : icon(item.icon, 16);
      const text = item.sub ? `<strong>${esc(item.label)}</strong> <span class="meta">${esc(item.sub)}</span>` : esc(item.label);
      html += `<li class="palette-item" role="option" id="pi${i}" data-i="${i}" aria-selected="${i === palette.selected}">
        ${lead}<span class="grow">${text}</span>${item.hint ? `<span class="hint">${esc(item.hint)}</span>` : ""}</li>`;
    }
  }
  const list = palette.dialog.querySelector(".palette-list");
  list.innerHTML = html || `<li class="palette-empty">${t("palette.none")}</li>`;
  palette.dialog.querySelector("input").setAttribute("aria-activedescendant", palette.items.length ? `pi${palette.selected}` : "");
}

function select(i) {
  palette.selected = i;
  for (const el of palette.dialog.querySelectorAll("[data-i]")) el.setAttribute("aria-selected", String(Number(el.dataset.i) === i));
  palette.dialog.querySelector(`#pi${i}`)?.scrollIntoView({ block: "nearest" });
  palette.dialog.querySelector("input").setAttribute("aria-activedescendant", `pi${i}`);
}

function runItem(i) {
  const item = palette.items[i];
  if (!item) return;
  palette.dialog.close();
  track("palette_used", { kind: item.app ? "application" : item.icon });
  item.run();
}

function onPaletteKey(e) {
  const n = palette.items.length;
  if (e.key === "ArrowDown" && n) {
    e.preventDefault();
    select((palette.selected + 1) % n);
  } else if (e.key === "ArrowUp" && n) {
    e.preventDefault();
    select((palette.selected - 1 + n) % n);
  } else if (e.key === "Enter") {
    e.preventDefault();
    runItem(palette.selected);
  }
}

addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    palette.dialog?.open ? palette.dialog.close() : openPalette();
  }
});
