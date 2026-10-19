/* ============================================================
   TWENTYFIVE — ADMIN APP
   1. ELEMENTS & HELPERS
   2. AUTH (login / logout / session)
   3. MEMBER FORM (create / edit / photo upload)
   4. MEMBER LIST (render / edit / delete)
   ============================================================ */

/* ---------- 1. ELEMENTS & HELPERS ---------- */
const $ = (sel) => document.querySelector(sel);
const loginPanel = $("#login-panel");
const dashboard = $("#dashboard");
const loginForm = $("#login-form");
const memberForm = $("#member-form");
const photoInput = memberForm.elements.photo;
const photoPreview = $("#photo-preview");
const photoPreviewImg = $("#photo-preview-img");

const esc = (v) => String(v || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function api(url, options = {}) {
  const r = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
  const data = await r.json().catch(() => ({}));
  // Session lost (server restart / expired) — return to login panel with a clear message
  if (r.status === 401 && url !== "/api/login") {
    showLogin();
    const msg = $("#login-msg");
    if (msg) msg.textContent = "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่อีกครั้ง";
  }
  if (!r.ok) throw Error(data.error || "เกิดข้อผิดพลาด");
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

function showPhotoPreview(src) {
  if (src) {
    photoPreviewImg.src = src;
    photoPreview.hidden = false;
  } else {
    photoPreviewImg.removeAttribute("src");
    photoPreview.hidden = true;
  }
}

/* ---------- 2. AUTH ---------- */
function showDashboard() { loginPanel.hidden = true; dashboard.hidden = false; refresh(); }
function showLogin() { loginPanel.hidden = false; dashboard.hidden = true; }

async function checkSession() {
  try {
    const d = await api("/api/session");
    d.authenticated ? showDashboard() : showLogin();
  } catch { showLogin(); }
}

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#login-msg").textContent = "กำลังตรวจสอบ...";
  const fd = new FormData(loginForm);
  try {
    await api("/api/login", { method: "POST", body: JSON.stringify({ username: fd.get("username"), password: fd.get("password") }) });
    $("#login-msg").textContent = "";
    showDashboard();
  } catch (err) { $("#login-msg").textContent = err.message; }
});

$("#logout").addEventListener("click", async () => {
  await api("/api/logout", { method: "POST" });
  showLogin();
});

/* ---------- 3. MEMBER FORM ---------- */
function resetForm() {
  memberForm.reset();
  memberForm.elements.id.value = "";
  $("#form-title").textContent = "เพิ่มสมาชิกใหม่";
  $("#cancel-edit").hidden = true;
  $("#form-msg").textContent = "";
  showPhotoPreview("");
}

$("#cancel-edit").addEventListener("click", resetForm);

photoInput.addEventListener("change", () => {
  const file = photoInput.files[0];
  showPhotoPreview(file ? URL.createObjectURL(file) : memberForm.elements.image.value);
});

memberForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(memberForm);
  const id = fd.get("id");
  const body = Object.fromEntries(fd.entries());
  delete body.id;
  delete body.photo;

  const file = photoInput.files[0];
  $("#form-msg").textContent = "กำลังบันทึก...";
  try {
    if (file) {
      $("#form-msg").textContent = "กำลังอัปโหลดรูป...";
      const upload = await api("/api/upload", { method: "POST", body: JSON.stringify({ data: await fileToDataURL(file) }) });
      body.image = upload.url;
    }
    await api(id ? `/api/members/${encodeURIComponent(id)}` : "/api/members", {
      method: id ? "PUT" : "POST",
      body: JSON.stringify(body)
    });
    $("#form-msg").textContent = "บันทึกสำเร็จ";
    resetForm();
    refresh();
  } catch (err) { $("#form-msg").textContent = err.message; }
});

/* ---------- 4. MEMBER LIST ---------- */
const TIERS = ["BOSS", "LEADER", "SUPPORT", "MEMBER"];
let allMembers = [];
let activeTier = "ALL";

