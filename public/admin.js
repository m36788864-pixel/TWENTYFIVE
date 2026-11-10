/* ============================================================
   TWENTYFIVE — ADMIN APP
   1. ELEMENTS & HELPERS
   2. AUTH (login / logout / session)
   3. MEMBER FORM (create / edit / photo upload)
   4. MEMBER LIST (render / edit / delete)
   5. REORDER (ลากวาง / ปุ่ม ↑ ↓ + บันทึกลำดับ)
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

/* ---------- 3.5 SITE SONG (เพลงเปิดเว็บ) ---------- */
const siteSongForm = $("#site-song-form");
const siteSongMsg = $("#site-song-msg");
let currentSiteSong = null;

function renderSiteSong(song) {
  currentSiteSong = song || null;
  const hasSong = !!(song && song.url);
  siteSongForm.elements.title.value = hasSong ? (song.title || "") : "";
  siteSongForm.elements.artist.value = hasSong ? (song.artist || "") : "";
  siteSongForm.elements.url.value = hasSong ? (song.url || "") : "";
  if (siteSongForm.elements.hideTitle) siteSongForm.elements.hideTitle.checked = hasSong ? !!song.hideTitle : false;
  const fileInput = $("#site-song-file");
  if (fileInput) fileInput.value = "";
  $("#site-song-clear").hidden = !hasSong;

  const badge = $("#site-song-badge");
  badge.className = "badge " + (hasSong ? "approved" : "pending");
  badge.innerHTML = `<i></i>${hasSong ? "กำลังเปิด" : "ยังไม่ตั้งค่า"}`;

  const preview = $("#site-song-preview");
  if (window.T25Song) T25Song.render(preview, song || { title: "", artist: "", url: "" });
  preview.hidden = !hasSong;
}

async function loadSiteSong() {
  try {
    const song = await api("/api/site-song");
    renderSiteSong(song);
  } catch (err) {
    siteSongMsg.textContent = err.message;
  }
}

siteSongForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(siteSongForm);
  const fileInput = $("#site-song-file");
  const file = fileInput && fileInput.files && fileInput.files[0];
  const body = {
    title: String(fd.get("title") || ""),
    artist: String(fd.get("artist") || ""),
    url: String(fd.get("url") || ""),
    hideTitle: fd.get("hideTitle") === "on"
  };

  /* เลือกไฟล์เสียง → อัปโหลดขึ้นเซิร์ฟเวอร์ก่อน แล้วใช้ URL ไฟล์นั้น */
  if (file) {
    if (file.size > 25 * 1024 * 1024) { siteSongMsg.textContent = "ไฟล์ใหญ่เกิน 25 MB"; return; }
    siteSongMsg.textContent = "กำลังอัปโหลดไฟล์เพลง...";
    siteSongMsg.className = "message";
    try {
      const up = await api(`/api/site-song/upload?filename=${encodeURIComponent(file.name)}`, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file
      });
      body.url = up.url;
      body.hideTitle = true;   /*ไฟล์ที่อัปโหลด → ซ่อนชื่อไว้ก่อน (ติ๊กออกได้ถ้าอยากให้โชว์ชื่อ) */
    } catch (err) { siteSongMsg.textContent = "อัปโหลดไม่สำเร็จ: " + err.message; return; }
  }

  if (!String(body.url || "").trim()) { siteSongMsg.textContent = "กรุณาใส่ลิงก์เพลง หรือเลือกไฟล์เสียงก่อน"; return; }
  siteSongMsg.textContent = "กำลังบันทึก...";
  siteSongMsg.className = "message";
  try {
    const song = await api("/api/site-song", { method: "PUT", body: JSON.stringify(body) });
    renderSiteSong(song);
    siteSongMsg.textContent = "บันทึกแล้ว — เพลงจะเปิดตอนเข้าเว็บ ✓";
    siteSongMsg.className = "message ok";
  } catch (err) { siteSongMsg.textContent = err.message; }
});

$("#site-song-clear").addEventListener("click", async () => {
  if (!confirm("ล้างเพลงเปิดเว็บ? (ผู้ชมจะไม่ได้ยินเพลงตอนเปิดเว็บ)")) return;
  try {
    await api("/api/site-song", { method: "DELETE" });
    renderSiteSong(null);
    siteSongMsg.textContent = "ล้างเพลงออกแล้ว";
    siteSongMsg.className = "message ok";
  } catch (err) { siteSongMsg.textContent = err.message; }
});

/* ---------- 4. MEMBER LIST ---------- */
const TIERS = ["BOSS", "LEADER", "SUPPORT", "MEMBER"];
let allMembers = [];
let activeTier = "ALL";

function tierOf(m) {
  if (m.exitedAt) return "EXIT";                 // ถูกให้ออกจากแก๊งแล้ว → แยกไปแท็บของตัวเอง
  const g = String(m.group || "").trim().toUpperCase();
  if (g === "LEADERSHIP") return "LEADER";
  if (g === "MEMBERS") return "MEMBER";
  return TIERS.includes(g) ? g : "MEMBER";
}

