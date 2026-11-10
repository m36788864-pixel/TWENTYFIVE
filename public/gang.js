/* ============================================================
   TWENTYFIVE — GANG MANAGEMENT SYSTEM (CLIENT)
   ============================================================ */
(() => {
  "use strict";

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const state = {
    me: null,
    perms: {},
    members: [],
    meta: {},
    pointsCfg: {},
    view: "dashboard",
    adminPane: "reports",
    recordTab: "scores",
    recordMemberId: null,
    report: { type: "shop", result: "won", proofUrl: "", memberId: "" },
    behaviorKind: "warning",
    reportPage: 1,
    reportPages: 1,
    currentReports: [],
    events: null,
    records: null
  };

  const STATUS_CLASS = { pending: "warn", approved: "ok", rejected: "bad", completed: "info" };
  const ACTIVITY_ICON = { shop: "🏪", loop: "🔁", airdrop: "📦" };
  const ROLE_CLASS = { leader: "leader", deputy: "deputy", staff: "staff", member: "member" };
  const EVENT_TEXT = {
    "report:new": ["📝 รายงานกิจกรรมใหม่", "มีสมาชิกส่งรายงานเข้าระบบ"],
    "report:updated": ["✅ อัปเดตสถานะรายงาน", "ผลการตรวจสอบรายงานเปลี่ยนแล้ว"],
    "score:changed": ["⭐ คะแนนมีการเปลี่ยนแปลง", "คะแนนสะสมของคุณถูกอัปเดต"],
    "leave:new": ["🗓️ คำขอลาใหม่", "มีคำขอลาเข้าระบบ"],
    "leave:updated": ["📬 อัปเดตสถานะการลา", "คำขอลาของคุณถูกตรวจสอบแล้ว"],
    "behavior:new": ["⚠️ บันทึกความประพฤติใหม่", "มีความประพฤติใหม่ถูกบันทึก"],
    "leaderboard:updated": ["🏆 Leaderboard อัปเดต", "อันดับคนขยันถูกคำนวณใหม่"],
    "config:updated": ["⚙️ ตั้งค่าระบบเปลี่ยน", "แอดมินอัปเดตการตั้งค่า"],
    "member:updated": ["👤 ข้อมูลสมาชิกเปลี่ยน", "ตำแหน่ง/สิทธิ์ถูกอัปเดต"]
  };

  /* ---------------- helpers ---------------- */
  const esc = (v) => String(v === undefined || v === null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (v) => Number(v || 0).toLocaleString("th-TH");
  const fmtDate = (v) => {
    if (!v) return "-";
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return String(v);
    return d.toLocaleDateString("th-TH", { day: "2-digit", month: "short", year: "numeric" });
  };
  const fmtDateTime = (v) => {
    if (!v) return "-";
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return String(v);
    return d.toLocaleString("th-TH", { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" });
  };
  const todayStr = () => {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  };
  const dateOffset = (days) => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  };
  const debounce = (fn, ms) => {
    let timer = null;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
  };

  async function api(url, options = {}) {
    const res = await fetch(url, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) }
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && !url.includes("/session")) {
      showLogin("เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่");
      throw new Error(data.error || "กรุณาเข้าสู่ระบบใหม่");
    }
    if (!res.ok) throw new Error(data.error || `เกิดข้อผิดพลาด (${res.status})`);
    return data;
  }

  function setMsg(el, text, ok) {
    if (!el) return;
    el.textContent = text || "";
    el.className = "message" + (text ? (ok ? " ok" : " bad") : "");
  }

  function toast(title, text, icon) {
    const wrap = $("#toasts");
    const el = document.createElement("div");
    el.className = "toast";
    el.innerHTML = `<span class="t-icon">${esc(icon || "🔔")}</span><div><b>${esc(title)}</b><span>${esc(text || "")}</span></div>`;
    wrap.appendChild(el);
    setTimeout(() => { el.style.opacity = "0"; el.style.transform = "translateY(8px)"; setTimeout(() => el.remove(), 300); }, 5200);
  }

  function openModal(html, wide) {
    const box = $("#modal-box");
    box.classList.toggle("wide", !!wide);
    $("#modal-content").innerHTML = html;
    $("#modal").hidden = false;
    document.body.style.overflow = "hidden";
    return $("#modal-content");
  }
  function closeModal() {
    $("#modal").hidden = true;
    $("#modal-content").innerHTML = "";
    document.body.style.overflow = "";
  }
  $("#modal-close").addEventListener("click", closeModal);
  $("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") closeModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#modal").hidden) closeModal(); });

  function statusBadge(status) {
    const list = state.meta.reportStatuses || [];
    const hit = list.find((x) => x.value === status);
    return `<span class="badge ${STATUS_CLASS[status] || ""}">${esc(hit ? hit.label : status)}</span>`;
  }
  function leaveBadge(status) {
    const list = state.meta.leaveStatuses || [];
    const hit = list.find((x) => x.value === status);
    return `<span class="badge ${STATUS_CLASS[status] || ""}">${esc(hit ? hit.label : status)}</span>`;
  }
  function roleBadge(role, label) {
    return `<span class="role-badge ${ROLE_CLASS[role] || "member"}">${esc(label || role || "Member")}</span>`;
  }
  const activityLabel = (value) => (state.meta.activities || []).find((x) => x.value === value)?.label || value || "-";
  const resultLabel = (value) => (state.meta.results || []).find((x) => x.value === value)?.label || value || "-";
  const leaveTypeLabel = (value) => (state.meta.leaveTypes || []).find((x) => x.value === value)?.label || value || "-";
  const pointsClass = (v) => (v > 0 ? "points-pos" : v < 0 ? "points-neg" : "points-zero");
  const signed = (v) => (Number(v) > 0 ? "+" : "") + num(v);

  function statCard(label, value, sub, cls) {
    return `<div class="stat ${cls || ""}"><small>${esc(label)}</small><b>${value}</b>${sub ? `<span>${esc(sub)}</span>` : ""}</div>`;
  }

  function memberAvatar(member, size) {
    const initial = esc(String(member && member.name || "25").trim().charAt(0).toUpperCase() || "2");
    const img = member && member.image ? `<img src="${esc(member.image)}" alt="">` : initial;
    return `<span class="mini-avatar"${size ? ` style="width:${size}px;height:${size}px"` : ""}>${img}</span>`;
  }

  /* ---------------- auth / boot ---------------- */
  function showLogin(message) {
    $("#app-view").hidden = true;
    $("#login-view").hidden = false;
    if (state.events) { state.events.close(); state.events = null; }
    if (message) setMsg($("#member-login-msg"), message, false);
  }

  function showApp() {
    $("#login-view").hidden = true;
    $("#app-view").hidden = false;
  }

  async function boot() {
    try {
      const session = await api("/api/gang/session");
      if (!session.authenticated) { showLogin(); return; }
      state.me = session;
      state.perms = session.perms || {};
      state.meta = session.meta || {};
      state.pointsCfg = session.points || {};
      /* รีเซ็ตสถานะที่ผูกกับผู้ใช้คนก่อน — กันการล็อกเอาต์แล้วสลับบัญชีในแท็บเดิม */
      state.report = { ...state.report, memberId: session.actor.memberId ? String(session.actor.memberId) : "", proofUrl: "" };
      state.records = null;
      state.currentReports = [];
      state.reportPage = 1;
      state.reportPages = 1;
      state.recordMemberId = null;
      state.adminPane = "reports";
      showApp();
      applySessionHeader();
      await loadMembers();
      connectEvents();
      navigate((location.hash || "#dashboard").replace("#", ""), false);
    } catch (err) {
      showLogin(err.message);
    }
  }

  function applySessionHeader() {
    const actor = state.me.actor;
    const member = state.me.member;
    const name = member ? member.name : actor.name;
    $("#user-name").textContent = name;
    $("#head-name").textContent = name;
    $("#dash-name").textContent = name;
    $("#user-role").outerHTML = roleBadge(actor.role, actor.roleLabel).replace('class="role-badge', 'id="user-role" class="role-badge');
    const avatar = $("#user-avatar");
    avatar.innerHTML = member && member.image ? `<img src="${esc(member.image)}" alt="">` : esc(String(name).charAt(0).toUpperCase() || "2");
    if (!member) {
      $("#user-points").textContent = "—";
      $("#dash-points").textContent = "—";
      $("#dash-rank").textContent = "#--";
    }
    updateNavPermissions();
  }

  function updateNavPermissions() {
    const perms = state.perms;
    $("#nav-admin").hidden = !perms.canViewAll;
    const recordBtn = $('[data-view="record"]');
    const reportBtn = $('[data-view="report"]');
    const leaveBtn = $('[data-view="leave"]');
    if (!state.me.actor.memberId) {
      if (recordBtn) recordBtn.hidden = true;
      if (leaveBtn) leaveBtn.hidden = true;
      if (reportBtn) reportBtn.hidden = !perms.canViewAll;
    }
    const auditBtn = $('[data-pane="audit"]');
    const settingsBtn = $('[data-pane="settings"]');
    if (auditBtn) auditBtn.hidden = !perms.canViewAudit;
    if (settingsBtn) settingsBtn.hidden = !perms.canManageConfig;
    $("#role-hint").textContent = perms.canManageMembers
      ? "คุณสามารถเปลี่ยนตำแหน่งและสิทธิ์ของสมาชิกได้"
      : "เฉพาะ Leader เท่านั้นที่เปลี่ยนตำแหน่งและสิทธิ์ได้";
  }

  async function loadMembers() {
    const data = await api("/api/gang/members");
    state.members = data.members || [];
    fillReportMembers();
    fillSelect($("#behavior-member"), state.members);
  }

  function fillReportMembers(keyword) {
    const select = $("#report-member");
    if (!select) return;
    const list = state.perms.canViewAll
      ? state.members
      : state.members.filter((m) => String(m.id) === String(state.me.actor.memberId));
    const current = state.report.memberId || (state.me.actor.memberId ? String(state.me.actor.memberId) : "");
    fillSelect(select, list, current, keyword);
    if (!select.value && list.length) select.value = String(list[0].id);
    state.report.memberId = select.value;
    if (!state.perms.canViewAll) {
      select.disabled = true;
      $("#report-member-filter-wrap").hidden = true;
    }
  }

  function fillSelect(select, list, selected, keyword) {
    if (!select) return;
    const key = String(keyword || "").trim().toLowerCase();
    const filtered = key ? list.filter((m) => String(m.name || "").toLowerCase().includes(key) || String(m.id).includes(key)) : list;
    const chosen = String(selected || select.value || "");
    select.innerHTML = '<option value="">— เลือกสมาชิก —</option>' + filtered.map((m) =>
      `<option value="${esc(m.id)}">${esc(m.name)} · ${esc(m.roleLabel || "Member")} · ${num(m.points)} pts</option>`
    ).join("");
    if (chosen && filtered.some((m) => String(m.id) === chosen)) select.value = chosen;
    else if (filtered.length) select.value = String(filtered[0].id);
  }

  /* ---------------- realtime ---------------- */
  function connectEvents() {
    if (state.events) state.events.close();
    try {
      const es = new EventSource("/api/gang/events");
      es.onmessage = (event) => {
        let data;
        try { data = JSON.parse(event.data); } catch { return; }
        const meta = EVENT_TEXT[data.type];
        if (meta) toast(meta[0], meta[1], Array.from(meta[0])[0] || "🔔");
        if (data.type === "report:new" && state.perms.canViewAll) {
          const badge = $("#admin-count");
          badge.hidden = false;
          badge.textContent = String((Number(badge.textContent) || 0) + 1);
        }
        if (data.type === "score:changed" && state.me.actor.memberId && String(data.memberId) === String(state.me.actor.memberId)) {
          refreshSelfPoints();
        }
        scheduleRefresh();
      };
      state.events = es;
    } catch { /* browser ไม่รองรับ SSE */ }
  }

  const scheduleRefresh = debounce(() => {
    if (!state.me) return;
    if (!["dashboard", "report", "leaderboard", "leave", "record", "admin"].includes(state.view)) return;
    if ($("#modal").hidden === false) return;
    if (state.view === "admin" && state.adminPane === "settings") return;
    loadView(state.view, true);
  }, 450);

  async function refreshSelfPoints() {
    try {
      const record = await api(`/api/gang/records/${state.me.actor.memberId}`);
      state.records = record;
      updatePoints(record.points);
    } catch { /* ignore */ }
  }

  function updatePoints(points) {
    $("#user-points").textContent = num(points);
    $("#dash-points").textContent = num(points);
    if (state.me && state.me.member) state.me.member.points = points;
  }

  /* ---------------- navigation ---------------- */
  const VIEW_META = {
    dashboard: ["DASHBOARD", "ภาพรวมผลงานและความประพฤติของคุณ"],
    report: ["ACTIVITY REPORT", "ส่งรายงานกิจกรรมพร้อมหลักฐานให้แอดมินตรวจสอบ"],
    leaderboard: ["LEADERBOARD", "จัดอันดับสมาชิกตามคะแนนและผลงาน"],
    leave: ["LEAVE SYSTEM", "ส่งคำขอลาและติดตามสถานะ"],
    record: ["MY RECORD", "ประวัติคะแนน การลา การเตือน และกิจกรรม"],
    admin: ["ADMIN DASHBOARD", "จัดการระบบแก๊งทั้งหมด"]
  };

  function navigate(view, reload) {
    if (view === "admin" && !state.perms.canViewAll) view = "dashboard";
    if (view === "record" && !state.me.actor.memberId) view = state.perms.canViewAll ? "admin" : "dashboard";
    state.view = view;
    $$("#app-nav button").forEach((btn) => btn.classList.toggle("active", btn.dataset.view === view));
    $$(".view").forEach((section) => { section.hidden = section.id !== `view-${view}`; });
    const meta = VIEW_META[view] || VIEW_META.dashboard;
    $("#view-eyebrow").textContent = meta[0];
    $("#head-sub").textContent = meta[1];
    if (reload !== false) history.replaceState(null, "", `#${view}`);
    loadView(view);
  }

  function loadView(view, silent) {
    if (view === "dashboard") return loadDashboard(silent);
    if (view === "report") return loadReportView();
    if (view === "leaderboard") return loadLeaderboard();
    if (view === "leave") return loadLeaveView();
    if (view === "record") return loadRecord(state.recordMemberId || state.me.actor.memberId);
    if (view === "admin") return loadAdmin();
  }

  /* ---------------- dashboard ---------------- */
  async function loadDashboard() {
    const isMember = !!state.me.actor.memberId;
    try {
      if (isMember) {
        const [record, leaderboard, leaves] = await Promise.all([
          api(`/api/gang/records/${state.me.actor.memberId}`),
          api("/api/gang/leaderboard?limit=500"),
          api("/api/gang/leaves?limit=5")
        ]);
        state.records = record;
        const row = (leaderboard.items || []).find((x) => String(x.memberId) === String(state.me.actor.memberId));
        updatePoints(record.points);
        $("#dash-rank").textContent = row ? `#${row.rank}` : "#--";
        $("#dash-role-badge").outerHTML = roleBadge(record.member.role, record.member.roleLabel).replace('class="role-badge', 'id="dash-role-badge" class="role-badge');
        $("#dash-status-badge").textContent = record.member.status === "อยู่ในแก๊ง" ? "ACTIVE" : "INACTIVE";
        $("#dash-status-badge").className = "badge " + (record.member.status === "อยู่ในแก๊ง" ? "ok" : "bad");

        const stats = record.stats || {};
        $("#dash-stats").innerHTML = [
          statCard("กิจกรรมที่ส่ง", num(stats.submitted), "รายการทั้งหมด", ""),
          statCard("กิจกรรมที่ผ่าน", num(stats.approved), `อัตราผ่าน ${stats.passRate || 0}%`, "ok"),
          statCard("จำนวนชัยชนะ", num(stats.wins), "ผลลัพธ์ชนะ", "gold"),
          statCard("รอตรวจสอบ", num(stats.pending), "รายการที่ยังไม่ตรวจ", "warn")
        ].join("");

        $("#dash-recent").innerHTML = (record.activityHistory || []).length
          ? record.activityHistory.slice(0, 6).map((r) => recentRow(r, false)).join("")
          : '<div class="empty">ยังไม่มีรายงานกิจกรรม — เริ่มส่งรายงานได้เลย</div>';

        const pendingLeaves = (leaves.items || []).filter((l) => l.status === "pending").slice(0, 3);
        const recentLeaves = pendingLeaves.length ? pendingLeaves : (leaves.items || []).slice(0, 3);
        $("#dash-leave").innerHTML = recentLeaves.length
          ? recentLeaves.map(leaveMiniRow).join("")
          : '<div class="empty">ยังไม่มีคำขอลา</div>';
      } else {
        $("#dash-rank").textContent = "#--";
        $("#dash-role-badge").outerHTML = roleBadge("leader", "Leader").replace('class="role-badge', 'id="dash-role-badge" class="role-badge');
        $("#dash-status-badge").textContent = "ADMIN";
        $("#dash-status-badge").className = "badge gold";
        $("#dash-stats").innerHTML = "";
        $("#dash-recent").innerHTML = '<div class="empty">เข้า ADMIN DASHBOARD เพื่อจัดการระบบ</div>';
        $("#dash-leave").innerHTML = '<div class="empty">—</div>';
      }

      if (state.perms.canViewAll) {
        $("#dash-admin-panel").hidden = false;
        const overview = await api("/api/gang/overview");
        $("#dash-admin-stats").innerHTML = [
          statCard("สมาชิก", num(overview.members), "คนในแก๊ง", "gold"),
          statCard("รอตรวจรายงาน", num(overview.pendingReports), "รายการ", "warn"),
          statCard("รออนุมัติลา", num(overview.pendingLeaves), "คำขอ", "info"),
          statCard("คะแนนรวมแก๊ง", num(overview.totalPoints), "คะแนน", "ok")
        ].join("");
        $("#dash-admin-top").innerHTML = (overview.top || []).length
          ? overview.top.map((r) => `<tr><td class="rank">#${r.rank}</td><td>${esc(r.name)}</td><td>${num(r.points)}</td><td>${num(r.approved)}</td></tr>`).join("")
          : '<tr><td colspan="4"><div class="empty">ยังไม่มีข้อมูล</div></td></tr>';
        updateAdminCount(overview.pendingReports);
      } else {
        $("#dash-admin-panel").hidden = true;
      }
    } catch (err) {
      toast("โหลดข้อมูลไม่สำเร็จ", err.message, "⚠️");
    }
  }

  function recentRow(r, showMember) {
    const pointCls = pointsClass(r.points);
    return `<div class="row-card">
      <div class="row-icon">${ACTIVITY_ICON[r.type] || "🎯"}</div>
      <div class="row-main">
        <div class="row-title">${esc(activityLabel(r.type))} · ${esc(resultLabel(r.result))} ${statusBadge(r.status)}</div>
        <div class="row-sub">${showMember ? `<b style="color:#d8d8de">${esc(r.memberName)}</b> · ` : ""}${fmtDateTime(r.createdAt)}${r.reviewedByName ? ` · ตรวจโดย ${esc(r.reviewedByName)}` : ""}</div>
      </div>
      <div class="row-side"><span class="${pointCls}">${r.points ? signed(r.points) : "0"}</span><small style="font-size:9px;color:var(--muted)">POINTS</small></div>
    </div>`;
  }

  function leaveMiniRow(l) {
    return `<div class="row-card">
      <div class="row-icon">🗓️</div>
      <div class="row-main"><div class="row-title">${esc(leaveTypeLabel(l.type))} ${leaveBadge(l.status)}</div><div class="row-sub">${fmtDate(l.startDate)} → ${fmtDate(l.endDate)}</div></div>
    </div>`;
  }

  function updateAdminCount(value) {
    const badge = $("#admin-count");
    const count = Number(value) || 0;
    badge.hidden = count <= 0;
    badge.textContent = String(count);
  }

  /* ---------------- report view ---------------- */
  async function loadReportView() {
    fillReportMembers($("#report-member-filter").value);
    try {
      const query = state.me.actor.memberId ? `?limit=50&memberId=${encodeURIComponent(state.me.actor.memberId)}` : "?limit=50";
      const data = await api(`/api/gang/reports${query}`);
      const title = $(".split aside .panel-head h2");
      if (title) title.textContent = state.perms.canViewAll && !state.me.actor.memberId ? "รายงานล่าสุด" : "รายงานของฉัน";
      $("#my-reports").innerHTML = (data.items || []).length
        ? data.items.map((r) => reportRow(r, true)).join("")
        : '<div class="empty">ยังไม่มีรายงาน</div>';
    } catch (err) {
      $("#my-reports").innerHTML = `<div class="empty">${esc(err.message)}</div>`;
    }
  }

  function reportRow(r, withProof) {
    const thumb = r.proofUrl
      ? `<img class="thumb" src="${esc(r.proofUrl)}" alt="หลักฐาน" data-proof-img="${esc(r.proofUrl)}">`
      : '<span class="thumb empty-thumb">ไม่มี<br>หลักฐาน</span>';
    return `<div class="row-card">
      ${thumb}
      <div class="row-main">
        <div class="row-title">${esc(activityLabel(r.type))} · ${esc(resultLabel(r.result))} ${statusBadge(r.status)}</div>
        <div class="row-sub">${esc(r.memberName)} · ${fmtDateTime(r.createdAt)} · ${r.points ? `${signed(r.points)} คะแนน` : "ยังไม่ให้คะแนน"}</div>
        ${r.note ? `<div class="row-sub">หมายเหตุ: ${esc(r.note)}</div>` : ""}
        ${r.reviewNote ? `<div class="review-note">${esc(r.reviewNote)}${r.reviewedByName ? ` — ${esc(r.reviewedByName)}` : ""}</div>` : ""}
      </div>
      <div class="row-side"><span class="${pointsClass(r.points)}">${r.points ? signed(r.points) : "0"}</span></div>
    </div>`;
  }

  function updateReportFormUI() {
    const { type, result } = state.report;
    const needProof = !(type === "shop" && result === "lost");
    $("#proof-required").style.display = needProof ? "" : "none";
    const hint = $("#proof-hint");
    if (type === "shop") hint.textContent = result === "won" ? "ต้องแนบหลักฐานการงัดร้านเมื่อได้ร้าน" : "ไม่ได้ร้าน — แนบหลักฐานเพิ่มเติมได้ (ไม่บังคับ)";
    else if (type === "loop") hint.textContent = "ต้องแนบรูปภาพหลักฐานการเล่นลูป";
    else hint.textContent = "ต้องแนบรูปภาพหลักฐานการเล่นแอร์ดอป";
    const labels = type === "shop" ? ["ได้ร้าน", "ไม่ได้ร้าน"] : ["ชนะ", "แพ้"];
    const resultButtons = $$("#report-results button");
    if (resultButtons[0]) resultButtons[0].innerHTML = `${labels[0]}<small>WIN</small>`;
    if (resultButtons[1]) resultButtons[1].innerHTML = `${labels[1]}<small>LOSE</small>`;
    $$("#report-types .type-card").forEach((btn) => btn.classList.toggle("active", btn.dataset.type === type));
    $$("#report-results button").forEach((btn) => btn.classList.toggle("active", btn.dataset.result === result));
  }

  async function handleProofUpload(file) {
    if (!file) return;
    const msg = $("#report-msg");
    setMsg(msg, "กำลังอัปโหลดรูป...", true);
    try {
      const dataUrl = await compressImage(file);
      const result = await api("/api/upload", { method: "POST", body: JSON.stringify({ data: dataUrl }) });
      state.report.proofUrl = result.url;
      const preview = $("#proof-preview");
      preview.style.display = "block";
      preview.querySelector("img").src = result.url;
      setMsg(msg, "อัปโหลดหลักฐานสำเร็จ", true);
    } catch (err) {
      setMsg(msg, err.message, false);
    }
  }

  function compressImage(file) {
    return new Promise((resolve, reject) => {
      if (!file.type || !/^image\//.test(file.type)) return reject(new Error("ไฟล์ต้องเป็นรูปภาพ"));
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("อ่านไฟล์ไม่สำเร็จ"));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error("รูปภาพเสียหาย"));
        img.onload = () => {
          const max = 1600;
          let { width, height } = img;
          if (width > max || height > max) {
            const ratio = Math.min(max / width, max / height);
            width = Math.round(width * ratio);
            height = Math.round(height * ratio);
          }
          const canvas = document.createElement("canvas");
          canvas.width = width; canvas.height = height;
          canvas.getContext("2d").drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL("image/jpeg", 0.82));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  async function submitReport(event) {
    event.preventDefault();
    const form = event.target;
    const button = $("#report-submit");
    const msg = $("#report-msg");
    const type = state.report.type;
    const result = state.report.result;
    const needProof = !(type === "shop" && result === "lost");
    if (needProof && !state.report.proofUrl) return setMsg(msg, "กรุณาแนบรูปภาพหลักฐานก่อนส่ง", false);
    const memberId = $("#report-member").value || state.report.memberId;
    if (!memberId) return setMsg(msg, "กรุณาเลือกสมาชิก", false);
    button.disabled = true;
    setMsg(msg, "กำลังส่งรายงาน...", true);
    try {
      await api("/api/gang/reports", {
        method: "POST",
        body: JSON.stringify({
          memberId,
          type,
          result,
          proofUrl: state.report.proofUrl,
          note: new FormData(form).get("note") || "",
          requestId: (crypto.randomUUID && crypto.randomUUID()) || `req-${Date.now()}`
        })
      });
      state.report.proofUrl = "";
      $("#proof-preview").style.display = "none";
      $("#report-proof").value = "";
      form.elements.note.value = "";
      setMsg(msg, "ส่งรายงานสำเร็จ — รอแอดมินตรวจสอบ", true);
      toast("ส่งรายงานสำเร็จ", "รายงานอยู่ในสถานะรอตรวจสอบ", "✅");
      await loadReportView();
    } catch (err) {
      setMsg(msg, err.message, false);
    } finally {
      button.disabled = false;
    }
  }

  /* ---------------- leaderboard ---------------- */
  async function loadLeaderboard() {
    const range = $("#lb-range").value;
    let from = "";
    let to = "";
    if (range === "custom") {
      from = $("#lb-from").value;
      to = $("#lb-to").value;
    } else if (range !== "all") {
      from = dateOffset(Number(range));
      to = todayStr();
    }
    const params = new URLSearchParams({ limit: "500", q: $("#lb-search").value || "" });
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    const body = $("#lb-body");
    try {
      const data = await api(`/api/gang/leaderboard?${params.toString()}`);
      const items = data.items || [];
      body.innerHTML = items.length
        ? items.map((r) => {
          const me = String(r.memberId) === String(state.me.actor.memberId);
          return `<tr class="${r.rank <= 3 ? `top${r.rank}` : ""} ${me ? "me" : ""}" data-member="${esc(r.memberId)}" style="cursor:pointer">
            <td class="rank">#${r.rank}</td>
            <td><div class="name-cell">${memberAvatar(r)}<div><b>${esc(r.name)}${me ? ' <span class="badge gold" style="margin-left:4px">YOU</span>' : ""}</b><small>${esc(r.role === "member" ? "" : (state.meta.roles || []).find((x) => x.value === r.role)?.label || "")}</small></div></div></td>
            <td><b style="color:var(--gold-strong);font-family:Orbitron;font-size:13px">${num(r.points)}</b></td>
            <td>${num(r.submitted)}</td><td>${num(r.approved)}</td><td>${num(r.wins)}</td>
            <td>${r.passRate}%</td>
          </tr>`;
        }).join("")
        : '<tr><td colspan="7"><div class="empty">ไม่พบข้อมูล</div></td></tr>';
      $("#lb-updated").innerHTML = `<i></i>LIVE · ${new Date().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}`;
    } catch (err) {
      body.innerHTML = `<tr><td colspan="7"><div class="empty">${esc(err.message)}</div></td></tr>`;
    }
  }

  function openMemberRecord(memberId) {
    if (!state.perms.canViewAll && String(memberId) !== String(state.me.actor.memberId)) return;
    if (!state.perms.canViewAll && memberId === undefined) return;
    state.recordMemberId = memberId;
    navigate("record");
  }

  /* ---------------- leave ---------------- */
  async function loadLeaveView() {
    const typeSelect = $("#leave-type");
    if (!typeSelect.options.length) {
      typeSelect.innerHTML = (state.meta.leaveTypes || []).map((t) => `<option value="${esc(t.value)}">${esc(t.label)}</option>`).join("");
    }
    const form = $("#leave-form");
    if (!form.elements.startDate.value) form.elements.startDate.value = todayStr();
    if (!form.elements.endDate.value) form.elements.endDate.value = todayStr();
    $("#leave-list-title").textContent = state.perms.canViewAll ? "คำขอลาทั้งหมด" : "ประวัติการลาของฉัน";
    $("#leave-list-sub").textContent = state.perms.canViewAll ? "ตรวจสอบและอนุมัติคำขอของสมาชิก" : "ติดตามสถานะคำขอทั้งหมด";
    try {
      const data = await api("/api/gang/leaves?limit=100");
      $("#leave-list").innerHTML = (data.items || []).length
        ? data.items.map(leaveRow).join("")
        : '<div class="empty">ยังไม่มีคำขอลา</div>';
      updateAdminCount(data.counts ? data.counts.pending : 0);
    } catch (err) {
      $("#leave-list").innerHTML = `<div class="empty">${esc(err.message)}</div>`;
    }
  }

  function leaveRow(l) {
    const canReview = state.perms.canReviewLeaves && l.status === "pending";
    return `<div class="row-card">
      <div class="row-icon">🗓️</div>
      <div class="row-main">
        <div class="row-title">${esc(l.memberName)} · ${esc(leaveTypeLabel(l.type))} ${leaveBadge(l.status)}</div>
        <div class="row-sub">${fmtDate(l.startDate)} → ${fmtDate(l.endDate)} · ส่งเมื่อ ${fmtDateTime(l.createdAt)}</div>
        <div class="row-sub">เหตุผล: ${esc(l.reason)}</div>
        ${l.reviewNote ? `<div class="review-note">${esc(l.reviewNote)}${l.reviewedByName ? ` — ${esc(l.reviewedByName)}` : ""}</div>` : ""}
      </div>
      ${canReview ? `<div class="row-side"><button class="btn ok sm" data-leave-approve="${esc(l.id)}">อนุมัติ</button><button class="btn bad sm" data-leave-reject="${esc(l.id)}">ปฏิเสธ</button></div>` : ""}
    </div>`;
  }

  async function submitLeave(event) {
    event.preventDefault();
    const form = event.target;
    const msg = $("#leave-msg");
    const payload = Object.fromEntries(new FormData(form).entries());
    if (payload.endDate < payload.startDate) return setMsg(msg, "วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่มลา", false);
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    setMsg(msg, "กำลังส่งคำขอ...", true);
    try {
      await api("/api/gang/leaves", { method: "POST", body: JSON.stringify(payload) });
      setMsg(msg, "ส่งคำขอลาสำเร็จ", true);
      form.elements.reason.value = "";
      toast("ส่งคำขอลาสำเร็จ", "รอแอดมินตรวจสอบ", "🗓️");
      await loadLeaveView();
    } catch (err) {
      setMsg(msg, err.message, false);
    } finally {
      button.disabled = false;
    }
  }

  async function reviewLeave(id, action, reason) {
    try {
      await api(`/api/gang/leaves/${id}/review`, { method: "POST", body: JSON.stringify({ action, reason: reason || "" }) });
      toast(action === "approve" ? "อนุมัติการลาแล้ว" : "ปฏิเสธการลาแล้ว", "", action === "approve" ? "✅" : "❌");
      await loadLeaveView();
    } catch (err) {
      toast("ดำเนินการไม่สำเร็จ", err.message, "⚠️");
    }
  }

  function openRejectLeaveModal(id) {
    const content = openModal(`
      <h2>ไม่อนุมัติการลา</h2>
      <p class="modal-sub">ระบุเหตุผลเพื่อให้สมาชิกทราบ</p>
      <label class="field"><span>เหตุผล <b>*</b></span><textarea id="reject-leave-reason" maxlength="300" placeholder="เช่น ช่วงเวลาดังกล่าวมีกิจกรรมสำคัญ"></textarea></label>
      <div class="modal-actions"><button class="btn ghost" type="button" data-close>ยกเลิก</button><button class="btn bad" type="button" id="reject-leave-save">ยืนยันปฏิเสธ</button></div>
    `);
    content.querySelector("[data-close]").addEventListener("click", closeModal);
    content.querySelector("#reject-leave-save").addEventListener("click", () => {
      const reason = content.querySelector("#reject-leave-reason").value.trim();
      if (reason.length < 2) return toast("กรุณาระบุเหตุผล", "", "⚠️");
      closeModal();
      reviewLeave(id, "reject", reason);
    });
  }

  /* ---------------- my record ---------------- */
  async function loadRecord(memberId) {
    if (!memberId) return;
    state.recordMemberId = memberId;
    try {
      const data = await api(`/api/gang/records/${memberId}`);
      state.records = data;
      $("#record-role").outerHTML = roleBadge(data.member.role, data.member.roleLabel).replace('class="role-badge', 'id="record-role" class="role-badge');
      $("#record-sub").textContent = `${data.member.name} · Member ID ${data.member.id} · ${data.member.status}`;
      const stats = data.stats || {};
      $("#record-summary").innerHTML = [
        statCard("คะแนนปัจจุบัน", num(data.points), "คะแนนสะสม", "gold"),
        statCard("กิจกรรมที่ส่ง", num(stats.submitted), `ผ่าน ${num(stats.approved)}`, ""),
        statCard("ชัยชนะ", num(stats.wins), `อัตราผ่าน ${stats.passRate || 0}%`, "ok"),
        statCard("การเตือน", num((data.warnings || []).filter((w) => w.kind === "warning").length), "ครั้ง", "warn"),
        statCard("คำขอลา", num((data.leaveHistory || []).length), "รายการ", "info")
      ].join("");
      renderRecordBody(data);
    } catch (err) {
      $("#record-body").innerHTML = `<div class="empty">${esc(err.message)}</div>`;
    }
  }

  function renderRecordBody(data) {
    const body = $("#record-body");
    if (state.recordTab === "scores") {
      body.innerHTML = (data.scoreHistory || []).length
        ? `<div class="list">${data.scoreHistory.map((s) => `<div class="row-card">
            <div class="row-icon">${s.delta > 0 ? "➕" : "➖"}</div>
            <div class="row-main">
              <div class="row-title"><span class="${pointsClass(s.delta)}">${signed(s.delta)} คะแนน</span> <span class="badge">${s.source === "report" ? "จากรายงาน" : s.delta > 0 ? "เพิ่มคะแนน" : "หักคะแนน"}</span></div>
              <div class="row-sub">${esc(s.reason)}</div>
              <div class="row-sub">${fmtDateTime(s.createdAt)} · โดย ${esc(s.actorName || "-")}</div>
            </div>
          </div>`).join("")}</div>`
        : '<div class="empty">ยังไม่มีประวัติคะแนน</div>';
    } else if (state.recordTab === "leaves") {
      body.innerHTML = (data.leaveHistory || []).length
        ? `<div class="list">${data.leaveHistory.map((l) => `<div class="row-card">
            <div class="row-icon">🗓️</div>
            <div class="row-main">
              <div class="row-title">${esc(leaveTypeLabel(l.type))} ${leaveBadge(l.status)}</div>
              <div class="row-sub">${fmtDate(l.startDate)} → ${fmtDate(l.endDate)} · ส่งเมื่อ ${fmtDateTime(l.createdAt)}</div>
              <div class="row-sub">${esc(l.reason)}</div>
              ${l.reviewNote ? `<div class="review-note">${esc(l.reviewNote)}${l.reviewedByName ? ` — ${esc(l.reviewedByName)}` : ""}</div>` : ""}
            </div>
          </div>`).join("")}</div>`
        : '<div class="empty">ยังไม่มีประวัติการลา</div>';
    } else if (state.recordTab === "warnings") {
      body.innerHTML = (data.warnings || []).length
        ? `<div class="list">${data.warnings.map((w) => `<div class="row-card">
            <div class="row-icon">${w.kind === "warning" ? "⚠️" : "📌"}</div>
            <div class="row-main">
              <div class="row-title">${esc(w.title || (w.kind === "warning" ? "แจ้งเตือน" : "บันทึก"))} <span class="badge ${w.kind === "warning" ? "warn" : ""}">${w.kind === "warning" ? "เตือน" : "บันทึก"}</span></div>
              <div class="row-sub">${esc(w.detail)}</div>
              <div class="row-sub">${fmtDateTime(w.createdAt)} · โดย ${esc(w.actorName || "-")}</div>
            </div>
          </div>`).join("")}</div>`
        : '<div class="empty">ไม่มีประวัติการเตือน</div>';
    } else {
      body.innerHTML = (data.activityHistory || []).length
        ? `<div class="list">${data.activityHistory.map((r) => reportRow(r, true)).join("")}</div>`
        : '<div class="empty">ยังไม่มีประวัติกิจกรรม</div>';
    }
  }

  /* ---------------- admin ---------------- */
  async function loadAdmin() {
    if (!state.perms.canViewAll) return navigate("dashboard");
    try {
      const overview = await api("/api/gang/overview");
      renderAdminStats(overview);
      updateAdminCount(overview.pendingReports);
    } catch (err) {
      toast("โหลดภาพรวมไม่สำเร็จ", err.message, "⚠️");
    }
    if (state.adminPane === "reports") return loadAdminReports();
    if (state.adminPane === "members") return renderAdminMembers();
    if (state.adminPane === "behavior") return loadBehaviorAdmin();
    if (state.adminPane === "audit") return loadAudit();
    if (state.adminPane === "settings") return loadSettings();
  }

  function renderAdminStats(overview) {
    $("#admin-stats").innerHTML = [
      statCard("สมาชิกในแก๊ง", num(overview.members), "คน", "gold"),
      statCard("รายงานรอตรวจ", num(overview.pendingReports), "รายการ", "warn"),
      statCard("คำขอลารออนุมัติ", num(overview.pendingLeaves), "คำขอ", "info"),
      statCard("คะแนนรวมทั้งแก๊ง", num(overview.totalPoints), "คะแนน", "ok")
    ].join("");
  }

  function setAdminPane(pane) {
    if (pane === "audit" && !state.perms.canViewAudit) return;
    if (pane === "settings" && !state.perms.canManageConfig) return;
    state.adminPane = pane;
    $$("#admin-subnav button").forEach((btn) => btn.classList.toggle("active", btn.dataset.pane === pane));
    $$(".admin-pane").forEach((el) => el.classList.toggle("active", el.id === `pane-${pane}`));
    loadAdmin();
  }

  async function loadAdminReports(page) {
    if (page) state.reportPage = page;
    $('#admin-report-list').innerHTML = '<div class="empty">กำลังโหลด...</div>';
    const params = new URLSearchParams({ limit: "15", page: String(state.reportPage) });
    const status = $("#admin-report-status").value;
    const type = $("#admin-report-type").value;
    const q = $("#admin-report-search").value.trim();
    if (status) params.set("status", status);
    if (type) params.set("type", type);
    if (q) params.set("q", q);
    if ($("#admin-report-from").value) params.set("from", $("#admin-report-from").value);
    if ($("#admin-report-to").value) params.set("to", $("#admin-report-to").value);
    try {
      const data = await api(`/api/gang/reports?${params.toString()}`);
      state.reportPages = data.pages || 1;
      state.reportPage = data.page || 1;
      const items = data.items || [];
      state.currentReports = items;
      $("#admin-report-list").innerHTML = items.length
        ? items.map(reviewCard).join("")
        : '<div class="empty">ไม่มีรายงานตามเงื่อนไข</div>';
      const pending = data.counts && data.counts.reports ? data.counts.reports.pending : 0;
      $("#pending-report-badge").innerHTML = `<i></i>${pending} รอตรวจ`;
      updateAdminCount(pending);
      $("#admin-report-pagination").hidden = state.reportPages <= 1;
      $("#admin-report-page").textContent = `หน้า ${state.reportPage} / ${state.reportPages}`;
      $("#admin-report-prev").disabled = state.reportPage <= 1;
      $("#admin-report-next").disabled = state.reportPage >= state.reportPages;
    } catch (err) {
      $("#admin-report-list").innerHTML = `<div class="empty">${esc(err.message)}</div>`;
    }
  }

  function reviewCard(r) {
    const proof = r.proofUrl
      ? `<img class="thumb" src="${esc(r.proofUrl)}" alt="หลักฐาน" data-proof-img="${esc(r.proofUrl)}">`
      : '<span class="thumb empty-thumb">ไม่มี<br>หลักฐาน</span>';
    const actions = [];
    if (r.status === "pending") {
      actions.push(`<button class="btn ok sm" data-review="${esc(r.id)}">อนุมัติ</button>`);
      actions.push(`<button class="btn bad sm" data-reject="${esc(r.id)}">ปฏิเสธ</button>`);
    }
    if (r.status === "approved") actions.push(`<button class="btn sm" data-complete="${esc(r.id)}">ปิดงาน</button>`);
    if (r.proofUrl) actions.push(`<button class="btn ghost sm" data-proof-img="${esc(r.proofUrl)}">ดูหลักฐาน</button>`);
    return `<div class="review-card" data-id="${esc(r.id)}">
      ${proof}
      <div>
        <h4>${esc(r.memberName)} <span class="badge" style="font-weight:400">ID ${esc(r.memberId)}</span> ${statusBadge(r.status)}</h4>
        <div class="review-meta">
          <span>กิจกรรม <b>${esc(activityLabel(r.type))}</b></span>
          <span>ผล <b>${esc(resultLabel(r.result))}</b></span>
          <span>คะแนน <b>${esc(r.points)}</b></span>
          <span>ส่ง <b>${fmtDateTime(r.createdAt)}</b></span>
          ${r.reviewedByName ? `<span>ตรวจโดย <b>${esc(r.reviewedByName)}</b></span>` : ""}
        </div>
        ${r.note ? `<div class="row-sub" style="margin-top:7px">หมายเหตุ: ${esc(r.note)}</div>` : ""}
        ${r.reviewNote ? `<div class="review-note">${esc(r.reviewNote)}</div>` : ""}
      </div>
      <div class="review-actions">${actions.join("") || '<span class="muted" style="font-size:11px">ตรวจแล้ว</span>'}</div>
    </div>`;
  }

  function defaultPoints(type, result) {
    return state.pointsCfg && state.pointsCfg[type] ? (state.pointsCfg[type][result] || 0) : 0;
  }

  function openReviewModal(report) {
    const results = state.meta.results || [];
    const content = openModal(`
      <h2>อนุมัติรายงานกิจกรรม</h2>
      <p class="modal-sub">${esc(report.memberName)} · ${esc(activityLabel(report.type))} · ส่งเมื่อ ${fmtDateTime(report.createdAt)}</p>
      ${report.proofUrl ? `<img class="modal-img" src="${esc(report.proofUrl)}" alt="หลักฐาน" style="margin-bottom:18px">` : '<div class="notice gold" style="margin-bottom:16px">รายงานนี้ไม่มีรูปหลักฐาน (ไม่ได้ร้าน)</div>'}
      <div class="grid-2">
        <label class="field"><span>ผลลัพธ์ <b>*</b></span>
          <select id="review-result">${results.map((r) => `<option value="${esc(r.value)}" ${r.value === report.result ? "selected" : ""}>${esc(r.label)}</option>`).join("")}</select>
        </label>
        <label class="field"><span>คะแนนที่ได้รับ <b>*</b></span><input id="review-points" type="number" min="0" step="1" value="${defaultPoints(report.type, report.result)}"></label>
      </div>
      <label class="field"><span>หมายเหตุ / เหตุผล <span class="opt">ไม่บังคับ</span></span><textarea id="review-reason" maxlength="300" placeholder="เช่น หลักฐานครบถ้วน"></textarea></label>
      <p class="hint">ระบบจะให้คะแนนครั้งเดียวต่อรายงาน — ป้องกันการคิดคะแนนซ้ำ</p>
      <div class="modal-actions"><button class="btn ghost" type="button" data-close>ยกเลิก</button><button class="btn ok" type="button" id="review-save">ยืนยันอนุมัติ</button></div>
    `, true);
    content.querySelector("[data-close]").addEventListener("click", closeModal);
    const resultSelect = content.querySelector("#review-result");
    const pointsInput = content.querySelector("#review-points");
    resultSelect.addEventListener("change", () => {
      pointsInput.value = defaultPoints(report.type, resultSelect.value);
    });
    content.querySelector("#review-save").addEventListener("click", async () => {
      try {
        await api(`/api/gang/reports/${report.id}/review`, {
          method: "POST",
          body: JSON.stringify({
            action: "approve",
            result: resultSelect.value,
            points: Number(pointsInput.value) || 0,
            reason: content.querySelector("#review-reason").value
          })
        });
        closeModal();
        toast("อนุมัติรายงานแล้ว", "คะแนนถูกเพิ่มให้สมาชิก", "✅");
        await loadAdmin();
      } catch (err) { toast("อนุมัติไม่สำเร็จ", err.message, "⚠️"); }
    });
  }

  function openRejectReportModal(report) {
    const content = openModal(`
      <h2>ปฏิเสธรายงาน</h2>
      <p class="modal-sub">${esc(report.memberName)} · ${esc(activityLabel(report.type))}</p>
      <label class="field"><span>เหตุผลที่ปฏิเสธ <b>*</b></span><textarea id="reject-report-reason" maxlength="300" placeholder="เช่น หลักฐานไม่ชัดเจน / ไม่ตรงกับกิจกรรม"></textarea></label>
      <div class="modal-actions"><button class="btn ghost" type="button" data-close>ยกเลิก</button><button class="btn bad" type="button" id="reject-report-save">ยืนยันปฏิเสธ</button></div>
    `);
    content.querySelector("[data-close]").addEventListener("click", closeModal);
    content.querySelector("#reject-report-save").addEventListener("click", async () => {
      const reason = content.querySelector("#reject-report-reason").value.trim();
      if (reason.length < 2) return toast("กรุณาระบุเหตุผล", "", "⚠️");
      try {
        await api(`/api/gang/reports/${report.id}/review`, { method: "POST", body: JSON.stringify({ action: "reject", reason }) });
        closeModal();
        toast("ปฏิเสธรายงานแล้ว", "", "❌");
        await loadAdmin();
      } catch (err) { toast("ดำเนินการไม่สำเร็จ", err.message, "⚠️"); }
    });
  }

  async function completeReport(id) {
    try {
      await api(`/api/gang/reports/${id}/review`, { method: "POST", body: JSON.stringify({ action: "complete" }) });
      toast("ปิดงานเรียบร้อย", "", "✅");
      await loadAdmin();
    } catch (err) { toast("ดำเนินการไม่สำเร็จ", err.message, "⚠️"); }
  }

  function renderAdminMembers() {
    const keyword = $("#admin-member-search").value.trim().toLowerCase();
    const list = state.members.filter((m) => !keyword || String(m.name).toLowerCase().includes(keyword) || String(m.id).includes(keyword));
    $("#member-count-badge").innerHTML = `<i></i>${state.members.length} MEMBERS`;
    $("#admin-member-body").innerHTML = list.length
      ? list.map((m) => `<tr data-member-row="${esc(m.id)}">
          <td><div class="name-cell">${memberAvatar(m)}<div><b>${esc(m.name)}</b><small>ID ${esc(m.id)}</small></div></div></td>
          <td>${state.perms.canManageMembers
            ? `<select data-member-role="${esc(m.id)}" style="min-width:150px;padding:7px 10px;font-size:12px">${(state.meta.roles || []).map((r) => `<option value="${esc(r.value)}" ${r.value === m.role ? "selected" : ""}>${esc(r.label)}</option>`).join("")}</select>`
            : roleBadge(m.role, m.roleLabel)}</td>
          <td><b style="font-family:Orbitron;font-size:12px;color:var(--gold-strong)">${num(m.points)}</b></td>
          <td><span class="badge ok"><i></i>ACTIVE</span></td>
          <td><div style="display:flex;gap:5px;flex-wrap:wrap">
            ${state.perms.canAdjustPoints ? `<button class="btn ghost sm" data-adjust="${esc(m.id)}">± คะแนน</button>` : ""}
            ${state.perms.canManageBehavior ? `<button class="btn ghost sm" data-warn="${esc(m.id)}">เตือน</button>` : ""}
            <button class="btn ghost sm" data-member-record="${esc(m.id)}">ประวัติ</button>
          </div></td>
        </tr>`).join("")
      : '<tr><td colspan="5"><div class="empty">ไม่พบสมาชิก</div></td></tr>';
  }

  function openAdjustModal(member) {
    const content = openModal(`
      <h2>ปรับคะแนนสมาชิก</h2>
      <p class="modal-sub">${esc(member.name)} · คะแนนปัจจุบัน ${num(member.points)}</p>
      <label class="field"><span>จำนวนคะแนน <b>*</b> <span class="opt">ใส่ค่าติดลบเพื่อหักคะแนน</span></span><input id="adjust-delta" type="number" step="1" placeholder="เช่น 10 หรือ -5"></label>
      <label class="field"><span>เหตุผล <b>*</b></span><textarea id="adjust-reason" maxlength="300" placeholder="ต้องระบุเหตุผลทุกครั้ง"></textarea></label>
      <div class="modal-actions"><button class="btn ghost" type="button" data-close>ยกเลิก</button><button class="btn primary" type="button" id="adjust-save">บันทึกคะแนน</button></div>
    `);
    content.querySelector("[data-close]").addEventListener("click", closeModal);
    content.querySelector("#adjust-save").addEventListener("click", async () => {
      const delta = Number(content.querySelector("#adjust-delta").value);
      const reason = content.querySelector("#adjust-reason").value.trim();
      if (!delta) return toast("กรุณากรอกจำนวนคะแนน", "ห้ามเป็น 0", "⚠️");
      if (reason.length < 2) return toast("กรุณาระบุเหตุผล", "", "⚠️");
      try {
        await api("/api/gang/scores", { method: "POST", body: JSON.stringify({ memberId: member.id, delta, reason, requestId: (crypto.randomUUID && crypto.randomUUID()) || "" }) });
        closeModal();
        toast("บันทึกคะแนนแล้ว", `${member.name} ${signed(delta)} คะแนน`, "⭐");
        await loadMembers();
        renderAdminMembers();
      } catch (err) { toast("บันทึกไม่สำเร็จ", err.message, "⚠️"); }
    });
  }

  function openWarn(member) {
    setAdminPane("behavior");
    const select = $("#behavior-member");
    if (select) select.value = String(member.id);
    setTimeout(() => { const detail = $("#behavior-form textarea[name=detail]"); if (detail) detail.focus(); }, 250);
  }

  async function loadBehaviorAdmin() {
    const select = $("#behavior-member");
    if (select && !select.options.length) fillSelect(select, state.members);
    try {
      const data = await api("/api/gang/behavior?all=1");
      const items = data.items || [];
      $("#behavior-list").innerHTML = items.length
        ? items.map((b) => `<div class="row-card">
            <div class="row-icon">${b.kind === "warning" ? "⚠️" : "📌"}</div>
            <div class="row-main">
              <div class="row-title">${esc(b.memberName)} · ${esc(b.title)} <span class="badge ${b.kind === "warning" ? "warn" : ""}">${b.kind === "warning" ? "เตือน" : "บันทึก"}</span></div>
              <div class="row-sub">${esc(b.detail)}</div>
              <div class="row-sub">${fmtDateTime(b.createdAt)} · โดย ${esc(b.actorName)}</div>
            </div>
            <div class="row-side"><button class="btn ghost sm" data-behavior-delete="${esc(b.id)}">ลบ</button></div>
          </div>`).join("")
        : '<div class="empty">ยังไม่มีรายการ</div>';
    } catch (err) {
      $("#behavior-list").innerHTML = `<div class="empty">${esc(err.message)}</div>`;
    }
  }

  async function submitBehavior(event) {
    event.preventDefault();
    const form = event.target;
    const msg = $("#behavior-msg");
    const button = form.querySelector('button[type="submit"]');
    const payload = Object.fromEntries(new FormData(form).entries());
    payload.kind = state.behaviorKind;
    payload.memberId = $("#behavior-member").value;
    if (!payload.memberId) return setMsg(msg, "กรุณาเลือกสมาชิก", false);
    button.disabled = true;
    setMsg(msg, "กำลังบันทึก...", true);
    try {
      await api("/api/gang/behavior", { method: "POST", body: JSON.stringify(payload) });
      setMsg(msg, "บันทึกความประพฤติสำเร็จ", true);
      form.elements.title.value = "";
      form.elements.detail.value = "";
      toast("บันทึกความประพฤติแล้ว", "", "⚠️");
      await loadBehaviorAdmin();
    } catch (err) {
      setMsg(msg, err.message, false);
    } finally {
      button.disabled = false;
    }
  }

  async function loadAudit() {
    try {
      const data = await api(`/api/gang/audit?limit=100&q=${encodeURIComponent($("#audit-search").value || "")}`);
      $("#audit-list").innerHTML = (data.items || []).length
        ? data.items.map((a) => `<div class="row-card">
            <div class="row-icon">🧾</div>
            <div class="row-main">
              <div class="row-title">${esc(a.actorName)} · <span style="color:var(--gold-strong)">${esc(a.action)}</span> ${a.targetName ? `→ ${esc(a.targetName)}` : ""}</div>
              <div class="row-sub">${esc(a.detail || "-")}</div>
              <div class="row-sub">${fmtDateTime(a.createdAt)} · ${esc(a.actorRole)}</div>
            </div>
          </div>`).join("")
        : '<div class="empty">ไม่พบประวัติ</div>';
    } catch (err) {
      $("#audit-list").innerHTML = `<div class="empty">${esc(err.message)}</div>`;
    }
  }

  async function loadSettings() {
    if (!state.perms.canManageConfig) return;
    try {
      const cfg = await api("/api/gang/admin/config");
      state.pointsCfg = cfg.points || state.pointsCfg;
      renderPointsSettings(cfg.points || {});
      const webhook = cfg.webhook || {};
      $("#webhook-preview").value = webhook.configured ? `${webhook.preview} (${webhook.source === "env" ? "จาก env" : "ตั้งในเว็บ"})` : "ยังไม่ได้ตั้งค่า";
      const badge = $("#webhook-badge");
      badge.className = "badge " + (webhook.configured ? "ok" : "bad");
      badge.innerHTML = `<i></i>${webhook.configured ? "CONNECTED" : "NOT SET"}`;
      const sheets = cfg.sheets || {};
      const sBadge = $("#sheets-badge");
      sBadge.className = "badge " + (sheets.configured ? (sheets.lastError ? "warn" : "ok") : "bad");
      sBadge.innerHTML = `<i></i>${sheets.configured ? (sheets.lastError ? "มีข้อผิดพลาด" : "CONNECTED") : "NOT SET"}`;
      $("#sheets-stats").innerHTML = [
        statCard("สถานะ", sheets.configured ? "พร้อมใช้งาน" : "ยังไม่ตั้งค่า", "", sheets.configured ? "ok" : "bad"),
        statCard("ซิงก์ล่าสุด", sheets.lastSyncAt ? fmtDateTime(sheets.lastSyncAt) : "-", "", ""),
        statCard("จำนวนชีต", String((sheets.sheets ? Object.keys(sheets.sheets).length : 0)), "ตาราง", "gold"),
        statCard("ข้อผิดพลาดล่าสุด", sheets.lastError ? "มี" : "ไม่มี", sheets.lastError ? sheets.lastError.slice(0, 60) : "", sheets.lastError ? "bad" : "ok")
      ].join("");
      $("#sheets-hint").textContent = sheets.configured
        ? "ระบบจะส่งข้อมูลขึ้น Google Sheets อัตโนมัติเมื่อมีการเปลี่ยนแปลง และมีคิวลองใหม่หากล้มเหลว"
        : "ยังไม่ได้ตั้งค่า SHEETS_WEBHOOK_URL — ตั้งค่าใน Render แล้ว deploy ใหม่";
    } catch (err) {
      toast("โหลดการตั้งค่าไม่สำเร็จ", err.message, "⚠️");
    }
  }

  function renderPointsSettings(points) {
    const icons = ACTIVITY_ICON;
    $("#points-settings").innerHTML = (state.meta.activities || []).map((a) => {
      const p = points[a.value] || { won: 0, lost: 0 };
      return `<div class="settings-card">
        <h4>${icons[a.value] || ""} ${esc(a.label)}</h4>
        <label class="field"><span>ผลได้ / ชนะ</span><input type="number" min="0" step="1" data-point-type="${esc(a.value)}" data-point-result="won" value="${Number(p.won) || 0}"></label>
        <label class="field"><span>ผลไม่ได้ / แพ้</span><input type="number" min="0" step="1" data-point-type="${esc(a.value)}" data-point-result="lost" value="${Number(p.lost) || 0}"></label>
      </div>`;
    }).join("");
  }

  async function savePoints() {
    const points = {};
    $$("#points-settings input[data-point-type]").forEach((input) => {
      const type = input.dataset.pointType;
      const result = input.dataset.pointResult;
      points[type] = points[type] || {};
      points[type][result] = Math.max(0, Math.round(Number(input.value) || 0));
    });
    try {
      const res = await api("/api/gang/admin/config", { method: "PUT", body: JSON.stringify({ points }) });
      state.pointsCfg = res.points || points;
      setMsg($("#points-msg"), "บันทึกคะแนนกิจกรรมแล้ว", true);
      toast("บันทึกการตั้งค่าแล้ว", "คะแนนกิจกรรมถูกอัปเดต", "⚙️");
    } catch (err) {
      setMsg($("#points-msg"), err.message, false);
    }
  }

  async function saveWebhook(clear) {
    const msg = $("#webhook-msg");
    try {
      const body = clear ? { clearWebhook: true } : { webhookUrl: $("#webhook-url").value.trim() };
      if (!clear && !body.webhookUrl) return setMsg(msg, "กรุณากรอก Webhook URL", false);
      const res = await api("/api/gang/admin/config", { method: "PUT", body: JSON.stringify(body) });
      const webhook = res.webhook || {};
      $("#webhook-url").value = "";
      $("#webhook-preview").value = webhook.configured ? `${webhook.preview} (${webhook.source === "env" ? "จาก env" : "ตั้งในเว็บ"})` : "ยังไม่ได้ตั้งค่า";
      $("#webhook-badge").className = "badge " + (webhook.configured ? "ok" : "bad");
      $("#webhook-badge").innerHTML = `<i></i>${webhook.configured ? "CONNECTED" : "NOT SET"}`;
      setMsg(msg, clear ? "ลบ Webhook แล้ว" : "บันทึก Webhook แล้ว", true);
    } catch (err) {
      setMsg(msg, err.message, false);
    }
  }

  async function testWebhook() {
    const msg = $("#webhook-msg");
    setMsg(msg, "กำลังส่งข้อความทดสอบ...", true);
    try {
      await api("/api/gang/admin/discord/test", { method: "POST", body: JSON.stringify({}) });
      setMsg(msg, "ส่งข้อความทดสอบสำเร็จ — ตรวจสอบใน Discord", true);
    } catch (err) {
      setMsg(msg, err.message, false);
    }
  }

  async function syncSheets() {
    const msg = $("#sheets-msg");
    setMsg(msg, "กำลังส่งข้อมูลขึ้นชีต...", true);
    try {
      const res = await api("/api/gang/admin/sheets/sync", { method: "POST", body: JSON.stringify({}) });
      setMsg(msg, res.ok ? "ส่งข้อมูลขึ้น Google Sheets สำเร็จ" : `สำเร็จบางส่วน: ${res.error || ""}`, !!res.ok);
      await loadSettings();
    } catch (err) {
      setMsg(msg, err.message, false);
    }
  }

  /* ---------------- event wiring ---------------- */
  $("#member-login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    const msg = $("#member-login-msg");
    setMsg(msg, "กำลังเข้าสู่ระบบ...", true);
    try {
      await api("/api/gang/login", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) });
      await boot();
    } catch (err) { setMsg(msg, err.message, false); }
  });
  $("#admin-login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    const msg = $("#admin-login-msg");
    setMsg(msg, "กำลังเข้าสู่ระบบ...", true);
    try {
      await api("/api/login", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) });
      await boot();
    } catch (err) { setMsg(msg, err.message, false); }
  });
  $$(".login-tabs button").forEach((btn) => btn.addEventListener("click", () => {
    $$(".login-tabs button").forEach((b) => b.classList.toggle("active", b === btn));
    const isMember = btn.dataset.loginTab === "member";
    $("#member-login-form").hidden = !isMember;
    $("#admin-login-form").hidden = isMember;
  }));

  $("#logout-btn").addEventListener("click", async () => {
    try { await api("/api/gang/logout", { method: "POST", body: JSON.stringify({}) }); } catch { /* ignore */ }
    state.me = null;
    if (state.events) { state.events.close(); state.events = null; }
    showLogin("ออกจากระบบแล้ว");
  });

  $$("#app-nav button").forEach((btn) => btn.addEventListener("click", () => navigate(btn.dataset.view)));
  document.addEventListener("click", (e) => {
    const goto = e.target.closest("[data-goto]");
    if (goto) navigate(goto.dataset.goto);
  });

  $$("#report-types .type-card").forEach((btn) => btn.addEventListener("click", () => {
    state.report.type = btn.dataset.type;
    updateReportFormUI();
  }));
  $$("#report-results button").forEach((btn) => btn.addEventListener("click", () => {
    state.report.result = btn.dataset.result;
    updateReportFormUI();
  }));
  $("#report-member-filter").addEventListener("input", debounce((e) => fillReportMembers(e.target.value), 150));
  $("#report-member").addEventListener("change", (e) => { state.report.memberId = e.target.value; });
  $("#report-proof").addEventListener("change", (e) => handleProofUpload(e.target.files[0]));
  $("#proof-clear").addEventListener("click", () => {
    state.report.proofUrl = "";
    $("#proof-preview").style.display = "none";
    $("#report-proof").value = "";
  });
  $("#report-form").addEventListener("submit", submitReport);

  $("#lb-refresh").addEventListener("click", loadLeaderboard);
  $("#lb-search").addEventListener("input", debounce(loadLeaderboard, 250));
  $("#lb-range").addEventListener("change", () => {
    const custom = $("#lb-range").value === "custom";
    $("#lb-from-wrap").hidden = !custom;
    $("#lb-to-wrap").hidden = !custom;
    loadLeaderboard();
  });
  $("#lb-from").addEventListener("change", loadLeaderboard);
  $("#lb-to").addEventListener("change", loadLeaderboard);
  $("#lb-body").addEventListener("click", (e) => {
    const row = e.target.closest("tr[data-member]");
    if (row) openMemberRecord(row.dataset.member);
  });

  $("#leave-form").addEventListener("submit", submitLeave);
  $("#leave-list").addEventListener("click", (e) => {
    const approve = e.target.closest("[data-leave-approve]");
    const reject = e.target.closest("[data-leave-reject]");
    if (approve) reviewLeave(approve.dataset.leaveApprove, "approve", "");
    if (reject) openRejectLeaveModal(reject.dataset.leaveReject);
  });

  $$("#record-tabs button").forEach((btn) => btn.addEventListener("click", () => {
    state.recordTab = btn.dataset.recordTab;
    $$("#record-tabs button").forEach((b) => b.classList.toggle("active", b === btn));
    if (state.records) renderRecordBody(state.records);
  }));

  $$("#admin-subnav button").forEach((btn) => btn.addEventListener("click", () => setAdminPane(btn.dataset.pane)));
  $("#admin-report-search").addEventListener("input", debounce(() => loadAdminReports(1), 300));
  $("#admin-report-status").addEventListener("change", () => loadAdminReports(1));
  $("#admin-report-type").addEventListener("change", () => loadAdminReports(1));
  $("#admin-report-from").addEventListener("change", () => loadAdminReports(1));
  $("#admin-report-to").addEventListener("change", () => loadAdminReports(1));
  $("#admin-report-refresh").addEventListener("click", () => loadAdminReports(1));
  $("#admin-report-prev").addEventListener("click", () => loadAdminReports(state.reportPage - 1));
  $("#admin-report-next").addEventListener("click", () => loadAdminReports(state.reportPage + 1));
  $("#admin-report-list").addEventListener("click", (e) => {
    const approve = e.target.closest("[data-review]");
    const reject = e.target.closest("[data-reject]");
    const complete = e.target.closest("[data-complete]");
    const proof = e.target.closest("[data-proof-img]");
    if (proof) return openProof(proof.dataset.proofImg);
    const card = e.target.closest("[data-id]");
    const report = state.currentReports ? state.currentReports.find((r) => String(r.id) === String(card && card.dataset.id)) : null;
    if (!report) return;
    if (approve) openReviewModal(report);
    if (reject) openRejectReportModal(report);
    if (complete) completeReport(report.id);
  });
  function openProof(url) {
    openModal(`<h2>รูปภาพหลักฐาน</h2><p class="modal-sub">ตรวจสอบความถูกต้องของหลักฐาน</p><img class="modal-img" src="${esc(url)}" alt="หลักฐาน"><div class="modal-actions"><a class="btn ghost" href="${esc(url)}" target="_blank" rel="noopener">เปิดในแท็บใหม่</a><button class="btn primary" type="button" data-close>ปิด</button></div>`, true)
      .querySelector("[data-close]").addEventListener("click", closeModal);
  }
  $("#my-reports").addEventListener("click", (e) => {
    const img = e.target.closest("[data-proof-img]");
    if (img) openProof(img.dataset.proofImg);
  });

  $("#admin-member-search").addEventListener("input", debounce(renderAdminMembers, 150));
  $("#admin-member-body").addEventListener("change", async (e) => {
    const select = e.target.closest("[data-member-role]");
    if (!select) return;
    try {
      await api(`/api/gang/admin/members/${select.dataset.memberRole}/role`, { method: "POST", body: JSON.stringify({ role: select.value }) });
      const member = state.members.find((m) => String(m.id) === String(select.dataset.memberRole));
      if (member) { member.role = select.value; member.roleLabel = (state.meta.roles || []).find((r) => r.value === select.value)?.label || select.value; }
      toast("อัปเดตตำแหน่งแล้ว", "", "👤");
    } catch (err) {
      toast("อัปเดตตำแหน่งไม่สำเร็จ", err.message, "⚠️");
      await loadMembers();
      renderAdminMembers();
    }
  });
  $("#admin-member-body").addEventListener("click", (e) => {
    const adjust = e.target.closest("[data-adjust]");
    const warn = e.target.closest("[data-warn]");
    const record = e.target.closest("[data-member-record]");
    const member = (id) => state.members.find((m) => String(m.id) === String(id));
    if (adjust) { const m = member(adjust.dataset.adjust); if (m) openAdjustModal(m); }
    if (warn) { const m = member(warn.dataset.warn); if (m) openWarn(m); }
    if (record) openMemberRecord(record.dataset.memberRecord);
  });

  $$("#behavior-kind button").forEach((btn) => btn.addEventListener("click", () => {
    state.behaviorKind = btn.dataset.kind;
    $$("#behavior-kind button").forEach((b) => b.classList.toggle("active", b === btn));
  }));
  $("#behavior-form").addEventListener("submit", submitBehavior);
  $("#behavior-list").addEventListener("click", async (e) => {
    const del = e.target.closest("[data-behavior-delete]");
    if (!del) return;
    if (!confirm("ลบรายการความประพฤตินี้?")) return;
    try {
      await api(`/api/gang/behavior/${del.dataset.behaviorDelete}`, { method: "DELETE" });
      toast("ลบรายการแล้ว", "", "🗑️");
      await loadBehaviorAdmin();
    } catch (err) { toast("ลบไม่สำเร็จ", err.message, "⚠️"); }
  });

  $("#audit-search").addEventListener("input", debounce(loadAudit, 300));
  $("#audit-refresh").addEventListener("click", loadAudit);
  $("#settings-save-points").addEventListener("click", savePoints);
  $("#webhook-save").addEventListener("click", () => saveWebhook(false));
  $("#webhook-clear").addEventListener("click", () => { if (confirm("ลบ Discord Webhook ที่ตั้งไว้?")) saveWebhook(true); });
  $("#webhook-test").addEventListener("click", testWebhook);
  $("#sheets-sync").addEventListener("click", syncSheets);

  updateReportFormUI();
  boot();
})();
