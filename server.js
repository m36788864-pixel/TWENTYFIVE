const express = require("express");
const session = require("express-session");
const { Store } = require("express-session");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET;
/* ตั้ง DISCORD_BOT_TOKEN เพื่อให้บอทส่ง DM เอง / ถ้าไม่ตั้ง แอดมินกดคัดลอกข้อความไปส่งเองได้
   DISCORD_GUILD_ID = ไอดีเซิร์ฟเวอร์ (ไม่บังคับ) ใส่แล้วบอทจะค้นหา User ID จาก "ชื่อผู้ใช้" ให้ได้ */
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || "";
const DISCORD_GUILD_ID = (process.env.DISCORD_GUILD_ID || "").trim();
/* ลิงก์เชิญเข้ากลุ่มดิสคอร์ดของแก๊ง — ใช้ในข้อความที่ส่งให้ผู้สมัคร (แก้ผ่าน env DISCORD_INVITE ได้) */
const DISCORD_INVITE = (process.env.DISCORD_INVITE || "https://discord.gg/rZBmUgYtx2").trim();
/* ใช้ทำลิงก์ในข้อความ DM เช่น https://your-site.onrender.com */
const PUBLIC_URL = (process.env.PUBLIC_URL || "").replace(/\/+$/, "");

/* ============================================================
   สำรองข้อมูลขึ้น GitHub (เข้ารหัส) — ใช้คู่กับ Render ฟรีที่ดิสก์ถูกล้างทุกครั้งที่ deploy
   BACKUP_KEY          = รหัสลับสำหรับเข้ารหัส AES-256 (ห้ามหาย ถ้าหายกู้ข้อมูลไม่ได้)
   BACKUP_GITHUB_TOKEN = GitHub Token (repo หรือ Contents: Read and write)
   BACKUP_REPO         = ชื่อ repo รูปแบบ owner/repo (หรือลิงก์ github.com ก็ได้)
   BACKUP_BRANCH       = branch สำหรับเก็บข้อมูล (ค่าเริ่มต้น data-backup)
                        ไม่ควรเป็น branch เดียวกับที่ Render ใช้ deploy กัน deploy loop)
   ============================================================ */
const BACKUP_KEY = (process.env.BACKUP_KEY || "").trim();
const BACKUP_GITHUB_TOKEN = (process.env.BACKUP_GITHUB_TOKEN || "").trim();
const BACKUP_BRANCH = (process.env.BACKUP_BRANCH || "data-backup").trim() || "data-backup";
const BACKUP_INTERVAL = Math.max(10, Number(process.env.BACKUP_INTERVAL) || 30) * 1000;

function parseRepoUrl(value) {
  const m = String(value || "").trim().replace(/\/+$/, "").match(/(?:github\.com[/:])?([\w.-]+)\/([\w.-]+?)(?:\.git)?$/i);
  return m ? { owner: m[1], repo: m[2], fullName: `${m[1]}/${m[2]}` } : null;
}
const BACKUP_REPO = parseRepoUrl(process.env.BACKUP_REPO || "");

/* ============================================================
   ส่งข้อมูลขึ้น Google ชีต — ผ่าน Apps Script Web App
   SHEETS_WEBHOOK_URL = URL ของ Apps Script ที่ลงท้ายด้วย /exec
   SHEETS_SECRET      = รหัสลับให้ตรงกับ TOKEN ใน Apps Script (ไม่บังคับ แต่แนะนำ)
   SHEETS_INTERVAL    = ส่งไม่ถี่กว่าทุกกี่วินาที (ค่าเริ่มต้น 20)
   SHEETS_KEEPALIVE   = ส่งข้อมูลขึ้นชีตเองทุกกี่วินาที แม้ไม่มีใครแก้ไข (ค่าเริ่มต้น 300, 0 = ปิด)
                        ทำให้มีสำเนาบนชีตอยู่เสมอ → กด "กู้ข้อมูลจากชีตกลับมา" ได้ทุกเมื่อ
   ============================================================ */
const SHEETS_WEBHOOK_URL = (process.env.SHEETS_WEBHOOK_URL || "").trim();
const SHEETS_SECRET = (process.env.SHEETS_SECRET || "").trim();
const SHEETS_INTERVAL = Math.max(5, Number(process.env.SHEETS_INTERVAL) || 20) * 1000;
const SHEETS_KEEPALIVE = Math.max(0, Number(process.env.SHEETS_KEEPALIVE ?? 300) || 0) * 1000;

/* เช็กรูปแบบ URL ตั้งแต่ต้นทาง — ถ้าผิด การส่งจะโดน 404 ทุกครั้งโดยไม่รู้สาเหตุ */
const SHEETS_URL_HINT = (() => {
  if (!SHEETS_WEBHOOK_URL) return "";
  if (!/^https:\/\/script\.google\.com\/macros\//i.test(SHEETS_WEBHOOK_URL)) {
    return "SHEETS_WEBHOOK_URL ต้องขึ้นต้นด้วย https://script.google.com/macros/ — ตอนนี้เป็นอย่างอื่น อาจเอา URL ของ Google ชีต (docs.google.com/spreadsheets/...) มาวางแทน URL ของ Apps Script";
  }
  if (!/\/exec\/?$/i.test(SHEETS_WEBHOOK_URL)) {
    return "SHEETS_WEBHOOK_URL ต้องลงท้ายด้วย /exec — ถ้าลงท้ายด้วย /dev ให้ใช้ URL จาก Deploy → Manage deployments → Web app แทน (URL แบบ /dev ใช้ได้ตอนทดสอบใน-editor เท่านั้น)";
  }
  return "";
})();

const DATA_DIR = path.join(__dirname, "data");

if (!ADMIN_PASSWORD || !SESSION_SECRET) {
  console.warn("IMPORTANT: Set ADMIN_PASSWORD and SESSION_SECRET environment variables before public deployment.");
}
if (!DISCORD_BOT_TOKEN) {
  console.warn("NOTE: ยังไม่ได้ตั้ง DISCORD_BOT_TOKEN — ระบบจะไม่ส่ง DM เอง แต่จะให้แอดมินคัดลอกข้อความไปส่งแทน");
}
if (!SHEETS_WEBHOOK_URL) {
  console.warn("NOTE: ยังไม่ได้ตั้ง SHEETS_WEBHOOK_URL — ข้อมูลจะไม่ถูกส่งขึ้น Google ชีต");
} else if (SHEETS_URL_HINT) {
  console.warn(`IMPORTANT: ${SHEETS_URL_HINT}`);
}
fs.mkdirSync(DATA_DIR, { recursive: true });
const UPLOAD_DIR = path.join(__dirname, "public", "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/* ============================================================
   1. STORAGE + SEED — เก็บข้อมูลเป็นไฟล์ และสำรองอัตโนมัติ
   ทุกครั้งที่บันทึก จะอัปเดต <name>.seed.json (สำเนา)
   ถ้า <name>.json หายหรือเสียหาย ระบบจะกู้คืนจาก seed ให้เอง
   ============================================================ */
const DEFAULT_MEMBERS = [
  { id: 1, name: "TWENTYFIVE", role: "FOUNDER", group: "BOSS", image: "", description: "ตัวอย่างสมาชิก — แก้ไขหรือลบได้จากหลังบ้าน" },
  { id: 2, name: "MEMBER 01", role: "MEMBER", group: "MEMBER", image: "", description: "ตัวอย่างข้อมูลสมาชิก" },
  { id: 3, name: "MEMBER 02", role: "MEMBER", group: "MEMBER", image: "", description: "ตัวอย่างข้อมูลสมาชิก" }
];

/* ------------------------------------------------------------
   CLOUD BACKUP ENGINE — เข้ารหัส AES-256-GCM แล้ว push ขึ้น GitHub
   และตอนเปิดเซิร์ฟเวอร์ ถ้าดิสก์ว่าง (เช่นเพิ่ง deploy บน Render ฟรี)
   จะดึงสำเนาล่าสุดจาก GitHub → ถอดรหัส → เติมข้อมูลกลับให้เอง
   ------------------------------------------------------------ */
const backupStatus = {
  configured: !!(BACKUP_KEY && BACKUP_GITHUB_TOKEN && BACKUP_REPO),
  keySet: !!BACKUP_KEY,
  repo: BACKUP_REPO ? BACKUP_REPO.fullName : "",
  branch: BACKUP_BRANCH,
  intervalSec: BACKUP_INTERVAL / 1000,
  lastPushAt: null,
  lastPushError: null,
  lastRestoreAt: null,
  lastRestoreSource: "",
  lastRestoreError: null,
  pushed: { members: { at: null, error: null }, applications: { at: null, error: null } }
};

function backupKey() {
  if (!BACKUP_KEY) return null;
  return crypto.scryptSync(BACKUP_KEY, "twentyfive-backup-v1", 32);
}
function encryptBackup(text) {
  const key = backupKey();
  if (!key) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return `v1:${Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64")}`;
}
function decryptBackup(blob) {
  const key = backupKey();
  if (!key) throw new Error("ยังไม่ได้ตั้งค่า BACKUP_KEY");
  const raw = String(blob || "").trim();
  if (!raw.startsWith("v1:")) throw new Error("ไฟล์สำรองไม่ใช่รูปแบบ v1:");
  const buf = Buffer.from(raw.slice(3), "base64");
  if (buf.length < 29) throw new Error("ไฟล์สำรองเสียหาย (สั้นเกินไป)");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
}

const GITHUB_API = "https://api.github.com";
async function githubFetch(apiPath, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    return await fetch(`${GITHUB_API}${apiPath}`, {
      ...options,
      signal: controller.signal,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${BACKUP_GITHUB_TOKEN}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(options.headers || {})
      }
    });
  } finally { clearTimeout(timer); }
}

const backupPath = (name) => `data/${name}.seed.enc`;
let branchReady = false;

