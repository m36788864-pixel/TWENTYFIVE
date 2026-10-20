/**
 * TWENTYFIVE — ตัวรับข้อมูลจากเว็บ แล้วเขียนลง Google ชีต
 * =====================================================
 * วิธีติดตั้ง (ทำครั้งเดียว ประมาณ 3 นาที)
 *
 * 1) เปิด Google ชีตใหม่ 1 ไฟล์ (ตั้งชื่ออะไรก็ได้ เช่น TWENTYFIVE DATA)
 * 2) เมนู Extensions (ส่วนขยาย) → Apps Script
 * 3) ลบโค้ดเดิมในไฟล์ Code.gs ทั้งหมด แล้ววางโค้ดไฟล์นี้แทน
 * 4) ตั้งค่า TOKEN ด้านล่างให้ตรงกับ SHEETS_SECRET ที่ตั้งบน Render
 *    (ถ้าไม่ได้ตั้ง SHEETS_SECRET บน Render ก็ปล่อย TOKEN เป็น "" ได้)
 * 5) กด Deploy → New deployment → ไอคอนเฟือง → เลือกชนิด "Web app"
 *      - Description: TWENTYFIVE
 *      - Execute as: Me (ตัวเอง)
 *      - Who has access: Anyone (ทุกคน)
 *    กด Deploy แล้วอนุญาตสิทธิ์ให้เสร็จ จากนั้นคัดลอก URL ที่ลงท้ายด้วย /exec
 * 6) เอา URL นั้นไปตั้งเป็นตัวแปรแวดล้อมบน Render
 *      SHEETS_WEBHOOK_URL = <URL ที่คัดลอกมา>
 *      SHEETS_SECRET      = <รหัสลับอะไรก็ได้ ให้ตรงกับ TOKEN ด้านล่าง>
 *    แล้ว deploy ใหม่ — จากนี้ทุกครั้งที่มีใบสมัครใหม่/แก้รายชื่อสมาชิก
 *    ระบบจะส่งข้อมูลทั้งชุดมาเขียนทับชีตให้อัตโนมัติ
 *
 * หมายเหตุ
 * - ครั้งแรกที่ระบบส่งข้อมูลมา ถ้ายังไม่มีชีต Applications / Members ระบบจะสร้างให้เองพร้อมหัวตาราง
 * - ไฟล์นี้ยังเก็บ "สำเนาข้อมูลดิบ" ไว้ในชีตลับชื่อ _raw ด้วย → เว็บกู้ข้อมูลกลับได้ครบถ้วน
 *   (อย่าลบชีต _raw ไม่งั้นกู้คืนไม่ได้ — แก้ไขชีต Applications/Members ด้วยมือไม่มีผลกับเว็บ)
 * - แก้โค้ดแล้วต้อง Deploy → Manage deployments → แก้ไขเวอร์ชัน → Deploy ใหม่ทุกครั้ง
 */

/* ใส่รหัสลับให้ตรงกับ SHEETS_SECRET บน Render — ถ้าไม่ใช้ก็เว้นว่างไว้ */
const TOKEN = "";

/* ชีตลับที่เก็บสำเนาข้อมูลดิบไว้กู้คืน (ห้ามลบ) */
const RAW_SHEET = "_raw";
/* ขนาดก้อนข้อมูลต่อเซลล์ (Google ชีตจำกัด 50,000 ตัวอักษรต่อช่อง) */
const CHUNK = 40000;