function rowHTML(m, i, total) {
  const t = tierOf(m);
  const id = esc(m.id);
  if (t === "EXIT") {
    const when = m.exitedAt ? new Date(m.exitedAt).toLocaleString("th-TH") : "—";
    return `
      <div class="admin-row tier-exit exited" data-id="${id}">
        <span class="drag-handle" aria-hidden="true">✕</span>
        <div class="avatar">${m.image ? `<img class="avatar" src="${esc(m.image)}" alt="" onerror="this.style.display='none'">` : "25"}</div>
        <div class="row-info">
          <small><span class="tier-badge">EXIT</span> ${esc(m.role)}</small>
          <strong>${esc(m.name)}</strong>
          <p class="mini-note">ออกจากแก๊งเมื่อ ${esc(when)}${m.exitReason ? ` · เหตุผล: ${esc(m.exitReason)}` : ""} · สิทธิ์เข้าบอร์ดถูกระงับ แต่ข้อมูลบอร์ดยังอยู่</p>
        </div>
        <div class="row-actions">
          <button class="silver-btn" data-restore="${id}">รับกลับเข้าแก๊ง</button>
          <button class="delete" data-delete="${id}">ลบถาวร</button>
        </div>
      </div>`;
  }
  return `
      <div class="admin-row tier-${t.toLowerCase()}" data-id="${id}" draggable="true">
        <span class="drag-handle" title="ลากเพื่อจัดลำดับ" aria-hidden="true">⠿</span>
        <div class="avatar">${m.image ? `<img class="avatar" src="${esc(m.image)}" alt="" onerror="this.style.display='none'">` : "25"}</div>
        <div class="row-info">
          <small><span class="tier-badge">${t}</span> ${esc(m.role)}</small>
          <strong>${esc(m.name)}</strong>
          <p>${esc(m.description)}</p>
          ${m.facebook || m.tiktok ? `<div class="row-socials">${m.facebook ? `<a href="${esc(m.facebook)}" target="_blank" rel="noopener">FB</a>` : ""}${m.tiktok ? `<a href="${esc(m.tiktok)}" target="_blank" rel="noopener">TT</a>` : ""}</div>` : ""}
          <div class="row-cred">
            ${m.credentials ? `<code title="ชื่อผู้ใช้สำหรับล็อกอินบอร์ด">${esc(m.credentials.username)}</code>` : `<span class="mini-note">ยังไม่มีรหัสบอร์ด</span>`}
            <button type="button" class="mini" data-send="${id}">ส่งรหัสอีกครั้ง</button>
            <button type="button" class="mini" data-reset="${id}">ออกรหัสใหม่</button>
          </div>
        </div>
        <div class="row-move" title="เลื่อนลำดับ">
          <button type="button" class="move" data-move="up" data-id="${id}" ${i === 0 ? "disabled" : ""} aria-label="เลื่อน ${esc(m.name)} ขึ้น">↑</button>
          <button type="button" class="move" data-move="down" data-id="${id}" ${i === total - 1 ? "disabled" : ""} aria-label="เลื่อน ${esc(m.name)} ลง">↓</button>
        </div>
        <div class="row-actions">
          <button class="ghost" data-edit="${id}">แก้ไข</button>
          <button class="ghost danger" data-exit="${id}">ให้ออกจากแก๊ง</button>
          <button class="delete" data-delete="${id}">ลบ</button>
        </div>
      </div>`;
}

function renderList() {
  const counts = Object.fromEntries(TIERS.map((t) => [t, allMembers.filter((m) => tierOf(m) === t).length]));
  const exitedCount = allMembers.filter((m) => tierOf(m) === "EXIT").length;
  document.querySelectorAll("#admin-tabs .tab").forEach((btn) => {
    const t = btn.dataset.tier;
    const n = t === "ALL" ? allMembers.length : t === "EXIT" ? exitedCount : counts[t];
    btn.textContent = `${t === "EXIT" ? "ออกจากแก๊ง" : t} ${n}`;
    btn.classList.toggle("active", t === activeTier);
  });
  $("#total").textContent = `${allMembers.length} MEMBERS`;

  const shown = activeTier === "EXIT" ? ["EXIT"] : TIERS.filter((t) => activeTier === "ALL" || t === activeTier);
  const html = shown.map((t) => {
    const rows = allMembers.filter((m) => tierOf(m) === t);
    if (!rows.length) return "";
    const head = t === "EXIT" ? "อดีตสมาชิก (ออกจากแก๊งแล้ว)" : `${t} TIER`;
    return `<div class="tier-head tier-${t.toLowerCase()}"><span>${head}</span><b>${rows.length}</b></div>${rows.map((m, i) => rowHTML(m, i, rows.length)).join("")}`;
  }).join("");
  $("#admin-list").innerHTML = html || '<p class="empty">ยังไม่มีสมาชิกในหมวดนี้</p>';
}

async function refresh() {
  try {
    allMembers = await api("/api/members/full");
    renderList();
  } catch (err) { $("#admin-list").textContent = err.message; }
  loadApplications();
  loadStatus();
  loadDiscordStatus();
  loadSiteSong();
}

$("#admin-tabs").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-tier]");
  if (!btn) return;
  activeTier = btn.dataset.tier;
  renderList();
});

/* ---------- 5. REORDER (เลื่อนลำดับคน) ---------- */
function flashOrder(text) {
  const el = $("#order-msg");
  if (!el) return;
  el.textContent = text;
  clearTimeout(flashOrder.timer);
  flashOrder.timer = setTimeout(() => { el.textContent = ""; }, 3000);
}