async function ensureBackupBranch() {
  if (branchReady || !BACKUP_REPO) return;
  const repoRes = await githubFetch(`/repos/${BACKUP_REPO.fullName}`);
  if (!repoRes.ok) {
    const hint = repoRes.status === 404 ? " — เช็กชื่อ BACKUP_REPO และสิทธิ์ของโทเคน"
      : repoRes.status === 401 || repoRes.status === 403 ? " — โทเคนไม่ถูกต้องหรือหมดสิทธิ์" : "";
    throw new Error(`เข้าถึง repo ${BACKUP_REPO.fullName} ไม่ได้ (${repoRes.status}${hint})`);
  }
  const repo = await repoRes.json();
  if (repo.default_branch === BACKUP_BRANCH) { branchReady = true; return; }
  const ref = await githubFetch(`/repos/${BACKUP_REPO.fullName}/git/ref/heads/${BACKUP_BRANCH}`);
  if (ref.ok) { branchReady = true; return; }
  const head = await githubFetch(`/repos/${BACKUP_REPO.fullName}/git/ref/heads/${repo.default_branch}`);
  if (!head.ok) throw new Error(`อ่าน branch หลักของ repo ไม่ได้ (${head.status})`);
  const sha = (await head.json()).object.sha;
  const create = await githubFetch(`/repos/${BACKUP_REPO.fullName}/git/refs`, {
    method: "POST",
    body: JSON.stringify({ ref: `refs/heads/${BACKUP_BRANCH}`, sha })
  });
  if (!create.ok && create.status !== 422) throw new Error(`สร้าง branch ${BACKUP_BRANCH} ไม่สำเร็จ (${create.status})`);
  branchReady = true;
}

async function pushBackupFile(name, text) {
  const encrypted = encryptBackup(text);
  if (!encrypted) throw new Error("ยังไม่ได้ตั้งค่า BACKUP_KEY");
  const file = backupPath(name);
  let sha = "";
  const head = await githubFetch(`/repos/${BACKUP_REPO.fullName}/contents/${file}?ref=${encodeURIComponent(BACKUP_BRANCH)}`);
  if (head.ok) sha = (await head.json()).sha;
  else if (head.status !== 404) throw new Error(`อ่านสถานะไฟล์ ${file} ไม่ได้ (${head.status})`);
  const put = await githubFetch(`/repos/${BACKUP_REPO.fullName}/contents/${file}`, {
    method: "PUT",
    body: JSON.stringify({
      message: `backup: ${name} ${new Date().toISOString()}`,
      content: Buffer.from(encrypted, "utf8").toString("base64"),
      branch: BACKUP_BRANCH,
      ...(sha ? { sha } : {})
    })
  });
  if (!put.ok) {
    const detail = await put.json().catch(() => ({}));
    throw new Error(`push ไม่สำเร็จ (${put.status})${detail.message ? ` — ${detail.message}` : ""}`);
  }
  return file;
}

