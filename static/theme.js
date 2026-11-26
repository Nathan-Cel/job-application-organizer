// Thème clair ou sombre, chargé dans <head> pour éviter un flash au chargement.
// Préférence enregistrée : "light", "dark" ou "auto" (suit le système).
const themeQuery = matchMedia("(prefers-color-scheme: dark)");

function themePref() {
  try {
    return localStorage.getItem("theme") || "auto";
  } catch {
    return "auto";
  }
}

function applyTheme() {
  const pref = themePref();
  const dark = pref === "dark" || (pref === "auto" && themeQuery.matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

function setTheme(pref) {
  try {
    localStorage.setItem("theme", pref);
  } catch {}
  applyTheme();
}

themeQuery.addEventListener("change", applyTheme);
applyTheme();
