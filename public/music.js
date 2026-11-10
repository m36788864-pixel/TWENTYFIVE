/* ============================================================
   TWENTYFIVE — SITE MUSIC (เพลงที่แอดมินตั้งไว้ → เปิดตอนเข้าเว็บ)
   - ดึงเพลงจาก /api/site-song ถ้ามี จะเล่นเสียงออกมาเลย
     ไม่มีตัวเล่น/ปุ่ม/ป้าย ให้เห็นบนหน้าเว็บทั้งสิ้น
   - พยายามเล่นอัตโนมัติตอนเปิดหน้า ถ้าเบราว์เซอร์บล็อก
     จะเริ่มเล่นทันทีที่ผู้ชมแตะ/คลิกหน้าจอครั้งแรก
   - ตัวเล่นถูกซ่อนไว้นอกจอ (ไม่ใช่ display:none กันบางเบราว์เซอร์
     หยุดเสียงตอนมี iframe ที่ถูกซ่อน)
   ต้องโหลด /song.js ก่อนไฟล์นี้
   ============================================================ */
(async function () {
  "use strict";
  if (!window.T25Song) return;

  /* ดึงเพลงที่แอดมินตั้งไว้ */
  let song = null;
  try {
    const res = await fetch("/api/site-song", { cache: "no-store" });
    if (res.ok) song = await res.json();
  } catch {}
  if (!song || !song.url) return;   // ยังไม่มีเพลงเปิดเว็บ

  /* กล่องซ่อนนอกจอ — ไม่มีอะไรแสดงบนหน้าเว็บเลย */
  const holder = document.createElement("div");
  holder.setAttribute("aria-hidden", "true");
  holder.style.cssText = "position:fixed;left:-10000px;top:0;width:1px;height:1px;overflow:hidden;pointer-events:none";
  document.body.appendChild(holder);

  const player = T25Song.render(holder, { ...song, hideTitle: true }, { autoplay: true });
  if (!player) { holder.remove(); return; }

  /* เบราว์เซอร์บล็อกการเล่นอัตโนมัติ → เล่นทันทีที่แตะ/คลิกหน้าจอครั้งแรก */
  function unblock() {
    if (player.isPlaying()) return;
    player.play();
  }
  document.addEventListener("pointerdown", unblock, { capture: true });
  document.addEventListener("keydown", unblock, { capture: true });
})();