async function fetchBackupFile(name) {
  const file = backupPath(name);
  const res = await githubFetch(`/repos/${BACKUP_REPO.fullName}/contents/${file}?ref=${encodeURIComponent(BACKUP_BRANCH)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`อ่าน ${file} จาก GitHub ไม่ได้ (${res.status})`);
  const info = await res.json();
  return Buffer.from(String(info.content || "").replace(/\n/g, ""), "base64").toString("utf8");
}

/* คิว push: รวมการแก้หลาย ๆ ครั้งให้เหลือ push ไม่เกิน BACKUP_INTERVAL วินาที */
const backupQueue = new Map();   // name → json ล่าสุดที่ยังไม่ได้ push
let backupTimer = null;
let backupRun = null;
let backupLastRun = 0;
let cloudRestoreInProgress = false;

function scheduleBackup(name, text) {
  if (cloudRestoreInProgress || !backupStatus.configured) return;
  const store = STORES[name];
  if (store && store.freshPlaceholder) return;   // ข้อมูลเริ่มต้นชั่วคราว — ห้ามเขียนทับสำรองบน GitHub
  backupQueue.set(name, text);
  if (backupRun || backupTimer) return;
  backupTimer = setTimeout(runBackupLoop, Math.max(0, backupLastRun + BACKUP_INTERVAL - Date.now()));
  if (backupTimer.unref) backupTimer.unref();
}

async function runBackupLoop() {
  backupTimer = null;
  if (backupRun) return backupRun;
  backupRun = (async () => {
    try {
      await ensureBackupBranch();
      while (backupQueue.size) {
        const name = [...backupQueue.keys()][0];
        const text = backupQueue.get(name);
        try {
          const file = await pushBackupFile(name, text);
          backupQueue.delete(name);
          backupStatus.pushed[name] = { at: new Date().toISOString(), error: null };
          backupStatus.lastPushAt = new Date().toISOString();
          backupStatus.lastPushError = null;
          console.log(`[backup] push ${name} ขึ้น GitHub สำเร็จ (${file})`);
        } catch (err) {
          const message = String(err.message || err);
          backupQueue.delete(name);   // ไม่ retry ทันที — บันทึกครั้งหน้าจะลองใหม่เอง
          backupStatus.pushed[name] = { at: (backupStatus.pushed[name] || {}).at, error: message };
          backupStatus.lastPushError = message;
          console.warn(`[backup] push ${name} ไม่สำเร็จ: ${message}`);
        }
      }
    } catch (err) {
      backupStatus.lastPushError = String(err.message || err);
      console.warn(`[backup] ${backupStatus.lastPushError}`);
    } finally {
      backupLastRun = Date.now();
      backupRun = null;
    }
  })();
  return backupRun;
}

/* บังคับส่งคิวที่ค้างอยู่ทั้งหมดตอนนี้ (ใช้ตอนกดปุ่มสำรอง และตอนเซิร์ฟเวอร์กำลังจะปิด) */
async function flushBackup() {
  if (backupTimer) { clearTimeout(backupTimer); backupTimer = null; }
  if (backupRun) await backupRun;
  while (backupQueue.size && !backupRun) await runBackupLoop();
}

/* เปิดเซิร์ฟเวอร์: ถ้าดิสก์ว่าง → ดึงข้อมูลกลับจาก GitHub / ไฟล์ .enc บนเครื่องเองอัตโนมัติ */
async function restoreFromCloud() {
  cloudRestoreInProgress = true;
  try {
    const part = [BACKUP_KEY, BACKUP_GITHUB_TOKEN, BACKUP_REPO].filter(Boolean).length;
    if (part > 0 && part < 3) {
      backupStatus.lastRestoreError = "ตั้งค่า BACKUP ไม่ครบ — ต้องมี BACKUP_KEY + BACKUP_GITHUB_TOKEN + BACKUP_REPO ครบทั้งสามตัว";
      console.warn(`[backup] ${backupStatus.lastRestoreError}`);
    }
    for (const store of [membersStore, appsStore]) {
      const name = store.name;
      try {
        if (fs.existsSync(store.file) || fs.existsSync(store.seedFile)) {
          console.log(`[backup] ${name}: มีข้อมูลบนเครื่องอยู่แล้ว — ข้ามการกู้คืน`);
          continue;
        }
        const localEnc = path.join(DATA_DIR, `${name}.seed.enc`);
        if (BACKUP_KEY && fs.existsSync(localEnc)) {
          const list = JSON.parse(decryptBackup(fs.readFileSync(localEnc, "utf8")));
          if (!Array.isArray(list)) throw new Error("ไฟล์ .enc ไม่ใช่รายการข้อมูล");
          store.write(list);
          backupStatus.lastRestoreAt = new Date().toISOString();
          backupStatus.lastRestoreSource = `${name}.seed.enc (บนเครื่อง)`;
          console.warn(`[backup] ${name}: กู้คืนจากไฟล์ .enc บนเครื่องสำเร็จ (${list.length} รายการ)`);
          continue;
        }
        if (backupStatus.configured) {
          const blob = await fetchBackupFile(name);
          if (blob) {
            const list = JSON.parse(decryptBackup(blob));
            if (!Array.isArray(list)) throw new Error("ข้อมูลในไฟล์สำรองไม่ใช่รายการ");
            store.write(list);
            backupStatus.lastRestoreAt = new Date().toISOString();
            backupStatus.lastRestoreSource = `${BACKUP_REPO.fullName}@${BACKUP_BRANCH}`;
            console.warn(`[backup] ${name}: ดึงข้อมูลจาก GitHub สำเร็จ — กู้คืน ${list.length} รายการ`);
            continue;
          }
          console.log(`[backup] ${name}: ไม่พบสำเนาบน GitHub`);
        } else {
          console.log(`[backup] ${name}: ยังไม่ได้ตั้งค่า GitHub backup`);
        }
        /* ทางสุดท้าย: กู้จากสำเนาดิบบน Google ชีต (ลองซ้ำถ้าพลาดชั่วคราว) */
        if (sheetStatus.configured) {
          const sheetName = SHEET_NAMES[name];
          let item = null;
          for (let attempt = 1; attempt <= 3 && !item; attempt++) {
            try {
              item = (await sheetsRawCached())[sheetName];
            } catch (err) {
              item = null;
              console.warn(`[sheets] ${name}: ดึงสำเนาจาก Google ชีตไม่ได้ (รอบ ${attempt}/3) — ${err.message}`);
              if (attempt < 3) await new Promise((r) => setTimeout(r, 3000));
            }
          }
          if (item && Array.isArray(item.data)) {
            store.write(item.data);
            sheetStatus.lastRestoreAt = new Date().toISOString();
            sheetStatus.lastRestoreSource = `Google ชีต (${sheetName})`;
            console.warn(`[sheets] ${name}: กู้คืนจาก Google ชีตสำเร็จ (${item.data.length} รายการ)`);
          } else {
            console.log(`[sheets] ${name}: ไม่พบสำเนาบน Google ชีต`);
          }
        }
      } catch (err) {
        backupStatus.lastRestoreError = String(err.message || err);
        console.warn(`[backup] ${name}: กู้คืนไม่สำเร็จ — ${err.message}`);
      }
    }
  } finally { cloudRestoreInProgress = false; }
}

/* สรุปสถานะ backup ส่งให้หน้าแอดมิน */
function cloudSummary() {
  return {
    configured: backupStatus.configured,
    keySet: backupStatus.keySet,
    repo: backupStatus.repo,
    branch: backupStatus.branch,
    intervalSec: backupStatus.intervalSec,
    lastPushAt: backupStatus.lastPushAt,
    lastPushError: backupStatus.lastPushError,
    lastRestoreAt: backupStatus.lastRestoreAt,
    lastRestoreSource: backupStatus.lastRestoreSource,
    lastRestoreError: backupStatus.lastRestoreError,
    pushed: backupStatus.pushed
  };
}

/* ------------------------------------------------------------
   GOOGLE SHEETS SYNC — ส่งใบสมัคร + รายชื่อสมาชิกขึ้น Google ชีต
   ปลายทางคือ Apps Script Web App (ไม่ต้องใช้ไลบรารีเพิ่ม)
   ส่งแบบ "เขียนทับทั้งชีต" ทุกครั้ง → แก้/ลบ/เรียงลำดับ ตรงกันเสมอ
   ------------------------------------------------------------ */
const SHEET_NAMES = { applications: "Applications", members: "Members" };
const APPLICATION_COLUMNS = [
  "ลำดับ", "รหัส", "ชื่อ IC", "อายุ IC", "เฟส IC", "ดิสคอร์ด", "ลิงก์ไดรฟ์", "รายละเอียดแนะนำตัว",
  "สถานะใบสมัคร", "วันที่สมัคร", "วันที่ตัดสิน", "เหตุผลที่แจ้ง", "ชื่อผู้ใช้บอร์ด", "สถานะส่ง DM"
];
const MEMBER_COLUMNS = [
  "ลำดับ", "รหัส", "ชื่อ IC", "ตำแหน่ง", "หมวด", "อายุ IC", "เฟส IC", "ดิสคอร์ด", "ลิงก์ไดรฟ์",
  "คำโปรย", "รายละเอียด", "สถานะแก๊ง", "วันที่สมัคร", "วันที่รับเข้า",
  "ชื่อผู้ใช้บอร์ด", "รหัสผ่านบอร์ด", "อัปเดตรหัสเมื่อ"
];
const APPLICATION_STATUS_TH = { pending: "รอตรวจ", approved: "รับเข้าแก๊ง", rejected: "ไม่ผ่าน" };
const DM_STATUS_TH = { sent: "ส่งแล้ว", manual: "ให้แอดมินส่งเอง", failed: "ส่งไม่สำเร็จ" };

const sheetStatus = {
  configured: !!SHEETS_WEBHOOK_URL,
  secretSet: !!SHEETS_SECRET,
  intervalSec: SHEETS_INTERVAL / 1000,
  keepaliveSec: SHEETS_KEEPALIVE / 1000,
  lastSyncAt: null,
  lastError: null,
  lastRestoreAt: null,
  lastRestoreSource: "",
  sheets: {
    Applications: { at: null, error: null, rows: 0 },
    Members: { at: null, error: null, rows: 0 }
  }
};
const sheetQueue = new Map();
let sheetTimer = null;
let sheetKeepaliveTimer = null;
let sheetRun = null;
let sheetLastRun = 0;
let sheetBuilding = false;
let sheetRestoring = false;

function thDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("th-TH", { timeZone: "Asia/Bangkok" });
}
function tierLabel(member) {
  const group = String(member.group || "").trim().toUpperCase();
  if (group === "LEADERSHIP") return "LEADER";
  if (group === "MEMBERS") return "MEMBER";
  return group || "MEMBER";
}
function applicationRows(members) {
  const byId = new Map(members.map((m) => [String(m.id), m]));
  return readApps().map((a, i) => {
    const member = a.memberId ? byId.get(String(a.memberId)) : null;
    return [
      i + 1, a.id, a.name, a.icAge, a.facebookIc, a.discordUser, a.driveLink, a.about,
      APPLICATION_STATUS_TH[a.status] || a.status || "", thDateTime(a.createdAt), thDateTime(a.decidedAt), a.reason || "",
      (member && member.credentials && member.credentials.username) || "",
      a.dm ? (DM_STATUS_TH[a.dm.status] || a.dm.status || "") : ""
    ];
  });
}
function memberRows(members) {
  return members.map((m, i) => [
    i + 1, m.id, m.name, m.role, tierLabel(m), m.icAge, m.facebookIc, m.discordUser, m.driveLink,
    m.tagline, m.description || m.bio,
    m.exitedAt ? `ออกจากแก๊งแล้ว (${thDateTime(m.exitedAt)}${m.exitReason ? ` · ${m.exitReason}` : ""})` : "อยู่ในแก๊ง",
    thDateTime(m.appliedAt), thDateTime(m.approvedAt),
    (m.credentials && m.credentials.username) || "", (m.credentials && m.credentials.password) || "",
    thDateTime(m.credentials && m.credentials.issuedAt)
  ]);
}
/* อ่านข้อมูลจากดิสก์ทุกครั้งที่ส่ง → ชีตตรงกับข้อมูลจริงเสมอ
   ส่งทั้งตารางที่อ่านง่าย (columns/rows) และข้อมูลดิบ (data) สำหรับกู้คืนกลับแบบไม่สูญหาย */
function buildSheetPayload(sheet) {
  sheetBuilding = true;
  try {
    const members = readMembers();
    const columns = sheet === "Members" ? MEMBER_COLUMNS : APPLICATION_COLUMNS;
    const rows = sheet === "Members" ? memberRows(members) : applicationRows(members);
    const data = sheet === "Members" ? members : readApps();
    return {
      token: SHEETS_SECRET,
      version: 2,
      sheet,
      columns,
      rows: rows.map((row) => columns.map((_, i) => (row[i] === undefined || row[i] === null ? "" : String(row[i])))),
      data,                        // สำเนาข้อมูลดิบ — ใช้กู้คืนกลับเข้าระบบได้ครบถ้วน
      at: new Date().toISOString()
    };
  } finally { sheetBuilding = false; }
}

async function postToSheet(payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(SHEETS_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },   // text/plain เลี่ยงปัญหา preflight ของ Apps Script
      body: JSON.stringify(payload),
      redirect: "follow",
      signal: controller.signal
    });    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch {}
    if (!res.ok) {
      const tip = res.status === 404
        ? ` — URL ปลายทางไม่มีอยู่จริง ให้ตรวจว่า SHEETS_WEBHOOK_URL ลงท้ายด้วย /exec (ไม่ใช่ /dev) และคัดลอกจาก Deploy → Manage deployments → Web app แล้ว${SHEETS_URL_HINT ? ` · ${SHEETS_URL_HINT}` : ""}`
        : SHEETS_URL_HINT ? ` — ${SHEETS_URL_HINT}` : "";
      throw new Error(`Google ชีตตอบกลับ ${res.status}${tip}`);
    }
    if (data && data.ok === false) throw new Error(data.error || "Apps Script ปฏิเสธข้อมูล");
    return data || { ok: true };
  } finally { clearTimeout(timer); }
}

/* ดึงข้อมูลดิบที่สำรองไว้บน Google ชีต (สำหรับกู้คืนกลับเข้าระบบ) */
async function fetchSheetRaw() {
  const url = new URL(SHEETS_WEBHOOK_URL);
  url.searchParams.set("action", "raw");
  if (SHEETS_SECRET) url.searchParams.set("token", SHEETS_SECRET);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url.toString(), { redirect: "follow", signal: controller.signal });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch {}
    if (!res.ok) throw new Error(`Google ชีตตอบกลับ ${res.status}`);
    if (!data) throw new Error("อ่านข้อมูลจาก Google ชีตไม่ได้ (ผลลัพธ์ไม่ใช่ JSON)");
    if (data.ok === false) throw new Error(data.error || "Apps Script ปฏิเสธข้อมูล");
    return data.items || {};
  } finally { clearTimeout(timer); }
}

async function sendSheet(sheet) {
  const payload = buildSheetPayload(sheet);
  const startedAt = Date.now();
  await postToSheet(payload);
  const at = new Date().toISOString();
  sheetStatus.sheets[sheet] = { at, error: null, rows: payload.rows.length };
  sheetStatus.lastSyncAt = at;
  sheetStatus.lastError = null;
  console.log(`[sheets] ส่ง ${sheet} ขึ้น Google ชีตสำเร็จ (${payload.rows.length} แถว, ${Date.now() - startedAt} ms)`);
  return { sheet, rows: payload.rows.length };
}

function scheduleSheetSync(storeName) {
  const sheet = SHEET_NAMES[storeName];
  if (!sheet || !sheetStatus.configured || sheetBuilding || sheetRestoring || cloudRestoreInProgress) return;
  const store = STORES[storeName];
  if (store && store.freshPlaceholder) return;   // ยังเป็นข้อมูลเริ่มต้นชั่วคราว — ห้ามเขียนทับสำเนาบนชีต
  sheetQueue.set(sheet, true);
  if (sheetRun || sheetTimer) return;
  sheetTimer = setTimeout(runSheetQueue, Math.max(0, sheetLastRun + SHEETS_INTERVAL - Date.now()));
  if (sheetTimer.unref) sheetTimer.unref();
}

/* ส่งข้อมูลขึ้นชีตอัตโนมัติเป็นรอบ ๆ แม้ไม่มีใครแก้ไขอะไรเลย
   เพื่อให้ "มีสำเนาอยู่บนชีตเสมอ" → กดปุ่มกู้ข้อมูลได้ทุกเมื่อ */
function runSheetKeepalive() {
  if (!sheetStatus.configured || sheetBuilding || sheetRestoring || cloudRestoreInProgress) return;
  try { readMembers(); readApps(); } catch {}     // โหลดข้อมูลจริงก่อน จะได้รู้ว่าเป็นข้อมูลชั่วคราวหรือไม่
  scheduleSheetSync("members");
  scheduleSheetSync("applications");
  if (sheetQueue.size && !sheetRun) runSheetQueue();
}

function startSheetKeepalive() {
  if (!sheetStatus.configured || sheetKeepaliveTimer) return;
  if (SHEETS_KEEPALIVE > 0) {
    sheetKeepaliveTimer = setInterval(runSheetKeepalive, SHEETS_KEEPALIVE);
    if (sheetKeepaliveTimer.unref) sheetKeepaliveTimer.unref();
  }
  runSheetKeepalive();                            // ผลักครั้งแรกทันทีตอนเปิดเซิร์ฟเวอร์
}

async function runSheetQueue() {
  sheetTimer = null;
  if (sheetRun) return sheetRun;
  sheetRun = (async () => {
    let hadError = false;
    try {
      for (const sheet of [...sheetQueue.keys()]) {
        try {
          await sendSheet(sheet);
          sheetQueue.delete(sheet);
        } catch (err) {
          const message = String((err && err.message) || err);
          sheetStatus.sheets[sheet].error = message;
          sheetStatus.lastError = message;
          console.warn(`[sheets] ส่ง ${sheet} ไม่สำเร็จ: ${message} (จะลองใหม่รอบถัดไป)`);
          hadError = true;
          break;                                   // ไม่ยิงรัว — รอรอบถัดไปลองใหม่
        }
      }
    } finally {
      sheetLastRun = Date.now();
      sheetRun = null;
      if (hadError && sheetQueue.size && !sheetTimer) {
        sheetTimer = setTimeout(runSheetQueue, SHEETS_INTERVAL);   // ลองใหม่เร็ว ๆ ไม่ต้องรอรอบ keepalive
        if (sheetTimer.unref) sheetTimer.unref();
      }
    }
  })();
  return sheetRun;
}

/* ส่งคิวที่ค้างอยู่ตอนนี้ (ตอนกดปุ่ม และตอนเซิร์ฟเวอร์กำลังจะปิด) */
async function flushSheets() {
  if (sheetKeepaliveTimer) { clearInterval(sheetKeepaliveTimer); sheetKeepaliveTimer = null; }
  if (sheetTimer) { clearTimeout(sheetTimer); sheetTimer = null; }
  if (sheetRun) await sheetRun;
  if (sheetStatus.configured && sheetQueue.size) await runSheetQueue();
}

/* ดึงข้อมูลดิบจากชีตครั้งเดียวต่อการกู้หนึ่งรอบ (ใช้ตอนเปิดเซิร์ฟเวอร์) */
let sheetsRawCache = null;
async function sheetsRawCached() {
  if (!sheetsRawCache) sheetsRawCache = await fetchSheetRaw();
  return sheetsRawCache;
}

/* เติมข้อมูลที่ดึงจากชีตกลับเข้าระบบ (เขียนทับข้อมูลปัจจุบัน)
   onlyMissing = true → เติมเฉพาะเมื่อบนเครื่องไม่มีข้อมูล (ใช้ตอนเปิดเซิร์ฟเวอร์) */
async function applySheetRestore(items, { onlyMissing = false } = {}) {
  sheetRestoring = true;
  const report = {};
  try {
    for (const [storeName, sheetName] of Object.entries(SHEET_NAMES)) {
      const store = storeName === "members" ? membersStore : appsStore;
      try {
        const item = items && items[sheetName];
        if (!item) throw new Error("ไม่พบสำเนาข้อมูลของชีตนี้บน Google ชีต");
        const list = item.data;
        if (!Array.isArray(list)) throw new Error("รูปแบบข้อมูลบนชีตไม่ถูกต้อง");
        if (onlyMissing && (fs.existsSync(store.file) || fs.existsSync(store.seedFile))) {
          report[sheetName] = { ok: true, skipped: true, count: list.length, at: item.at || "" };
          continue;
        }
        if (!list.length && store.read().length) {
          throw new Error("ข้อมูลบนชีตว่างเปล่า — ยกเลิกเพื่อกันข้อมูลหาย (ถ้าต้องการล้างข้อมูล ให้ลบที่หน้าแอดมิน)");
        }
        store.write(list);
        sheetStatus.lastRestoreAt = new Date().toISOString();
        sheetStatus.lastRestoreSource = `Google ชีต (${sheetName})`;
        console.warn(`[sheets] ${storeName}: กู้คืนจาก Google ชีตสำเร็จ (${list.length} รายการ)`);
        report[sheetName] = { ok: true, count: list.length, at: item.at || "" };
      } catch (err) {
        report[sheetName] = { ok: false, error: String((err && err.message) || err) };
        console.warn(`[sheets] ${storeName}: กู้คืนไม่สำเร็จ — ${report[sheetName].error}`);
      }
    }
  } finally { sheetRestoring = false; }
  return report;
}

function sheetsSummary() {
  return {
    configured: sheetStatus.configured,
    urlHint: SHEETS_URL_HINT,
    secretSet: sheetStatus.secretSet,
    intervalSec: sheetStatus.intervalSec,
    keepaliveSec: sheetStatus.keepaliveSec,
    lastSyncAt: sheetStatus.lastSyncAt,
    lastError: sheetStatus.lastError,
    lastRestoreAt: sheetStatus.lastRestoreAt,
    lastRestoreSource: sheetStatus.lastRestoreSource,
    sheets: sheetStatus.sheets,
    queue: [...sheetQueue.keys()]
  };
}

function createStore(name, createEmpty) {
  const file = path.join(DATA_DIR, `${name}.json`);
  const seedFile = path.join(DATA_DIR, `${name}.seed.json`);
  const parse = (target) => {
    try {
      const value = JSON.parse(fs.readFileSync(target, "utf8"));
      return Array.isArray(value) ? value : null;
    } catch { return null; }
  };
  const api = {
    file, seedFile, name, seededAt: null, restoredAt: null,
    /* true = เป็นข้อมูลเริ่มต้นชั่วคราวที่ระบบสร้างขึ้นเพราะดิสก์ว่าง
       ห้ามส่งข้อมูลชุดนี้ขึ้นคลาวด์/ชีต เพราะจะเขียนทับสำเนาจริงที่มีอยู่ให้หาย */
    freshPlaceholder: false,
    read() {
      const primary = parse(file);
      if (primary) {
        if (!fs.existsSync(seedFile)) api.write(primary);   // ครั้งแรก: สร้าง seed จากข้อมูลจริง
        return primary;
      }
      const seed = parse(seedFile);
      if (seed) {                                          // ไฟล์หลักหาย/พัง → ดึงจาก seed อัตโนมัติ
        try { fs.writeFileSync(file, JSON.stringify(seed, null, 2)); } catch {}
        api.restoredAt = new Date().toISOString();
        console.warn(`[seed] ${name}.json ใช้งานไม่ได้ — กู้คืนจาก ${name}.seed.json อัตโนมัติแล้ว`);
        return seed;
      }
      const fresh = createEmpty();
      /* ไม่เขียนลงดิสก์ — กันไม่ให้ข้อมูลเริ่มต้นชั่วคราวไปแทนที่ข้อมูลจริง
         และกันไม่ให้รอบ restart ถัดไปคิดว่า "มีข้อมูลอยู่แล้ว" จนข้ามการกู้จากคลาวด์ */
      api.freshPlaceholder = true;
      console.warn(`[seed] ${name}: ยังไม่มีข้อมูลบนเครื่อง — ใช้ข้อมูลเริ่มต้นชั่วคราว ${fresh.length} รายการ (ยังไม่เขียนไฟล์ ระบบจะลองกู้จากคลาวด์อีกครั้งทุกครั้งที่เปิดเซิร์ฟเวอร์ และจะไม่ส่งชุดนี้ขึ้น Google ชีต/GitHub)`);
      return fresh;
    },
    write(value, opts = {}) {
      const json = JSON.stringify(value, null, 2);
      fs.writeFileSync(file, json);
      try {
        fs.writeFileSync(seedFile, json);
        api.seededAt = new Date().toISOString();
      } catch (err) { console.warn(`[seed] สำรอง ${name} ไม่สำเร็จ: ${err.message}`); }
      api.freshPlaceholder = !!opts.placeholder;
      scheduleBackup(name, json);   // สำรองขึ้น GitHub (เข้ารหัส) อัตโนมัติ
      scheduleSheetSync(name);      // ส่งขึ้น Google ชีตอัตโนมัติ (ถ้าตั้งค่าไว้)
      return value;
    }
  };
  return api;
}

const membersStore = createStore("members", () => DEFAULT_MEMBERS);
const appsStore = createStore("applications", () => []);
const readMembers = () => membersStore.read();
const writeMembers = (list) => membersStore.write(list);
const readApps = () => appsStore.read();
const writeApps = (list) => appsStore.write(list);
const STORES = { members: membersStore, applications: appsStore };

/* ============================================================
   2. HELPERS
   ============================================================ */
const cleanUrl = (value) => {
  const url = String(value || "").trim().slice(0, 1000);
  return /^https?:\/\//i.test(url) ? url : "";
};
const cleanLine = (value, max) => String(value ?? "").trim().slice(0, max);
const cleanChoice = (value, list) => {
  const picked = String(value || "").trim().toLowerCase();
  return list.includes(picked) ? picked : "";
};
const nameKey = (value) => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
const GROUPS = ["BOSS", "LEADER", "SUPPORT", "MEMBER"];
const cleanGroup = (value) => {
  const g = String(value || "").trim().toUpperCase();
  if (g === "LEADERSHIP") return "LEADER";
  if (g === "MEMBERS") return "MEMBER";
  return GROUPS.includes(g) ? g : "MEMBER";
};

const BOARD_THEMES = ["gold", "silver", "ice", "rose", "mint", "violet"];
const BOARD_PATTERNS = ["plain", "grid", "dots", "glow"];

const slugify = (value) => {
  const slug = String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 16);
  /* ชื่อไทย/อักขระอื่นจะเหลือค่าว่าง → ใช้อักษรสุ่มให้ยังอ่านออก */
  return slug || `t25${crypto.randomBytes(2).toString("hex")}`;
};
const makePassword = () => {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";   // ตัดตัวที่อ่านสับสน (l i o 0 1)
  const bytes = crypto.randomBytes(10);
  let out = "";
  for (let i = 0; i < 10; i += 1) out += chars[bytes[i] % chars.length];
  return out;
};
function uniqueUsername(list, name) {
  const used = new Set(list.map((m) => nameKey(m.credentials && m.credentials.username)).filter(Boolean));
  const base = slugify(name);
  let candidate = base;
  let n = 1;
  while (used.has(nameKey(candidate))) { n += 1; candidate = `${base}${n}`; }
  return candidate;
}

/* ไม่ส่งรหัสผ่านออกไปฝั่งสาธารณะ */
const publicMember = (m) => {
  if (!m) return null;
  const { credentials, ...rest } = m;
  return rest;
};
/* ข้อมูลที่เจ้าของบอร์ดเห็นได้ (ของตัวเอง) */
const boardMember = (m) => {
  if (!m) return null;
  return { ...publicMember(m), username: (m.credentials && m.credentials.username) || "" };
};
const publicMemberList = () => readMembers().filter((m) => !m.exitedAt).map(publicMember);
const baseUrl = (req) => PUBLIC_URL || `${req.protocol}://${req.get("host")}`;

/* ============================================================
   3. DISCORD DM — บอทส่งชื่อผู้ใช้/รหัสให้ผู้สมัครทางข้อความส่วนตัว
   ============================================================ */
const DISCORD_API = "https://discord.com/api/v10";

/* ดึง User ID จากข้อความที่กรอก (รับได้ทั้ง ID ล้วน และลิงก์โปรไฟล์) */
function discordIdFrom(value) {
  const raw = String(value || "").trim();
  const fromLink = raw.match(/users\/(\d{17,20})/);
  if (fromLink) return fromLink[1];
  const snowflake = raw.match(/(?:^|\D)(\d{17,20})(?:\D|$)/);
  return snowflake ? snowflake[1] : "";
}

/* ตัด @ นำหน้า / #1234 ท้ายชื่อออก เพื่อเทียบชื่อแบบไม่สนตัวพิมพ์ */
function discordNameKey(value) {
  return String(value || "").trim().toLowerCase().replace(/^@+/, "").replace(/#\d{2,4}$/, "").replace(/\s+/g, " ");
}

async function discordFetch(apiPath, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    return await fetch(`${DISCORD_API}${apiPath}`, {
      ...options,
      signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bot ${DISCORD_BOT_TOKEN}`, ...(options.headers || {}) }
    });
  } finally { clearTimeout(timer); }
}

/* แปลง "ชื่อผู้ใช้ดิสคอร์ด" → User ID (ต้องตั้ง DISCORD_GUILD_ID และบอทอยู่ในเซิร์ฟเวอร์นั้น) */
async function resolveDiscordId(value) {
  const direct = discordIdFrom(value);
  if (direct) return { id: direct, via: "id" };
  const raw = String(value || "").trim();
  if (!raw) return { id: "", via: "none" };
  if (!DISCORD_BOT_TOKEN || !DISCORD_GUILD_ID) return { id: "", via: "name-no-guild" };

  const key = discordNameKey(raw);
  const find = (list) => (list || []).find((entry) => {
    const user = entry.user || {};
    const names = [user.username, user.global_name, entry.nick];
    if (user.discriminator && user.discriminator !== "0") names.push(`${user.username}#${user.discriminator}`);
    return names.map(discordNameKey).filter(Boolean).includes(key);
  });

  try {
    const search = await discordFetch(`/guilds/${DISCORD_GUILD_ID}/members/search?limit=50&query=${encodeURIComponent(key)}`);
    if (search.ok) {
      const hit = find(await search.json());
      if (hit) return { id: hit.user.id, via: "guild-search" };
    }
  } catch { /* ลองวิธีถัดไป */ }

  try {
    const list = await discordFetch(`/guilds/${DISCORD_GUILD_ID}/members?limit=1000`);
    if (list.ok) {
      const hit = find(await list.json());
      if (hit) return { id: hit.user.id, via: "guild-list" };
    } else if (list.status === 403) {
      return { id: "", via: "no-intent" };
    }
  } catch { /* ตกไปแจ้งให้แอดมินส่งเอง */ }

  return { id: "", via: "not-found" };
}

const DM_FAIL_REASON = {
  none: "ใบสมัครไม่ได้กรอกดิสคอร์ด",
  "name-no-guild": "กรอกเป็นชื่อผู้ใช้ — ต้องตั้ง DISCORD_GUILD_ID เพื่อให้บอทค้นหา User ID (หรือให้ผู้สมัครกรอก User ID)",
  "no-intent": "บอทอ่านรายชื่อสมาชิกไม่ได้ — เปิด GUILD MEMBERS INTENT ในหน้า Developer Portal หรือให้ผู้สมัครกรอก User ID",
  "not-found": "หาชื่อผู้ใช้นี้ไม่เจอในเซิร์ฟเวอร์"
};
const DM_VIA_TEXT = {
  id: "ส่งจาก User ID ที่กรอกไว้",
  "guild-search": "หา User ID จากชื่อในเซิร์ฟเวอร์ให้แล้ว",
  "guild-list": "หา User ID จากชื่อในเซิร์ฟเวอร์ให้แล้ว"
};

function credentialMessage(member, req) {
  const link = `${baseUrl(req)}/board`;
  return [
    "🎉 **ยินดีด้วย! ใบสมัครเข้าแก๊ง TWENTYFIVE ของคุณได้รับการอนุมัติแล้ว**",
    "",
    `👤 ชื่อ IC: **${member.name}**`,
    `🔑 ชื่อผู้ใช้ (Username): \`${member.credentials.username}\``,
    `🔒 รหัสผ่าน: \`${member.credentials.password}\``,
    "",
    `🎨 เข้าไปตกแต่งบอร์ดแนะนำตัวของตัวเองได้ที่: ${link}`,
    "",
    "💬 เข้ากลุ่มดิสคอร์ดของแก๊งเพื่อพูดคุย พบปะ และรับข่าวสารของแก๊งได้ที่:",
    DISCORD_INVITE,
    "",
    "⚠️ เก็บชื่อผู้ใช้และรหัสผ่านนี้ไว้เป็นความลับ อย่าส่งให้ใคร",
    "",
    "✨ ยินดีต้อนรับสู่ TWENTYFIVE — ขอให้สนุกกับแก๊งของเรานะ!"
  ].join("\n");
}

/* ตอบกลับอัตโนมัติทันทีที่ส่งใบสมัคร — บอกให้ผู้สมัครรอข้อความตอบกลับอีกฉบับ */
function applicationReceivedMessage(application) {
  return [
    "📩 **ได้รับใบสมัครเข้าแก๊ง TWENTYFIVE ของคุณแล้ว**",
    "",
    `👤 ชื่อ IC: **${application.name}**`,
    `🎮 ดิสคอร์ด: ${application.discordUser}`,
    "",
    "⏳ ตอนนี้แอดมินกำลังตรวจใบสมัครของคุณอยู่ — รออีกนิดนะ",
    "📬 ถ้าใบสมัครผ่าน ระบบจะ **ส่งข้อความมาหาคุณอีกครั้ง** พร้อมชื่อผู้ใช้ รหัสผ่าน และลิงก์เข้ากลุ่มดิสคอร์ดของแก๊ง",
    "🚫 ระหว่างรอผลยังเข้ากลุ่มดิสคอร์ดไม่ได้ ต้องรอข้อความยืนยันจากระบบก่อน",
    "",
    "🙏 ขอบคุณที่สนใจแก๊ง TWENTYFIVE"
  ].join("\n");
}

/* ส่ง DM ให้ผู้สมัคร: แปลงเป็น User ID ก่อน แล้วเปิดช่อง DM + ส่งข้อความ */
async function sendDiscordDM(value, content) {
  if (!DISCORD_BOT_TOKEN) return { status: "manual", error: "ยังไม่ได้ตั้งค่า DISCORD_BOT_TOKEN" };
  const who = await resolveDiscordId(value);
  if (!who.id) return { status: "manual", error: DM_FAIL_REASON[who.via] || "ไม่พบ Discord User ID" };
  try {
    const channelRes = await discordFetch("/users/@me/channels", { method: "POST", body: JSON.stringify({ recipient_id: who.id }) });
    if (!channelRes.ok) {
      const hint = channelRes.status === 401 ? " — โทเคนบอทไม่ถูกต้อง"
        : channelRes.status === 403 ? " — ผู้ใช้ปิดรับ DM หรือไม่ได้อยู่เซิร์ฟเวอร์เดียวกับบอท"
        : channelRes.status === 429 ? " — ส่งถี่เกินไป ลองใหม่ภายหลัง" : "";
      throw new Error(`เปิด DM ไม่สำเร็จ (${channelRes.status}${hint})`);
    }
    const channel = await channelRes.json();
    const msgRes = await discordFetch(`/channels/${channel.id}/messages`, { method: "POST", body: JSON.stringify({ content }) });
    if (!msgRes.ok) {
      const hint = msgRes.status === 403 ? " — บอทไม่มีสิทธิ์ส่งข้อความหาผู้ใช้นี้" : msgRes.status === 429 ? " — ส่งถี่เกินไป ลองใหม่ภายหลัง" : "";
      throw new Error(`ส่งข้อความไม่สำเร็จ (${msgRes.status}${hint})`);
    }
    return { status: "sent", recipientId: who.id, via: who.via, viaText: DM_VIA_TEXT[who.via] || "" };
  } catch (err) {
    const message = err && err.name === "AbortError" ? "ดิสคอร์ดตอบช้าเกิน 12 วินาที" : String((err && err.message) || err);
    return { status: "manual", error: message, recipientId: who.id, via: who.via };
  }
}

/* ============================================================
   4. FILE-BACKED SESSION (ล็อกอินอยู่ได้แม้เซิร์ฟเวอร์รีสตาร์ท)
   ============================================================ */
const SESSION_FILE = path.join(DATA_DIR, "sessions.json");
class FileStore extends Store {
  constructor() {
    super();
    this.sessions = {};
    this.saveTimer = null;
    try {
      if (fs.existsSync(SESSION_FILE)) this.sessions = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
    } catch { this.sessions = {}; }
  }
  persist() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      try { fs.writeFileSync(SESSION_FILE, JSON.stringify(this.sessions)); } catch {}
    }, 250);
  }
  get(sid, cb) {
    const raw = this.sessions[sid];
    if (!raw) return cb(null, null);
    let sess;
    try { sess = JSON.parse(raw); } catch { return cb(null, null); }
    const expires = sess && sess.cookie && sess.cookie.expires ? new Date(sess.cookie.expires) : null;
    if (expires && expires < new Date()) {
      delete this.sessions[sid];
      this.persist();
      return cb(null, null);
    }
    cb(null, sess);
  }
  set(sid, sess, cb) {
    try { this.sessions[sid] = JSON.stringify(sess); this.persist(); cb && cb(null); }
    catch (err) { cb && cb(err); }
  }
  destroy(sid, cb) {
    delete this.sessions[sid];
    this.persist();
    cb && cb(null);
  }
}
const fileStore = new FileStore();

