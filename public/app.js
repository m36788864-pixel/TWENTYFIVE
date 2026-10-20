/* ============================================================
   TWENTYFIVE — MAIN APP
   1. ELEMENTS
   2. UTILITIES
   3. LOADING SCREEN
   4. CUSTOM CURSOR
   5. NAVIGATION
   6. SCROLL REVEAL
   7. MEMBER DIRECTORY
   ============================================================ */

/* ---------- 1. ELEMENTS ---------- */
const grid = document.getElementById("member-grid");
const search = document.getElementById("search");
const count = document.getElementById("count");
const empty = document.getElementById("empty");
const intro = document.getElementById("intro");
const introPercent = document.getElementById("intro-percent");
const introType = document.getElementById("intro-type");
const nav = document.querySelector(".nav");
const burger = document.getElementById("nav-burger");
const navLinks = document.querySelector(".nav-links");
const cursorDot = document.getElementById("cursor-dot");
const cursorRing = document.getElementById("cursor-ring");
const profileOverlay = document.getElementById("profile-overlay");
const profileClose = document.getElementById("profile-close");

let members = [];
let activeGroup = "ALL";

document.getElementById("year").textContent = new Date().getFullYear();

/* ---------- 2. UTILITIES ---------- */
function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));
}

function safeURL(value = "") {
  const url = String(value).trim();
  return /^https?:\/\//i.test(url) ? url : "";
}

/* social icons (facebook / tiktok) */
const SOCIAL_ICONS = {
  facebook: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>',
  tiktok: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/></svg>'
};

function socialLinks(member) {
  const links = ["facebook", "tiktok"]
    .map((name) => {
      const url = safeURL(member[name]);
      if (!url) return "";
      return `<a class="social-btn" href="${escapeHTML(url)}" target="_blank" rel="noopener" aria-label="${name}">${SOCIAL_ICONS[name]}</a>`;
    })
    .join("");
  return links ? `<div class="member-socials">${links}</div>` : "";
}

/* ---------- 3. LOADING SCREEN ---------- */
const BOOT_LINES = [
  "INITIALIZING KERNEL...",
  "MOUNTING DIRECTORY...",
  "DECRYPTING ROSTER...",
  "ACCESS GRANTED"
];

function bootSequence() {
  let progress = 0;
  let lineIndex = 0;

  const lineTimer = setInterval(() => {
    lineIndex = Math.min(lineIndex + 1, BOOT_LINES.length - 1);
    if (introType) introType.textContent = BOOT_LINES[lineIndex];
  }, 450);

  const percentTimer = setInterval(() => {
    progress = Math.min(progress + Math.ceil(Math.random() * 9), 100);
    if (introPercent) introPercent.textContent = progress + "%";
    if (progress >= 100) {
      clearInterval(percentTimer);
      clearInterval(lineTimer);
      setTimeout(() => intro.classList.add("done"), 350);
    }
  }, 90);
}

window.addEventListener("load", () => setTimeout(bootSequence, 200));

/* ---------- 4. CUSTOM CURSOR ---------- */
if (window.matchMedia("(hover:hover) and (min-width:901px)").matches) {
  let mouseX = -100, mouseY = -100, ringX = -100, ringY = -100;

  document.addEventListener("mousemove", (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
    cursorDot.style.transform = `translate(${mouseX}px, ${mouseY}px) translate(-50%,-50%)`;
  });

  (function followRing() {
    ringX += (mouseX - ringX) * 0.15;
    ringY += (mouseY - ringY) * 0.15;
    cursorRing.style.transform = `translate(${ringX}px, ${ringY}px) translate(-50%,-50%)`;
    requestAnimationFrame(followRing);
  })();

  document.addEventListener("mouseover", (e) => {
    cursorRing.classList.toggle("hovering", !!e.target.closest("a, button, input, .op-card"));
  });
}

/* ---------- 5. NAVIGATION ---------- */
window.addEventListener("scroll", () => {
  nav.classList.toggle("scrolled", window.scrollY > 40);
}, { passive: true });

burger.addEventListener("click", () => navLinks.classList.toggle("open"));
navLinks.addEventListener("click", (e) => {
  if (e.target.tagName === "A") navLinks.classList.remove("open");
});

/* ---------- 6. SCROLL REVEAL ---------- */
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add("visible");
      revealObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.15 });

document.querySelectorAll(".reveal").forEach((el) => revealObserver.observe(el));

