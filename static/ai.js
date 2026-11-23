// Fonctions IA : préparation d'entretien, suggestion de lettre, et profil.

// ---------- Rendu Markdown minimal (titres, listes, tableaux, citations, gras, liens) ----------

function renderMarkdown(text) {
  const inline = (line) =>
    esc(line.replace(/<(https?:\/\/[^\s>]+)>/g, "$1"))
      .replace(/&#60;br\s*\/?&#62;/gi, "<br>")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)&]+)\)/g, '<a class="link" href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/(^|[\s(])(https?:\/\/[^\s)&<]+)/g, '$1<a class="link" href="$2" target="_blank" rel="noopener">$2</a>');
  const cells = (line) => line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
  const lines = (text || "").split("\n");
  let html = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    if (line.trim().startsWith("|") && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] || "")) {
      html += "<div class='md-table'><table><thead><tr>" + cells(line).map((c) => `<th>${inline(c)}</th>`).join("") + "</tr></thead><tbody>";
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        html += "<tr>" + cells(lines[i]).map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>";
        i++;
      }
      html += "</tbody></table></div>";
      i--;
      continue;
    }
    const item = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)/);
    if (item) {
      html = (html.endsWith("</ul>") ? html.slice(0, -5) : html + "<ul>") + `<li>${inline(item[1])}</li></ul>`;
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.*)/);
    const quote = line.match(/^\s*>\s?(.*)/);
    if (heading) html += `<h3>${inline(heading[2])}</h3>`;
    else if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) html += "<hr>";
    else if (quote) html += `<blockquote>${inline(quote[1])}</blockquote>`;
    else if (line.trim()) html += `<p>${inline(line)}</p>`;
  }
  return `<div class="md">${html}</div>`;
}

// ---------- Prochaine étape (Box et page candidature) ----------

function nextStepLabel(n) {
  return t("next." + (n.kind || "todo"), { date: fmtDate(n.date) });
}

function nextStepTag(a) {
  const n = a.nextStep;
  if (!n?.date || a.status === "refused") return "";
  const late = n.date < new Date().toISOString().slice(0, 10);
  return `<span class="next-tag${late ? " late" : ""}">${esc(nextStepLabel(n))}</span>`;
}

function nextStepBanner(app) {
  const n = app.nextStep;
  if (!n?.date || app.status === "refused") return "";
  return `<div class="banner next" role="status"><strong>${esc(nextStepLabel(n))}</strong>${n.label ? `<span>${esc(n.label)}</span>` : ""}</div>`;
}

// ---------- Préparation d'entretien ----------

function prepCard(app, prep, open) {
  const p = app.prep;
  const button = `<button class="btn ${p ? "" : "btn-primary"}" type="button" data-prep ${prep.loading ? "disabled" : ""}>${icon("spark")}${t(p ? "prep.regenerate" : "prep.generate")}</button>`;
  let body;
  if (prep.loading) {
    body = `<div class="banner loading" role="status"><span>${t("prep.loading")}</span><div class="progress"></div></div>`;
  } else if (p) {
    body = `<p class="meta">${t("prep.generatedOn", { date: fmtDate(p.at) })}</p><div class="clamp">${renderMarkdown(p.text)}</div>
      <div class="actions">${button}<button class="btn" type="button" data-copy-prep>${t("common.copy")}</button></div>`;
  } else {
    body = `<p class="help">${t("prep.help")}</p><div class="actions">${button}</div>`;
  }
  const error = prep.error ? `<p class="banner error" role="status">${esc(prep.error)}</p>` : "";
  const over = overlaid === "prep";
  return `<details class="card prep${over ? " overlaid" : ""}" id="prep" ${open || over ? "open" : ""}><summary class="card-head"><h2>${t("prep.title")}</h2>
    <div class="head-tools">${expandButton("prep")}${icon("chevron", 16, 'stroke="currentColor" stroke-width="2"')}</div></summary>
    <div class="card-body">${error}${body}</div></details>`;
}

async function runPrep(app, prep, redraw) {
  Object.assign(prep, { loading: true, error: "" });
  redraw();
  try {
    return await api(`/api/applications/${app.id}/prep`, { method: "POST", body: { lang } });
  } catch (err) {
    prep.error = err.message;
    return null;
  } finally {
    prep.loading = false;
  }
}

// ---------- Historique des réponses ----------

function repliesCard(app) {
  const list = app.replies || [];
  if (!list.length) return "";
  const items = list.map((r) => {
    const when = [r.date && fmtDate(r.date), r.time, r.format].filter(Boolean).join(" · ");
    return `<li class="reply-item">
      <div class="reply-head"><span class="type-tag">${t("replyType." + r.type)}</span><span class="meta">${t("reply.received", { date: fmtDate(r.at) })}</span></div>
      ${r.summary ? `<p>${esc(r.summary)}</p>` : ""}
      ${when ? `<p class="meta">${esc(when)}</p>` : ""}
      ${r.todo ? `<p class="meta"><strong>${t("reply.todo")}</strong> ${esc(r.todo)}</p>` : ""}
      <details><summary class="link">${t("reply.fullMessage")}</summary><div class="prose">${paras(r.message || "")}</div></details>
    </li>`;
  }).join("");
  return card(t("reply.history"), `<ul class="reply-list">${items}</ul>`, { key: "replies" });
}

