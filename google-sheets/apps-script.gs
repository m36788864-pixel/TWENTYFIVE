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
 *    ระบบจะส่งข้อมูลมา "อัปเดตต่อ" ในชีตให้อัตโนมัติ (แถวเดิมแก้ในที่เดิม แถวใหม่ต่อท้าย ไม่ล้างแล้วลงใหม่)
 *
 * หมายเหตุ
 * - ครั้งแรกที่ระบบส่งข้อมูลมา ถ้ายังไม่มีชีต Applications / Members ระบบจะสร้างให้เองพร้อมหัวตาราง
 * - ไฟล์นี้ยังเก็บ "สำเนาข้อมูลดิบ" ไว้ในชีตลับชื่อ _raw ด้วย → เว็บกู้ข้อมูลกลับได้ครบถ้วน
 *   (อย่าลบชีต _raw ไม่งั้นกู้คืนไม่ได้ — แก้ไขชีต Applications/Members ด้วยมือไม่มีผลกับเว็บ)
 * - แก้โค้ดแล้วต้อง Deploy → Manage deployments → แก้ไขเวอร์ชัน → Deploy ใหม่ทุกครั้ง
 */

/* ใส่รหัสลับให้ตรงกับ SHEETS_SECRET บน Render — ถ้าไม่ใช้ก็เว้นว่างไว้ */
const TOKEN = "";

/* ชีตลับที่เก็บสำเนาข้อมูลดิบไว้กู้คืน (ห้ามลบ)
   _raw2 = แบบใหม่ เก็บทีละรายการ (อัปเดตต่อได้) · _raw = แบบเก่าทั้งก้อน (ยังอ่านได้ ถ้ายังไม่มี _raw2) */
const RAW_SHEET = "_raw2";
const LEGACY_RAW_SHEET = "_raw";
const META_ID = "__meta__";
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
    const remove = (body.remove || []).map(String);
    const rows = upsertPretty(book, body.sheet, columns, body.rows || [], remove);
    if (Array.isArray(body.data)) upsertRaw(book, body.sheet, body.data, remove, body.at || new Date().toISOString());

    return json({ ok: true, sheet: body.sheet, rows: rows, at: body.at, url: book.getUrl() });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

/* ตารางที่อ่านง่าย — อัปเดตต่อตามรหัส (คอลัมน์ B)
   แถวเดิม = แก้ในที่เดิม · แถวใหม่ = ต่อท้าย · รหัสที่ถูกลบบนเว็บ = ลบแถวนั้น · ไม่ล้างทั้งชีต */
function upsertPretty(book, name, columns, incoming, remove) {
  const sheet = book.getSheetByName(name) || book.insertSheet(name);
  const width = columns.length;
  const clean = function (row) {
    return columns.map(function (_, i) {
      const cell = row[i];
      return cell === undefined || cell === null ? "" : cell;
    });
  };

  if (sheet.getLastRow() < 1) {
    sheet.getRange(1, 1, 1, width).setValues([columns]).setFontWeight("bold").setBackground("#efefef");
    sheet.setFrozenRows(1);
  }

  const last = sheet.getLastRow();
  const existingIds = last > 1 ? sheet.getRange(2, 2, last - 1, 1).getValues() : [];
  const rowOf = {};
  existingIds.forEach(function (r, i) { if (r[0] !== "") rowOf[String(r[0])] = i + 2; });

  const toAppend = [];
  incoming.forEach(function (raw) {
    const row = clean(raw);
    const id = String(row[1]);
    if (rowOf[id]) sheet.getRange(rowOf[id], 1, 1, width).setValues([row]);
    else toAppend.push(row);
  });
  if (toAppend.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, toAppend.length, width).setValues(toAppend);
  }

  // ลบแถวของรายการที่ถูกลบบนเว็บ (ลบจากล่างขึ้นบนไม่ให้เลขแถวเพี้ยน)
  const dead = remove.map(function (id) { return rowOf[id]; }).filter(Boolean).sort(function (x, y) { return y - x; });
  dead.forEach(function (r) { sheet.deleteRow(r); });

  // เรียงเลขลำดับ (คอลัมน์ A) ใหม่ให้ต่อเนื่อง
  const total = sheet.getLastRow() - 1;
  if (total > 0) {
    const nums = [];
    for (let i = 1; i <= total; i++) nums.push([i]);
    sheet.getRange(2, 1, total, 1).setValues(nums);
  }
  if (sheet.isSheetHidden()) sheet.showSheet();
  return Math.max(0, total);
}

/* สำเนาข้อมูลดิบ — เก็บทีละรายการ (ชีตลับ _raw2) คอลัมน์: ชีต | รหัส | ก้อนที่ | ลำดับ | ข้อมูล JSON | เวลา
   อัปเดตเฉพาะรายการที่ส่งมา รายการอื่นไม่ถูกแตะ */