app.disable("x-powered-by");
// Render/Railway อยู่หลัง proxy (HTTPS) — ต้องเชื่อ proxy ไม่งั้น cookie แบบ secure จะไม่ถูกตั้ง และล็อกอินแอดมินไม่ได้
app.set("trust proxy", 1);
app.use(express.json({ limit: "8mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(session({
  name: "twentyfive.sid",
  store: fileStore,
  secret: SESSION_SECRET || "local-development-only-change-this",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 4 * 60 * 60 * 1000 }
}));
app.use(express.static(path.join(__dirname, "public")));

/* ============================================================
   5. AUTH GUARDS
   ============================================================ */
const adminOnly = (req, res, next) => req.session && req.session.admin ? next() : res.status(401).json({ error: "กรุณาเข้าสู่ระบบแอดมินก่อน" });
const adminOrMember = (req, res, next) => (req.session && (req.session.admin || req.session.memberId)) ? next() : res.status(401).json({ error: "กรุณาเข้าสู่ระบบก่อน" });
const currentMember = (req) => {
  const id = req.session && req.session.memberId;
  if (!id) return null;
  const member = readMembers().find((m) => String(m.id) === String(id)) || null;
  return member && !member.exitedAt ? member : null;   // ถูกให้ออกจากแก๊งแล้ว → สิทธิ์เดิมใช้ไม่ได้ทันที
};