// ---------- Suggestion de lettre ----------

// Offre envoyée à l'IA : le texte complet s'il est là, sinon le poste et les points clés.
function offerText(f) {
  const link = section(f, "offerLink") || {};
  const kp = section(f, "keyPoints") || {};
  return (link.paste || link.rawText || [f.jobTitle, kp.contract, kp.responsibilities, kp.requirements].filter(Boolean).join("\n")).trim();
}

async function suggestLetter(s) {
  if (s.text.trim() && !confirm(t("suggest.confirmReplace"))) return;
  Object.assign(s, { _ai: "loading", _aiError: "" });
  renderForm();
  try {
    s.text = (await api("/api/write", { method: "POST", body: { kind: "letter", offer: offerText(form), company: form.company, lang } })).text;
    s._ai = "";
  } catch (err) {
    Object.assign(s, { _ai: "error", _aiError: err.message });
  }
  if (form?.sections.includes(s)) renderForm();
}

// ---------- Profil ----------

const profileState = { data: null, saving: false, notice: "", error: "", importing: false };

async function showProfile() {
  view.className = "";
  rerender = renderProfile;
  Object.assign(profileState, { notice: "", error: "" });
  renderProfile();
  try {
    profileState.data = await api("/api/profile");
  } catch (err) {
    profileState.error = err.message;
  }
  renderProfile();
}

function renderProfile() {
  const p = profileState;
  if (!p.data) {
    view.innerHTML = p.error ? `<p class="banner error">${esc(p.error)}</p>` : "";
    return;
  }
  const d = p.data;
  view.innerHTML = `<form class="narrow" id="profile-form">
    <header class="stack"><h1>${t("nav.profile")}</h1><p class="lead">${t("profile.lead")}</p></header>
    <section class="mod"><div class="mod-head"><h2>${t("profile.about")}</h2></div><div class="mod-body">
      <p class="help">${t("profile.aboutHelp")}</p>
      <div class="fields">
        ${input("name", t("form.name"), { value: d.name })}
        ${input("target", t("profile.target"), { value: d.target, ph: t("profile.targetPh") })}
        ${input("location", t("profile.location"), { value: d.location, ph: t("profile.locationPh") })}
      </div>
      ${input("skills", t("profile.skills"), { value: d.skills, ph: t("profile.skillsPh"), area: 3 })}
    </div></section>
    <section class="mod"><div class="mod-head"><h2>${t("profile.cv")}</h2></div><div class="mod-body">
      <div class="drop">${icon("upload", 22, 'stroke="#4B5563" stroke-width="1.5"')}<span>${t(p.importing ? "profile.importing" : "profile.import")}</span>
        <input type="file" accept="application/pdf" hidden data-cv-file>
        <button class="btn" type="button" data-action="choose" ${p.importing ? "disabled" : ""}>${t("form.chooseFile")}</button></div>
      ${input("cv", t("profile.cvText"), { value: d.cv, ph: t("profile.cvPh"), area: 12 })}
    </div></section>
    <section class="mod"><div class="mod-head"><h2>${t("profile.language")}</h2></div><div class="mod-body">
      <div class="fields"><select class="field" data-lang-select aria-label="${t("profile.language")}">
        ${Object.keys(LOCALES).map((code) => `<option value="${code}" ${code === lang ? "selected" : ""}>${t("lang." + code)}</option>`).join("")}
      </select></div>
    </div></section>
    ${p.notice ? `<p class="banner success" role="status">${esc(p.notice)}</p>` : ""}
    ${p.error ? `<p class="banner error" role="status">${esc(p.error)}</p>` : ""}
    <div class="form-foot"><div class="actions"><a class="btn" href="#/signout">${t("nav.signOut")}</a>
      <button class="btn btn-primary" type="submit" ${p.saving ? "disabled" : ""}>${t("profile.save")}</button></div></div>
  </form>`;
  view.oninput = (e) => {
    if (e.target.dataset.key) d[e.target.dataset.key] = e.target.value;
  };
  view.onclick = (e) => {
    if (e.target.closest("[data-action=choose]")) view.querySelector("[data-cv-file]").click();
  };
  view.onchange = async (e) => {
    if (e.target.dataset.langSelect !== undefined) {
      setLang(e.target.value);
      track("lang_changed", { to: e.target.value });
      renderNav();
      return renderProfile();
    }
    if (e.target.dataset.cvFile === undefined || !e.target.files[0]) return;
    Object.assign(p, { importing: true, error: "", notice: "" });
    renderProfile();
    try {
      const { text } = await api("/api/profile/cv-text", { method: "POST", body: e.target.files[0] });
      d.cv = text;
      p.notice = t(text ? "profile.imported" : "profile.importEmpty");
    } catch (err) {
      p.error = err.message;
    }
    p.importing = false;
    renderProfile();
  };
  view.onsubmit = async (e) => {
    e.preventDefault();
    Object.assign(p, { saving: true, error: "", notice: "" });
    try {
      p.data = await api("/api/profile", { method: "PUT", body: d });
      p.notice = t("profile.saved");
      if (me) me.profileFilled = Boolean(d.cv.trim() || d.skills.trim());
    } catch (err) {
      p.error = err.message;
    }
    p.saving = false;
    renderProfile();
  };
}
