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

// E-mail de candidature spontanée : infos de la section Entreprise, CV de la section CV comme contexte.
async function coldEmail(f) {
  const cv = section(f, "cv") || {};
  const { subject, body } = await api("/api/companies/application", {
    method: "POST",
    body: { company: { name: f.company }, what: f.jobTitle, description: section(f, "company")?.summary || "",
      cvFileId: cv.file?.id || cv._profileFileId || "", lang },
  });
  return `${subject}\n\n${body}`;
}

async function suggestLetter(s) {
  if (s.text.trim() && !confirm(t("suggest.confirmReplace"))) return;
  Object.assign(s, { _ai: "loading", _aiError: "" });
  renderForm();
  try {
    s.text = form.type === "spontaneous" ? await coldEmail(form)
      : (await api("/api/write", { method: "POST", body: { kind: "letter", offer: offerText(form), company: form.company, lang } })).text;
    s._ai = "";
  } catch (err) {
    Object.assign(s, { _ai: "error", _aiError: err.message });
  }
  if (form?.sections.includes(s)) renderForm();
}

// ---------- Profil ----------

const profileState = { data: null, saving: false, notice: "", error: "" };

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

// Un CV du profil : titre, puis le PDF enregistré ou en attente d'envoi (_pending).
function cvRow(cv, i) {
  const f = cv._pending ? { name: cv._pending.name } : cv.file;
  const meta = cv._pending ? t("form.fileReady") : `${pagesLabel(f.pages)} · ${t("file.added", { date: fmtDate(f.addedAt) })}`;
  return `<div class="fields">
      ${input("title", t("profile.cvTitle"), { value: cv.title, attrs: `required data-i="${i}"` })}
      <button class="icon-btn boxed" type="button" aria-label="${t("profile.removeCv")}" data-action="remove-cv" data-i="${i}">${icon("close", 16, 'stroke="currentColor" stroke-width="2"')}</button></div>
    <div class="file-row">${icon("file", 22, 'stroke="currentColor" style="color:var(--muted)" stroke-width="1.5"')}
      <div><span class="file-name">${esc(f.name)}</span><span class="file-meta">${meta}</span></div>
      ${cv._pending ? "" : `<a class="btn" href="${fileUrl(cv.file)}" target="_blank" rel="noopener">${t("file.open")}</a>`}</div>`;
}

function renderProfile() {
  const p = profileState;
  if (!p.data) {
    view.innerHTML = p.error ? `<p class="banner error">${esc(p.error)}</p>` : "";
    return;
  }
  const cvs = p.data.cvs;
  view.innerHTML = `<form class="narrow" id="profile-form">
    <header class="stack"><h1>${t("nav.profile")}</h1><p class="lead">${t("profile.lead")}</p></header>
    <section class="mod"><div class="mod-head"><h2>${t("profile.cv")}</h2></div><div class="mod-body">
      ${cvs.map(cvRow).join('<div class="rule"></div>')}
      <div class="drop">${icon("upload", 22, 'stroke="currentColor" style="color:var(--muted)" stroke-width="1.5"')}<span>${t("profile.addCv")}</span>
        <input type="file" accept="application/pdf" hidden data-cv-file>
        <button class="btn" type="button" data-action="choose">${t("form.chooseFile")}</button></div>
    </div></section>
    <section class="mod"><div class="mod-head"><h2>${t("profile.language")}</h2></div><div class="mod-body">
      <div class="fields"><select class="field" data-lang-select aria-label="${t("profile.language")}">
        ${Object.keys(LOCALES).map((code) => `<option value="${code}" ${code === lang ? "selected" : ""}>${t("lang." + code)}</option>`).join("")}
      </select></div>
    </div></section>
    <section class="mod"><div class="mod-head"><h2>${t("profile.theme")}</h2></div><div class="mod-body">
      <div class="fields"><select class="field" data-theme-select aria-label="${t("profile.theme")}">
        ${["auto", "light", "dark"].map((v) => `<option value="${v}" ${v === themePref() ? "selected" : ""}>${t("theme." + v)}</option>`).join("")}
      </select></div>
    </div></section>
    ${p.notice ? `<p class="banner success" role="status">${esc(p.notice)}</p>` : ""}
    ${p.error ? `<p class="banner error" role="status">${esc(p.error)}</p>` : ""}
    <div class="form-foot"><div class="actions"><button class="btn btn-danger" type="button" data-action="delete-account">${t("profile.deleteAccount")}</button>
      <a class="btn" href="#/signout">${t("nav.signOut")}</a>
      <button class="btn btn-primary" type="submit" ${p.saving ? "disabled" : ""}>${t("profile.save")}</button></div></div>
  </form>`;
  view.oninput = (e) => {
    if (e.target.dataset.key === "title") cvs[e.target.dataset.i].title = e.target.value;
  };
  view.onclick = async (e) => {
    if (e.target.closest("[data-action=delete-account]") && confirm(t("profile.confirmDeleteAccount"))) {
      try {
        await api("/api/account", { method: "DELETE" });
        location.hash = "#/";
        return authApi.signOut();
      } catch (err) {
        p.error = err.message;
        return renderProfile();
      }
    }
    if (e.target.closest("[data-action=choose]")) view.querySelector("[data-cv-file]").click();
    const remove = e.target.closest("[data-action=remove-cv]");
    if (remove) {
      cvs.splice(Number(remove.dataset.i), 1);
      renderProfile();
    }
  };
  view.onchange = (e) => {
    if (e.target.dataset.themeSelect !== undefined) {
      setTheme(e.target.value);
      track("theme_changed", { to: e.target.value });
      return renderNav();
    }
    if (e.target.dataset.langSelect !== undefined) {
      setLang(e.target.value);
      track("lang_changed", { to: e.target.value });
      renderNav();
      return renderProfile();
    }
    const file = e.target.dataset.cvFile !== undefined && e.target.files[0];
    if (!file) return;
    cvs.push({ title: file.name.replace(/\.pdf$/i, ""), _pending: file });
    renderProfile();
  };
  view.onsubmit = async (e) => {
    e.preventDefault();
    Object.assign(p, { saving: true, error: "", notice: "" });
    renderProfile();
    try {
      for (const cv of cvs.filter((c) => c._pending)) {
        cv.file = await api(`/api/files?name=${encodeURIComponent(cv._pending.name)}`, { method: "POST", body: cv._pending });
        delete cv._pending;
      }
      p.data = await api("/api/profile", { method: "PUT", body: { cvs } });
      p.notice = t("profile.saved");
      profileCvs = p.data.cvs;
    } catch (err) {
      p.error = err.message;
    }
    p.saving = false;
    renderProfile();
  };
}