/* สลับกับสมาชิกคนถัดไป/ก่อนหน้าในหมวดเดียวกันเท่านั้น
   (หน้าเว็บแสดงแยกตามหมวด จึงสลับเฉพาะคนหมวดเดียวกันถึงเห็นผล) */
function moveMember(id, dir) {
  const from = allMembers.findIndex((m) => String(m.id) === String(id));
  if (from < 0) return false;
  const tier = tierOf(allMembers[from]);
  let to = from + dir;
  while (to >= 0 && to < allMembers.length && tierOf(allMembers[to]) !== tier) to += dir;
  if (to < 0 || to >= allMembers.length) return false;
  [allMembers[from], allMembers[to]] = [allMembers[to], allMembers[from]];
  return true;
}

async function saveOrder() {
  try {
    await api("/api/members/order", { method: "PUT", body: JSON.stringify({ ids: allMembers.map((m) => m.id) }) });
    renderList();
    flashOrder("บันทึกลำดับแล้ว ✓");
  } catch (err) {
    flashOrder("บันทึกไม่สำเร็จ");
    alert(err.message);
    refresh();
  }
}

$("#admin-list").addEventListener("click", (e) => {
  const move = e.target.closest("[data-move]");
  if (!move) return;
  if (moveMember(move.dataset.id, move.dataset.move === "up" ? -1 : 1)) saveOrder();
});

/* ลากวาง (drag & drop) — อนุญาตเฉพาะภายในหมวดเดียวกัน */
let dragId = null;
const dropMark = () => $("#admin-list").querySelector(".drop-before, .drop-after");
const clearDropMark = () => { const el = dropMark(); if (el) el.classList.remove("drop-before", "drop-after"); };

$("#admin-list").addEventListener("dragstart", (e) => {
  const row = e.target.closest(".admin-row");
  if (!row) return;
  dragId = row.dataset.id;
  row.classList.add("dragging");
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", dragId);
});

$("#admin-list").addEventListener("dragend", () => {
  dragId = null;
  clearDropMark();
  $("#admin-list").querySelectorAll(".dragging").forEach((el) => el.classList.remove("dragging"));
});

$("#admin-list").addEventListener("dragover", (e) => {
  const row = e.target.closest(".admin-row");
  if (!row || !dragId || row.dataset.id === String(dragId)) return;
  const dragged = allMembers.find((m) => String(m.id) === String(dragId));
  const target = allMembers.find((m) => String(m.id) === row.dataset.id);
  if (!dragged || !target || tierOf(dragged) !== tierOf(target)) {
    e.dataTransfer.dropEffect = "none";
    clearDropMark();
    return;
  }
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  const before = e.clientY < row.getBoundingClientRect().top + row.offsetHeight / 2;
  clearDropMark();
  row.classList.add(before ? "drop-before" : "drop-after");
});

$("#admin-list").addEventListener("drop", async (e) => {
  const row = e.target.closest(".admin-row");
  if (!row || !dragId) return;
  e.preventDefault();
  const before = row.classList.contains("drop-before");
  const targetId = row.dataset.id;
  const draggedId = dragId;
  dragId = null;
  clearDropMark();
  if (String(targetId) === String(draggedId)) return;

  const from = allMembers.findIndex((m) => String(m.id) === String(draggedId));
  if (from < 0) return;
  const dragged = allMembers[from];
  const target = allMembers.find((m) => String(m.id) === String(targetId));
  if (!target || tierOf(target) !== tierOf(dragged)) return; // ข้ามหมวดไม่ได้
  allMembers.splice(from, 1);
  let to = allMembers.findIndex((m) => String(m.id) === String(targetId));
  if (to < 0) { allMembers.splice(from, 0, dragged); return; }
  if (!before) to += 1;
  allMembers.splice(to, 0, dragged);
  await saveOrder();
});

$("#admin-list").addEventListener("dragleave", (e) => {
  if (e.target.closest(".admin-row") && !e.currentTarget.contains(e.relatedTarget)) clearDropMark();
});