function tierOf(m) {
  const g = String(m.group || "").trim().toUpperCase();
  if (g === "LEADERSHIP") return "LEADER";
  if (g === "MEMBERS") return "MEMBER";
  return TIERS.includes(g) ? g : "MEMBER";
}

function rowHTML(m) {
  const t = tierOf(m);
  return `
      <div class="admin-row tier-${t.toLowerCase()}">
        <div class="avatar">${m.image ? `<img class="avatar" src="${esc(m.image)}" alt="" onerror="this.style.display='none'">` : "25"}</div>
        <div class="row-info">
          <small><span class="tier-badge">${t}</span> ${esc(m.role)}</small>
          <strong>${esc(m.name)}</strong>
          <p>${esc(m.description)}</p>
          ${m.facebook || m.tiktok ? `<div class="row-socials">${m.facebook ? `<a href="${esc(m.facebook)}" target="_blank" rel="noopener">FB</a>` : ""}${m.tiktok ? `<a href="${esc(m.tiktok)}" target="_blank" rel="noopener">TT</a>` : ""}</div>` : ""}
        </div>
        <div class="row-actions">
          <button class="ghost" data-edit="${esc(m.id)}">แก้ไข</button>
          <button class="delete" data-delete="${esc(m.id)}">ลบ</button>
        </div>
      </div>`;
}

function renderList() {
  const counts = Object.fromEntries(TIERS.map((t) => [t, allMembers.filter((m) => tierOf(m) === t).length]));
  document.querySelectorAll("#admin-tabs .tab").forEach((btn) => {
    const t = btn.dataset.tier;
    btn.textContent = `${t} ${t === "ALL" ? allMembers.length : counts[t]}`;
    btn.classList.toggle("active", t === activeTier);
  });
  $("#total").textContent = `${allMembers.length} MEMBERS`;

  const shown = TIERS.filter((t) => activeTier === "ALL" || t === activeTier);
  const html = shown.map((t) => {
    const rows = allMembers.filter((m) => tierOf(m) === t);
    if (!rows.length) return "";
    return `<div class="tier-head tier-${t.toLowerCase()}"><span>${t} TIER</span><b>${rows.length}</b></div>${rows.map(rowHTML).join("")}`;
  }).join("");
  $("#admin-list").innerHTML = html || '<p class="empty">ยังไม่มีสมาชิกในหมวดนี้</p>';
}

async function refresh() {
  try {
    allMembers = await api("/api/members");
    renderList();
  } catch (err) { $("#admin-list").textContent = err.message; }
}

$("#admin-tabs").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-tier]");
  if (!btn) return;
  activeTier = btn.dataset.tier;
  renderList();
});

$("#admin-list").addEventListener("click", async (e) => {
  const edit = e.target.closest("[data-edit]");
  const del = e.target.closest("[data-delete]");
  try {
    if (edit) {
      const list = await api("/api/members");
      const m = list.find((x) => String(x.id) === edit.dataset.edit);
      if (!m) return;
      for (const k of ["id", "name", "role", "group", "image", "description", "discord", "facebook", "tiktok"]) memberForm.elements[k].value = k === "group" ? ({ LEADERSHIP: "LEADER", MEMBERS: "MEMBER" }[m[k]] || m[k] || "MEMBER") : (m[k] || "");
      showPhotoPreview(m.image || "");
      $("#form-title").textContent = "แก้ไขสมาชิก";
      $("#cancel-edit").hidden = false;
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
    if (del) {
      const list = await api("/api/members");
      const m = list.find((x) => String(x.id) === del.dataset.delete);
      if (m && confirm(`ต้องการลบ ${m.name} หรือไม่?`)) {
        await api(`/api/members/${encodeURIComponent(m.id)}`, { method: "DELETE" });
        refresh();
      }
    }
  } catch (err) { alert(err.message); }
});

checkSession();