/* กันสแปมใบสมัคร: ไม่เกิน 4 ครั้ง / 10 นาที ต่อ IP */
const applyHits = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const list = (applyHits.get(key) || []).filter((t) => now - t < windowMs);
  if (list.length >= max) return false;
  list.push(now);
  applyHits.set(key, list);
  return true;
}

/* ============================================================
   6. AUTH (แอดมิน)
   ============================================================ */
app.post("/api/login", (req, res) => {
  const { username, password } = req.body || {};
  if (!ADMIN_PASSWORD || !SESSION_SECRET) return res.status(503).json({ error: "เซิร์ฟเวอร์ยังไม่ได้ตั้งค่า ADMIN_PASSWORD และ SESSION_SECRET" });
  if (username !== ADMIN_USER || password !== ADMIN_PASSWORD) return res.status(401).json({ error: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" });
  req.session.admin = true;
  res.json({ ok: true });
});
app.get("/api/session", (req, res) => res.json({ authenticated: !!(req.session && req.session.admin) }));
app.post("/api/logout", (req, res) => req.session.destroy(() => res.json({ ok: true })));

/* ============================================================
   7. MEMBERS (สาธารณะอ่านได้ / แอดมินแก้ได้)
   ============================================================ */
app.get("/api/members", (req, res) => res.json(publicMemberList()));
app.get("/api/members/full", adminOnly, (req, res) => res.json(readMembers()));

const IMAGE_TYPES = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif" };
app.post("/api/upload", adminOrMember, (req, res) => {
  const { data } = req.body || {};
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(String(data || ""));
  if (!match) return res.status(400).json({ error: "ไฟล์ต้องเป็นรูปภาพ PNG, JPG, WEBP หรือ GIF" });
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length) return res.status(400).json({ error: "ไฟล์รูปภาพเสียหายหรือว่างเปล่า" });
  if (buffer.length > 4 * 1024 * 1024) return res.status(400).json({ error: "ขนาดรูปต้องไม่เกิน 4MB" });
  const filename = `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${IMAGE_TYPES[match[1]]}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, filename), buffer);
  res.status(201).json({ url: `/uploads/${filename}` });
});

function memberPayload(body, current = {}) {
  return {
    name: cleanLine(body.name === undefined ? current.name : body.name, 80),
    role: cleanLine(body.role === undefined ? current.role : body.role, 40) || "MEMBER",
    group: cleanGroup(body.group === undefined ? current.group : body.group),
    icAge: cleanLine(body.icAge === undefined ? current.icAge : body.icAge, 10),
    facebookIc: cleanUrl(body.facebookIc === undefined ? current.facebookIc : body.facebookIc),
    discordUser: cleanLine(body.discordUser === undefined ? current.discordUser : body.discordUser, 60),
    driveLink: cleanUrl(body.driveLink === undefined ? current.driveLink : body.driveLink),
    image: cleanLine(body.image === undefined ? current.image : body.image, 1000),
    description: cleanLine(body.description === undefined ? current.description : body.description, 240),
    tagline: cleanLine(body.tagline === undefined ? current.tagline : body.tagline, 60),
    bio: cleanLine(body.bio === undefined ? current.bio : body.bio, 240),
    status: cleanLine(body.status === undefined ? current.status : body.status, 40),
    theme: cleanChoice(body.theme === undefined ? current.theme : body.theme, BOARD_THEMES),
    pattern: cleanChoice(body.pattern === undefined ? current.pattern : body.pattern, BOARD_PATTERNS),
    discord: cleanUrl(body.discord === undefined ? current.discord : body.discord),
    facebook: cleanUrl(body.facebook === undefined ? current.facebook : body.facebook),
    tiktok: cleanUrl(body.tiktok === undefined ? current.tiktok : body.tiktok)
  };
}

app.post("/api/members", adminOnly, (req, res) => {
  const body = req.body || {};
  const data = memberPayload(body);
  if (!data.name) return res.status(400).json({ error: "กรุณาใส่ชื่อสมาชิก" });
  const members = readMembers();
  const member = { id: Date.now(), ...data };
  members.unshift(member);
  writeMembers(members);
  res.status(201).json(member);
});

app.put("/api/members/order", adminOnly, (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids)) return res.status(400).json({ error: "ids ต้องเป็นอาเรย์ของหมายเลขสมาชิก" });
  const members = readMembers();
  const byId = new Map(members.map((m) => [String(m.id), m]));
  const used = new Set();
  const next = [];
  for (const raw of ids) {                       // เรียงตามลำดับที่แอดมินส่งมา
    const id = String(raw);
    if (byId.has(id) && !used.has(id)) { next.push(byId.get(id)); used.add(id); }
  }
  for (const m of members) if (!used.has(String(m.id))) next.push(m); // รายการที่ไม่ได้ส่งมา ต่อท้ายตามเดิม
  writeMembers(next);
  res.json(next);
});

app.put("/api/members/:id", adminOnly, (req, res) => {
  const members = readMembers();
  const index = members.findIndex((m) => String(m.id) === String(req.params.id));
  if (index < 0) return res.status(404).json({ error: "ไม่พบสมาชิก" });
  const data = memberPayload(req.body || {}, members[index]);
  if (!data.name) return res.status(400).json({ error: "กรุณาใส่ชื่อสมาชิก" });
  members[index] = { ...members[index], ...data };
  writeMembers(members);
  res.json(members[index]);
});

app.delete("/api/members/:id", adminOnly, (req, res) => {
  const members = readMembers();
  const next = members.filter((m) => String(m.id) !== String(req.params.id));
  if (next.length === members.length) return res.status(404).json({ error: "ไม่พบสมาชิก" });
  writeMembers(next);
  res.json({ ok: true });
});

/* ให้ออกจากแก๊ง: ซ่อนจากหน้าเว็บ + ตัดสิทธิ์เข้าบอร์ดทันที แต่ข้อมูล/ผลงานบอร์ดยังอยู่และกู้กลับได้ */
app.post("/api/members/:id/exit", adminOnly, (req, res) => {
  const members = readMembers();
  const index = members.findIndex((m) => String(m.id) === String(req.params.id));
  if (index < 0) return res.status(404).json({ error: "ไม่พบสมาชิก" });
  if (members[index].exitedAt) return res.status(409).json({ error: "สมาชิกคนนี้ถูกให้ออกจากแก๊งอยู่แล้ว" });
  const reason = cleanLine((req.body || {}).reason, 160);
  members[index] = { ...members[index], exitedAt: new Date().toISOString(), exitReason: reason };
  writeMembers(members);
  res.json({ ok: true, member: members[index] });
});

/* รับกลับเข้าแก๊ง (คืนสิทธิ์ล็อกอินบอร์ดด้วยรหัสเดิม) */
app.post("/api/members/:id/restore", adminOnly, (req, res) => {
  const members = readMembers();
  const index = members.findIndex((m) => String(m.id) === String(req.params.id));
  if (index < 0) return res.status(404).json({ error: "ไม่พบสมาชิก" });
  const { exitedAt, exitReason, ...kept } = members[index];
  members[index] = kept;
  writeMembers(members);
  res.json({ ok: true, member: members[index] });
});

/* ออกรหัสใหม่ / ส่งรหัสซ้ำให้สมาชิกทาง DM */
app.post("/api/members/:id/credentials", adminOnly, async (req, res) => {
  const members = readMembers();
  const index = members.findIndex((m) => String(m.id) === String(req.params.id));
  if (index < 0) return res.status(404).json({ error: "ไม่พบสมาชิก" });
  const member = members[index];
  const reset = req.body && req.body.reset;
  const username = (member.credentials && member.credentials.username) || uniqueUsername(members, member.name);
  const password = reset ? makePassword() : ((member.credentials && member.credentials.password) || makePassword());
  member.credentials = { username, password, issuedAt: new Date().toISOString() };
  writeMembers(members);

  const message = credentialMessage(member, req);
  const dm = await sendDiscordDM(member.discordUser, message);
  res.json({ username, password, dm: { ...dm, message, at: new Date().toISOString() } });
});

/* ============================================================
   8. APPLICATIONS (สมัครเข้าแก๊ง → แอดมินคัด)
   ============================================================ */
app.post("/api/applications", async (req, res) => {
  const ip = req.ip || req.connection.remoteAddress || "unknown";
  if (!rateLimit(`apply:${ip}`, 4, 10 * 60 * 1000)) {
    return res.status(429).json({ error: "ส่งใบสมัครบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่" });
  }
  const body = req.body || {};
  const name = cleanLine(body.name, 80);
  const icAge = cleanLine(body.icAge, 10);
  const facebookIc = cleanUrl(body.facebookIc);
  const discordUser = cleanLine(body.discordUser, 60);
  const driveLink = cleanUrl(body.driveLink);
  const about = cleanLine(body.about, 400);

  if (!name) return res.status(400).json({ error: "กรุณากรอกชื่อ IC" });
  if (!icAge) return res.status(400).json({ error: "กรุณากรอกอายุ IC" });
  if (!discordUser) return res.status(400).json({ error: "กรุณากรอกชื่อดิสคอร์ด" });
  if (!about) return res.status(400).json({ error: "กรุณากรอกรายละเอียดแนะนำตัว" });

  const apps = readApps();
  const dup = apps.find((a) => a.status === "pending" && (nameKey(a.name) === nameKey(name) || nameKey(a.discordUser) === nameKey(discordUser)));
  if (dup) return res.status(409).json({ error: "มีใบสมัครที่รอตรวจอยู่แล้ว กรุณารอแอดมินอนุมัติ" });

  const application = {
    id: Date.now(),
    name, icAge, facebookIc, discordUser, driveLink, about,
    status: "pending",
    createdAt: new Date().toISOString()
  };
  apps.unshift(application);

  /* ส่งข้อความตอบกลับอัตโนมัติ บอกให้ผู้สมัครรอผล (ถ้าตั้งบอทไว้) */
  const ackMessage = applicationReceivedMessage(application);
  const ack = await sendDiscordDM(application.discordUser, ackMessage);
  application.dm = { ...ack, kind: "ack", message: ackMessage, at: new Date().toISOString() };

  writeApps(apps);
  res.status(201).json({ ok: true, id: application.id, application });
});

/* แจ้งรับใบสมัครอีกครั้ง (ให้แอดมินกดส่งซ้ำได้) */
app.post("/api/applications/:id/ack", adminOnly, async (req, res) => {
  const apps = readApps();
  const index = apps.findIndex((a) => String(a.id) === String(req.params.id));
  if (index < 0) return res.status(404).json({ error: "ไม่พบใบสมัคร" });
  const application = apps[index];
  const message = applicationReceivedMessage(application);
  const dm = await sendDiscordDM(application.discordUser, message);
  application.dm = { ...dm, kind: "ack", message, at: new Date().toISOString() };
  writeApps(apps);
  res.json({ ok: true, dm: application.dm });
});

/* ตรวจสถานะใบสมัครของตัวเอง (ไม่แสดงรหัสผ่าน) */
app.get("/api/applications/status", (req, res) => {
  const key = nameKey(req.query.name);
  if (!key) return res.status(400).json({ error: "กรุณากรอกชื่อ IC" });
  const list = readApps().filter((a) => nameKey(a.name) === key || nameKey(a.discordUser) === key);
  if (!list.length) return res.status(404).json({ error: "ไม่พบใบสมัครชื่อนี้" });
  const latest = list[0];
  const member = latest.memberId ? readMembers().find((m) => String(m.id) === String(latest.memberId)) : null;
  res.json({
    name: latest.name,
    status: latest.status,
    createdAt: latest.createdAt,
    decidedAt: latest.decidedAt || "",
    reason: latest.reason || "",
    username: member && member.credentials ? member.credentials.username : ""
  });
});

app.get("/api/applications", adminOnly, (req, res) => res.json(readApps()));

app.post("/api/applications/:id/approve", adminOnly, async (req, res) => {
  const apps = readApps();
  const index = apps.findIndex((a) => String(a.id) === String(req.params.id));
  if (index < 0) return res.status(404).json({ error: "ไม่พบใบสมัคร" });
  const application = apps[index];
  if (application.status === "approved") return res.status(409).json({ error: "ใบสมัครนี้รับเข้าแก๊งแล้ว" });

  const body = req.body || {};
  const members = readMembers();
  const username = uniqueUsername(members, application.name);
  const password = makePassword();
  const member = {
    id: Date.now(),
    name: application.name,
    role: cleanLine(body.role, 40) || "MEMBER",
    group: cleanGroup(body.group || "MEMBER"),
    icAge: application.icAge,
    facebookIc: application.facebookIc,
    discordUser: application.discordUser,
    driveLink: application.driveLink,
    image: "",
    description: application.about.slice(0, 240),
    tagline: "",
    bio: application.about.slice(0, 240),
    status: "",
    theme: "",
    pattern: "",
    discord: "",
    facebook: application.facebookIc,
    tiktok: "",
    credentials: { username, password, issuedAt: new Date().toISOString() },
    appliedAt: application.createdAt,
    approvedAt: new Date().toISOString()
  };
  members.unshift(member);
  writeMembers(members);

  const message = credentialMessage(member, req);
  const dm = await sendDiscordDM(application.discordUser, message);

  apps[index] = {
    ...application,
    status: "approved",
    decidedAt: new Date().toISOString(),
    memberId: member.id,
    dm: { ...dm, kind: "credentials", message, at: new Date().toISOString() }
  };
  writeApps(apps);
  res.json({ member, dm: apps[index].dm });
});

app.post("/api/applications/:id/reject", adminOnly, (req, res) => {
  const apps = readApps();
  const index = apps.findIndex((a) => String(a.id) === String(req.params.id));
  if (index < 0) return res.status(404).json({ error: "ไม่พบใบสมัคร" });
  apps[index] = { ...apps[index], status: "rejected", reason: cleanLine((req.body || {}).reason, 160), decidedAt: new Date().toISOString() };
  writeApps(apps);
  res.json(apps[index]);
});

app.delete("/api/applications/:id", adminOnly, (req, res) => {
  const apps = readApps();
  const next = apps.filter((a) => String(a.id) !== String(req.params.id));
  if (next.length === apps.length) return res.status(404).json({ error: "ไม่พบใบสมัคร" });
  writeApps(next);
  res.json({ ok: true });
});

/* ============================================================
   9. BOARD (เจ้าของล็อกอินด้วย ชื่อ IC + รหัสผ่าน แล้วตกแต่งบอร์ดตัวเอง)
   ============================================================ */
app.post("/api/board/login", (req, res) => {
  const body = req.body || {};
  const key = nameKey(body.name);
  const password = String(body.password || "");
  if (!key || !password) return res.status(400).json({ error: "กรุณากรอกชื่อ IC และรหัสผ่าน" });
  const member = readMembers().find((m) =>
    (nameKey(m.name) === key || nameKey(m.credentials && m.credentials.username) === key) &&
    m.credentials && m.credentials.password === password
  );
  if (!member) return res.status(401).json({ error: "ชื่อ IC หรือรหัสผ่านไม่ถูกต้อง (หรือยังไม่ได้รับอนุมัติ — ติดต่อแอดมิน)" });
  if (member.exitedAt) return res.status(403).json({ error: "บัญชีนี้ถูกให้ออกจากแก๊งแล้ว — ติดต่อแอดมินหากต้องการกลับเข้าแก๊ง" });
  req.session.memberId = member.id;
  res.json({ ok: true, member: boardMember(member) });
});
app.get("/api/board/session", (req, res) => {
  const member = currentMember(req);
  res.json({ authenticated: !!member, member: boardMember(member) });
});
app.post("/api/board/logout", (req, res) => {
  if (req.session) delete req.session.memberId;
  res.json({ ok: true });
});
app.put("/api/board/me", (req, res) => {
  const me = currentMember(req);
  if (!me) return res.status(401).json({ error: "กรุณาเข้าสู่ระบบก่อน" });
  const members = readMembers();
  const index = members.findIndex((m) => String(m.id) === String(me.id));
  if (index < 0) return res.status(404).json({ error: "ไม่พบข้อมูลสมาชิก" });
  const body = req.body || {};
  /* เจ้าของแก้ได้เฉพาะข้อมูลบอร์ดของตัวเอง — หมวด/ตำแหน่ง/รหัส แอดมินเท่านั้น */
  const data = memberPayload({
    name: body.name,
    image: body.image,
    tagline: body.tagline,
    bio: body.bio,
    status: body.status,
    theme: body.theme,
    pattern: body.pattern,
    discord: body.discord,
    facebook: body.facebook,
    tiktok: body.tiktok
  }, members[index]);
  const name = body.name === undefined ? members[index].name : data.name;
  if (!name) return res.status(400).json({ error: "กรุณาใส่ชื่อที่แสดงบนบอร์ด" });
  members[index] = {
    ...members[index],
    name,
    image: data.image,
    tagline: data.tagline,
    bio: data.bio,
    status: data.status,
    theme: data.theme,
    pattern: data.pattern,
    discord: data.discord,
    facebook: data.facebook,
    tiktok: data.tiktok,
    boardUpdatedAt: new Date().toISOString()
  };
  writeMembers(members);
  res.json(boardMember(members[index]));
});

/* ============================================================
   10. STATUS (ให้แอดมินดูสถานะ seed/DM)
   ============================================================ */
/* สำรองข้อมูลเดี๋ยวนี้: เขียน seed ใหม่ + บังคับ push ขึ้น GitHub ทันที */
app.post("/api/backup", adminOnly, async (req, res) => {
  membersStore.write(readMembers());
  appsStore.write(readApps());
  if (backupStatus.configured) await flushBackup();
  res.json({
    ok: true,
    cloud: cloudSummary(),
    members: { count: readMembers().length, seededAt: membersStore.seededAt },
    applications: { count: readApps().length, seededAt: appsStore.seededAt }
  });
});

/* สถานะ GitHub backup (สำหรับหน้าแอดมิน) */
app.get("/api/backup/status", adminOnly, (req, res) => {
  res.json({ ...cloudSummary(), queue: [...backupQueue.keys()] });
});

/* ส่งข้อมูลขึ้น Google ชีตเดี๋ยวนี้ (ทั้งใบสมัครและรายชื่อสมาชิก) */
app.post("/api/sheets/sync", adminOnly, async (req, res) => {
  if (!sheetStatus.configured) {
    return res.status(400).json({ error: "ยังไม่ได้ตั้งค่า SHEETS_WEBHOOK_URL — ดูวิธีตั้งค่าได้ในหน้าแอดมิน" });
  }
  const results = {};
  for (const sheet of Object.values(SHEET_NAMES)) {
    try {
      results[sheet] = { ok: true, ...(await sendSheet(sheet)) };
      sheetQueue.delete(sheet);
    } catch (err) {
      const message = String((err && err.message) || err);
      sheetStatus.sheets[sheet].error = message;
      sheetStatus.lastError = message;
      console.warn(`[sheets] ส่ง ${sheet} ไม่สำเร็จ: ${message}`);
      results[sheet] = { ok: false, error: message };
    }
  }
  sheetLastRun = Date.now();
  const ok = Object.values(results).every((r) => r.ok);
  const failed = Object.entries(results).filter(([, r]) => !r.ok).map(([sheet, r]) => `${sheet}: ${r.error}`);
  res.status(ok ? 200 : 502).json({ ok, results, error: failed.join(" · "), sheets: sheetsSummary() });
});

app.get("/api/sheets/status", adminOnly, (req, res) => res.json(sheetsSummary()));

/* กู้ข้อมูลกลับจาก Google ชีต (เขียนทับข้อมูลปัจจุบัน) */
app.post("/api/sheets/restore", adminOnly, async (req, res) => {
  if (!sheetStatus.configured) {
    return res.status(400).json({ error: "ยังไม่ได้ตั้งค่า SHEETS_WEBHOOK_URL — ดูวิธีตั้งค่าได้ในหน้าแอดมิน" });
  }
  try {
    const items = await fetchSheetRaw();
    if (!Object.keys(items).length) {
      const why = sheetStatus.lastError
        ? ` สาเหตุที่ยังไม่มีสำเนา: ${sheetStatus.lastError}`
        : "";
      const memberCount = readMembers().length;
      const appCount = readApps().length;
      if (memberCount || appCount) {
        return res.status(404).json({
          error: `ยังไม่มีสำเนาบน Google ชีตให้ดึงกลับ — แต่บนเว็บตอนนี้มีข้อมูลอยู่แล้ว ${memberCount} สมาชิก / ${appCount} ใบสมัคร ถ้าจะเก็บข้อมูลชุดนี้ลงชีต ให้กด "ส่งข้อมูลขึ้นชีตเดี๋ยวนี้" 1 ครั้ง (ระบบก็ส่งให้เองอัตโนมัติทุก ${sheetStatus.keepaliveSec} วินาทีอยู่แล้ว)${why}`
        });
      }
      return res.status(404).json({
        error: `ยังไม่มีสำเนาบน Google ชีตให้ดึงกลับ — ระบบยังส่งข้อมูลขึ้นชีตไม่สำเร็จเลยครั้งเดียว ให้ตรวจว่า SHEETS_WEBHOOK_URL ถูกต้อง, Apps Script Deploy เป็น "Anyone" และ TOKEN ในโค้ด Apps Script ตรงกับ SHEETS_SECRET${why}`
      });
    }
    const report = await applySheetRestore(items, { onlyMissing: false });
    const ok = Object.values(report).every((r) => r.ok);
    const failed = Object.entries(report).filter(([, r]) => !r.ok).map(([sheet, r]) => `${sheet}: ${r.error}`);
    res.status(ok ? 200 : 502).json({ ok, report, error: failed.join(" · ") });
  } catch (err) {
    res.status(502).json({ error: String((err && err.message) || err) });
  }
});

/* ตรวจสอบการเชื่อมต่อบอทดิสคอร์ด (ให้แอดมินเห็นว่าพร้อมส่ง DM อัตโนมัติไหม) */
app.get("/api/discord/status", adminOnly, async (req, res) => {
  if (!DISCORD_BOT_TOKEN) {
    return res.json({
      enabled: false,
      reason: "ยังไม่ได้ตั้งค่า DISCORD_BOT_TOKEN",
      message: "ระบบจะยังไม่ส่ง DM เอง — กดรับเข้าแล้วให้แอดมินกดคัดลอกข้อความไปส่งเอง"
    });
  }
  try {
    const meRes = await discordFetch("/users/@me");
    if (!meRes.ok) throw new Error(meRes.status === 401 ? "โทเคนบอทไม่ถูกต้อง" : `เรียก Discord ไม่สำเร็จ (${meRes.status})`);
    const bot = await meRes.json();
    const info = {
      enabled: true,
      bot: {
        id: bot.id,
        name: bot.global_name || bot.username,
        handle: bot.username,
        avatar: bot.avatar ? `https://cdn.discordapp.com/avatars/${bot.id}/${bot.avatar}.png?size=64` : ""
      },
      guild: null,
      guildLookup: false,
      guildId: DISCORD_GUILD_ID,
      message: ""
    };
    if (DISCORD_GUILD_ID) {
      const guildRes = await discordFetch(`/guilds/${DISCORD_GUILD_ID}`);
      if (guildRes.ok) {
        const guild = await guildRes.json();
        info.guild = { id: guild.id, name: guild.name };
      }
      const probe = await discordFetch(`/guilds/${DISCORD_GUILD_ID}/members?limit=1`);
      info.guildLookup = probe.ok;
      info.message = probe.ok
        ? "บอทพร้อมส่ง DM อัตโนมัติ — ค้นหา User ID จากชื่อผู้ใช้ในเซิร์ฟเวอร์ได้ด้วย"
        : "บอทพร้อมส่ง DM อัตโนมัติ แต่ค้นหาจากชื่อผู้ใช้ไม่ได้ (เปิด GUILD MEMBERS INTENT) — ให้ผู้สมัครกรอก User ID 17-20 หลัก";
    } else {
      info.message = "บอทพร้อมส่ง DM อัตโนมัติ — ผู้สมัครต้องกรอก User ID (ตัวเลข 17-20 หลัก)";
    }
    res.json(info);
  } catch (err) {
    res.json({ enabled: false, reason: String((err && err.message) || err), message: "เชื่อมต่อดิสคอร์ดไม่สำเร็จ" });
  }
});

