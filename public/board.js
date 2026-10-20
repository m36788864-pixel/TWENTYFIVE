/* ============================================================
   TWENTYFIVE — BOARD PAGE (บอร์ดส่วนตัวของสมาชิก)
   1. HELPERS
   2. THEMES
   3. AUTH (login / session / logout)
   4. EDITOR (fill / live preview / save)
   ============================================================ */

/* ---------- 1. HELPERS ---------- */
const $ = (sel) => document.querySelector(sel);
const loginPanel = $("#login-panel");
const editor = $("#editor");
const loginForm = $("#login-form");
const boardForm = $("#board-form");
const photoInput = boardForm.elements.photo;

const esc = (v) => String(v || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function api(url, options = {}) {
  const res = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !url.endsWith("/login")) { showLogin("เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่"); }
  if (!res.ok) throw Error(data.error || "เกิดข้อผิดพลาด");
  return data;
}

function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(Error("อ่านไฟล์ไม่สำเร็จ"));
    reader.readAsDataURL(file);
  });
}

function setMsg(el, text, ok) {
  el.textContent = text;
  el.className = "message" + (text ? (ok ? " ok" : " bad") : "");
}

/* ---------- 2. THEMES ---------- */
const THEMES = {
  "": { c: "#ffffff", rgb: "255,255,255" },
  gold: { c: "#e6b528", rgb: "230,181,40" },
  silver: { c: "#c9ccd4", rgb: "201,204,212" },
  ice: { c: "#6fc7ff", rgb: "111,199,255" },
  rose: { c: "#ff8fb1", rgb: "255,143,177" },
  mint: { c: "#7fe0b0", rgb: "127,224,176" },
  violet: { c: "#b79cff", rgb: "183,156,255" }
};

function applyTheme(value) {
  const theme = THEMES[value] ? value : "";
  const { c, rgb } = THEMES[theme];
  document.documentElement.style.setProperty("--acc", c);
  document.documentElement.style.setProperty("--acc-rgb", rgb);
  $("#theme-input").value = theme;
  document.querySelectorAll("#theme-chips .chip").forEach((chip) => chip.classList.toggle("active", chip.dataset.theme === theme));
}

function applyPattern(value) {
  const pattern = ["plain", "grid", "dots", "glow"].includes(value) ? value : "plain";
  $("#pattern-input").value = pattern;
  document.querySelectorAll("#pattern-chips .chip").forEach((chip) => chip.classList.toggle("active", chip.dataset.pattern === pattern));
  const card = $("#preview");
  card.className = "preview-card pat-" + pattern;
}

/* ---------- 3. AUTH ---------- */
function showLogin(message) {
  loginPanel.hidden = false;
  editor.hidden = true;
  $("#logout").hidden = true;
  if (message) setMsg($("#login-msg"), message, false);
}

let me = null;

function showEditor(member) {
  me = member;
  loginPanel.hidden = true;
  editor.hidden = false;
  $("#logout").hidden = false;
  boardForm.elements.name.value = member.name || "";
  boardForm.elements.status.value = member.status || "";
  boardForm.elements.tagline.value = member.tagline || "";
  boardForm.elements.bio.value = member.bio || member.description || "";
  boardForm.elements.image.value = (member.image || "").startsWith("data:") ? "" : (member.image || "");
  boardForm.elements.discord.value = member.discord || "";
  boardForm.elements.facebook.value = member.facebook || member.facebookIc || "";
  boardForm.elements.tiktok.value = member.tiktok || "";
  photoInput.value = "";
  applyTheme(member.theme || "");
  applyPattern(member.pattern || "plain");

  $("#board-username").textContent = "@" + (member.username || "member");
  $("#board-title").textContent = member.name || "MEMBER";
  $("#ic-info").innerHTML = [
    ["ชื่อ IC", member.name],
    ["อายุ IC", member.icAge],
    ["เฟส IC", member.facebookIc],
    ["ดิสคอร์ด (DM)", member.discordUser],
    ["ลิงก์ไดรฟ์", member.driveLink],
    ["ชื่อผู้ใช้", member.username]
  ].map(([label, value]) => {
    const text = value ? (label === "ลิงก์ไดรฟ์" || label === "เฟส IC"
      ? `<a href="${esc(value)}" target="_blank" rel="noopener">${esc(value)}</a>`
      : esc(value)) : "—";
    return `<li><b>${label}</b><span>${text}</span></li>`;
  }).join("");

  updatePreview();
}

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(loginForm);
  setMsg($("#login-msg"), "กำลังเข้าสู่ระบบ...", true);
  try {
    const data = await api("/api/board/login", {
      method: "POST",
      body: JSON.stringify({ name: fd.get("name"), password: fd.get("password") })
    });
    setMsg($("#login-msg"), "", true);
    showEditor(data.member);
  } catch (err) { setMsg($("#login-msg"), err.message, false); }
});

