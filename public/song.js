/* ============================================================
   TWENTYFIVE — SONG PLAYER (ระบบเพลงประจำบอร์ด / เพลงเปิดเว็บ)
   รองรับลิงก์ YouTube / YouTube Music / Spotify / SoundCloud / Apple Music
   → ฝังตัวเล่นในหน้าเว็บได้เลย ส่วนลิงก์อื่น ๆ แสดงเป็นปุ่มเปิดลิงก์แทน

   วิธีใช้:
     T25Song.parse(url)                      → { kind, embed } | null
     T25Song.render(el, song, { autoplay })   → ผู้ควบคุม { play, pause, toggle, isPlaying, destroy }
     T25Song.destroyIn(el)                    → หยุดและล้างตัวเล่นในกล่องนั้น
   song = { title, artist, url }
   ============================================================ */
window.T25Song = (function () {
  "use strict";

  const esc = (v) => String(v || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ---------- STYLES (ฉีดเข้าหน้าเว็บครั้งเดียว) ---------- */
  const CSS = `
.t25-player{display:grid;gap:10px;min-width:0}
.t25-song-frame{position:relative;width:100%;background:#000;border:1px solid rgba(255,255,255,.14);border-radius:12px;overflow:hidden}
.t25-player.k-youtube .t25-song-frame{aspect-ratio:16/9}
.t25-player.k-spotify .t25-song-frame{height:152px}
.t25-player.k-soundcloud .t25-song-frame{height:166px}
.t25-player.k-apple .t25-song-frame{height:175px}
.t25-player.k-audio .t25-song-frame{height:48px;background:rgba(0,0,0,.35)}
.t25-song-frame iframe,.t25-song-frame>div{position:absolute;inset:0;width:100%;height:100%;border:0;display:block}
.t25-song-frame audio{position:absolute;inset:0;width:100%;height:100%;border:0;display:block}
.t25-song-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0;font-size:12.5px;color:#b9b9c2}
.t25-song-meta b{color:#f0f0f4;font-weight:600;overflow-wrap:anywhere}
.t25-song-meta em{font-style:normal;color:#8b8b95;overflow-wrap:anywhere}
.t25-song-meta em:empty{display:none}
.t25-song-note{color:var(--acc,#e6b528);font-style:normal;font-size:15px;line-height:1}
.t25-song-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.t25-song-toggle,.t25-song-open,.t25-song-link{
  display:inline-flex;align-items:center;justify-content:center;gap:6px;
  min-height:34px;padding:7px 16px;border-radius:999px;font:inherit;font-size:12.5px;font-weight:600;
  border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.06);color:#f2f2f4;
  text-decoration:none;cursor:pointer;transition:.18s
}
.t25-song-toggle:hover,.t25-song-open:hover,.t25-song-link:hover{background:rgba(255,255,255,.16)}
.t25-song-toggle{min-width:46px;padding:7px 12px}
.t25-player.is-playing .t25-song-toggle{border-color:var(--acc,#e6b528);color:var(--acc,#e6b528)}
.t25-song-link{background:rgba(var(--acc-rgb,230,181,40),.12);border-color:rgba(var(--acc-rgb,230,181,40),.5);color:var(--acc,#e6b528)}

/* ป้ายโน้ตเพลงบนการ์ดสมาชิก */
.op-song-chip{
  display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;
  border-radius:6px;border:1px solid rgba(var(--acc-rgb,230,181,40),.55);
  background:rgba(var(--acc-rgb,230,181,40),.14);color:var(--acc,#e6b528);font-size:13px;line-height:1
}`;

  function ensureStyle() {
    if (document.getElementById("t25-song-style")) return;
    const style = document.createElement("style");
    style.id = "t25-song-style";
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  /* ---------- แปลงลิงก์เป็น URL ฝังเล่น ---------- */
  function parse(rawUrl) {
    const url = String(rawUrl || "").trim();
    if (!url) return null;

    /* ไฟล์เสียงตรง ๆ (เช่น /uploads/site-song.mp3 ที่อัปโหลดไว้ หรือลิงก์ .mp3 ทั่วไป) */
    if (/^\/[\w./-]+$/.test(url) || /^https?:\/\//i.test(url)) {
      if (/\.(mp3|m4a|aac|wav|ogg|opus|webm|flac)([?#].*)?$/i.test(url)) return { kind: "audio", embed: url };
    }
    if (!/^https?:\/\//i.test(url)) return null;

    /* YouTube / YouTube Music / youtu.be / Shorts */
    let m = url.match(/(?:youtube\.com\/(?:watch\?(?:[^#\s]*&)?v=|shorts\/|embed\/|live\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/i);
    if (m) return { kind: "youtube", videoId: m[1], embed: `https://www.youtube.com/embed/${m[1]}?rel=0&playsinline=1` };

    /* Spotify (track / album / playlist / episode / show) */
    m = url.match(/open\.spotify\.com\/(track|album|playlist|episode|show)\/([A-Za-z0-9]+)/i);
    if (m) return { kind: "spotify", embed: `https://open.spotify.com/embed/${m[1].toLowerCase()}/${m[2]}` };

    /* SoundCloud */
    if (/(?:on\.)?soundcloud\.com\/[\w.-]+\/[\w.-]+/i.test(url)) {
      return { kind: "soundcloud", embed: `https://w.soundcloud.com/player/?url=${encodeURIComponent(url.split("?")[0])}&visual=false` };
    }

    /* Apple Music (เปลี่ยนเป็นโดเมน embed) */
    if (/^https?:\/\/(?:www\.)?music\.apple\.com\//i.test(url)) {
      return { kind: "apple", embed: url.replace(/^(https?:\/\/)(?:www\.)?music\.apple\.com/i, "$1embed.music.apple.com") };
    }

    return { kind: "link", embed: null };   // ลิงก์อื่น → แสดงปุ่มเปิดลิงก์
  }

  /* ---------- YouTube IFrame API (โหลดเฉพาะเมื่อจำเป็น) ---------- */
  let ytPromise = null;
  function loadYT() {
    if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
    if (ytPromise) return ytPromise;
    ytPromise = new Promise((resolve, reject) => {
      const previous = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = function () {
        if (typeof previous === "function") previous();
        resolve(window.YT);
      };
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.onerror = () => { ytPromise = null; reject(new Error("โหลด YouTube API ไม่สำเร็จ")); };
      document.head.appendChild(script);
    });
    return ytPromise;
  }

  function destroyIn(container) {
    const old = container && container.__t25Song;
    if (old) { try { old.destroy(); } catch {} }
  }

  /* ---------- สร้างตัวเล่นลงในกล่อง ---------- */
  function render(container, song, opts) {
    if (!container) return null;
    ensureStyle();
    opts = opts || {};
    destroyIn(container);

    const info = {
      title: String((song && song.title) || "").trim(),
      artist: String((song && song.artist) || "").trim(),
      url: String((song && song.url) || "").trim()
    };

    container.innerHTML = "";
    container.classList.add("t25-player");
    if (!info.url) { container.hidden = true; return null; }
    container.hidden = false;

    const parsed = parse(info.url) || { kind: "link", embed: null };
    ["youtube", "spotify", "soundcloud", "apple", "audio", "link"].forEach((k) => container.classList.remove("k-" + k));
    container.classList.add("k-" + parsed.kind);

    /* ซ่อนชื่อเพลง (hideTitle) → แสดงเฉพาะตัวเล่น ไม่โชว์ชื่อ/ศิลปิน */
    if (!song || !song.hideTitle) {
      const meta = document.createElement("div");
      meta.className = "t25-song-meta";
      meta.innerHTML = `<span class="t25-song-note" aria-hidden="true">♪</span><b>${esc(info.title || "เพลงประจำบอร์ด")}</b><em>${esc(info.artist)}</em>`;
      container.appendChild(meta);
    }

    /* ลิงก์ที่ฝังไม่ได้ → ปุ่มเปิดลิงก์ */
    if (!parsed.embed) {
      const link = document.createElement("a");
      link.className = "t25-song-link";
      link.href = info.url;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = "♪ เปิดเพลง ↗";
      container.appendChild(link);
      container.__t25Song = null;
      return null;
    }

    const frame = document.createElement("div");
    frame.className = "t25-song-frame";
    container.appendChild(frame);

    const state = { playing: false, destroyed: false, yt: null, ytReady: null, pendingPlay: false, iframe: null, audio: null };

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "t25-song-toggle";

    const open = document.createElement("a");
    open.className = "t25-song-open";
    open.href = info.url;
    open.target = "_blank";
    open.rel = "noopener";
    open.textContent = "เปิดลิงก์ ↗";

    const actions = document.createElement("div");
    actions.className = "t25-song-actions";
    actions.append(btn, open);
    container.appendChild(actions);

    function paint() {
      btn.textContent = state.playing ? "❚❚" : "▶";
      btn.setAttribute("aria-label", state.playing ? "หยุดเพลง" : "เล่นเพลง");
      container.classList.toggle("is-playing", state.playing);
      if (typeof opts.onStateChange === "function") opts.onStateChange(state.playing);
    }

    function post(message, origin) {
      if (!state.iframe || !state.iframe.contentWindow) return;
      try { state.iframe.contentWindow.postMessage(JSON.stringify(message), origin); } catch {}
    }

    /* สร้าง iframe (ใช้กับ Spotify / SoundCloud / Apple Music / สำรองของ YouTube) */
    function mount(autoplay) {
      if (state.destroyed) return;
      frame.innerHTML = "";
      const iframe = document.createElement("iframe");
      iframe.title = info.title ? `เพลง ${info.title}` : "ตัวเล่นเพลง";
      iframe.setAttribute("allow", "autoplay; encrypted-media; picture-in-picture; fullscreen");
      iframe.setAttribute("allowfullscreen", "");
      let src = parsed.embed;
      if (parsed.kind === "soundcloud") src += `${src.includes("?") ? "&" : "?"}auto_play=${autoplay ? "true" : "false"}`;
      else if (autoplay) src += `${src.includes("?") ? "&" : "?"}autoplay=1`;
      iframe.src = src;
      frame.appendChild(iframe);
      state.iframe = iframe;
    }

    function start() {
      if (state.destroyed) return;
      state.playing = true;
      paint();
      if (parsed.kind === "audio") { if (state.audio) { const p = state.audio.play(); if (p && p.catch) p.catch(() => {}); } return; }
      if (parsed.kind === "youtube") {
        if (state.ytReady) { try { state.ytReady.playVideo(); } catch {} }
        else state.pendingPlay = true;
        return;
      }
      if (parsed.kind === "spotify") { post({ command: "play" }, "https://open.spotify.com"); return; }
      if (parsed.kind === "soundcloud") { post({ method: "play" }, "https://w.soundcloud.com"); return; }
      if (!state.iframe) mount(true);   // เคยถูกหยุดไปแล้ว → สร้างใหม่พร้อมเล่นเอง
    }

    function stop() {
      if (state.destroyed) return;
      state.playing = false;
      paint();
      if (parsed.kind === "audio") { if (state.audio) state.audio.pause(); return; }
      if (parsed.kind === "youtube") { if (state.ytReady) { try { state.ytReady.pauseVideo(); } catch {} } return; }
      if (parsed.kind === "spotify") { post({ command: "pause" }, "https://open.spotify.com"); return; }
      if (parsed.kind === "soundcloud") { post({ method: "pause" }, "https://w.soundcloud.com"); return; }
      frame.innerHTML = "";            // รายอื่น → เอา iframe ออกเพื่อหยุดเสียง
      state.iframe = null;
    }

    function destroy() {
      if (state.destroyed) return;
      state.destroyed = true;
      try { if (state.yt && state.yt.destroy) state.yt.destroy(); } catch {}
      container.innerHTML = "";
      container.classList.remove("t25-player", "k-youtube", "k-spotify", "k-soundcloud", "k-apple", "k-audio", "k-link", "is-playing");
      container.hidden = true;
      container.__t25Song = null;
    }

    const controller = {
      play: start,
      pause: stop,
      toggle: () => (state.playing ? stop() : start()),
      isPlaying: () => state.playing,
      destroy
    };
    container.__t25Song = controller;
    btn.addEventListener("click", () => controller.toggle());
    paint();

    if (parsed.kind === "audio") {
      /* ไฟล์เสียงบนเซิร์ฟเวอร์ → เล่นตรงด้วย <audio> */
      const audio = document.createElement("audio");
      audio.src = parsed.embed;
      audio.controls = true;
      audio.preload = "metadata";
      audio.setAttribute("playsinline", "");
      audio.addEventListener("play", () => { state.playing = true; paint(); });
      audio.addEventListener("pause", () => { state.playing = false; paint(); });
      frame.appendChild(audio);
      state.audio = audio;
      if (opts.autoplay) { const p = audio.play(); if (p && p.catch) p.catch(() => {}); }
    } else if (parsed.kind === "youtube") {
      const holder = document.createElement("div");
      frame.appendChild(holder);
      loadYT().then((YT) => {
        if (state.destroyed) return;
        state.yt = new YT.Player(holder, {
          videoId: parsed.videoId,
          playerVars: { rel: 0, playsinline: 1, modestbranding: 1, autoplay: opts.autoplay ? 1 : 0 },
          events: {
            onReady: (e) => {
              state.ytReady = e.target;
              if (state.pendingPlay || opts.autoplay) {
                state.pendingPlay = false;
                try { e.target.playVideo(); } catch {}
              }
              paint();
            },
            onStateChange: (e) => {
              state.playing = e.data === 1;    // 1 = กำลังเล่น (รู้สถานะจริงจาก YouTube)
              paint();
            }
          }
        });
      }).catch(() => { if (!state.destroyed) mount(!!opts.autoplay); });   // โหลด API ไม่ได้ → ใช้ iframe ตรง ๆ
    } else {
      mount(!!opts.autoplay);
    }

    return controller;
  }

  ensureStyle();
  return { parse, render, destroyIn, esc };
})();
