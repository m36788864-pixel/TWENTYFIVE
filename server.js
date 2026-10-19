const express = require("express");
const session = require("express-session");
const { Store } = require("express-session");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET;
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "members.json");

if (!ADMIN_PASSWORD || !SESSION_SECRET) {
  console.warn("IMPORTANT: Set ADMIN_PASSWORD and SESSION_SECRET environment variables before public deployment.");
}
fs.mkdirSync(DATA_DIR, { recursive: true });
const UPLOAD_DIR = path.join(__dirname, "public", "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify([
    { id: 1, name: "TWENTYFIVE", role: "FOUNDER", group: "BOSS", image: "", description: "ตัวอย่างสมาชิก — แก้ไขหรือลบได้จากหลังบ้าน" },
    { id: 2, name: "MEMBER 01", role: "MEMBER", group: "MEMBER", image: "", description: "ตัวอย่างข้อมูลสมาชิก" },
    { id: 3, name: "MEMBER 02", role: "MEMBER", group: "MEMBER", image: "", description: "ตัวอย่างข้อมูลสมาชิก" }
  ], null, 2));
}
const readMembers = () => JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
const writeMembers = (data) => fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
const cleanUrl = (value) => {
  const url = String(value || "").trim().slice(0, 1000);
  return /^https?:\/\//i.test(url) ? url : "";
};

// File-backed session store: sessions survive server restarts (e.g. Render cold-start / redeploy wake)
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

const adminOnly = (req, res, next) => req.session && req.session.admin ? next() : res.status(401).json({ error: "กรุณาเข้าสู่ระบบแอดมินก่อน" });

app.get("/api/members", (req, res) => res.json(readMembers()));
app.post("/api/login", (req, res) => {
  const { username, password } = req.body || {};
  if (!ADMIN_PASSWORD || !SESSION_SECRET) return res.status(503).json({ error: "เซิร์ฟเวอร์ยังไม่ได้ตั้งค่า ADMIN_PASSWORD และ SESSION_SECRET" });
  if (username !== ADMIN_USER || password !== ADMIN_PASSWORD) return res.status(401).json({ error: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" });
  req.session.admin = true;
  res.json({ ok: true });
});
app.get("/api/session", (req, res) => res.json({ authenticated: !!(req.session && req.session.admin) }));
app.post("/api/logout", (req, res) => req.session.destroy(() => res.json({ ok: true })));

const IMAGE_TYPES = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif" };
app.post("/api/upload", adminOnly, (req, res) => {
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
app.post("/api/members", adminOnly, (req, res) => {
  const { name, role, group, image, description, discord, facebook, tiktok } = req.body || {};
  if (!String(name || "").trim()) return res.status(400).json({ error: "กรุณาใส่ชื่อสมาชิก" });
  const members = readMembers();
  const member = {
    id: Date.now(),
    name: String(name).trim().slice(0, 80),
    role: String(role || "MEMBER").trim().slice(0, 40),
    group: String(group || "MEMBER").trim().slice(0, 40),
    image: String(image || "").trim().slice(0, 1000),
    description: String(description || "").trim().slice(0, 240),
    discord: cleanUrl(discord),
    facebook: cleanUrl(facebook),
    tiktok: cleanUrl(tiktok)
  };
  members.unshift(member); writeMembers(members); res.status(201).json(member);
});
app.put("/api/members/:id", adminOnly, (req, res) => {
  const members = readMembers();
  const index = members.findIndex(m => String(m.id) === String(req.params.id));
  if (index < 0) return res.status(404).json({ error: "ไม่พบสมาชิก" });
  const body = req.body || {};
  members[index] = { ...members[index],
    name: String(body.name ?? members[index].name).trim().slice(0, 80),
    role: String(body.role ?? members[index].role).trim().slice(0, 40),
    group: String(body.group ?? members[index].group).trim().slice(0, 40),
    image: String(body.image ?? members[index].image).trim().slice(0, 1000),
    description: String(body.description ?? members[index].description).trim().slice(0, 240),
    discord: cleanUrl(body.discord ?? members[index].discord),
    facebook: cleanUrl(body.facebook ?? members[index].facebook),
    tiktok: cleanUrl(body.tiktok ?? members[index].tiktok)
  };
  writeMembers(members); res.json(members[index]);
});
app.delete("/api/members/:id", adminOnly, (req, res) => {
  const members = readMembers();
  const next = members.filter(m => String(m.id) !== String(req.params.id));
  if (next.length === members.length) return res.status(404).json({ error: "ไม่พบสมาชิก" });
  writeMembers(next); res.json({ ok: true });
});
app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(PORT, () => console.log(`TWENTYFIVE running on http://localhost:${PORT}`));