/* หัวตารางของแต่ละชีต — ลำดับต้องตรงกับที่เซิร์ฟเวอร์ส่งมา (ไม่ต้องแก้) */
const SHEETS = {
  Applications: [
    "ลำดับ", "รหัส", "ชื่อ IC", "อายุ IC", "เฟส IC", "ดิสคอร์ด", "ลิงก์ไดรฟ์", "รายละเอียดแนะนำตัว",
    "สถานะใบสมัคร", "วันที่สมัคร", "วันที่ตัดสิน", "เหตุผลที่แจ้ง", "ชื่อผู้ใช้บอร์ด", "สถานะส่ง DM"
  ],
  Members: [
    "ลำดับ", "รหัส", "ชื่อ IC", "ตำแหน่ง", "หมวด", "อายุ IC", "เฟส IC", "ดิสคอร์ด", "ลิงก์ไดรฟ์",
    "คำโปรย", "รายละเอียด", "สถานะแก๊ง", "วันที่สมัคร", "วันที่รับเข้า",
    "ชื่อผู้ใช้บอร์ด", "รหัสผ่านบอร์ด", "อัปเดตรหัสเมื่อ"
  ]
};

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    if (TOKEN && body.token !== TOKEN) return json({ ok: false, error: "token ไม่ถูกต้อง" });

    const columns = SHEETS[body.sheet];
    if (!columns) return json({ ok: false, error: "ไม่รู้จักชีต: " + body.sheet });

    const book = SpreadsheetApp.getActiveSpreadsheet();
    const rows = writePretty(book, body.sheet, columns, body.rows || []);
    writeRaw(book, body.sheet, {
      version: body.version || 1,
      sheet: body.sheet,
      at: body.at || new Date().toISOString(),
      data: body.data || null
    });

    return json({ ok: true, sheet: body.sheet, rows: rows, at: body.at, url: book.getUrl() });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

/* เขียนตารางที่อ่านง่าย (เขียนทับทั้งชีต) */
function writePretty(book, name, columns, incoming) {
  const sheet = book.getSheetByName(name) || book.insertSheet(name);
  const width = columns.length;
  const rows = [columns].concat(incoming).map(function (row) {
    return columns.map(function (_, i) {
      const cell = row[i];
      return cell === undefined || cell === null ? "" : cell;
    });
  });
  sheet.clear();
  sheet.getRange(1, 1, rows.length, width).setValues(rows);
  sheet.getRange(1, 1, 1, width).setFontWeight("bold").setBackground("#efefef");
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, width);
  if (sheet.isSheetHidden()) sheet.showSheet();
  return rows.length - 1;
}

/* เก็บสำเนาข้อมูลดิบ (JSON) ลงชีตลับแบบแบ่งก้อน ๆ */
function writeRaw(book, name, payload) {
  const sheet = book.getSheetByName(RAW_SHEET) || book.insertSheet(RAW_SHEET);
  const text = JSON.stringify(payload);
  const chunks = [];
  for (let i = 0; i < text.length; i += CHUNK) chunks.push(text.slice(i, i + CHUNK));

  const lastRow = sheet.getLastRow();
  const existing = lastRow ? sheet.getRange(1, 1, lastRow, 3).getValues() : [];
  const others = existing.filter(function (row) { return row[0] && row[0] !== name; });   // เก็บของชีตอื่นไว้
  const next = others.concat(chunks.map(function (chunk, i) { return [name, i, chunk]; }));

  sheet.clear();
  if (next.length) sheet.getRange(1, 1, next.length, 3).setValues(next);
  try { sheet.hideSheet(); } catch (err) {}
}

/* อ่านสำเนาข้อมูลดิบกลับมา */
function readRaw(book) {
  const sheet = book.getSheetByName(RAW_SHEET);
  const lastRow = sheet ? sheet.getLastRow() : 0;
  if (!lastRow) return {};
  const values = sheet.getRange(1, 1, lastRow, 3).getValues();
  const grouped = {};
  values.forEach(function (row) {
    const name = row[0];
    if (!name) return;
    if (!grouped[name]) grouped[name] = [];
    grouped[name].push({ i: Number(row[1]) || 0, chunk: String(row[2] === undefined || row[2] === null ? "" : row[2]) });
  });
  const out = {};
  Object.keys(grouped).forEach(function (name) {
    const text = grouped[name].sort(function (a, b) { return a.i - b.i; }).map(function (c) { return c.chunk; }).join("");
    try { out[name] = JSON.parse(text); } catch (err) { out[name] = null; }
  });
  return out;
}

function doGet(e) {
  const params = (e && e.parameter) || {};
  if (params.action === "raw") {
    if (TOKEN && params.token !== TOKEN) return json({ ok: false, error: "token ไม่ถูกต้อง" });
    const book = SpreadsheetApp.getActiveSpreadsheet();
    const raw = readRaw(book);
    const items = {};
    Object.keys(raw).forEach(function (name) {
      const entry = raw[name];
      if (entry && entry.data) items[name] = { at: entry.at || "", data: entry.data };
    });
    return json({ ok: true, items: items, url: book.getUrl() });
  }
  return json({ ok: true, message: "TWENTYFIVE sheet endpoint พร้อมใช้งาน" });
}

function json(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
