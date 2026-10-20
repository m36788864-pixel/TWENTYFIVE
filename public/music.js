/* ============================================================
   TWENTYFIVE — SITE MUSIC (เพลงที่แอดมินตั้งไว้ → เปิดตอนเข้าเว็บ)
   - ดึงเพลงจาก /api/site-song ถ้ามี จะสร้างตัวเล่นลอยที่มุมล่างขวา
   - พยายามเล่นอัตโนมัติตอนเปิดหน้า ถ้าเบราว์เซอร์บล็อก
     จะเริ่มเล่นทันทีที่ผู้ชมแตะ/คลิกหน้าจอครั้งแรก
   - กดหยุดแล้วจะจำหน้าถัดไปไว้ (localStorage) ไม่มาเล่นซ้ำรบกวน
   ต้องโหลด /song.js ก่อนไฟล์นี้
   ============================================================ */
(async function () {
  "use strict";
  if (!window.T25Song) return;

  const STYLE = `
#t25-music{
  position:fixed;right:18px;bottom:18px;z-index:9990;
  display:flex;align-items:flex-end;gap:10px;font-family:inherit
}
#t25-music[hidden]{display:none}
.t25-music-btn{
  width:50px;height:50px;flex:0 0 auto;border-radius:50%;cursor:pointer;
  border:1px solid rgba(var(--acc-rgb,230,181,40),.65);
  background:rgba(8,8,10,.92);color:var(--acc,#e6b528);
  font-size:15px;line-height:1;backdrop-filter:blur(8px);
  box-shadow:0 6px 24px rgba(0,0,0,.55);transition:.18s
}
#t25-music:hover .t25-music-btn{background:rgba(var(--acc-rgb,230,181,40),.18)}
#t25-music.is-idle .t25-music-btn{animation:t25musicPulse 1.6s ease-in-out infinite}
@keyframes t25musicPulse{0%,100%{box-shadow:0 0 0 0 rgba(var(--acc-rgb,230,181,40),.5)}50%{box-shadow:0 0 0 12px rgba(var(--acc-rgb,230,181,40),0)}}
.t25-music-card{
  width:270px;max-width:calc(100vw - 90px);padding:10px 12px 12px;
  background:rgba(8,8,10,.94);border:1px solid rgba(255,255,255,.14);
  border-radius:14px;backdrop-filter:blur(10px);box-shadow:0 10px 30px rgba(0,0,0,.55)
}
.t25-music-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}
.t25-music-eyebrow{font-size:9.5px;letter-spacing:.18em;color:var(--acc,#e6b528);font-weight:600}
.t25-music-close{
  border:0;background:transparent;color:#8b8b95;font-size:16px;line-height:1;
  cursor:pointer;padding:2px 4px
}
.t25-music-close:hover{color:#fff}
.t25-music-player .t25-song-toggle{display:none}
.t25-music-player .t25-song-frame{border-radius:9px}
.t25-music-player .t25-song-meta{font-size:11.5px}
.t25-music-player .t25-song-open{min-height:28px;padding:4px 12px;font-size:11.5px}
.t25-music-link{
  display:inline-flex;align-items:center;gap:6px;margin-top:4px;
  color:var(--acc,#e6b528);font-size:12.5px;text-decoration:none
}
@media (max-width:560px){
  #t25-music{right:12px;bottom:12px}
  .t25-music-card{width:230px}
}`;

  const style = document.createElement("style");
  style.id = "t25-music-style";
  style.textContent = STYLE;
  document.head.appendChild(style);

  /* ดึงเพลงที่แอดมินตั้งไว้ */
  let song = null;
  try {
    const res = await fetch("/api/site-song", { cache: "no-store" });
    if (res.ok) song = await res.json();
  } catch {}
  if (!song || !song.url) return;                       // ยังไม่มีเพลงเปิดเว็บ
  if (sessionStorage.getItem("t25music") === "closed") return;   // ปิดไว้ในรอบนี้

  const pausedBefore = localStorage.getItem("t25music") === "off";   // เคยสั่งหยุดไว้
  const parsed = T25Song.parse(song.url);

  const wrap = document.createElement("div");
  wrap.id = "t25-music";
  wrap.innerHTML = `
    <button class="t25-music-btn" type="button" aria-label="เล่น/หยุดเพลงเปิดเว็บ">▶</button>
    <div class="t25-music-card">
      <div class="t25-music-head">
        <span class="t25-music-eyebrow">NOW PLAYING</span>
        <button class="t25-music-close" type="button" aria-label="ปิดตัวเล่นเพลง">×</button>
      </div>
      <div class="t25-music-player"></div>
    </div>`;
  document.body.appendChild(wrap);

  const btn = wrap.querySelector(".t25-music-btn");
  const mount = wrap.querySelector(".t25-music-player");

  /* ลิงก์ที่ฝังเล่นไม่ได้ → แค่ปุ่มเปิดลิงก์ */
  let player = null;
  if (!parsed || !parsed.embed) {
    mount.innerHTML = `<b style="display:block;color:#f0f0f4;font-size:12.5px">${T25Song.esc(song.title || "เพลงเปิดเว็บ")}</b>
      <a class="t25-music-link" href="${T25Song.esc(song.url)}" target="_blank" rel="noopener">♪ เปิดเพลง ↗</a>`;
    wrap.querySelector(".t25-music-head").hidden = false;
    btn.addEventListener("click", () => window.open(song.url, "_blank", "noopener"));
    return;
  }

  let userPaused = pausedBefore;
  let autoStartedAt = 0;
  let closed = false;

  function paint() {
    const playing = player && player.isPlaying();
    btn.textContent = playing ? "❚❚" : "▶";
    btn.setAttribute("aria-label", playing ? "หยุดเพลงเปิดเว็บ" : "เล่นเพลงเปิดเว็บ");
    wrap.classList.toggle("is-playing", !!playing);
    wrap.classList.toggle("is-idle", !playing && !userPaused && !closed);
  }

  player = T25Song.render(mount, song, {
    autoplay: !pausedBefore,
    onStateChange: paint
  });
  if (!player) { wrap.remove(); return; }
  paint();

  /* เบราว์เซอร์บล็อกการเล่นอัตโนมัติ → เล่นทันทีที่แตะหน้าจอครั้งแรก (ครั้งเดียว) */
  function unblock() {
    if (closed || userPaused || player.isPlaying()) return;
    player.play();
    autoStartedAt = Date.now();
    paint();
  }
  document.addEventListener("pointerdown", unblock, { capture: true });
  document.addEventListener("keydown", unblock, { capture: true });

  btn.addEventListener("click", () => {
    /* คลิกแรกที่เพิ่งปลดบล็อก autoplay → ไม่ต้องสลับสถานะซ้ำ */
    if (Date.now() - autoStartedAt < 700) { paint(); return; }
    if (player.isPlaying()) { userPaused = true; localStorage.setItem("t25music", "off"); player.pause(); }
    else { userPaused = false; localStorage.setItem("t25music", "on"); player.play(); }
    paint();
  });

  wrap.querySelector(".t25-music-close").addEventListener("click", () => {
    closed = true;
    try { player.destroy(); } catch {}
    wrap.remove();
    sessionStorage.setItem("t25music", "closed");
  });
})();
