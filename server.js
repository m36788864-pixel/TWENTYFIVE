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
/* Apps Script ตื่นนอน (cold start) ครั้งแรกหลังไม่ได้เรียกใช้จะช้ามาก (บางที 20-40 วิ)
   ถ้า timeout สั้นเกินไปจะได้ "This operation was aborted" ทั้งที่ชีตไม่ได้เป็นอะไร */
const SHEETS_TIMEOUT = Math.max(10, Number(process.env.SHEETS_TIMEOUT) || 60) * 1000;
const SHEETS_TIMEOUT_MSG = `Google ชีตตอบช้าเกิน ${Math.round(SHEETS_TIMEOUT / 1000)} วินาที — มักเกิดตอน Apps Script เพิ่งตื่นนอน (เรียกครั้งแรกหลังเว้นช่วง) ไม่ใช่ชีตเสีย ให้รอสักครู่แล้วกดใหม่ หรือตั้ง SHEETS_TIMEOUT ให้มากขึ้น`;

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

/* ============================================================
   GANG MANAGEMENT SYSTEM — ค่าคงที่และค่าตั้งต้น
   ============================================================ */
const GANG_ROLES = ["member", "staff", "deputy", "leader"];
const GANG_ROLE_LABEL = { member: "Member", staff: "Staff", deputy: "Deputy Leader", leader: "Leader" };
const GANG_ROLE_RANK = { member: 1, staff: 2, deputy: 3, leader: 4 };
const ACTIVITY_TYPES = ["shop", "loop", "airdrop"];
const ACTIVITY_LABEL = { shop: "เล่นร้าน", loop: "เล่นลูป", airdrop: "เล่นแอร์ดอป" };
const ACTIVITY_RESULT_LABEL = { won: "ได้ / ชนะ", lost: "ไม่ได้ / แพ้" };
const REPORT_STATUSES = ["pending", "approved", "rejected", "completed"];
const REPORT_STATUS_LABEL = {
  pending: "รอตรวจสอบ",
  approved: "อนุมัติแล้ว",
  rejected: "ปฏิเสธ",
  completed: "ดำเนินการเรียบร้อย"
};
const LEAVE_STATUSES = ["pending", "approved", "rejected"];
const LEAVE_STATUS_LABEL = { pending: "รออนุมัติ", approved: "อนุมัติแล้ว", rejected: "ไม่อนุมัติ" };
const LEAVE_TYPES = {
  sick: "ลาป่วย",
  personal: "ลากิจ",
  vacation: "ลาพักร้อน",
  other: "อื่น ๆ"
};
/* ไม่กำหนดคะแนนตายตัว — ค่าเริ่มต้นนี้แก้ได้จากหน้าแอดมิน (Leader) */
const DEFAULT_GANG_POINTS = {
  shop: { won: 10, lost: 2 },
  loop: { won: 5, lost: 1 },
  airdrop: { won: 5, lost: 1 }
};
/* Webhook สำรองจาก env — ถ้าแอดมินตั้งในหน้าเว็บจะใช้ค่านั้นก่อน (เก็บฝั่ง Backend เท่านั้น) */
const DISCORD_WEBHOOK_URL = (process.env.DISCORD_WEBHOOK_URL || "").trim();

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
  pushed: Object.fromEntries(
    ["members", "applications", "settings", "reports", "scores", "leaves", "behavior", "audit"]
      .map((name) => [name, { at: null, error: null }])
  )
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
    for (const store of ALL_STORES) {
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
          if (!sheetName) { console.log(`[sheets] ${name}: ไม่มีชีตสำรอง (ข้าม)`); continue; }
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
   ส่งแบบ "อัปเดตต่อ" (upsert ตามรหัส) → แถวเดิมแก้ในที่เดิม แถวใหม่ต่อท้าย ไม่ล้างชีตแล้วลงใหม่
   รายการที่ลบบนเว็บ จะส่งรหัสไปลบแถวนั้นบนชีตให้ด้วย
   ------------------------------------------------------------ */
const SHEET_NAMES = {
  applications: "Applications",
  members: "Members",
  reports: "Activity Reports",
  scores: "Score History",
  leaves: "Leave History",
  behavior: "Behavior History"
};
/* ชีตที่สร้างจากข้อมูลคำนวณ (ไม่มี store ของตัวเอง) */
const LEADERBOARD_SHEET = "Leaderboard";
const ALL_SHEETS = [...Object.values(SHEET_NAMES), LEADERBOARD_SHEET];
const APPLICATION_COLUMNS = [
  "ลำดับ", "รหัส", "ชื่อ IC", "อายุ IC", "เฟส IC", "ดิสคอร์ด", "ลิงก์ไดรฟ์", "รายละเอียดแนะนำตัว",
  "สถานะใบสมัคร", "วันที่สมัคร", "วันที่ตัดสิน", "เหตุผลที่แจ้ง", "ชื่อผู้ใช้บอร์ด", "สถานะส่ง DM"
];
const MEMBER_COLUMNS = [
  "ลำดับ", "รหัส", "ชื่อ IC", "ตำแหน่ง", "หมวด", "อายุ IC", "เฟส IC", "ดิสคอร์ด", "ลิงก์ไดรฟ์",
  "คำโปรย", "รายละเอียด", "สถานะแก๊ง", "วันที่สมัคร", "วันที่รับเข้า",
  "ชื่อผู้ใช้บอร์ด", "รหัสผ่านบอร์ด", "อัปเดตรหัสเมื่อ", "สิทธิ์ระบบแก๊ง", "คะแนนสะสม"
];
const REPORT_COLUMNS = [
  "ลำดับ", "รหัส", "Member ID", "ชื่อสมาชิก", "ประเภทกิจกรรม", "ผลลัพธ์", "รูปภาพหลักฐาน",
  "หมายเหตุสมาชิก", "สถานะ", "คะแนน", "เหตุผลตรวจสอบ", "ผู้ตรวจสอบ", "วันที่ส่ง", "วันที่ตรวจสอบ"
];
const SCORE_COLUMNS = [
  "ลำดับ", "รหัส", "Member ID", "ชื่อสมาชิก", "คะแนนที่เปลี่ยน", "คะแนนรวมหลังเปลี่ยน",
  "เหตุผล", "แหล่งที่มา", "รายงานอ้างอิง", "ผู้ดำเนินการ", "วันที่"
];
const LEAVE_COLUMNS = [
  "ลำดับ", "รหัส", "Member ID", "ชื่อสมาชิก", "ประเภทการลา", "วันที่เริ่มลา", "วันที่สิ้นสุด",
  "เหตุผล", "สถานะ", "เหตุผลผู้อนุมัติ", "ผู้อนุมัติ", "วันที่ส่ง", "วันที่อนุมัติ"
];
const BEHAVIOR_COLUMNS = [
  "ลำดับ", "รหัส", "Member ID", "ชื่อสมาชิก", "ประเภท", "หัวข้อ", "รายละเอียด / เหตุผล",
  "ผู้แจ้ง", "วันที่"
];
const LEADERBOARD_COLUMNS = [
  "อันดับ", "Member ID", "ชื่อสมาชิก", "ตำแหน่ง", "คะแนนสะสม", "กิจกรรมที่ส่ง",
  "กิจกรรมที่ผ่าน", "จำนวนชัยชนะ", "อัตราผ่าน", "อัปเดตเมื่อ"
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
  sheets: Object.fromEntries(ALL_SHEETS.map((name) => [name, { at: null, error: null, rows: 0 }]))
};
const sheetQueue = new Map();
/* รหัสที่ถูกลบบนเว็บ รอส่งไปลบแถวบนชีต (เก็บแยกตามชีต) */
const sheetRemovals = Object.fromEntries(ALL_SHEETS.map((name) => [name, new Set()]));
function markSheetRemoved(storeName, id) {
  const sheet = SHEET_NAMES[storeName];
  if (sheet && id !== undefined && id !== null) sheetRemovals[sheet].add(String(id));
}
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
  const points = memberPointMap();
  return members.map((m, i) => [
    i + 1, m.id, m.name, m.role, tierLabel(m), m.icAge, m.facebookIc, m.discordUser, m.driveLink,
    m.tagline, m.description || m.bio,
    m.exitedAt ? `ออกจากแก๊งแล้ว (${thDateTime(m.exitedAt)}${m.exitReason ? ` · ${m.exitReason}` : ""})` : "อยู่ในแก๊ง",
    thDateTime(m.appliedAt), thDateTime(m.approvedAt),
    (m.credentials && m.credentials.username) || "", (m.credentials && m.credentials.password) || "",
    thDateTime(m.credentials && m.credentials.issuedAt),
    GANG_ROLE_LABEL[gangRoleOf(m)] || "Member",
    points.get(String(m.id)) || 0
  ]);
}
function reportRows() {
  return readReports().map((r, i) => [
    i + 1, r.id, r.memberId, r.memberName, ACTIVITY_LABEL[r.type] || r.type,
    ACTIVITY_RESULT_LABEL[r.result] || r.result || "", r.proofUrl || "", r.note || "",
    REPORT_STATUS_LABEL[r.status] || r.status || "", r.points || 0, r.reviewNote || "",
    r.reviewedByName || "", thDateTime(r.createdAt), thDateTime(r.reviewedAt)
  ]);
}
function scoreRows() {
  const members = readMembers();
  const byId = new Map(members.map((m) => [String(m.id), m]));
  /* คิดยอดสะสมตามลำดับเวลา เพื่อให้คอลัมน์ "คะแนนรวมหลังเปลี่ยน" ถูกต้อง */
  const ordered = [...readScores()].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const running = new Map();
  const atEntry = new Map();
  for (const entry of ordered) {
    const key = String(entry.memberId);
    const next = (running.get(key) || 0) + Number(entry.delta || 0);
    running.set(key, next);
    atEntry.set(String(entry.id), next);
  }
  return readScores().map((entry, i) => [
    i + 1, entry.id, entry.memberId, (byId.get(String(entry.memberId)) || {}).name || entry.memberName || "",
    entry.delta > 0 ? `+${entry.delta}` : entry.delta,
    atEntry.get(String(entry.id)) || 0,
    entry.reason || "", entry.source === "report" ? "รายงานกิจกรรม" : entry.source === "penalty" ? "หักคะแนน" : "ปรับโดยแอดมิน",
    entry.reportId || "", entry.actorName || "", thDateTime(entry.createdAt)
  ]);
}
function leaveRows() {
  return readLeaves().map((l, i) => [
    i + 1, l.id, l.memberId, l.memberName, LEAVE_TYPES[l.type] || l.type,
    l.startDate || "", l.endDate || l.startDate || "", l.reason || "",
    LEAVE_STATUS_LABEL[l.status] || l.status || "", l.reviewNote || "", l.reviewedByName || "",
    thDateTime(l.createdAt), thDateTime(l.reviewedAt)
  ]);
}
function behaviorRows() {
  return readBehavior().map((b, i) => [
    i + 1, b.id, b.memberId, b.memberName, b.kind === "warning" ? "เตือน" : "บันทึก",
    b.title || "", b.detail || b.reason || "", b.actorName || "", thDateTime(b.createdAt)
  ]);
}
function leaderboardRows() {
  const rows = computeLeaderboard({ limit: 500 });
  return rows.map((r) => [
    r.rank, r.memberId, r.name, GANG_ROLE_LABEL[r.role] || "Member", r.points,
    r.submitted, r.approved, r.wins, `${r.passRate || 0}%`,
    thDateTime(new Date().toISOString())
  ]);
}
/* อ่านข้อมูลจากดิสก์ทุกครั้งที่ส่ง → ชีตตรงกับข้อมูลจริงเสมอ
   ส่งทั้งตารางที่อ่านง่าย (columns/rows) และข้อมูลดิบ (data) สำหรับกู้คืนกลับแบบไม่สูญหาย */
