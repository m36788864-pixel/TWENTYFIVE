/* ============================================================
   TWENTYFIVE — APPLY PAGE (สมัครเข้าแก๊ง)
   ============================================================ */
const $ = (sel) => document.querySelector(sel);
const form = $("#apply-form");
const msg = $("#apply-msg");

const esc = (v) => String(v || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function post(url, body) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Error(data.error || "เกิดข้อผิดพลาด");
  return data;
}

function setMsg(text, ok) {
  msg.textContent = text;
  msg.className = "message" + (ok ? " ok" : " bad");
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(form).entries());
  const button = $("#apply-submit");
  button.disabled = true;
  setMsg("กำลังส่งใบสมัคร...", true);
  try {
    const data = await post("/api/applications", body);
    setMsg("", true);
    $("#done-name").textContent = body.name;
    $("#done-discord").textContent = body.discordUser;
    /* แจ้งว่าส่งข้อความตอบกลับไปแล้วหรือยัง */
    const dm = (data && data.application && data.application.dm) || null;
    const note = $("#done-dm-note");
    if (dm && dm.status === "sent") {
      note.className = "notice-box ok";
      note.querySelector("b").textContent = "ส่งข้อความตอบกลับไปที่ดิสคอร์ดของคุณแล้ว";
      $("#done-dm-text").textContent = "รอข้อความยืนยันจากแอดมินอีกครั้งนะ — ถ้าใบสมัครผ่าน จะได้ชื่อผู้ใช้ รหัสผ่าน และลิงก์เข้ากลุ่มดิสคอร์ดในข้อความถัดไป";
    } else {
      note.className = "notice-box";
      note.querySelector("b").textContent = "รอข้อความตอบกลับจากแอดมิน";
      $("#done-dm-text").textContent = "รอข้อความยืนยันอีกครั้งนะ — ถ้าใบสมัครผ่าน จะได้ชื่อผู้ใช้ รหัสผ่าน และลิงก์เข้ากลุ่มดิสคอร์ดในข้อความนั้น ระหว่างนี้ยังเข้ากลุ่มดิสคอร์ดไม่ได้";
    }
    $("#form-panel").hidden = true;
    $("#done-panel").hidden = false;
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (err) {
    setMsg(err.message, false);
  } finally {
    button.disabled = false;
  }
});

$("#again").addEventListener("click", () => {
  form.reset();
  setMsg("", true);
  $("#done-panel").hidden = true;
  $("#form-panel").hidden = false;
});

/* ---------- ตรวจสอบสถานะ ---------- */
const STATUS_TEXT = { pending: "รอแอดมินตรวจ", approved: "อนุมัติแล้ว", rejected: "ไม่ผ่านการคัดเลือก" };

$("#status-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = new FormData(e.target).get("name");
  const out = $("#status-msg");
  const box = $("#status-result");
  out.className = "message";
  out.textContent = "กำลังตรวจสอบ...";
  box.hidden = true;
  try {
    const res = await fetch(`/api/applications/status?name=${encodeURIComponent(name)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Error(data.error || "ตรวจสอบไม่สำเร็จ");
    const cls = data.status === "approved" ? "approved" : data.status === "rejected" ? "rejected" : "pending";
    out.textContent = "";
    box.hidden = false;
    box.innerHTML = `
      <div class="status-card" style="margin-top:14px">
        <div>
          <p class="eyebrow">ผลการตรวจสอบ</p>
          <h2 style="margin-top:8px">${esc(data.name)}</h2>
        </div>
        <span class="badge ${cls}"><i></i>${STATUS_TEXT[data.status] || data.status}</span>
      </div>
      <ul class="status-list">
        <li><b>ชื่อ IC</b><span>${esc(data.name)}</span></li>
        <li><b>วันที่ส่ง</b><span>${data.createdAt ? new Date(data.createdAt).toLocaleString("th-TH") : "—"}</span></li>
        ${data.username ? `<li><b>ชื่อผู้ใช้</b><span>${esc(data.username)}</span></li>` : ""}
        ${data.reason ? `<li><b>เหตุผล</b><span>${esc(data.reason)}</span></li>` : ""}
        ${data.status === "approved" ? "<li><b>รหัสผ่าน</b><span>ระบบส่งให้ทาง DM ดิสคอร์ดแล้ว — ถ้ายังไม่ได้รับ แจ้งแอดมิน</span></li>" : ""}
      </ul>`;
  } catch (err) {
    out.className = "message bad";
    out.textContent = err.message;
  }
});
