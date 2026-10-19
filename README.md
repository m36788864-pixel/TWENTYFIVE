# TWENTYFIVE — Member Directory

เว็บไซต์รายชื่อสมาชิกโทนทอง-ดำ พร้อม intro animation, search/filter และหลังบ้านเพิ่ม/แก้ไข/ลบสมาชิก

## ต้องมี
- Node.js 18 ขึ้นไป
- VS Code

## รันในเครื่อง
1. แตก ZIP แล้วเปิดโฟลเดอร์ `TWENTYFIVE` ใน VS Code
2. เปิด Terminal > New Terminal
3. ติดตั้งแพ็กเกจ: `npm install`
4. ตั้งค่าตัวแปรแวดล้อมก่อนรัน

### Windows PowerShell
```powershell
$env:ADMIN_USER="admin"
$env:ADMIN_PASSWORD="ใส่รหัสผ่านที่คาดเดายากของคุณ"
$env:SESSION_SECRET="ใส่สตริงสุ่มยาวๆ ที่ไม่ซ้ำกับรหัสผ่าน"
npm start
```
5. เปิด http://localhost:3000
6. หลังบ้านอยู่ที่ http://localhost:3000/admin

ชื่อผู้ใช้เริ่มต้นคือ `admin` ส่วนรหัสผ่านคือค่าที่คุณกำหนดใน `ADMIN_PASSWORD` — ไม่มีรหัสผ่านตายตัวฝังไว้ในโค้ด

## เผยแพร่ผ่าน Render
> **สำคัญ:** `package.json` และ `server.js` ต้องอยู่ที่ราก (root) ของ repository — อัปโหลด "เนื้อในโฟลเดอร์" ไม่ใช่ทั้งโฟลเดอร์ ถ้าอัปโหลดซ้อนโฟลเดอร์ ให้ไปตั้ง Root Directory ใน Render Settings

โปรเจกต์นี้มี backend จึงไม่ใช่เว็บ static อย่างเดียว และไม่สามารถเอาไปวางบน Cloudflare Pages แบบ static ตรงๆ ได้
1. สร้าง repository ใหม่บน GitHub แล้วอัปโหลดไฟล์ทั้งหมดในโฟลเดอร์นี้ (ไม่ต้องอัปโหลด `node_modules`)
2. เข้า Render แล้วสร้าง **New Web Service** จาก repository
3. Build Command: `npm install`
4. Start Command: `npm start`
5. ใน Environment Variables ของ Render เพิ่ม:
   - `ADMIN_USER` = ชื่อผู้ใช้แอดมินที่ต้องการ
   - `ADMIN_PASSWORD` = รหัสผ่านที่เดายากและไม่ใช้ซ้ำกับบัญชีอื่น
   - `SESSION_SECRET` = สตริงสุ่มยาวๆ ที่ไม่เปิดเผย
   - `NODE_ENV` = `production`
6. Deploy แล้วเปิด URL ที่ Render ให้มา และเติม `/admin` สำหรับหลังบ้าน

## ข้อควรรู้ก่อนเปิดใช้จริง
- ข้อมูลสมาชิกถูกเก็บใน `data/members.json` เหมาะกับการทดลองหรือโฮสต์ที่เก็บไฟล์ถาวร หากโฮสต์ล้างไฟล์เมื่อ deploy/restart ข้อมูลอาจหาย ควรย้ายไปฐานข้อมูลถาวร (เช่น PostgreSQL) ก่อนใช้งานจริง
- หลังบ้านนี้มีระบบล็อกอินพื้นฐาน แต่ยังไม่มี rate limiting/ระบบรีเซ็ตรหัสผ่าน/ฐานข้อมูลถาวร ควรเพิ่มก่อนใช้กับข้อมูลสำคัญ
- รูปภาพใส่เป็น URL ที่เข้าถึงได้สาธารณะเท่านั้น อย่าใส่ข้อมูลส่วนตัวที่ไม่ต้องการเผยแพร่
- ตั้ง `ADMIN_PASSWORD` และ `SESSION_SECRET` ให้แข็งแรง ห้ามใส่ความลับลง GitHub