function buildSheetPayload(sheet) {
  sheetBuilding = true;
  try {
    let columns;
    let rows;
    let data = null;
    let mode = "upsert";
    if (sheet === "Members") {
      columns = MEMBER_COLUMNS; rows = memberRows(readMembers()); data = readMembers();
    } else if (sheet === "Applications") {
      columns = APPLICATION_COLUMNS; rows = applicationRows(readMembers()); data = readApps();
    } else if (sheet === "Activity Reports") {
      columns = REPORT_COLUMNS; rows = reportRows(); data = readReports();
    } else if (sheet === "Score History") {
      columns = SCORE_COLUMNS; rows = scoreRows(); data = readScores();
    } else if (sheet === "Leave History") {
      columns = LEAVE_COLUMNS; rows = leaveRows(); data = readLeaves();
    } else if (sheet === "Behavior History") {
      columns = BEHAVIOR_COLUMNS; rows = behaviorRows(); data = readBehavior();
    } else if (sheet === LEADERBOARD_SHEET) {
      columns = LEADERBOARD_COLUMNS; rows = leaderboardRows();
      mode = "replace";                    // ตารางอันดับเป็น snapshot → เขียนทับทั้งชีตให้เรียงถูกเสมอ
    } else {
      throw new Error(`ไม่รู้จักชีต: ${sheet}`);
    }
    return {
      token: SHEETS_SECRET,
      version: 3,
      sheet,
      mode,
      columns,
      rows: rows.map((row) => columns.map((_, i) => (row[i] === undefined || row[i] === null ? "" : String(row[i])))),
      ...(data ? { data } : {}),           // สำเนาข้อมูลดิบ — ใช้กู้คืนกลับเข้าระบบได้ครบถ้วน
      remove: [...sheetRemovals[sheet]],   // รหัสที่ถูกลบบนเว็บ → ให้ลบแถวนั้นบนชีต
      at: new Date().toISOString()
    };
  } finally { sheetBuilding = false; }
}

/* เรียก Google ชีตด้วยเวลาที่ยาวพอ — Apps Script ตื่นนอนครั้งแรกอาจกินเวลา 20-40 วิ
   ถ้าโดนตัดกลางคัน (AbortError) จะลองซ้ำอีก 1 ครั้งก่อนยอมแพ้ */
async function sheetFetch(url, init = {}) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SHEETS_TIMEOUT);
    let res;
    try {
      res = await fetch(url, { ...init, redirect: "follow", signal: controller.signal });
    } catch (err) {
      clearTimeout(timer);
      const aborted = err && err.name === "AbortError";
      if (!aborted) throw err;                       // ไม่ใช่เรื่อง timeout ให้รายงานผิดจริงไปเลย
      if (attempt === 2) throw new Error(SHEETS_TIMEOUT_MSG);
      console.warn(`[sheets] เรียกชีตครั้งที่ ${attempt} ไม่ทันเวลา — รอ 3 วินาทีแล้วลองใหม่ (Apps Script น่าจะกำลังตื่นนอน)`);
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }
    clearTimeout(timer);
    return res;
  }
}

async function postToSheet(payload) {
  const res = await sheetFetch(SHEETS_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },   // text/plain เลี่ยงปัญหา preflight ของ Apps Script
    body: JSON.stringify(payload)
  });
  const text = await res.text();
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
}

/* ดึงข้อมูลดิบที่สำรองไว้บน Google ชีต (สำหรับกู้คืนกลับเข้าระบบ) */
async function fetchSheetRaw() {
  const url = new URL(SHEETS_WEBHOOK_URL);
  url.searchParams.set("action", "raw");
  if (SHEETS_SECRET) url.searchParams.set("token", SHEETS_SECRET);
  const res = await sheetFetch(url.toString());
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  if (!res.ok) throw new Error(`Google ชีตตอบกลับ ${res.status}`);
  if (!data) throw new Error("อ่านข้อมูลจาก Google ชีตไม่ได้ (ผลลัพธ์ไม่ใช่ JSON)");
  if (data.ok === false) throw new Error(data.error || "Apps Script ปฏิเสธข้อมูล");
  return data.items || {};
}

async function sendSheet(sheet) {
  const payload = buildSheetPayload(sheet);
  const startedAt = Date.now();
  await postToSheet(payload);
  payload.remove.forEach((id) => sheetRemovals[sheet].delete(id));   // ส่งสำเร็จแล้ว ค่อยเคลียร์คิวลบ
  const at = new Date().toISOString();
  sheetStatus.sheets[sheet] = { at, error: null, rows: payload.rows.length };
  sheetStatus.lastSyncAt = at;
  sheetStatus.lastError = null;
  console.log(`[sheets] ส่ง ${sheet} ขึ้น Google ชีตสำเร็จ (${payload.rows.length} แถว, ${Date.now() - startedAt} ms)`);
  return { sheet, rows: payload.rows.length };
}

const LEADERBOARD_SOURCES = new Set(["members", "reports", "scores"]);
function scheduleSheetSync(storeName) {
  if (!sheetStatus.configured || sheetBuilding || sheetRestoring || cloudRestoreInProgress) return;
  const sheet = SHEET_NAMES[storeName];
  if (!sheet && storeName !== "leaderboard") return;
  const store = STORES[storeName];
  if (store && store.freshPlaceholder) return;   // ยังเป็นข้อมูลเริ่มต้นชั่วคราว — ห้ามเขียนทับสำเนาบนชีต
  const targets = new Set();
  if (sheet) targets.add(sheet);
  if (LEADERBOARD_SOURCES.has(storeName)) targets.add(LEADERBOARD_SHEET);
  for (const target of targets) sheetQueue.set(target, true);
  if (sheetRun || sheetTimer) return;
  sheetTimer = setTimeout(runSheetQueue, Math.max(0, sheetLastRun + SHEETS_INTERVAL - Date.now()));
  if (sheetTimer.unref) sheetTimer.unref();
}

/* ส่งข้อมูลขึ้นชีตอัตโนมัติเป็นรอบ ๆ แม้ไม่มีใครแก้ไขอะไรเลย
   เพื่อให้ "มีสำเนาอยู่บนชีตเสมอ" → กดปุ่มกู้ข้อมูลได้ทุกเมื่อ */