$("#admin-list").addEventListener("click", async (e) => {
  const edit = e.target.closest("[data-edit]");
  const del = e.target.closest("[data-delete]");
  const exit = e.target.closest("[data-exit]");
  const restore = e.target.closest("[data-restore]");
  try {
    if (edit) {
      const list = await api("/api/members/full");
      const m = list.find((x) => String(x.id) === edit.dataset.edit);
      if (!m) return;
      for (const k of ["id", "name", "role", "group", "image", "description", "discord", "facebook", "tiktok", "icAge", "facebookIc", "discordUser", "driveLink", "tagline", "status", "theme", "pattern", "songTitle", "songArtist", "songUrl"]) memberForm.elements[k].value = k === "group" ? ({ LEADERSHIP: "LEADER", MEMBERS: "MEMBER" }[m[k]] || m[k] || "MEMBER") : (m[k] || "");
      showPhotoPreview(m.image || "");
      $("#form-title").textContent = "แก้ไขสมาชิก";
      $("#cancel-edit").hidden = false;
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
    if (del) {
      const list = await api("/api/members/full");
      const m = list.find((x) => String(x.id) === del.dataset.delete);
      if (m && confirm(`ต้องการลบ ${m.name} ออกจากระบบถาวรหรือไม่?\n\nถ้าแค่ต้องการให้ออกจากแก๊ง ใช้ปุ่ม "ให้ออกจากแก๊ง" แทน (กู้กลับได้)`)) {
        await api(`/api/members/${encodeURIComponent(m.id)}`, { method: "DELETE" });
        refresh();
      }
    }
    if (exit) {
      const list = await api("/api/members/full");
      const m = list.find((x) => String(x.id) === exit.dataset.exit);
      if (!m) return;
      if (!confirm(`ให้ ${m.name} ออกจากแก๊ง?\n\n- ซ่อนจากหน้าเว็บทันที\n- ล็อกอินบอร์ดใช้ไม่ได้ทันที\n- ข้อมูลบอร์ดยังอยู่ และกด "รับกลับเข้าแก๊ง" ได้`)) return;
      const reason = (prompt(`เหตุผลที่ให้ ${m.name} ออก (เว้นว่างได้)`, "") || "").trim();
      await api(`/api/members/${encodeURIComponent(m.id)}/exit`, { method: "POST", body: JSON.stringify({ reason }) });
      refresh();
    }
    if (restore) {
      const list = await api("/api/members/full");
      const m = list.find((x) => String(x.id) === restore.dataset.restore);
      if (!m) return;
      if (!confirm(`รับ ${m.name} กลับเข้าแก๊ง? (ล็อกอินบอร์ดด้วยรหัสเดิมได้ทันที)`)) return;
      await api(`/api/members/${encodeURIComponent(m.id)}/restore`, { method: "POST" });
      refresh();
    }
  } catch (err) { alert(err.message); }
});

checkSession();

/* ============================================================
   6. CREDENTIALS MODAL (ชื่อผู้ใช้ + รหัส + ข้อความ DM)
   ============================================================ */
const credOverlay = $("#cred-overlay");

function openCred({ title, status, info = [], message = "" }) {
  $("#cred-title").textContent = title || "ส่งรหัสให้สมาชิก";
  $("#cred-status").textContent = status || "";
  $("#cred-info").innerHTML = info.map(([k, v]) => `<li><b>${esc(k)}</b><span>${v}</span></li>`).join("");
  $("#cred-message").textContent = message;
  $("#cred-copy").hidden = !message;
  credOverlay.hidden = false;
}
function closeCred() { credOverlay.hidden = true; }
$("#cred-close").addEventListener("click", closeCred);
$("#cred-done").addEventListener("click", closeCred);
credOverlay.addEventListener("click", (e) => { if (e.target === credOverlay) closeCred(); });
$("#cred-copy").addEventListener("click", async () => {
  const text = $("#cred-message").textContent;
  try { await navigator.clipboard.writeText(text); }
  catch {
    const range = document.createRange();
    range.selectNodeContents($("#cred-message"));
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand("copy");
  }
  $("#cred-copy").textContent = "คัดลอกแล้ว ✓";
  setTimeout(() => { $("#cred-copy").textContent = "คัดลอกข้อความ DM"; }, 2000);
});

/* DM result → ข้อความ + ข้อมูลที่ต้องใช้ส่งเอง */
function dmReport(dm, username, password) {
  const sent = dm && dm.status === "sent";
  const target = dm && dm.recipientId
    ? `User ID ${esc(dm.recipientId)}${dm.viaText ? ` · ${esc(dm.viaText)}` : ""}`
    : "ไม่พบ User ID (ผู้สมัครต้องกรอก User ID หรือตั้ง DISCORD_GUILD_ID)";
  return {
    status: sent
      ? "บอทส่ง DM ให้ผู้สมัครเรียบร้อยอัตโนมัติแล้ว ✓"
      : "ระบบยังส่ง DM อัตโนมัติไม่ได้" + (dm && dm.error ? ` — ${dm.error}` : "") + " กดคัดลอกข้อความด้านล่างไปส่งให้ผู้สมัครเองได้เลย",
    info: [
      ["ชื่อผู้ใช้", `<code>${esc(username)}</code>`],
      ["รหัสผ่าน", `<code>${esc(password)}</code>`],
      ["สถานะ DM", sent ? "ส่งแล้วอัตโนมัติ" : "ต้องส่งเอง"],
      ["ปลายทาง", target]
    ],
    message: (dm && dm.message) || ""
  };
}

/* ---------- 7. APPLICATIONS INBOX (สมัครเข้าแก๊ง → คัดคน) ---------- */
let applications = [];
let applyTab = "pending";
const APPLY_TEXT = { pending: "รอตรวจ", approved: "รับเข้าแล้ว", rejected: "ไม่ผ่าน" };

function applyRowHTML(a) {
  const id = esc(a.id);
  const status = a.status || "pending";
  const links = [
    a.facebookIc ? `<a href="${esc(a.facebookIc)}" target="_blank" rel="noopener">FACEBOOK IC ↗</a>` : "",
    a.driveLink ? `<a href="${esc(a.driveLink)}" target="_blank" rel="noopener">GOOGLE DRIVE ↗</a>` : ""
  ].join("");
  const isAck = a.dm && a.dm.kind === "ack";
  const dmNote = a.dm
    ? `<div class="apply-dm ${a.dm.status === "sent" ? "ok" : "warn"}">${
        a.dm.status === "sent"
          ? (isAck ? "แจ้งรับใบสมัครทาง DM แล้ว ✓" : "ส่งรหัสทาง DM แล้วอัตโนมัติ ✓")
          : `${isAck ? "ยังไม่ได้แจ้งรับใบสมัคร" : "ยังไม่ได้ส่ง DM"} — ${esc((a.dm.error || "").slice(0, 60))}`
      }</div>`
    : "";
  return `
    <div class="apply-row status-${status}" data-apply="${id}">
      <div class="apply-head">
        <div>
          <strong>${esc(a.name)}</strong>
          <small>อายุ IC ${esc(a.icAge)} · ดิสคอร์ด ${esc(a.discordUser)}</small>
        </div>
        <span class="badge ${status}"><i></i>${APPLY_TEXT[status] || status}</span>
      </div>
      <p class="apply-about">${esc(a.about)}</p>
      ${links ? `<div class="row-socials">${links}</div>` : ""}
      ${dmNote}
      <div class="apply-foot">
        <small class="muted">ส่งเมื่อ ${a.createdAt ? new Date(a.createdAt).toLocaleString("th-TH") : "—"}${a.reason ? ` · เหตุผล: ${esc(a.reason)}` : ""}</small>
        <div class="apply-actions">
          ${status !== "approved" ? `
            <label class="apply-group">หมวด
              <select data-group-for="${id}">
                <option value="MEMBER" ${a.group === "MEMBER" ? "selected" : ""}>MEMBER</option>
                <option value="SUPPORT">SUPPORT</option>
                <option value="LEADER">LEADER</option>
                <option value="BOSS">BOSS</option>
              </select>
            </label>
            <button class="silver-btn" data-approve="${id}">รับเข้าแก๊ง</button>` : `<button class="ghost" data-resent="${id}">ส่งรหัสอีกครั้ง</button>`}
          ${status === "pending" ? `<button class="ghost" data-ack="${id}">แจ้งรับใบสมัคร</button>` : ""}
          ${status === "pending" ? `<button class="ghost" data-reject="${id}">ไม่ผ่าน</button>` : ""}
          <button class="delete" data-drop="${id}">ลบ</button>
        </div>
      </div>
    </div>`;
}

function renderApplications() {
  const counts = {
    pending: applications.filter((a) => a.status === "pending").length,
    approved: applications.filter((a) => a.status === "approved").length,
    rejected: applications.filter((a) => a.status === "rejected").length
  };
  document.querySelectorAll("#apply-tabs .tab").forEach((btn) => {
    const s = btn.dataset.status;
    btn.textContent = `${s === "ALL" ? "ทั้งหมด" : APPLY_TEXT[s]} ${s === "ALL" ? applications.length : counts[s]}`;
    btn.classList.toggle("active", s === applyTab);
  });
  const badge = $("#apply-count");
  badge.className = "badge " + (counts.pending ? "pending" : "approved");
  badge.innerHTML = `<i></i>${counts.pending} รอตรวจ`;

  const shown = applications.filter((a) => applyTab === "ALL" || (a.status || "pending") === applyTab);
  $("#apply-list").innerHTML = shown.length
    ? shown.map(applyRowHTML).join("")
    : '<p class="empty">ยังไม่มีใบสมัครในหมวดนี้</p>';
}

async function loadApplications() {
  try {
    applications = await api("/api/applications");
    renderApplications();
  } catch (err) { $("#apply-list").textContent = err.message; }
}

$("#apply-tabs").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-status]");
  if (!btn) return;
  applyTab = btn.dataset.status;
  renderApplications();
});

