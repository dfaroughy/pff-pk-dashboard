const button = document.querySelector(".theme-switch");
let dark = false;
try { dark = localStorage.getItem("pythia-landing-theme") === "dark"; } catch { /* Storage is optional. */ }
function renderTheme() {
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  button.querySelector("span").textContent = dark ? "☾" : "☀";
  button.setAttribute("aria-pressed", String(dark));
  button.setAttribute("aria-label", `Switch to ${dark ? "light" : "dark"} mode`);
}
renderTheme();
button.hidden = false;
button.addEventListener("click", () => {
  dark = !dark;
  renderTheme();
  try { localStorage.setItem("pythia-landing-theme", dark ? "dark" : "light"); } catch { /* Storage is optional. */ }
});