function runSheetKeepalive() {
  if (!sheetStatus.configured || sheetBuilding || sheetRestoring || cloudRestoreInProgress) return;
  try {
    for (const name of Object.keys(SHEET_NAMES)) STORES[name] && STORES[name].read();   // โหลดข้อมูลจริงก่อน จะได้รู้ว่าเป็นข้อมูลชั่วคราวหรือไม่
  } catch {}
  for (const name of Object.keys(SHEET_NAMES)) scheduleSheetSync(name);
  scheduleSheetSync("leaderboard");
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

/* เติมข้อมูลที่ดึงจากชีตกลับเข้าระบบ แบบ "รวมเพิ่ม" (ไม่เขียนทับ ไม่ล้างของเดิม)
   - รายการที่บนเว็บมีอยู่แล้ว (รหัสเดียวกัน) → เก็บของบนเว็บไว้ ไม่แตะ
   - รายการที่มีบนชีตแต่ไม่มีบนเว็บ → ต่อท้ายเข้าไป
   - ถ้าเว็บยังเป็นข้อมูลเริ่มต้นชั่วคราว (ดิสก์ว่าง) → ใช้ข้อมูลจากชีตทั้งชุด
   onlyMissing = true → เติมเฉพาะเมื่อบนเครื่องไม่มีข้อมูล (ใช้ตอนเปิดเซิร์ฟเวอร์) */
async function applySheetRestore(items, { onlyMissing = false } = {}) {
  sheetRestoring = true;
  const report = {};
  try {
    for (const [storeName, sheetName] of Object.entries(SHEET_NAMES)) {
      const store = STORES[storeName];
      try {
        if (!store) throw new Error("ไม่พบแหล่งข้อมูลของชีตนี้");
        let item = items && items[sheetName];
        /* ชีตนี้ไม่มีรายการเลย (เช่น ใบสมัคร 0 ฉบับ) แต่ชีตอื่นมีสำเนา → ถือว่าว่างเปล่า ไม่ใช่ error */
        if (!item && items && Object.values(items).some(Boolean)) item = { data: [], at: "" };
        if (!item) throw new Error("ไม่พบสำเนาข้อมูลของชีตนี้บน Google ชีต");
        const list = item.data;
        if (!Array.isArray(list)) throw new Error("รูปแบบข้อมูลบนชีตไม่ถูกต้อง");
        if (onlyMissing && (fs.existsSync(store.file) || fs.existsSync(store.seedFile))) {
          report[sheetName] = { ok: true, skipped: true, count: list.length, at: item.at || "" };
          continue;
        }
        const current = store.read();
        let result;
        let added;
        if (store.freshPlaceholder) {
          result = list;                       // เว็บยังว่าง/เป็นข้อมูลชั่วคราว → ใช้ข้อมูลจากชีตทั้งชุด
          added = list.length;
        } else {
          const have = new Set(current.map((x) => String(x && x.id)));
          const fresh = list.filter((x) => x && x.id !== undefined && x.id !== null && !have.has(String(x.id)));
          result = current.concat(fresh);      // ต่อท้ายเฉพาะที่ยังไม่มี
          added = fresh.length;
        }
        if (added || store.freshPlaceholder) store.write(result);
        sheetStatus.lastRestoreAt = new Date().toISOString();
        sheetStatus.lastRestoreSource = `Google ชีต (${sheetName})`;
        console.warn(`[sheets] ${storeName}: กู้คืนจาก Google ชีตสำเร็จ (เพิ่มใหม่ ${added} รายการ, รวม ${result.length})`);
        report[sheetName] = { ok: true, count: result.length, added, kept: result.length - added, at: item.at || "" };
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
/* ตั้งค่าทั่วไปของเว็บ (เช่น เพลงเปิดเว็บที่แอดมินตั้งไว้) — เก็บเป็นอาเรย์ของ { id, ... } */
const settingsStore = createStore("settings", () => []);
/* ระบบแก๊ง */
const reportsStore = createStore("reports", () => []);
const scoresStore = createStore("scores", () => []);
const leavesStore = createStore("leaves", () => []);
const behaviorStore = createStore("behavior", () => []);
const auditStore = createStore("audit", () => []);
const readMembers = () => membersStore.read();
const writeMembers = (list) => membersStore.write(list);
const readApps = () => appsStore.read();
const writeApps = (list) => appsStore.write(list);
const readSettings = () => settingsStore.read();
const readReports = () => reportsStore.read();
const writeReports = (list) => reportsStore.write(list);
const readScores = () => scoresStore.read();
const writeScores = (list) => scoresStore.write(list);
const readLeaves = () => leavesStore.read();
const writeLeaves = (list) => leavesStore.write(list);
const readBehavior = () => behaviorStore.read();
const writeBehavior = (list) => behaviorStore.write(list);
const readAudit = () => auditStore.read();
const writeAudit = (list) => auditStore.write(list);
const STORES = {
  members: membersStore,
  applications: appsStore,
  settings: settingsStore,
  reports: reportsStore,
  scores: scoresStore,
  leaves: leavesStore,
  behavior: behaviorStore,
  audit: auditStore
};
/* ทุก store ที่ต้องสำรองขึ้น GitHub / กู้คืนตอนเปิดเซิร์ฟเวอร์ */
const ALL_STORES = [membersStore, appsStore, settingsStore, reportsStore, scoresStore, leavesStore, behaviorStore, auditStore];

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
    tiktok: cleanUrl(body.tiktok === undefined ? current.tiktok : body.tiktok),
    /* เพลงประจำบอร์ด (1 เพลง) — เจ้าของบอร์ดและแอดมินแก้ได้ทั้งคู่ */
    songTitle: cleanLine(body.songTitle === undefined ? current.songTitle : body.songTitle, 80),
    songArtist: cleanLine(body.songArtist === undefined ? current.songArtist : body.songArtist, 80),
    songUrl: cleanUrl(body.songUrl === undefined ? current.songUrl : body.songUrl)
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
  markSheetRemoved("members", req.params.id);
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
  markSheetRemoved("applications", req.params.id);
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
    tiktok: body.tiktok,
    songTitle: body.songTitle,
    songArtist: body.songArtist,
    songUrl: body.songUrl
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
    songTitle: data.songTitle,
    songArtist: data.songArtist,
    songUrl: data.songUrl,
    boardUpdatedAt: new Date().toISOString()
  };
  writeMembers(members);
  res.json(boardMember(members[index]));
});

/* ============================================================
   9.5 SITE SONG (เพลงเปิดเว็บ — แอดมินตั้งในหลังบ้าน แล้วระบบเปิดตอนเข้าเว็บ)
   ============================================================ */
const SITE_SONG_ID = "siteSong";
const SONG_AUDIO_EXT = ["mp3", "m4a", "aac", "wav", "ogg", "opus", "webm", "flac"];
const getSiteSong = () => {
  const row = readSettings().find((s) => s && s.id === SITE_SONG_ID);
  if (!row || !row.url) return null;
  return { title: cleanLine(row.title, 80), artist: cleanLine(row.artist, 80), url: String(row.url), hideTitle: !!row.hideTitle };
};
/* เก็บเพลงไฟล์เดียวเสมอ — อัปโหลดใหม่แทนที่ไฟล์เก่า */
const clearUploadedSong = () => {
  try {
    for (const f of fs.readdirSync(UPLOAD_DIR)) {
      if (/^site-song\.[a-z0-9]+$/i.test(f)) { try { fs.unlinkSync(path.join(UPLOAD_DIR, f)); } catch {} }
    }
  } catch {}
};

app.get("/api/site-song", (req, res) => res.json(getSiteSong()));

/* อัปโหลดไฟล์เสียงจากเครื่องแอดมินมาเป็นเพลงเปิดเว็บ (ไม่ต้องพึ่งลิงก์) */
app.post("/api/site-song/upload", adminOnly, express.raw({ type: () => true, limit: "25mb" }), (req, res) => {
  const filename = cleanLine((req.query || {}).filename, 120);
  const ext = (filename.match(/\.([A-Za-z0-9]{2,5})$/) || [])[1] || "";
  if (!SONG_AUDIO_EXT.includes(ext.toLowerCase())) {
    return res.status(400).json({ error: "ไฟล์ต้องเป็นเสียง mp3 / m4a / wav / ogg / opus / webm / flac" });
  }
  const buf = Buffer.isBuffer(req.body) ? req.body : null;
  if (!buf || !buf.length) return res.status(400).json({ error: "ไม่ได้รับไฟล์เพลง" });
  try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch {}
  clearUploadedSong();
  const name = `site-song.${ext.toLowerCase()}`;
  try { fs.writeFileSync(path.join(UPLOAD_DIR, name), buf); }
  catch { return res.status(500).json({ error: "บันทึกไฟล์เพลงไม่สำเร็จ" }); }
  res.json({ url: `/uploads/${name}`, bytes: buf.length });
});

app.put("/api/site-song", adminOnly, (req, res) => {
  const body = req.body || {};
  let url = cleanUrl(body.url);
  /* อนุญาต url เป็นไฟล์ที่อัปโหลดไว้ (ชี้ไปที่ /uploads/site-song.xxx ที่เพิ่งอัป) */
  if (!url && /^\/uploads\/site-song\.[a-z0-9]+$/i.test(String(body.url || "").trim())) {
    const name = String(body.url).trim().split("/").pop();
    if (fs.existsSync(path.join(UPLOAD_DIR, name))) url = `/uploads/${name}`;
  }
  if (!url) return res.status(400).json({ error: "ลิงก์เพลงต้องขึ้นต้นด้วย http:// หรือ https:// หรือเป็นไฟล์ที่อัปโหลดไว้" });
  const entry = {
    id: SITE_SONG_ID,
    title: cleanLine(body.title, 80),
    artist: cleanLine(body.artist, 80),
    url,
    hideTitle: !!body.hideTitle,
    updatedAt: new Date().toISOString()
  };
  const list = readSettings().filter((s) => !s || s.id !== SITE_SONG_ID);
  list.push(entry);
  settingsStore.write(list);
  res.json(getSiteSong());
});

app.delete("/api/site-song", adminOnly, (req, res) => {
  const list = readSettings();
  const next = list.filter((s) => s && s.id !== SITE_SONG_ID);
  if (next.length !== list.length) settingsStore.write(next);
  clearUploadedSong();
  res.json(null);
});

/* ============================================================
   10. STATUS (ให้แอดมินดูสถานะ seed/DM)
   ============================================================ */
/* สำรองข้อมูลเดี๋ยวนี้: เขียน seed ใหม่ + บังคับ push ขึ้น GitHub ทันที */
app.post("/api/backup", adminOnly, async (req, res) => {
  membersStore.write(readMembers());
  appsStore.write(readApps());
  settingsStore.write(readSettings());
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
  for (const sheet of ALL_SHEETS) {
    try {
      results[sheet] = { ok: true, ...(await sendSheet(sheet)) };
      sheetQueue.delete(sheet);
    } catch (err) {
      const message = String((err && err.message) || err);
      if (sheetStatus.sheets[sheet]) sheetStatus.sheets[sheet].error = message;
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

/* กู้ข้อมูลกลับจาก Google ชีต — รวมเพิ่มเข้าข้อมูลปัจจุบัน ไม่เขียนทับ */
app.post("/api/sheets/restore", adminOnly, async (req, res) => {
  if (!sheetStatus.configured) {
    return res.status(400).json({ error: "ยังไม่ได้ตั้งค่า SHEETS_WEBHOOK_URL — ดูวิธีตั้งค่าได้ในหน้าแอดมิน" });
  }
  try {
    const items = await fetchSheetRaw();
    if (!Object.keys(items).length) {
      /* ยังไม่มีข้อมูลในชีต — ต้องบอกให้ชัดว่า "ส่งขึ้นชีต" กับ "อ่านจากชีต" อันไหนที่มีปัญหา
         เพราะถ้าส่งสำเร็จแต่กู้ไม่ได้ แปลว่าโค้ด Apps Script ที่วางเป็นเวอร์ชันเก่า */
      const syncState = sheetStatus.lastSyncAt
        ? `สถานะส่งขึ้นชีต: เคยสำเร็จครั้งล่าสุด ${sheetStatus.lastSyncAt}${sheetStatus.lastError ? ` แต่ล่าสุดผิดพลาด: ${sheetStatus.lastError}` : " และไม่มีข้อผิดพลาดค้าง"}`
        : `สถานะส่งขึ้นชีต: ยังไม่เคยสำเร็จเลย${sheetStatus.lastError ? ` — ${sheetStatus.lastError}` : ""}`;
      const diagnosis = sheetStatus.lastSyncAt
        ? `ส่งขึ้นชีตสำเร็จแล้วแต่กู้ไม่ได้ → โค้ด Apps Script บนชีตน่าจะเป็นเวอร์ชันเก่าที่ยังไม่รองรับชีตลับ _raw ให้เปิดไฟล์ Apps Script แล้ววางเนื้อหาใหม่ทั้งหมดจากไฟล์ google-sheets/apps-script.gs จากนั้น Deploy → Manage deployments → ไอคอนดินสอ → New version`
        : `ยังไม่เคยส่งขึ้นชีตสำเร็จ → ให้กดปุ่ม "ส่งข้อมูลขึ้นชีตเดี๋ยวนี้" ก่อน แล้วดูว่าขึ้นสำเร็จหรือข้อความผิดพลาดอะไร`;
      const memberCount = readMembers().length;
      const appCount = readApps().length;
      if (memberCount || appCount) {
        return res.status(404).json({
          error: `ยังไม่มีสำเนาบน Google ชีตให้ดึงกลับ — ระบบติดต่อ Apps Script ได้แล้ว แต่ยังไม่พบข้อมูลในชีต (ชีตลับ _raw ว่างเปล่า) · ${syncState} · บนเว็บตอนนี้มีข้อมูลอยู่ ${memberCount} สมาชิก / ${appCount} ใบสมัคร · วิธีแก้: ${diagnosis}`
        });
      }
      return res.status(404).json({
        error: `ยังไม่มีสำเนาบน Google ชีตให้ดึงกลับ — ระบบติดต่อ Apps Script ได้แล้ว แต่ยังไม่พบข้อมูลในชีต (ชีตลับ _raw ว่างเปล่า) · ${syncState} · วิธีแก้: ตรวจว่า SHEETS_WEBHOOK_URL ถูกต้อง, Deploy เป็น "Anyone", TOKEN ในโค้ด Apps Script ตรงกับ SHEETS_SECRET แล้วกด "ส่งข้อมูลขึ้นชีตเดี๋ยวนี้"`
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
   10.5 GANG MANAGEMENT SYSTEM — CORE
   สิทธิ์ / คะแนน / อันดับ / ตั้งค่า / Discord / Realtime
   ============================================================ */

/* ---------- สิทธิ์และตัวตน ---------- */
function gangRoleOf(member) {
  if (!member) return "member";
  const explicit = String(member.gangRole || "").trim().toLowerCase();
  if (GANG_ROLES.includes(explicit)) return explicit;
  const group = String(member.group || "").trim().toUpperCase();
  if (group === "BOSS") return "leader";
  if (group === "LEADER") return "deputy";
  if (group === "SUPPORT") return "staff";
  if (/FOUNDER|OWNER|BOSS/i.test(String(member.role || ""))) return "leader";
  return "member";
}
function actorOf(req) {
  const isAdmin = !!(req.session && req.session.admin);
  const member = currentMember(req);
  if (!isAdmin && !member) return null;
  const role = isAdmin ? "leader" : gangRoleOf(member);
  return {
    admin: isAdmin,
    member,
    memberId: member ? member.id : null,
    name: isAdmin ? (ADMIN_USER || "Admin") : (member.name || "Member"),
    role,
    rank: GANG_ROLE_RANK[role] || 0
  };
}
function permsOf(actor) {
  const rank = actor ? actor.rank : 0;
  return {
    role: actor ? actor.role : "",
    roleLabel: GANG_ROLE_LABEL[actor ? actor.role : ""] || "",
    canViewAll: rank >= 2,
    canReviewReports: rank >= 2,
    canReviewLeaves: rank >= 2,
    canAdjustPoints: rank >= 3,
    canManageBehavior: rank >= 3,
    canViewAudit: rank >= 3,
    canManageMembers: rank >= 4,
    canManageConfig: rank >= 4
  };
}
const gangAuth = (req, res, next) => {
  const actor = actorOf(req);
  if (!actor) return res.status(401).json({ error: "กรุณาเข้าสู่ระบบก่อน" });
  req.gang = actor;
  next();
};
const gangAtLeast = (rank) => (req, res, next) => {
  if (!req.gang || req.gang.rank < rank) return res.status(403).json({ error: "คุณไม่มีสิทธิ์ดำเนินการนี้" });
  next();
};

/* ---------- คะแนน ---------- */
function memberPointMap() {
  const map = new Map();
  for (const entry of readScores()) {
    const key = String(entry.memberId);
    map.set(key, (map.get(key) || 0) + Number(entry.delta || 0));
  }
  return map;
}
function pointsOf(memberId) {
  return memberPointMap().get(String(memberId)) || 0;
}
function cleanPoints(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100000, Math.round(n)));
}
function makeId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
}

/* ---------- ช่วงวันที่ (เวลาไทย) ---------- */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
function startOfDay(value) {
  if (!DATE_ONLY.test(String(value || ""))) return null;
  const date = new Date(`${value}T00:00:00+07:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}
function endOfDay(value) {
  if (!DATE_ONLY.test(String(value || ""))) return null;
  const date = new Date(`${value}T23:59:59.999+07:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}
function inDateRange(iso, from, to) {
  const time = new Date(iso || 0).getTime();
  if (Number.isNaN(time)) return true;
  const fromDate = startOfDay(from);
  const toDate = endOfDay(to);
  if (fromDate && time < fromDate.getTime()) return false;
  if (toDate && time > toDate.getTime()) return false;
  return true;
}

/* ---------- ตั้งค่าคะแนน / Discord ---------- */
function readGangConfig() {
  const row = readSettings().find((s) => s && s.id === "gangConfig") || {};
  const points = {};
  for (const type of ACTIVITY_TYPES) {
    points[type] = {};
    for (const result of ["won", "lost"]) {
      const raw = row.points && row.points[type] ? row.points[type][result] : undefined;
      const n = Number(raw);
      points[type][result] = Number.isFinite(n) && n >= 0
        ? Math.min(100000, Math.round(n))
        : DEFAULT_GANG_POINTS[type][result];
    }
  }
  return {
    id: "gangConfig",
    points,
    webhookUrl: typeof row.webhookUrl === "string" ? row.webhookUrl : "",
    updatedAt: row.updatedAt || ""
  };
}
function saveGangConfig({ points, webhookUrl }) {
  const list = readSettings().filter((s) => !s || s.id !== "gangConfig");
  list.push({
    id: "gangConfig",
    points,
    webhookUrl: String(webhookUrl || ""),
    updatedAt: new Date().toISOString()
  });
  settingsStore.write(list);
  return readGangConfig();
}
function effectiveWebhook() {
  const config = readGangConfig();
  return (config.webhookUrl || DISCORD_WEBHOOK_URL || "").trim();
}
function maskWebhook(url) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/\/webhooks\/(\d{17,20})/);
    const id = match ? match[1] : "";
    const short = id ? `${id.slice(0, 4)}••••${id.slice(-4)}` : "••••";
    return `${parsed.host}/api/webhooks/${short}/••••••`;
  } catch {
    return "••••••";
  }
}
function webhookStatus() {
  const config = readGangConfig();
  const url = (config.webhookUrl || DISCORD_WEBHOOK_URL || "").trim();
  return {
    configured: !!url,
    source: config.webhookUrl ? "settings" : (DISCORD_WEBHOOK_URL ? "env" : "none"),
    preview: maskWebhook(url)
  };
}

/* คิวส่ง Discord Webhook — retry อัตโนมัติ + กัน rate limit */
const discordWebhookQueue = [];
let discordWebhookRunning = false;
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function discordEmbed({ title, description, color, fields }) {
  return {
    title: String(title || "").slice(0, 250),
    ...(description ? { description: String(description).slice(0, 3500) } : {}),
    color: color || 0xd4af37,
    fields: (fields || [])
      .filter((f) => f && f.name && f.value !== undefined && f.value !== null && String(f.value) !== "")
      .slice(0, 20)
      .map((f) => ({ name: String(f.name).slice(0, 250), value: String(f.value).slice(0, 1000), inline: !!f.inline })),
    timestamp: new Date().toISOString(),
    footer: { text: "TWENTYFIVE GANG SYSTEM" }
  };
}
function queueDiscord(embed) {
  if (!effectiveWebhook()) return false;
  discordWebhookQueue.push(embed);
  if (discordWebhookQueue.length > 100) discordWebhookQueue.splice(0, discordWebhookQueue.length - 100);
  runDiscordWebhookQueue();
  return true;
}
async function runDiscordWebhookQueue() {
  if (discordWebhookRunning) return;
  discordWebhookRunning = true;
  try {
    while (discordWebhookQueue.length) {
      const embed = discordWebhookQueue.shift();
      const url = effectiveWebhook();
      if (!url) continue;
      let sent = false;
      let lastError = "";
      for (let attempt = 1; attempt <= 3 && !sent; attempt += 1) {
        try {
          const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: "TWENTYFIVE SYSTEM", embeds: [embed] })
          });
          if (res.ok) { sent = true; break; }
          lastError = `Discord ตอบกลับ ${res.status}`;
          if (res.status === 429) {
            const retryAfter = Number((await res.json().catch(() => ({}))).retry_after || 1);
            await sleep(Math.min(5000, Math.max(500, retryAfter * 1000)));
          } else if (res.status >= 500) {
            await sleep(800 * attempt);
          } else break;
        } catch (err) {
          lastError = String((err && err.message) || err);
          await sleep(800 * attempt);
        }
      }
      if (!sent) console.warn(`[discord] ส่ง webhook ไม่สำเร็จ: ${lastError}`);
      await sleep(250);
    }
  } finally {
    discordWebhookRunning = false;
  }
}
async function sendDiscordEmbedNow(embed) {
  const url = effectiveWebhook();
  if (!url) return { ok: false, error: "ยังไม่ได้ตั้งค่า Discord Webhook" };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "TWENTYFIVE SYSTEM", embeds: [embed] })
    });
    if (!res.ok) return { ok: false, error: `Discord ตอบกลับ ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
}

/* ---------- Realtime (Server-Sent Events) ---------- */
const gangEventClients = new Set();
function broadcast(type, detail = {}) {
  const payload = `data: ${JSON.stringify({ type, ...detail, at: new Date().toISOString() })}\n\n`;
  for (const client of gangEventClients) {
    const scopedMember = detail && detail.memberId !== undefined && detail.memberId !== null;
    if (scopedMember && client.actor.rank < 2 && String(client.actor.memberId) !== String(detail.memberId)) continue;
    try { client.res.write(payload); } catch { /* client หลุด — เก็บกวาดตอน close */ }
  }
}

/* ---------- Audit log ---------- */
function writeGangAudit(actor, action, target, detail) {
  const list = readAudit();
  list.unshift({
    id: makeId("audit"),
    action,
    targetType: (target && target.type) || "",
    targetId: target && target.id !== undefined ? target.id : "",
    targetName: (target && target.name) || "",
    detail: String(detail || ""),
    actorId: actor ? (actor.memberId || "admin") : "system",
    actorName: actor ? actor.name : "System",
    actorRole: actor ? actor.role : "system",
    createdAt: new Date().toISOString()
  });
  if (list.length > 3000) list.length = 3000;
  writeAudit(list);
}

/* ---------- Leaderboard ---------- */
function computeLeaderboard({ from = "", to = "", q = "", limit = 0 } = {}) {
  const members = readMembers().filter((m) => !m.exitedAt);
  const scores = readScores();
  const reports = readReports();
  const allTimePoints = new Map();
  const rangePoints = new Map();
  for (const entry of scores) {
    const key = String(entry.memberId);
    allTimePoints.set(key, (allTimePoints.get(key) || 0) + Number(entry.delta || 0));
    if (inDateRange(entry.createdAt, from, to)) {
      rangePoints.set(key, (rangePoints.get(key) || 0) + Number(entry.delta || 0));
    }
  }
  const stats = new Map();
  for (const report of reports) {
    if (!inDateRange(report.createdAt, from, to)) continue;
    const key = String(report.memberId);
    const row = stats.get(key) || { submitted: 0, approved: 0, wins: 0, pending: 0, rejected: 0 };
    row.submitted += 1;
    if (report.status === "approved" || report.status === "completed") {
      row.approved += 1;
      if (report.result === "won") row.wins += 1;
    } else if (report.status === "pending") row.pending += 1;
    else if (report.status === "rejected") row.rejected += 1;
    stats.set(key, row);
  }
  const useRange = !!(from || to);
  const rows = members.map((member) => {
    const key = String(member.id);
    const stat = stats.get(key) || { submitted: 0, approved: 0, wins: 0, pending: 0, rejected: 0 };
    return {
      memberId: member.id,
      name: member.name,
      role: gangRoleOf(member),
      group: member.group || "",
      image: member.image || "",
      points: (useRange ? rangePoints : allTimePoints).get(key) || 0,
      totalPoints: allTimePoints.get(key) || 0,
      submitted: stat.submitted,
      approved: stat.approved,
      wins: stat.wins,
      pending: stat.pending,
      rejected: stat.rejected,
      passRate: stat.submitted ? Math.round((stat.approved / stat.submitted) * 100) : 0
    };
  });
  rows.sort((a, b) => b.points - a.points || b.wins - a.wins || b.approved - a.approved || a.name.localeCompare(b.name));
  rows.forEach((row, index) => { row.rank = index + 1; });
  const keyword = String(q || "").trim().toLowerCase();
  const filtered = keyword ? rows.filter((row) => String(row.name || "").toLowerCase().includes(keyword)) : rows;
  const cap = Number(limit) > 0 ? Math.min(Number(limit), 1000) : filtered.length;
  return filtered.slice(0, cap);
}

/* ---------- สถิติสมาชิก ---------- */
function memberStats(memberId, { from = "", to = "" } = {}) {
  const reports = readReports().filter((r) => String(r.memberId) === String(memberId) && inDateRange(r.createdAt, from, to));
  const scores = readScores().filter((s) => String(s.memberId) === String(memberId) && inDateRange(s.createdAt, from, to));
  const approved = reports.filter((r) => r.status === "approved" || r.status === "completed");
  return {
    submitted: reports.length,
    approved: approved.length,
    wins: approved.filter((r) => r.result === "won").length,
    pending: reports.filter((r) => r.status === "pending").length,
    rejected: reports.filter((r) => r.status === "rejected").length,
    points: scores.reduce((sum, s) => sum + Number(s.delta || 0), 0),
    totalPoints: pointsOf(memberId),
    passRate: reports.length ? Math.round((approved.length / reports.length) * 100) : 0
  };
}

/* ============================================================
   10.6 GANG MANAGEMENT SYSTEM — ROUTES
   ============================================================ */

/* ---------- เข้าสู่ระบบ / เซสชัน ---------- */
app.post("/api/gang/login", (req, res) => {
  const body = req.body || {};
  const key = nameKey(body.name);
  const password = String(body.password || "");
  if (!key || !password) return res.status(400).json({ error: "กรุณากรอกชื่อ IC และรหัสผ่าน" });
  const member = readMembers().find((m) =>
    (nameKey(m.name) === key || nameKey(m.credentials && m.credentials.username) === key) &&
    m.credentials && m.credentials.password === password
  );
  if (!member) return res.status(401).json({ error: "ชื่อ IC หรือรหัสผ่านไม่ถูกต้อง (หรือยังไม่ได้รับอนุมัติ)" });
  if (member.exitedAt) return res.status(403).json({ error: "บัญชีนี้ถูกให้ออกจากแก๊งแล้ว — ติดต่อแอดมิน" });
  delete req.session.admin;
  req.session.memberId = member.id;
  res.json({ ok: true });
});
app.get("/api/gang/session", (req, res) => {
  const actor = actorOf(req);
  if (!actor) return res.json({ authenticated: false });
  const config = readGangConfig();
  res.json({
    authenticated: true,
    actor: {
      admin: actor.admin,
      memberId: actor.memberId,
      name: actor.name,
      role: actor.role,
      roleLabel: GANG_ROLE_LABEL[actor.role] || ""
    },
    member: actor.member ? {
      ...boardMember(actor.member),
      roleLabel: GANG_ROLE_LABEL[gangRoleOf(actor.member)] || "Member",
      points: pointsOf(actor.member.id)
    } : null,
    perms: permsOf(actor),
    points: config.points,
    meta: {
      activities: ACTIVITY_TYPES.map((value) => ({ value, label: ACTIVITY_LABEL[value] })),
      results: Object.entries(ACTIVITY_RESULT_LABEL).map(([value, label]) => ({ value, label })),
      reportStatuses: REPORT_STATUSES.map((value) => ({ value, label: REPORT_STATUS_LABEL[value] })),
      leaveTypes: Object.entries(LEAVE_TYPES).map(([value, label]) => ({ value, label })),
      leaveStatuses: LEAVE_STATUSES.map((value) => ({ value, label: LEAVE_STATUS_LABEL[value] })),
      roles: GANG_ROLES.map((value) => ({ value, label: GANG_ROLE_LABEL[value] }))
    }
  });
});
app.post("/api/gang/logout", (req, res) => {
  if (!req.session) return res.json({ ok: true });
  delete req.session.memberId;
  delete req.session.admin;
  req.session.destroy(() => res.json({ ok: true }));
});

/* ---------- รายชื่อสมาชิก (Dropdown ค้นหา) ---------- */
app.get("/api/gang/members", gangAuth, (req, res) => {
  const perms = permsOf(req.gang);
  const points = memberPointMap();
  const all = readMembers()
    .filter((m) => !m.exitedAt)
    .map((m) => ({
      id: m.id,
      name: m.name,
      role: gangRoleOf(m),
      roleLabel: GANG_ROLE_LABEL[gangRoleOf(m)] || "Member",
      group: m.group || "",
      image: m.image || "",
      points: points.get(String(m.id)) || 0
    }));
  const members = perms.canViewAll
    ? all
    : all.filter((m) => String(m.id) === String(req.gang.memberId));
  res.json({ members, canViewAll: perms.canViewAll });
});

/* ---------- รายงานกิจกรรม ---------- */
function cleanProofUrl(value) {
  const raw = String(value || "").trim().slice(0, 1500);
  if (/^\/uploads\/[A-Za-z0-9._-]+$/.test(raw)) {
    return fs.existsSync(path.join(UPLOAD_DIR, path.basename(raw))) ? raw : "";
  }
  return /^https?:\/\//i.test(raw) ? raw : "";
}
function recordCounts(perms, memberId) {
  const reports = readReports();
  const scoped = perms.canViewAll ? reports : reports.filter((r) => String(r.memberId) === String(memberId));
  const counts = { pending: 0, approved: 0, rejected: 0, completed: 0 };
  scoped.forEach((r) => { if (counts[r.status] !== undefined) counts[r.status] += 1; });
  const leaves = readLeaves();
  const scopedLeaves = perms.canViewAll ? leaves : leaves.filter((l) => String(l.memberId) === String(memberId));
  return {
    reports: counts,
    leaves: {
      pending: scopedLeaves.filter((l) => l.status === "pending").length,
      approved: scopedLeaves.filter((l) => l.status === "approved").length,
      rejected: scopedLeaves.filter((l) => l.status === "rejected").length
    }
  };
}
app.get("/api/gang/reports", gangAuth, (req, res) => {
  const perms = permsOf(req.gang);
  const query = req.query || {};
  let list = readReports();
  if (!perms.canViewAll) list = list.filter((r) => String(r.memberId) === String(req.gang.memberId));
  else if (query.memberId) list = list.filter((r) => String(r.memberId) === String(query.memberId));
  if (REPORT_STATUSES.includes(query.status)) list = list.filter((r) => r.status === query.status);
  if (ACTIVITY_TYPES.includes(query.type)) list = list.filter((r) => r.type === query.type);
  list = list.filter((r) => inDateRange(r.createdAt, query.from, query.to));
  const keyword = String(query.q || "").trim().toLowerCase();
  if (keyword) list = list.filter((r) => String(r.memberName || "").toLowerCase().includes(keyword));
  list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const total = list.length;
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  const items = list.slice((page - 1) * limit, page * limit);
  res.json({ items, total, page, pages: Math.max(1, Math.ceil(total / limit)), counts: recordCounts(perms, req.gang.memberId) });
});
app.post("/api/gang/reports", gangAuth, (req, res) => {
  const body = req.body || {};
  const perms = permsOf(req.gang);
  const targetId = perms.canViewAll && body.memberId ? body.memberId : req.gang.memberId;
  if (!targetId) return res.status(400).json({ error: "กรุณาเลือกสมาชิก" });
  const members = readMembers();
  const member = members.find((m) => String(m.id) === String(targetId));
  if (!member) return res.status(404).json({ error: "ไม่พบสมาชิก" });
  if (member.exitedAt) return res.status(403).json({ error: "สมาชิกนี้ถูกระงับ/ออกจากแก๊งแล้ว ไม่สามารถส่งรายงานได้" });
  if (!perms.canViewAll && String(member.id) !== String(req.gang.memberId)) {
    return res.status(403).json({ error: "สมาชิกสามารถส่งรายงานของตัวเองเท่านั้น" });
  }
  const type = String(body.type || "").trim();
  const result = String(body.result || "").trim();
  if (!ACTIVITY_TYPES.includes(type)) return res.status(400).json({ error: "กรุณาเลือกประเภทกิจกรรม" });
  if (!["won", "lost"].includes(result)) return res.status(400).json({ error: "กรุณาเลือกผลลัพธ์กิจกรรม" });
  const proofUrl = cleanProofUrl(body.proofUrl);
  const proofRequired = !(type === "shop" && result === "lost");
  if (proofRequired && !proofUrl) {
    return res.status(400).json({ error: type === "shop" ? "กรุณาแนบรูปภาพหลักฐานการงัดร้าน" : "กรุณาแนบรูปภาพหลักฐานกิจกรรม" });
  }
  if (!rateLimit(`report:${member.id}`, 6, 10 * 60 * 1000)) {
    return res.status(429).json({ error: "ส่งรายงานบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่" });
  }
  const requestId = cleanLine(body.requestId, 80);
  const reports = readReports();
  if (requestId && reports.some((r) => r.requestId === requestId)) {
    return res.status(409).json({ error: "รายงานนี้ถูกส่งไปแล้ว (ป้องกันการส่งซ้ำ)" });
  }
  const duplicate = reports.find((r) =>
    String(r.memberId) === String(member.id) &&
    r.type === type &&
    r.result === result &&
    Date.now() - new Date(r.createdAt).getTime() < 60 * 1000
  );
  if (duplicate) return res.status(409).json({ error: "พบรายงานที่เหมือนกันเมื่อสักครู่ — กรุณารอ 1 นาทีก่อนส่งซ้ำ" });
  const report = {
    id: makeId("rep"),
    memberId: member.id,
    memberName: member.name,
    type,
    result,
    proofUrl,
    note: cleanLine(body.note, 400),
    status: "pending",
    points: 0,
    reviewNote: "",
    reviewedBy: "",
    reviewedByName: "",
    reviewedAt: "",
    requestId,
    createdAt: new Date().toISOString()
  };
  reports.unshift(report);
  writeReports(reports);
  writeGangAudit(req.gang, "report.create", { type: "report", id: report.id, name: member.name }, `${ACTIVITY_LABEL[type]} · ${ACTIVITY_RESULT_LABEL[result]}`);
  queueDiscord(discordEmbed({
    title: "📝 มีรายงานกิจกรรมใหม่",
    color: 0xe8c56a,
    fields: [
      { name: "สมาชิก", value: `${member.name} (${member.id})`, inline: true },
      { name: "กิจกรรม", value: ACTIVITY_LABEL[type], inline: true },
      { name: "ผลลัพธ์", value: ACTIVITY_RESULT_LABEL[result], inline: true },
      { name: "สถานะ", value: REPORT_STATUS_LABEL.pending, inline: true },
      { name: "เวลา", value: thDateTime(report.createdAt), inline: true },
      { name: "หลักฐาน", value: proofUrl ? "แนบมาแล้ว" : "ไม่ได้แนบ", inline: true }
    ]
  }));
  broadcast("report:new", { reportId: report.id, memberId: member.id, status: report.status });
  res.status(201).json({ ok: true, report });
});
app.post("/api/gang/reports/:id/review", gangAuth, gangAtLeast(2), (req, res) => {
  const body = req.body || {};
  const action = String(body.action || "").trim();
  const reports = readReports();
  const index = reports.findIndex((r) => String(r.id) === String(req.params.id));
  if (index < 0) return res.status(404).json({ error: "ไม่พบรายงาน" });
  const report = reports[index];
  const now = new Date().toISOString();
  let message = "";
  let scoreDelta = 0;
  if (action === "reject") {
    if (report.status !== "pending") return res.status(409).json({ error: "รายงานนี้ถูกตรวจสอบแล้ว" });
    const reason = cleanLine(body.reason, 300);
    if (!reason) return res.status(400).json({ error: "กรุณาระบุเหตุผลที่ปฏิเสธ" });
    reports[index] = { ...report, status: "rejected", points: 0, reviewNote: reason, reviewedBy: req.gang.memberId || "admin", reviewedByName: req.gang.name, reviewedAt: now };
    message = `ปฏิเสธรายงาน · ${reason}`;
  } else if (action === "approve") {
    if (report.status !== "pending") return res.status(409).json({ error: "รายงานนี้ถูกตรวจสอบแล้ว" });
    const result = ["won", "lost"].includes(body.result) ? body.result : report.result;
    const config = readGangConfig();
    const defaultPoints = config.points[report.type] ? config.points[report.type][result] : 0;
    const points = body.points === undefined || body.points === "" ? defaultPoints : cleanPoints(body.points, defaultPoints);
    reports[index] = {
      ...report,
      status: "approved",
      result,
      points,
      reviewNote: cleanLine(body.reason, 300),
      reviewedBy: req.gang.memberId || "admin",
      reviewedByName: req.gang.name,
      reviewedAt: now
    };
    scoreDelta = points;
    message = `อนุมัติรายงาน · ${ACTIVITY_LABEL[report.type]} (${ACTIVITY_RESULT_LABEL[result]}) · ${points} คะแนน`;
  } else if (action === "complete") {
    if (report.status !== "approved") return res.status(409).json({ error: "ต้องอนุมัติรายงานก่อนจึงจะปิดงานได้" });
    reports[index] = { ...report, status: "completed", completedAt: now, reviewedByName: req.gang.name };
    message = "ปิดงานเรียบร้อย";
  } else {
    return res.status(400).json({ error: "action ต้องเป็น approve / reject / complete" });
  }
  const updated = reports[index];
  writeReports(reports);

  /* ให้คะแนนจากรายงานครั้งเดียวเท่านั้น — กันคิดคะแนนซ้ำ */
  if (action === "approve" && scoreDelta !== 0) {
    const scores = readScores();
    if (!scores.some((s) => s.reportId === updated.id)) {
      scores.unshift({
        id: makeId("score"),
        memberId: updated.memberId,
        memberName: updated.memberName,
        delta: scoreDelta,
        reason: `${ACTIVITY_LABEL[updated.type]} (${ACTIVITY_RESULT_LABEL[updated.result]}) — ${updated.memberName}`,
        source: "report",
        reportId: updated.id,
        actorId: req.gang.memberId || "admin",
        actorName: req.gang.name,
        createdAt: now
      });
      writeScores(scores);
      broadcast("score:changed", { memberId: updated.memberId, reportId: updated.id });
    }
  }
  writeGangAudit(req.gang, `report.${action}`, { type: "report", id: updated.id, name: updated.memberName }, message);
  queueDiscord(discordEmbed({
    title: action === "reject" ? "❌ รายงานถูกปฏิเสธ" : action === "complete" ? "✅ ปิดงานเรียบร้อย" : "✅ อนุมัติรายงานกิจกรรม",
    color: action === "reject" ? 0xe08a7c : 0x7fe0b0,
    description: message,
    fields: [
      { name: "สมาชิก", value: `${updated.memberName} (${updated.memberId})`, inline: true },
      { name: "กิจกรรม", value: ACTIVITY_LABEL[updated.type], inline: true },
      { name: "ผลลัพธ์", value: ACTIVITY_RESULT_LABEL[updated.result], inline: true },
      { name: "คะแนน", value: `${updated.points}`, inline: true },
      { name: "ผู้ดำเนินการ", value: req.gang.name, inline: true },
      { name: "เวลา", value: thDateTime(now), inline: true }
    ]
  }));
  broadcast("report:updated", { reportId: updated.id, memberId: updated.memberId, status: updated.status });
  broadcast("leaderboard:updated", {});
  res.json({ ok: true, report: updated });
});

/* ---------- คะแนน (เพิ่ม / หัก) ---------- */
app.get("/api/gang/scores", gangAuth, (req, res) => {
  const perms = permsOf(req.gang);
  const memberId = req.query.memberId || req.gang.memberId;
  if (!memberId) return res.status(400).json({ error: "กรุณาระบุสมาชิก" });
  if (!perms.canViewAll && String(memberId) !== String(req.gang.memberId)) {
    return res.status(403).json({ error: "ดูประวัติคะแนนของผู้อื่นไม่ได้" });
  }
  const list = readScores()
    .filter((s) => String(s.memberId) === String(memberId))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ items: list, points: pointsOf(memberId), total: list.length });
});
app.post("/api/gang/scores", gangAuth, gangAtLeast(3), (req, res) => {
  const body = req.body || {};
  const memberId = body.memberId;
  const member = readMembers().find((m) => String(m.id) === String(memberId));
  if (!member) return res.status(404).json({ error: "ไม่พบสมาชิก" });
  if (member.exitedAt) return res.status(400).json({ error: "สมาชิกนี้ถูกระงับ/ออกจากแก๊งแล้ว" });
  const delta = Math.round(Number(body.delta));
  if (!Number.isFinite(delta) || delta === 0) return res.status(400).json({ error: "จำนวนคะแนนต้องไม่เป็น 0" });
  if (Math.abs(delta) > 100000) return res.status(400).json({ error: "จำนวนคะแนนมากเกินไป" });
  const reason = cleanLine(body.reason, 300);
  if (reason.length < 2) return res.status(400).json({ error: "กรุณาระบุเหตุผลทุกครั้งที่เพิ่มหรือหักคะแนน" });
  const requestId = cleanLine(body.requestId, 80);
  const scores = readScores();
  if (requestId && scores.some((s) => s.requestId === requestId)) {
    return res.status(409).json({ error: "รายการนี้ถูกบันทึกไปแล้ว (ป้องกันการทำซ้ำ)" });
  }
  const entry = {
    id: makeId("score"),
    memberId: member.id,
    memberName: member.name,
    delta,
    reason,
    source: delta > 0 ? "manual" : "penalty",
    reportId: "",
    requestId,
    actorId: req.gang.memberId || "admin",
    actorName: req.gang.name,
    createdAt: new Date().toISOString()
  };
  scores.unshift(entry);
  writeScores(scores);
  const points = pointsOf(member.id);
  writeGangAudit(req.gang, delta > 0 ? "score.add" : "score.deduct", { type: "member", id: member.id, name: member.name }, `${delta > 0 ? "+" : ""}${delta} · ${reason}`);
  queueDiscord(discordEmbed({
    title: delta > 0 ? "➕ สมาชิกได้รับคะแนน" : "➖ สมาชิกถูกหักคะแนน",
    color: delta > 0 ? 0x7fe0b0 : 0xe08a7c,
    fields: [
      { name: "สมาชิก", value: `${member.name} (${member.id})`, inline: true },
      { name: "คะแนน", value: `${delta > 0 ? "+" : ""}${delta}`, inline: true },
      { name: "คะแนนคงเหลือ", value: `${points}`, inline: true },
      { name: "เหตุผล", value: reason, inline: false },
      { name: "ผู้ดำเนินการ", value: req.gang.name, inline: true },
      { name: "เวลา", value: thDateTime(entry.createdAt), inline: true }
    ]
  }));
  broadcast("score:changed", { memberId: member.id });
  broadcast("leaderboard:updated", {});
  res.status(201).json({ ok: true, entry, points });
});

/* ---------- Leaderboard ---------- */
app.get("/api/gang/leaderboard", gangAuth, (req, res) => {
  const query = req.query || {};
  const rows = computeLeaderboard({
    from: String(query.from || ""),
    to: String(query.to || ""),
    q: String(query.q || ""),
    limit: Number(query.limit) || 100
  });
  res.json({ items: rows, total: rows.length, updatedAt: new Date().toISOString() });
});

/* ---------- ประวัติของสมาชิก (MY RECORD) ---------- */
app.get("/api/gang/records/:memberId", gangAuth, (req, res) => {
  const perms = permsOf(req.gang);
  const memberId = req.params.memberId;
  if (!perms.canViewAll && String(memberId) !== String(req.gang.memberId)) {
    return res.status(403).json({ error: "สมาชิกดูได้เฉพาะประวัติของตัวเอง" });
  }
  const member = readMembers().find((m) => String(m.id) === String(memberId));
  if (!member) return res.status(404).json({ error: "ไม่พบสมาชิก" });
  const scores = readScores()
    .filter((s) => String(s.memberId) === String(memberId))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const reports = readReports()
    .filter((r) => String(r.memberId) === String(memberId))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const leaves = readLeaves()
    .filter((l) => String(l.memberId) === String(memberId))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const warnings = readBehavior()
    .filter((b) => String(b.memberId) === String(memberId))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const self = String(req.gang.memberId) === String(memberId);
  res.json({
    member: {
      id: member.id,
      name: member.name,
      role: gangRoleOf(member),
      roleLabel: GANG_ROLE_LABEL[gangRoleOf(member)] || "Member",
      group: member.group || "",
      image: member.image || "",
      tagline: member.tagline || "",
      bio: member.bio || member.description || "",
      status: member.exitedAt ? "ออกจากแก๊ง" : "อยู่ในแก๊ง",
      appliedAt: member.appliedAt || "",
      approvedAt: member.approvedAt || "",
      ...(self ? { username: (member.credentials && member.credentials.username) || "" } : {})
    },
    points: pointsOf(memberId),
    stats: memberStats(memberId),
    scoreHistory: scores,
    activityHistory: reports,
    leaveHistory: leaves,
    warnings
  });
});

/* ---------- ระบบการลา ---------- */
app.get("/api/gang/leaves", gangAuth, (req, res) => {
  const perms = permsOf(req.gang);
  const query = req.query || {};
  let list = readLeaves();
  if (!perms.canViewAll) list = list.filter((l) => String(l.memberId) === String(req.gang.memberId));
  else if (query.memberId) list = list.filter((l) => String(l.memberId) === String(query.memberId));
  if (LEAVE_STATUSES.includes(query.status)) list = list.filter((l) => l.status === query.status);
  list = list.filter((l) => inDateRange(`${l.startDate}T12:00:00+07:00`, query.from, query.to));
  const keyword = String(query.q || "").trim().toLowerCase();
  if (keyword) list = list.filter((l) => String(l.memberName || "").toLowerCase().includes(keyword));
  list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  res.json({ items: list.slice((page - 1) * limit, page * limit), total: list.length, page, counts: recordCounts(perms, req.gang.memberId).leaves });
});
app.post("/api/gang/leaves", gangAuth, (req, res) => {
  if (!req.gang.memberId) return res.status(400).json({ error: "แอดมินต้องเข้าสู่ระบบด้วยบัญชีสมาชิกเพื่อขอลา" });
  const body = req.body || {};
  const startDate = String(body.startDate || "").trim();
  const endDate = String(body.endDate || startDate).trim();
  if (!DATE_ONLY.test(startDate) || !DATE_ONLY.test(endDate)) return res.status(400).json({ error: "กรุณาเลือกวันที่ให้ถูกต้อง" });
  if (endDate < startDate) return res.status(400).json({ error: "วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่มลา" });
  const type = String(body.type || "").trim();
  if (!LEAVE_TYPES[type]) return res.status(400).json({ error: "กรุณาเลือกประเภทการลา" });
  const reason = cleanLine(body.reason, 400);
  if (reason.length < 2) return res.status(400).json({ error: "กรุณาระบุเหตุผลในการลา" });
  const leaves = readLeaves();
  const overlap = leaves.find((l) =>
    String(l.memberId) === String(req.gang.memberId) &&
    ["pending", "approved"].includes(l.status) &&
    l.startDate <= endDate && (l.endDate || l.startDate) >= startDate
  );
  if (overlap) return res.status(409).json({ error: "มีคำขอลาที่ทับซ้อนช่วงวันนี้อยู่แล้ว" });
  if (!rateLimit(`leave:${req.gang.memberId}`, 5, 10 * 60 * 1000)) {
    return res.status(429).json({ error: "ส่งคำขอลาบ่อยเกินไป กรุณารอสักครู่" });
  }
  const member = readMembers().find((m) => String(m.id) === String(req.gang.memberId));
  if (!member || member.exitedAt) return res.status(403).json({ error: "บัญชีนี้ไม่พร้อมใช้งาน" });
  const leave = {
    id: makeId("leave"),
    memberId: member.id,
    memberName: member.name,
    type,
    startDate,
    endDate,
    reason,
    status: "pending",
    reviewNote: "",
    reviewedBy: "",
    reviewedByName: "",
    reviewedAt: "",
    createdAt: new Date().toISOString()
  };
  leaves.unshift(leave);
  writeLeaves(leaves);
  writeGangAudit(req.gang, "leave.create", { type: "leave", id: leave.id, name: member.name }, `${LEAVE_TYPES[type]} ${startDate} → ${endDate}`);
  queueDiscord(discordEmbed({
    title: "🗓️ มีคำขอลาใหม่",
    color: 0xe8c56a,
    fields: [
      { name: "สมาชิก", value: `${member.name} (${member.id})`, inline: true },
      { name: "ประเภท", value: LEAVE_TYPES[type], inline: true },
      { name: "ช่วงวันที่", value: `${startDate} → ${endDate}`, inline: true },
      { name: "เหตุผล", value: reason },
      { name: "สถานะ", value: LEAVE_STATUS_LABEL.pending, inline: true },
      { name: "เวลา", value: thDateTime(leave.createdAt), inline: true }
    ]
  }));
  broadcast("leave:new", { leaveId: leave.id, memberId: member.id });
  res.status(201).json({ ok: true, leave });
});
app.post("/api/gang/leaves/:id/review", gangAuth, gangAtLeast(2), (req, res) => {
  const body = req.body || {};
  const action = String(body.action || "").trim();
  if (!["approve", "reject"].includes(action)) return res.status(400).json({ error: "action ต้องเป็น approve หรือ reject" });
  if (action === "reject" && cleanLine(body.reason, 300).length < 2) {
    return res.status(400).json({ error: "กรุณาระบุเหตุผลที่ไม่อนุมัติ" });
  }
  const leaves = readLeaves();
  const index = leaves.findIndex((l) => String(l.id) === String(req.params.id));
  if (index < 0) return res.status(404).json({ error: "ไม่พบคำขอลา" });
  if (leaves[index].status !== "pending") return res.status(409).json({ error: "คำขอนี้ถูกตรวจสอบแล้ว" });
  const now = new Date().toISOString();
  leaves[index] = {
    ...leaves[index],
    status: action === "approve" ? "approved" : "rejected",
    reviewNote: cleanLine(body.reason, 300),
    reviewedBy: req.gang.memberId || "admin",
    reviewedByName: req.gang.name,
    reviewedAt: now
  };
  writeLeaves(leaves);
  const leave = leaves[index];
  writeGangAudit(req.gang, `leave.${action}`, { type: "leave", id: leave.id, name: leave.memberName }, leave.reviewNote || "");
  queueDiscord(discordEmbed({
    title: action === "approve" ? "✅ อนุมัติการลา" : "❌ ไม่อนุมัติการลา",
    color: action === "approve" ? 0x7fe0b0 : 0xe08a7c,
    fields: [
      { name: "สมาชิก", value: `${leave.memberName} (${leave.memberId})`, inline: true },
      { name: "ประเภท", value: LEAVE_TYPES[leave.type] || leave.type, inline: true },
      { name: "ช่วงวันที่", value: `${leave.startDate} → ${leave.endDate}`, inline: true },
      { name: "เหตุผล", value: leave.reviewNote || "-" },
      { name: "ผู้ดำเนินการ", value: req.gang.name, inline: true },
      { name: "เวลา", value: thDateTime(now), inline: true }
    ]
  }));
  broadcast("leave:updated", { leaveId: leave.id, memberId: leave.memberId });
  res.json({ ok: true, leave });
});

/* ---------- ความประพฤติ / การเตือน ---------- */
app.get("/api/gang/behavior", gangAuth, (req, res) => {
  const perms = permsOf(req.gang);
  if (String(req.query.all || "") === "1") {
    if (!perms.canViewAll) return res.status(403).json({ error: "คุณไม่มีสิทธิ์ดูความประพฤติของทุกคน" });
    const all = readBehavior().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return res.json({ items: all, total: all.length });
  }
  const memberId = req.query.memberId || req.gang.memberId;
  if (!memberId) return res.status(400).json({ error: "กรุณาระบุสมาชิก" });
  if (!perms.canViewAll && String(memberId) !== String(req.gang.memberId)) {
    return res.status(403).json({ error: "ดูข้อมูลของผู้อื่นไม่ได้" });
  }
  const list = readBehavior()
    .filter((b) => String(b.memberId) === String(memberId))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ items: list, total: list.length });
});
app.post("/api/gang/behavior", gangAuth, gangAtLeast(3), (req, res) => {
  const body = req.body || {};
  const member = readMembers().find((m) => String(m.id) === String(body.memberId));
  if (!member) return res.status(404).json({ error: "ไม่พบสมาชิก" });
  const kind = body.kind === "note" ? "note" : "warning";
  const detail = cleanLine(body.detail || body.reason, 500);
  if (detail.length < 2) return res.status(400).json({ error: "กรุณาระบุรายละเอียด / เหตุผล" });
  const entry = {
    id: makeId("beh"),
    memberId: member.id,
    memberName: member.name,
    kind,
    title: cleanLine(body.title, 120) || (kind === "warning" ? "แจ้งเตือน" : "บันทึกความประพฤติ"),
    detail,
    actorId: req.gang.memberId || "admin",
    actorName: req.gang.name,
    createdAt: new Date().toISOString()
  };
  const list = readBehavior();
  list.unshift(entry);
  writeBehavior(list);
  writeGangAudit(req.gang, kind === "warning" ? "behavior.warn" : "behavior.note", { type: "member", id: member.id, name: member.name }, detail);
  queueDiscord(discordEmbed({
    title: kind === "warning" ? "⚠️ สมาชิกได้รับการเตือน" : "📌 บันทึกความประพฤติ",
    color: kind === "warning" ? 0xe8c56a : 0x9a9aa3,
    fields: [
      { name: "สมาชิก", value: `${member.name} (${member.id})`, inline: true },
      { name: "หัวข้อ", value: entry.title, inline: true },
      { name: "รายละเอียด", value: detail },
      { name: "ผู้แจ้ง", value: req.gang.name, inline: true },
      { name: "เวลา", value: thDateTime(entry.createdAt), inline: true }
    ]
  }));
  broadcast("behavior:new", { behaviorId: entry.id, memberId: member.id });
  res.status(201).json({ ok: true, entry });
});
app.delete("/api/gang/behavior/:id", gangAuth, gangAtLeast(3), (req, res) => {
  const list = readBehavior();
  const target = list.find((b) => String(b.id) === String(req.params.id));
  const next = list.filter((b) => !target || String(b.id) !== String(req.params.id));
  if (next.length === list.length) return res.status(404).json({ error: "ไม่พบรายการ" });
  markSheetRemoved("behavior", target.id);
  writeBehavior(next);
  writeGangAudit(req.gang, "behavior.delete", { type: "member", id: target.memberId, name: target.memberName }, target.detail);
  broadcast("behavior:deleted", { behaviorId: target.id, memberId: target.memberId });
  res.json({ ok: true });
});

/* ---------- Dashboard / Audit ---------- */
app.get("/api/gang/overview", gangAuth, (req, res) => {
  if (req.gang.rank < 2) return res.status(403).json({ error: "คุณไม่มีสิทธิ์ดูภาพรวมแก๊ง" });
  const reports = readReports();
  const leaves = readLeaves();
  const members = readMembers().filter((m) => !m.exitedAt);
  const scores = readScores();
  const leaderboard = computeLeaderboard({ limit: 5 });
  res.json({
    members: members.length,
    pendingReports: reports.filter((r) => r.status === "pending").length,
    approvedReports: reports.filter((r) => r.status === "approved" || r.status === "completed").length,
    rejectedReports: reports.filter((r) => r.status === "rejected").length,
    pendingLeaves: leaves.filter((l) => l.status === "pending").length,
    totalReports: reports.length,
    totalPoints: scores.reduce((sum, s) => sum + Number(s.delta || 0), 0),
    top: leaderboard,
    recentReports: [...reports].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 6),
    recentAudit: readAudit().slice(0, 8),
    discord: webhookStatus(),
    sheets: sheetsSummary()
  });
});
app.get("/api/gang/audit", gangAuth, gangAtLeast(3), (req, res) => {
  const query = req.query || {};
  let list = readAudit();
  const keyword = String(query.q || "").trim().toLowerCase();
  if (keyword) list = list.filter((a) => `${a.actorName} ${a.action} ${a.targetName} ${a.detail}`.toLowerCase().includes(keyword));
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(query.limit) || 50));
  res.json({ items: list.slice((page - 1) * limit, page * limit), total: list.length, page });
});

/* ---------- ตั้งค่าสำหรับ Leader ---------- */
app.get("/api/gang/admin/config", gangAuth, gangAtLeast(4), (req, res) => {
  const config = readGangConfig();
  res.json({
    points: config.points,
    webhook: webhookStatus(),
    sheets: sheetsSummary(),
    defaults: DEFAULT_GANG_POINTS,
    updatedAt: config.updatedAt
  });
});
app.put("/api/gang/admin/config", gangAuth, gangAtLeast(4), (req, res) => {
  const body = req.body || {};
  const current = readGangConfig();
  const points = {};
  for (const type of ACTIVITY_TYPES) {
    points[type] = {};
    for (const result of ["won", "lost"]) {
      const incoming = body.points && body.points[type] ? body.points[type][result] : undefined;
      points[type][result] = incoming === undefined ? current.points[type][result] : cleanPoints(incoming, current.points[type][result]);
    }
  }
  let webhookUrl = current.webhookUrl;
  if (body.clearWebhook) webhookUrl = "";
  else if (body.webhookUrl !== undefined) {
    const url = String(body.webhookUrl || "").trim();
    if (url && !/^https:\/\/(?:discord|discordapp|ptb\.discord|canary\.discord)\.com\/api\/(?:v\d+\/)?webhooks\/\d+\/[\w-]+$/i.test(url)) {
      return res.status(400).json({ error: "ลิงก์ Discord Webhook ไม่ถูกต้อง" });
    }
    webhookUrl = url;
  }
  const saved = saveGangConfig({ points, webhookUrl });
  const configDetail = webhookUrl !== current.webhookUrl ? "อัปเดตคะแนนและ Discord Webhook" : "อัปเดตคะแนนกิจกรรม";
  writeGangAudit(req.gang, "config.update", { type: "config", id: "gangConfig", name: "ตั้งค่าระบบ" }, configDetail);
  queueDiscord(discordEmbed({
    title: "⚙️ อัปเดตการตั้งค่าระบบแก๊ง",
    color: 0x9a9aa3,
    fields: [
      { name: "ผู้ดำเนินการ", value: req.gang.name, inline: true },
      { name: "รายละเอียด", value: configDetail, inline: true },
      { name: "เวลา", value: thDateTime(new Date().toISOString()), inline: true }
    ]
  }));
  broadcast("config:updated", {});
  res.json({ ok: true, points: saved.points, webhook: webhookStatus(), updatedAt: saved.updatedAt });
});
app.post("/api/gang/admin/discord/test", gangAuth, gangAtLeast(4), async (req, res) => {
  const result = await sendDiscordEmbedNow(discordEmbed({
    title: "🔔 ทดสอบการแจ้งเตือน TWENTYFIVE",
    description: "หากเห็นข้อความนี้ แสดงว่า Discord Webhook ทำงานถูกต้อง",
    color: 0xd4af37,
    fields: [{ name: "ผู้ทดสอบ", value: req.gang.name, inline: true }, { name: "เวลา", value: thDateTime(new Date().toISOString()), inline: true }]
  }));
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ ok: true });
});
app.post("/api/gang/admin/members/:id/role", gangAuth, gangAtLeast(4), (req, res) => {
  const role = String((req.body || {}).role || "").trim().toLowerCase();
  if (!GANG_ROLES.includes(role)) return res.status(400).json({ error: "ตำแหน่งไม่ถูกต้อง" });
  const members = readMembers();
  const index = members.findIndex((m) => String(m.id) === String(req.params.id));
  if (index < 0) return res.status(404).json({ error: "ไม่พบสมาชิก" });
  members[index] = { ...members[index], gangRole: role, gangRoleUpdatedAt: new Date().toISOString() };
  writeMembers(members);
  writeGangAudit(req.gang, "member.role", { type: "member", id: members[index].id, name: members[index].name }, GANG_ROLE_LABEL[role]);
  queueDiscord(discordEmbed({
    title: "👤 อัปเดตตำแหน่งสมาชิก",
    color: 0xd4af37,
    fields: [
      { name: "สมาชิก", value: `${members[index].name} (${members[index].id})`, inline: true },
      { name: "ตำแหน่งใหม่", value: GANG_ROLE_LABEL[role], inline: true },
      { name: "ผู้ดำเนินการ", value: req.gang.name, inline: true },
      { name: "เวลา", value: thDateTime(new Date().toISOString()), inline: true }
    ]
  }));
  broadcast("member:updated", { memberId: members[index].id });
  res.json({ ok: true, member: publicMember(members[index]) });
});
app.post("/api/gang/admin/sheets/sync", gangAuth, gangAtLeast(4), async (req, res) => {
  if (!sheetStatus.configured) return res.status(400).json({ error: "ยังไม่ได้ตั้งค่า SHEETS_WEBHOOK_URL" });
  const results = {};
  for (const sheet of ALL_SHEETS) {
    try {
      results[sheet] = { ok: true, ...(await sendSheet(sheet)) };
      sheetQueue.delete(sheet);
    } catch (err) {
      const message = String((err && err.message) || err);
      if (sheetStatus.sheets[sheet]) sheetStatus.sheets[sheet].error = message;
      sheetStatus.lastError = message;
      results[sheet] = { ok: false, error: message };
    }
  }
  sheetLastRun = Date.now();
  const ok = Object.values(results).every((r) => r.ok);
  const failed = Object.entries(results).filter(([, r]) => !r.ok).map(([sheet, r]) => `${sheet}: ${r.error}`);
  res.status(ok ? 200 : 502).json({ ok, results, sheets: sheetsSummary(), ...(ok ? {} : { error: failed.join(" · ") }) });
});
app.get("/api/gang/admin/sheets/status", gangAuth, gangAtLeast(4), (req, res) => res.json(sheetsSummary()));

/* ---------- Realtime (SSE) ---------- */
app.get("/api/gang/events", (req, res) => {
  const actor = actorOf(req);
  if (!actor) return res.status(401).end();
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  if (res.flushHeaders) res.flushHeaders();
  res.write("retry: 5000\n\n");
  const client = { res, actor };
  gangEventClients.add(client);
  const heartbeat = setInterval(() => { try { res.write(": ping\n\n"); } catch {} }, 25000);
  if (heartbeat.unref) heartbeat.unref();
  req.on("close", () => { clearInterval(heartbeat); gangEventClients.delete(client); });
});

/* ============================================================
   11. PAGES
   ============================================================ */
app.get("/apply", (req, res) => res.sendFile(path.join(__dirname, "public", "apply.html")));
app.get("/board", (req, res) => res.sendFile(path.join(__dirname, "public", "board.html")));
app.get("/gang", (req, res) => res.sendFile(path.join(__dirname, "public", "gang.html")));
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