$("#apply-list").addEventListener("click", async (e) => {
  const approve = e.target.closest("[data-approve]");
  const reject = e.target.closest("[data-reject]");
  const drop = e.target.closest("[data-drop]");
  const resent = e.target.closest("[data-resent]");
  const ack = e.target.closest("[data-ack]");
  try {
    if (approve) {
      const a = applications.find((x) => String(x.id) === approve.dataset.approve);
      if (!a) return;
      const picker = document.querySelector(`[data-group-for="${a.id}"]`);
      const group = ((picker && picker.value) || "MEMBER").toUpperCase();
      approve.disabled = true;
      const data = await api(`/api/applications/${encodeURIComponent(a.id)}/approve`, { method: "POST", body: JSON.stringify({ group }) });
      const report = dmReport(data.dm, data.member.credentials.username, data.member.credentials.password);
      openCred({ title: `รับ ${a.name} เข้าแก๊งแล้ว (${group})`, ...report });
      refresh();
    }
    if (resent) {
      const member = allMembers.find((m) => String(m.id) === String(resent.dataset.resent));
      if (!member) return;
      const data = await api(`/api/members/${encodeURIComponent(member.id)}/credentials`, { method: "POST", body: JSON.stringify({ reset: false }) });
      const report = dmReport(data.dm, data.username, data.password);
      openCred({ title: `ส่งรหัสให้ ${member.name}`, ...report });
    }
    if (ack) {
      const a = applications.find((x) => String(x.id) === ack.dataset.ack);
      if (!a) return;
      ack.disabled = true;
      const data = await api(`/api/applications/${encodeURIComponent(a.id)}/ack`, { method: "POST" });
      const sent = data.dm && data.dm.status === "sent";
      openCred({
        title: `แจ้งรับใบสมัคร — ${a.name}`,
        status: sent
          ? "ส่งข้อความตอบกลับให้ผู้สมัครแล้วอัตโนมัติ ✓"
          : `ยังส่งอัตโนมัติไม่ได้${data.dm && data.dm.error ? ` — ${data.dm.error}` : ""} กดคัดลอกข้อความด้านล่างไปส่งให้ผู้สมัครเองได้เลย`,
        info: [
          ["สถานะ DM", sent ? "ส่งแล้วอัตโนมัติ" : "ต้องส่งเอง"],
          ["ปลายทาง", data.dm && data.dm.recipientId ? `User ID ${esc(data.dm.recipientId)}` : "ไม่พบ User ID (ให้ผู้สมัครกรอก User ID หรือตั้ง DISCORD_GUILD_ID)"],
          ["สถานะใบสมัคร", "รอตรวจ"]
        ],
        message: (data.dm && data.dm.message) || ""
      });
      refresh();
    }
    if (reject) {
      const a = applications.find((x) => String(x.id) === reject.dataset.reject);
      if (!a) return;
      const reason = (prompt(`เหตุผลที่ให้ ${a.name} ไม่ผ่าน (เว้นว่างได้)`, "") || "").trim();
      await api(`/api/applications/${encodeURIComponent(a.id)}/reject`, { method: "POST", body: JSON.stringify({ reason }) });
      refresh();
    }
    if (drop) {
      if (!confirm("ต้องการลบใบสมัครนี้หรือไม่?")) return;
      await api(`/api/applications/${encodeURIComponent(drop.dataset.drop)}`, { method: "DELETE" });
      refresh();
    }
  } catch (err) { alert(err.message); }
});