$("#logout").addEventListener("click", async () => {
  await api("/api/board/logout", { method: "POST" });
  loginForm.reset();
  showLogin();
});

/* ---------- 4. EDITOR ---------- */
const pv = {
  avatar: $("#pv-avatar"),
  name: $("#pv-name"),
  tagline: $("#pv-tagline"),
  status: $("#pv-status"),
  bio: $("#pv-bio"),
  meta: $("#pv-meta")
};

function localImage() {
  const file = photoInput.files[0];
  if (file) return URL.createObjectURL(file);
  return boardForm.elements.image.value.trim();
}

function updatePreview() {
  const name = boardForm.elements.name.value.trim() || "MEMBER";
  const tagline = boardForm.elements.tagline.value.trim();
  const status = boardForm.elements.status.value.trim();
  const bio = boardForm.elements.bio.value.trim();
  const image = localImage();

  pv.avatar.innerHTML = image ? `<img src="${esc(image)}" alt="" onerror="this.remove()">` : "25";
  pv.name.textContent = name;
  pv.tagline.textContent = tagline || "TWENTYFIVE";
  pv.status.hidden = !status;
  if (status) pv.status.lastElementChild.textContent = status;
  pv.bio.textContent = bio || "แนะนำตัวของคุณจะแสดงตรงนี้";
  pv.bio.style.display = bio ? "" : "none";

  const rows = [
    ["อายุ IC", me && me.icAge],
    ["เฟส IC", boardForm.elements.facebook.value.trim()],
    ["ดิสคอร์ด", boardForm.elements.discord.value.trim()],
    ["ติ๊กต๊อก", boardForm.elements.tiktok.value.trim()]
  ].filter(([, v]) => v);
  pv.meta.innerHTML = rows.map(([label, value]) => `<span>${label}<b>${/^https?:/.test(value) ? "มีลิงก์" : esc(value)}</b></span>`).join("");
}

["input", "change"].forEach((evt) => boardForm.addEventListener(evt, updatePreview));
photoInput.addEventListener("change", updatePreview);

$("#theme-chips").addEventListener("click", (e) => {
  const chip = e.target.closest("[data-theme]");
  if (chip) applyTheme(chip.dataset.theme);
});
$("#pattern-chips").addEventListener("click", (e) => {
  const chip = e.target.closest("[data-pattern]");
  if (chip) applyPattern(chip.dataset.pattern);
});

$("#reload").addEventListener("click", () => { if (me) showEditor(me); });

boardForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(boardForm);
  const body = Object.fromEntries(fd.entries());
  delete body.photo;
  const file = photoInput.files[0];
  setMsg($("#board-msg"), "กำลังบันทึก...", true);
  try {
    if (file) {
      setMsg($("#board-msg"), "กำลังอัปโหลดรูป...", true);
      const upload = await api("/api/upload", { method: "POST", body: JSON.stringify({ data: await fileToDataURL(file) }) });
      body.image = upload.url;
    }
    const member = await api("/api/board/me", { method: "PUT", body: JSON.stringify(body) });
    showEditor(member);
    setMsg($("#board-msg"), "บันทึกบอร์ดแล้ว ✓", true);
  } catch (err) { setMsg($("#board-msg"), err.message, false); }
});

/* ---------- START ---------- */
(async function start() {
  try {
    const data = await api("/api/board/session");
    data.authenticated ? showEditor(data.member) : showLogin();
  } catch { showLogin(); }
})();