app.get("/api/status", adminOnly, (req, res) => {
  const apps = readApps();
  res.json({
    members: {
      count: readMembers().length,
      file: path.basename(membersStore.file),
      seed: path.basename(membersStore.seedFile),
      seededAt: membersStore.seededAt,
      restoredAt: membersStore.restoredAt
    },
    applications: {
      total: apps.length,
      pending: apps.filter((a) => a.status === "pending").length,
      approved: apps.filter((a) => a.status === "approved").length,
      rejected: apps.filter((a) => a.status === "rejected").length,
      seed: path.basename(appsStore.seedFile),
      seededAt: appsStore.seededAt,
      restoredAt: appsStore.restoredAt
    },
    discord: { enabled: !!DISCORD_BOT_TOKEN, guildConfigured: !!DISCORD_GUILD_ID },
    cloud: { ...cloudSummary(), queue: [...backupQueue.keys()] },
    sheets: sheetsSummary()
  });
});

/* ============================================================
   11. PAGES
   ============================================================ */
app.get("/apply", (req, res) => res.sendFile(path.join(__dirname, "public", "apply.html")));
app.get("/board", (req, res) => res.sendFile(path.join(__dirname, "public", "board.html")));
app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

/* เปิดเซิร์ฟเวอร์: กู้ข้อมูลจากคลาวด์ก่อน (ถ้าเพิ่ง deploy แล้วดิสก์ว่าง) */
async function startServer() {
  try {
    await Promise.race([
      restoreFromCloud(),
      new Promise((resolve) => { const t = setTimeout(resolve, 30000); if (t.unref) t.unref(); })
    ]);
  } catch (err) { console.warn(`[backup] ${err.message}`); }
  startSheetKeepalive();   // ผลักข้อมูลขึ้นชีตทันที + ส่งต่อเนื่องเป็นรอบ ๆ เอง
  app.listen(PORT, () => console.log(`TWENTYFIVE running on http://localhost:${PORT}`));
}

/* Render จะส่ง SIGTERM ก่อนปิดเซิร์ฟเวอร์ — เตะข้อมูลที่ค้าง push ขึ้น GitHub + Google ชีต ให้หมดก่อนตาย */
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    const hardStop = setTimeout(() => process.exit(0), 10000);
    if (hardStop.unref) hardStop.unref();
    Promise.allSettled([flushBackup(), flushSheets()])
      .catch(() => {})
      .finally(() => { clearTimeout(hardStop); process.exit(0); });
  });
}

startServer();