/* ---------- 8. MEMBER CREDENTIALS (ส่ง/ออกรหัสใหม่) ---------- */
$("#admin-list").addEventListener("click", async (e) => {
  const send = e.target.closest("[data-send]");
  const reset = e.target.closest("[data-reset]");
  if (!send && !reset) return;
  const id = (send || reset).dataset[send ? "send" : "reset"];
  const member = allMembers.find((m) => String(m.id) === String(id));
  if (!member) return;
  const isReset = !!reset;
  if (isReset && !confirm(`ออกรหัสใหม่ให้ ${member.name}? รหัสเดิมจะใช้ไม่ได้ทันที`)) return;
  try {
    const data = await api(`/api/members/${encodeURIComponent(id)}/credentials`, { method: "POST", body: JSON.stringify({ reset: isReset }) });
    const report = dmReport(data.dm, data.username, data.password);
    openCred({ title: isReset ? `ออกรหัสใหม่ให้ ${member.name}` : `ส่งรหัสให้ ${member.name}`, ...report });
    refresh();
  } catch (err) { alert(err.message); }
});

/* ---------- 9b. DISCORD BOT STATUS ---------- */
function renderDiscordStatus(d) {
  const badge = $("#discord-badge");
  const msg = $("#discord-msg");
  if (!d.enabled) {
    badge.className = "badge pending";
    badge.innerHTML = "<i></i>โหมดแมนนวล";
    msg.innerHTML = `<b>${esc(d.reason || "ยังไม่พร้อม")}</b><br>${esc(d.message || "")}`;
    return;
  }
  badge.className = "badge approved";
  badge.innerHTML = "<i></i>พร้อมส่งเอง";
  const bot = d.bot || {};
  const guild = d.guild ? `${esc(d.guild.name)} (${esc(d.guild.id)})` : (d.guildId ? `ระบุไว้ ${esc(d.guildId)} แต่บอทเข้าไม่ถึง` : "ยังไม่ได้ตั้ง DISCORD_GUILD_ID");
  msg.innerHTML =
    `บอท: <b>${esc(bot.name || "-")}</b> <code>${esc(bot.handle || "")}</code> · เซิร์ฟเวอร์: ${guild}<br>` +
    `ค้นหาชื่อผู้ใช้ → User ID: <b>${d.guildLookup ? "ได้" : "ไม่ได้"}</b><br>${esc(d.message || "")}`;
}

async function loadDiscordStatus() {
  try {
    renderDiscordStatus(await api("/api/discord/status"));
  } catch (err) { $("#discord-msg").textContent = err.message; }
}

$("#discord-check").addEventListener("click", async () => {
  const button = $("#discord-check");
  button.disabled = true;
  $("#discord-msg").textContent = "กำลังตรวจสอบ...";
  await loadDiscordStatus();
  button.disabled = false;
});

/* ---------- 10. SEED / BACKUP STATUS ---------- */
$("#seed-backup").addEventListener("click", async () => {
  const button = $("#seed-backup");
  button.disabled = true;
  try {
    await api("/api/backup", { method: "POST" });
    await loadStatus();
    button.textContent = "สำรองแล้ว ✓";
    setTimeout(() => { button.textContent = "สำรองข้อมูลเดี๋ยวนี้"; }, 2500);
  } catch (err) { alert(err.message); }
  finally { button.disabled = false; }
});

/* สถานะการส่งข้อมูลขึ้น Google ชีต + ปุ่มส่งเดี๋ยวนี้ */
$("#sheets-sync").addEventListener("click", async () => {
  const button = $("#sheets-sync");
  button.disabled = true;
  button.textContent = "กำลังส่ง...";
  try {
    await api("/api/sheets/sync", { method: "POST" });
    await loadStatus();
    button.textContent = "ส่งแล้ว ✓";
  } catch (err) {
    alert(err.message);
    button.textContent = "ส่งไม่สำเร็จ";
  } finally {
    button.disabled = false;
    setTimeout(() => { button.textContent = "ส่งขึ้นชีตเดี๋ยวนี้"; }, 3000);
  }
});