function upsertRaw(book, name, data, remove, at) {
  const sheet = book.getSheetByName(RAW_SHEET) || book.insertSheet(RAW_SHEET);
  const last = sheet.getLastRow();
  const rows = last ? sheet.getRange(1, 1, last, 6).getValues().filter(function (r) { return r[0]; }) : [];

  const removeSet = {};
  remove.forEach(function (id) { removeSet[id] = true; });
  const kept = rows.filter(function (r) { return !(r[0] === name && removeSet[String(r[1])]); });

  const pos = {};
  kept.forEach(function (r, i) { pos[r[0] + "|" + r[1] + "|" + r[2]] = i; });

  data.forEach(function (item, order) {
    const id = String(item && item.id !== undefined && item.id !== null ? item.id : "#" + order);
    const text = JSON.stringify(item);
    const chunks = [];
    for (let i = 0; i < text.length; i += CHUNK) chunks.push(text.slice(i, i + CHUNK));
    if (!chunks.length) chunks.push("");
    chunks.forEach(function (chunk, idx) {
      const row = [name, id, idx, order, chunk, at];
      const key = name + "|" + id + "|" + idx;
      if (pos[key] !== undefined) kept[pos[key]] = row;
      else { pos[key] = kept.length; kept.push(row); }
    });
    // ก้อนเก่าที่เกินมา (รายการสั้นลง) → ทำให้ว่างเพื่อกรองทิ้ง
    for (let idx = chunks.length; pos[name + "|" + id + "|" + idx] !== undefined; idx++) {
      kept[pos[name + "|" + id + "|" + idx]] = null;
    }
  });

  // แถวตัวบอกว่าชีตนี้มีสำเนาแล้ว (แม้ไม่มีรายการเลย เช่น ใบสมัคร 0 ฉบับ)
  const metaKey = name + "|" + META_ID + "|0";
  const metaRow = [name, META_ID, 0, -1, "", at];
  if (pos[metaKey] !== undefined) kept[pos[metaKey]] = metaRow;
  else kept.push(metaRow);

  const next = kept.filter(function (r) { return r; });
  if (next.length) sheet.getRange(1, 1, next.length, 6).setValues(next);
  if (last > next.length) sheet.getRange(next.length + 1, 1, last - next.length, 6).clearContent();   // ล้างเฉพาะท้ายตารางที่เกิน
  try { sheet.hideSheet(); } catch (err) {}
}

/* อ่านสำเนาข้อมูลดิบกลับมา — รวมรูปแบบใหม่ (_raw2) กับแบบเก่า (_raw) ตามรหัส
   รายการที่อยู่ใน _raw2 ใช้ตัวนั้นก่อน รายการที่มีเฉพาะใน _raw (เช่น สมาชิกที่ส่งไว้ก่อนอัปเดตโค้ด) จะถูกต่อท้ายเข้ามา
   → ไม่มีรายการเก่าตกหล่นเพราะสลับมาใช้ _raw2 */
function readRaw(book) {
  const out = readRawItems(book);
  const legacy = readRawLegacy(book);
  Object.keys(legacy).forEach(function (name) {
    if (!out[name]) { out[name] = legacy[name]; return; }
    const have = {};
    out[name].data.forEach(function (item) { if (item && item.id !== undefined && item.id !== null) have[String(item.id)] = true; });
    legacy[name].data.forEach(function (item) {
      if (item && item.id !== undefined && item.id !== null && !have[String(item.id)]) out[name].data.push(item);
    });
  });
  return out;
}

function readRawItems(book) {
  const sheet = book.getSheetByName(RAW_SHEET);
  const lastRow = sheet ? sheet.getLastRow() : 0;
  if (!lastRow) return {};
  const values = sheet.getRange(1, 1, lastRow, 6).getValues();
  const bySheet = {};
  values.forEach(function (row) {
    const name = row[0];
    if (!name) return;
    const id = String(row[1]);
    if (!bySheet[name]) bySheet[name] = {};
    if (id === META_ID) return;            // แค่ตัวบอกว่ามีสำเนา ไม่ใช่ข้อมูลจริง
    if (!bySheet[name][id]) bySheet[name][id] = { order: Number(row[3]) || 0, at: String(row[5] || ""), chunks: [] };
    bySheet[name][id].chunks.push({ i: Number(row[2]) || 0, chunk: String(row[4] === undefined || row[4] === null ? "" : row[4]) });
  });
  const out = {};
  Object.keys(bySheet).forEach(function (name) {
    const entries = Object.keys(bySheet[name]).map(function (id) { return bySheet[name][id]; })
      .sort(function (a, b) { return a.order - b.order; });
    const data = [];
    let at = "";
    entries.forEach(function (entry) {
      const text = entry.chunks.sort(function (a, b) { return a.i - b.i; }).map(function (c) { return c.chunk; }).join("");
      try { data.push(JSON.parse(text)); } catch (err) {}
      if (entry.at > at) at = entry.at;
    });
    out[name] = { at: at, data: data };
  });
  return out;
}

/* แบบเก่า: ทั้งก้อนใน _raw (อ่านอย่างเดียว เผื่อยังไม่เคยส่งด้วยโค้ดใหม่) */
function readRawLegacy(book) {
  const sheet = book.getSheetByName(LEGACY_RAW_SHEET);
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
    try {
      const entry = JSON.parse(text);
      if (entry && entry.data) out[name] = { at: entry.at || "", data: entry.data };
    } catch (err) {}
  });
  return out;
}

function doGet(e) {
  const params = (e && e.parameter) || {};
  if (params.action === "raw") {
    if (TOKEN && params.token !== TOKEN) return json({ ok: false, error: "token ไม่ถูกต้อง" });
    const book = SpreadsheetApp.getActiveSpreadsheet();
    const items = readRaw(book);
    return json({ ok: true, items: items, url: book.getUrl() });
  }
  return json({ ok: true, message: "TWENTYFIVE sheet endpoint พร้อมใช้งาน" });
}

function json(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