/* ---------- 7. MEMBER DIRECTORY ---------- */
const THEMES = ["gold", "silver", "ice", "rose", "mint", "violet"];
const PATTERNS = ["plain", "grid", "dots", "glow"];
/* ลายบอร์ดที่เจ้าของเลือกไว้ (validate อีกชั้นฝั่งหน้าเว็บ) */
function boardTheme(m) { return THEMES.includes(m && m.theme) ? m.theme : ""; }
function boardPattern(m) { return PATTERNS.includes(m && m.pattern) ? m.pattern : ""; }

const TIERS = [
  { key: "BOSS",    icon: "■" , label: "BOSS" },
  { key: "LEADER",  icon: "◆", label: "LEADER" },
  { key: "SUPPORT", icon: "✚", label: "SUPPORT" },
  { key: "MEMBER",  icon: "⚑", label: "MEMBER" }
];

/* รองรับข้อมูลเก่า: LEADERSHIP -> LEADER, MEMBERS -> MEMBER */
function tierOf(m) {
  const g = String(m.group || "").trim().toUpperCase();
  if (g === "BOSS") return "BOSS";
  if (g === "LEADER" || g === "LEADERSHIP") return "LEADER";
  if (g === "SUPPORT") return "SUPPORT";
  return "MEMBER";
}

function cardHTML(m, tier, i) {
  const t = TIERS.find((x) => x.key === tier);
  const socials = ["facebook", "tiktok"].map((network) => {
    const url = safeURL(m[network]);
    const label = network === "facebook" ? "Facebook" : "TikTok";
    return url
      ? `<a class="op-social" href="${escapeHTML(url)}" target="_blank" rel="noopener" aria-label="${label}">${SOCIAL_ICONS[network]}</a>`
      : `<span class="op-social off" aria-hidden="true">${SOCIAL_ICONS[network]}</span>`;
  }).join("");
  const idText = "ID-" + String(m.id).slice(-4).padStart(4, "0");
  const num = String(i + 1).padStart(2, "0");
  const theme = boardTheme(m);
  const classes = ["op-card", `tier-${tier.toLowerCase()}`, theme ? `board-${theme}` : ""].filter(Boolean).join(" ");
  return `
    <article class="${classes}" data-member-id="${escapeHTML(m.id)}" tabindex="0" role="button" aria-label="ดูโปรไฟล์ ${escapeHTML(m.name)}" style="animation-delay:${Math.min(i * 45, 420)}ms">
      <span class="op-ghost" aria-hidden="true">${num}</span>
      <div class="op-top"><span class="op-chip"><i></i>${t.label}</span></div>
      <div class="op-avatar">
        ${m.image ? `<img src="${escapeHTML(m.image)}" alt="" loading="lazy" onerror="this.remove()">` : `<b>25</b>`}
        <i class="op-dot"></i>
      </div>
      <div class="op-info">
        <span class="op-tag"><em>${t.icon}</em>${escapeHTML(m.role || t.label)}</span>
        <strong class="op-name" title="${escapeHTML(m.name)}">${escapeHTML(m.name)}</strong>
        <p class="op-desc">${escapeHTML(m.tagline || m.description || "TWENTYFIVE COLLECTIVE")}</p>
      </div>
      <div class="op-foot">
        <span class="op-id"><s></s>${idText}</span>
        <div class="op-actions">${socials}</div>
      </div>
    </article>`;
}

function render() {
  const query = search.value.trim().toLowerCase();
  const list = members.filter((m) =>
    (activeGroup === "ALL" || tierOf(m) === activeGroup) &&
    [m.name, m.role, m.group, m.description, m.tagline, m.bio].some((v) => String(v || "").toLowerCase().includes(query))
  );

  if (count) {
    count.innerHTML = `<b>${String(list.length).padStart(2, "0")}</b> MEMBERS FOUND`;
    count.hidden = false;
  }

  let n = 0;
  grid.innerHTML = TIERS.map((t, ti) => {
    const rows = list.filter((m) => tierOf(m) === t.key);
    if (!rows.length) return "";
    const cards = rows.map((m) => cardHTML(m, t.key, n++)).join("");
    const unit = rows.length === 1 ? "OPERATIVE" : "OPERATIVES";
    return `
      <section class="tier-block tier-${t.key.toLowerCase()}">
        <header class="tier-head">
          <span class="tier-num">${String(ti + 1).padStart(2, "0")}</span>
          <h3 class="tier-title">${t.label}</h3>
          <span class="tier-line"></span>
          <span class="tier-count"><b>${String(rows.length).padStart(2, "0")}</b> ${unit}</span>
        </header>
        <div class="tier-grid">${cards}</div>
      </section>`;
  }).join("");

  empty.hidden = list.length !== 0;
}