/* กู้ข้อมูลกลับจาก Google ชีต — โหลดเข้ามาทันที รวมเพิ่มเข้าข้อมูลที่มีอยู่ (ไม่เขียนทับ ไม่ต้องยืนยัน) */
$("#sheets-restore").addEventListener("click", async () => {
  const button = $("#sheets-restore");
  button.disabled = true;
  button.textContent = "กำลังโหลด...";
  try {
    const r = await api("/api/sheets/restore", { method: "POST" });
    await refresh();
    await loadStatus();
    const summary = Object.entries(r.report || {}).map(([sheet, v]) =>
      `${sheet}: ${v.ok ? `เพิ่มใหม่ ${v.added || 0} · มีอยู่แล้ว ${v.kept || 0} · รวม ${v.count} รายการ` : v.error}`).join("\n");
    alert(`โหลดข้อมูลจากชีตแล้ว\n\n${summary}`);
    button.textContent = "โหลดแล้ว ✓";
  } catch (err) {
    alert(err.message);
    button.textContent = "กู้ไม่สำเร็จ";
  } finally {
    button.disabled = false;
    setTimeout(() => { button.textContent = "กู้ข้อมูลจากชีตกลับมา"; }, 3000);
  }
});

/* สถานะ GitHub backup (เข้ารหัส + ดึงกลับเองหลัง deploy) */
function renderCloud(c) {
  const badge = $("#cloud-badge");
  const msg = $("#cloud-msg");
  const when = (iso) => (iso ? new Date(iso).toLocaleString("th-TH") : "");
  if (!c || !c.configured) {
    badge.className = "badge rejected";
    badge.innerHTML = "<i></i>ยังไม่ได้ตั้งค่า";
    msg.innerHTML =
      "ยังไม่ได้ตั้ง <code>BACKUP_KEY</code> / <code>BACKUP_GITHUB_TOKEN</code> / <code>BACKUP_REPO</code> — ข้อมูลอยู่แค่บนดิสก์เซิร์ฟเวอร์ " +
      "<b>ถ้ารันบน Render ฟรี ข้อมูลจะหายทุกครั้งที่ deploy/restart</b><br>" +
      "ดูวิธีตั้งค่าด้านล่าง เพื่อให้ระบบดึงข้อมูลกลับเองอัตโนมัติหลัง deploy";
    return;
  }
  const pushedOk = !!c.lastPushAt && !c.lastPushError;
  badge.className = "badge " + (c.lastPushError ? "rejected" : pushedOk ? "approved" : "pending");
  badge.innerHTML = `<i></i>${c.lastPushError ? "PUSH ERROR" : pushedOk ? "BACKUP OK" : "รอสำรอง"}`;
  const lines = [
    `repo <code>${esc(c.repo)}</code> · branch <code>${esc(c.branch)}</code> · เข้ารหัส AES-256 · push ไม่ถี่กว่าทุก ${esc(c.intervalSec)} วิ`,
    `push ล่าสุด: ${when(c.lastPushAt) || "ยังไม่เคย"}${(c.queue || []).length ? ` · ค้างส่ง: ${esc(c.queue.join(", "))}` : ""}`
  ];
  if (c.lastRestoreAt) lines.push(`✓ เปิดเซิร์ฟเวอร์แล้วดึงข้อมูลกลับจาก ${esc(c.lastRestoreSource)} เมื่อ ${when(c.lastRestoreAt)}`);
  if (c.lastPushError) lines.push(`▲ push ไม่สำเร็จ: ${esc(c.lastPushError)}`);
  if (c.lastRestoreError) lines.push(`▲ กู้คืนไม่สำเร็จ: ${esc(c.lastRestoreError)}`);
  msg.innerHTML = lines.join("<br>");
}