async function load() {
  try {
    const response = await fetch("/api/members");
    if (!response.ok) throw new Error();
    members = await response.json();
    render();
  } catch {
    grid.innerHTML = '<p class="empty">ไม่สามารถโหลดข้อมูลได้ กรุณารีเฟรชหน้าเว็บ</p>';
  }
}

search.addEventListener("input", render);

document.getElementById("filters").addEventListener("click", (e) => {
  const button = e.target.closest("button[data-group]");
  if (!button) return;
  activeGroup = button.dataset.group;
  document.querySelectorAll(".filter").forEach((el) => el.classList.toggle("active", el === button));
  render();
});


/* ---------- 8. MEMBER PROFILE MODAL ---------- */
function openProfile(member) {
  if (!member) return;
  const modal = document.querySelector(".profile-modal");
  const theme = boardTheme(member);
  const pattern = boardPattern(member);
  modal.className = ["profile-modal", theme ? `board-${theme}` : "", pattern ? `pat-${pattern}` : ""].filter(Boolean).join(" ");

  const avatar = document.getElementById("profile-avatar");
  avatar.innerHTML = member.image
    ? `<img src="${escapeHTML(member.image)}" alt="${escapeHTML(member.name)}" onerror="this.remove()"><span class="profile-avatar-fallback">25</span>`
    : '<span>25</span>';
  avatar.classList.toggle("has-image", !!member.image);
  document.getElementById("profile-name").textContent = member.name || "MEMBER";
  document.getElementById("profile-role").textContent = member.role || "MEMBER";
  document.getElementById("profile-group").textContent = member.group || "MEMBERS";

  const tagline = document.getElementById("profile-tagline");
  tagline.textContent = member.tagline || "";
  tagline.hidden = !member.tagline;

  const statusText = document.getElementById("profile-status-text");
  if (statusText) statusText.textContent = member.status || "MEMBER PROFILE";

  document.getElementById("profile-id").textContent = `NO. ${String(member.id || "--").padStart(2, "0")} / TWENTYFIVE`;
  document.getElementById("profile-description").textContent = member.bio || member.description || "TWENTYFIVE COLLECTIVE";

  const actions = [];
  const discord = safeURL(member.discord);
  if (discord) actions.push(`<a class="profile-link primary" href="${escapeHTML(discord)}" target="_blank" rel="noopener">◉&nbsp; OPEN DISCORD</a>`);
  for (const network of ["facebook", "tiktok"]) {
    const url = safeURL(member[network]);
    if (url) actions.push(`<a class="profile-link" href="${escapeHTML(url)}" target="_blank" rel="noopener">${network.toUpperCase()} ↗</a>`);
  }
  const drive = safeURL(member.driveLink);
  if (drive) actions.push(`<a class="profile-link" href="${escapeHTML(drive)}" target="_blank" rel="noopener">DRIVE ↗</a>`);
  if (!actions.length) actions.push('<span class="profile-no-links">NO PUBLIC LINKS PROVIDED</span>');
  document.getElementById("profile-actions").innerHTML = actions.join("");
  profileOverlay.classList.add("open");
  profileOverlay.setAttribute("aria-hidden", "false");
  document.body.classList.add("profile-open");
  profileClose.focus();
}

function closeProfile() {
  profileOverlay.classList.remove("open");
  profileOverlay.setAttribute("aria-hidden", "true");
  document.body.classList.remove("profile-open");
}

grid.addEventListener("click", (event) => {
  if (event.target.closest("a")) return;
  const card = event.target.closest(".op-card");
  if (card) openProfile(members.find((member) => String(member.id) === card.dataset.memberId));
});
/* spotlight: แสงไล่ตามเมาส์ภายในการ์ด */
grid.addEventListener("pointermove", (event) => {
  const card = event.target.closest(".op-card");
  if (!card) return;
  const box = card.getBoundingClientRect();
  card.style.setProperty("--mx", `${(((event.clientX - box.left) / box.width) * 100).toFixed(1)}%`);
  card.style.setProperty("--my", `${(((event.clientY - box.top) / box.height) * 100).toFixed(1)}%`);
});
grid.addEventListener("keydown", (event) => {
  if ((event.key === "Enter" || event.key === " ") && event.target.matches(".op-card")) {
    event.preventDefault();
    openProfile(members.find((member) => String(member.id) === event.target.dataset.memberId));
  }
});
profileClose.addEventListener("click", closeProfile);
profileOverlay.addEventListener("click", (event) => { if (event.target === profileOverlay) closeProfile(); });
document.addEventListener("keydown", (event) => { if (event.key === "Escape" && profileOverlay.classList.contains("open")) closeProfile(); });

load();