/* สถานะการส่งข้อมูลเข้า Google ชีต */
function renderSheets(s) {
  const badge = $("#sheets-badge");
  const msg = $("#sheets-msg");
  if (!badge || !msg) return;
  const when = (iso) => (iso ? new Date(iso).toLocaleString("th-TH") : "");
  if (!s || !s.configured) {
    badge.className = "badge rejected";
    badge.innerHTML = "<i></i>ยังไม่ได้ตั้งค่า";
    msg.innerHTML =
      "ยังไม่ได้ตั้ง <code>SHEETS_WEBHOOK_URL</code> — ข้อมูลจะอยู่แค่บนเซิร์ฟเวอร์<br>" +
      "ดูวิธีตั้งค่าในหัวข้อ <b>\"วิธีตั้งค่าให้ส่งข้อมูลเข้า Google ชีต\"</b> ด้านล่าง";
    return;
  }
  if (s.urlHint && !s.lastSyncAt) {
    /* URL ผิดรูปแบบและยังไม่เคยส่งสำเร็จเลย → ให้เห็นสาเหตุทันที
       แต่ถ้าเคยส่งสำเร็จมาแล้ว แสดงว่าใช้งานได้จริง จึงไม่ขึ้นเตือนนี้ */
    badge.className = "badge rejected";
    badge.innerHTML = "<i></i>URL ผิด";
    msg.innerHTML = `▲ <b>SHEETS_WEBHOOK_URL ตั้งค่าผิดรูปแบบ</b><br>${esc(s.urlHint)}<br>` +
      `วิธีเอา URL ที่ถูกต้อง: เปิด Apps Script → <b>Deploy → Manage deployments</b> → ไอคอนดินสอ → Version: New version → Deploy → คัดลอก URL ที่ลงท้ายด้วย <code>/exec</code>`;
    return;
  }
  const apps = s.sheets.Applications || {};
  const members = s.sheets.Members || {};
  const errors = [apps.error, members.error].filter(Boolean);
  badge.className = "badge " + (errors.length ? "rejected" : s.lastSyncAt ? "approved" : "pending");
  badge.innerHTML = `<i></i>${errors.length ? "SYNC ERROR" : s.lastSyncAt ? "SHEET OK" : "รอส่ง"}`;
  const lines = [
    `บันทึกต่อท้าย/อัปเดตเฉพาะแถวที่เปลี่ยน (ไม่ล้างชีต) · ไม่ถี่กว่าทุก ${esc(s.intervalSec)} วิ · รหัสลับ (SHEETS_SECRET): <b>${s.secretSet ? "ตั้งแล้ว" : "ยังไม่ได้ตั้ง"}</b>`,
    s.keepaliveSec ? `★ ระบบส่งข้อมูลขึ้นชีตให้เองทุก ${esc(s.keepaliveSec)} วินาที + ทุกครั้งที่มีการแก้ไข → กดปุ่มกู้ได้ทุกเมื่อ ไม่ต้องมากดส่งเอง` : `★ ระบบส่งข้อมูลขึ้นชีตให้เองทุกครั้งที่มีการแก้ไข`,
    `ชีต Applications: ${apps.at ? `${esc(apps.rows)} แถว · ${when(apps.at)}` : "ยังไม่เคยส่ง"}`,
    `ชีต Members: ${members.at ? `${esc(members.rows)} แถว · ${when(members.at)}` : "ยังไม่เคยส่ง"}`,
    `ส่งล่าสุด: ${when(s.lastSyncAt) || "ยังไม่เคย"}${(s.queue || []).length ? ` · ค้างส่ง: ${esc(s.queue.join(", "))}` : ""}`,
    `สำเนาสำหรับกู้คืน (ชีตลับ _raw): ${apps.at || members.at ? "พร้อมใช้ — กดปุ่ม \"กู้ข้อมูลจากชีตกลับมา\" ได้ทุกเมื่อ" : "ยังไม่มี (ระบบจะสร้างให้เองอัตโนมัติหลังตั้งค่าเสร็จ)"}`,
    `กู้คืนล่าสุด: ${s.lastRestoreAt ? `${esc(s.lastRestoreSource)} · ${when(s.lastRestoreAt)}` : "ยังไม่เคย"}`
  ];
  if (s.lastError) lines.push(`▲ ส่งไม่สำเร็จ: ${esc(s.lastError)}`);
  msg.innerHTML = lines.join("<br>");
}

async function loadStatus() {
  try {
    const d = await api("/api/status");
    const m = d.members;
    const a = d.applications;
    const when = (iso) => (iso ? new Date(iso).toLocaleString("th-TH") : "—");
    $("#seed-msg").innerHTML =
      `สำรองอัตโนมัติทุกครั้งที่บันทึก → <code>data/${esc(m.seed)}</code> และ <code>data/${esc(a.seed)}</code><br>` +
      `สมาชิก ${m.count} คน · ใบสมัคร ${a.total} ฉบับ (รอตรวจ ${a.pending}) · สำรองล่าสุด ${when(m.seededAt || a.seededAt)}` +
      (m.restoredAt ? `<br>▲ เคยกู้คืนข้อมูลจาก seed เมื่อ ${when(m.restoredAt)}` : "");
    const badge = $("#seed-badge");
    const ok = !!d.members.seededAt || !!d.applications.seededAt;
    badge.className = "badge " + (ok ? "approved" : "pending");
    badge.innerHTML = `<i></i>${ok ? "SEED OK" : "รอสำรอง"}`;
    $("#seed-msg").innerHTML += `<br>สถานะส่ง DM อัตโนมัติ: <b>${d.discord.enabled ? "เปิด" : "ปิด"}</b>${d.discord.enabled ? "" : " (ตั้งค่า DISCORD_BOT_TOKEN เพื่อให้ระบบส่ง DM เอง)"}`;
    renderCloud(d.cloud);
    renderSheets(d.sheets);
    /* กันเหนียว: ถ้าเว็บว่างเปล่าทั้งสมาชิกและใบสมัคร แต่มีสำเนาบนชีต ให้ชวนกดกู้ */
    const hint = $("#sheets-hint");
    if (hint) {
      const empty = !m.count && !a.total;
      hint.hidden = !(empty && d.sheets && d.sheets.configured);
      hint.innerHTML =
        "▲ ตอนนี้ยังไม่มีข้อมูลสมาชิกและใบสมัครในระบบเลย — ถ้าเพิ่ง deploy/restart ใหม่ " +
        "ให้กดปุ่ม <b>กู้ข้อมูลจากชีตกลับมา</b> ด้านบน เพื่อดึงข้อมูลเดิมกลับมา " +
        "(ปกติระบบจะกู้ให้อัตโนมัติตอนเปิดเซิร์ฟเวอร์อยู่แล้ว — ถ้าเห็นข้อความนี้แสดงว่ารอบนั้นกู้ไม่สำเร็จ)";
    }
  } catch (err) { $("#seed-msg").textContent = err.message; }
}

