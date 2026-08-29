# ChatGPT Machine MCP

MCP bridge สำหรับให้ ChatGPT Web และ Codex ใช้ shell และแก้ไขไฟล์บนเครื่อง Windows เครื่องนี้ผ่าน OpenAI Secure MCP Tunnel

ระบบที่ติดตั้งอยู่ใช้ workspace เริ่มต้น `D:\Projects\Github` และเปิดโหมด `UNRESTRICTED_MACHINE` จึงสามารถเข้าถึง path อื่นในเครื่องและรันคำสั่ง arbitrary shell ได้ตามสิทธิ์ของบัญชี Windows ปัจจุบัน

## สถานะที่ติดตั้งแล้ว

- MCP server: `D:\Projects\Github\ChatGPTMCP\dist\index.js`
- Tunnel client: `tools\tunnel-client-v0.0.13\tunnel-client.exe`
- Runtime alias: `chatgpt-machine`
- Tunnel: `ChatGPT Machine MCP`
- ChatGPT app/plugin: `ChatGPT Machine MCP` (Developer mode)
- Codex MCP name: `chatgpt_machine`
- Runtime key: เก็บแบบ Windows DPAPI ที่ `.tunnel\control-plane-api-key.dpapi`

ไฟล์ DPAPI ถอดรหัสได้เฉพาะบัญชี Windows ที่สร้างไฟล์นี้บนเครื่องนี้ ไม่ควร commit หรือส่งไฟล์ดังกล่าวให้ผู้อื่น

## เครื่องมือที่ ChatGPT และ Codex ใช้ได้

- `machine_status` — อ่าน platform, workspace และ access mode
- `shell_command` — รัน PowerShell, cmd หรือ Bash
- `apply_patch` — เพิ่ม แก้ ย้าย หรือลบไฟล์ด้วย Codex patch format

ไม่มี tool `ask` และไม่มีการมอบงานให้ `codex exec` ตัว MCP ทำงานกับเครื่องโดยตรง

## ใช้งานประจำวัน

เปิด PowerShell ที่โฟลเดอร์โปรเจกต์:

```powershell
cd D:\Projects\Github\ChatGPTMCP
```

### เปิด Tunnel

```powershell
.\scripts\start-tunnel.ps1
```

สคริปต์จะถอดรหัส runtime key จาก DPAPI เข้า environment ของ process ชั่วคราว เรียก `tunnel-client runtimes connect` และตรวจ `healthz`/`readyz` ให้ คีย์จะไม่ถูกพิมพ์ออกหน้าจอ

### เช็กสถานะ

```powershell
.\scripts\status-tunnel.ps1
```

พร้อมใช้งานเมื่อผลลัพธ์มีค่าต่อไปนี้:

```text
process_running : True
healthy         : True
ready           : True
runtime_state   : ready
```

หน้า runtime ภายในเครื่องดูได้ที่ URL `ui_url` จากผลลัพธ์ status โดยปัจจุบันมักเป็น `http://127.0.0.1:50988/ui`

### ปิด Tunnel

```powershell
.\scripts\stop-tunnel.ps1
```

เมื่อปิดแล้ว ChatGPT Web จะยังเห็น plugin แต่เรียก tools ในเครื่องไม่ได้จนกว่าจะเปิด Tunnel ใหม่

### หลังเปิดเครื่องหรือรีสตาร์ต Windows

ระบบยังไม่ได้ตั้ง Windows auto-start ให้เปิด PowerShell แล้วรัน:

```powershell
cd D:\Projects\Github\ChatGPTMCP
.\scripts\start-tunnel.ps1
```

## ใช้จาก ChatGPT Web

1. เปิด [ChatGPT](https://chatgpt.com/) และเลือกโหมด **Work**
2. กด **เพิ่มไฟล์และอื่นๆ**
3. พิมพ์ค้นหา `ChatGPT Machine MCP` แล้วเลือก plugin
4. พิมพ์งานที่ต้องการ เช่น:

```text
ใช้ machine_status ตรวจการเชื่อมต่อเท่านั้น
```

```text
ใช้ shell_command ตรวจ git status ที่ D:\Projects\Github\my-project ห้ามแก้ไฟล์
```

```text
ตรวจโปรเจกต์ D:\Projects\Github\my-project แล้วแก้ bug นี้ให้ พร้อมรันทดสอบ
```

ChatGPT ตั้งสิทธิ์ plugin เป็น **อนุญาตคำสั่งที่เสี่ยงต่ำ** ตามค่าเริ่มต้น การใช้ `shell_command` หรือ `apply_patch` ที่มีความเสี่ยงอาจแสดงหน้าต่างให้ผู้ใช้ยืนยันก่อน

## ใช้จาก Codex

MCP ถูกเพิ่มไว้ใน Codex global config แล้ว ตรวจได้ด้วย:

```powershell
codex mcp get chatgpt_machine
```

Codex เรียก MCP นี้ผ่าน stdio โดยตรง จึงไม่จำเป็นต้องเปิด Secure Tunnel สำหรับการใช้จาก Codex เอง แต่ต้องมี build ใน `dist` ที่เป็นเวอร์ชันล่าสุด หากแก้ source ให้รัน `npm run build` แล้วเปิด task/Codex ใหม่เพื่อโหลด tools ใหม่

## ติดตั้งหรือสร้างใหม่บนเครื่องอื่น

ต้องมี Node.js 20 ขึ้นไป จากนั้นติดตั้งและ build:

```powershell
cd D:\Projects\Github\ChatGPTMCP
npm install
npm run build
npm test
```

ตรวจ config ของ MCP:

```powershell
node dist\index.js --check --root D:\Projects\Github --dangerously-open-machine
```

จากนั้นต้องทำขั้นตอนที่ผูกกับบัญชีใหม่:

1. สร้าง Secure MCP Tunnel ใน OpenAI Platform
2. สร้าง runtime API key และเก็บแบบ DPAPI ห้ามใส่ plaintext ใน repo
3. สร้าง tunnel-client profile ให้รัน MCP command นี้:

```text
node D:/Projects/Github/ChatGPTMCP/dist/index.js --root D:/Projects/Github --dangerously-open-machine
```

4. รัน `tunnel-client doctor` และยืนยันว่า dependency checks ผ่าน
5. เปิด Developer mode ใน ChatGPT Web
6. สร้าง plugin แบบ Connection = Tunnel, Authentication = None แล้วเชื่อม plugin
7. ยืนยันว่า ChatGPT สแกนพบทั้งสาม tools และทดสอบ `machine_status`
8. เพิ่ม local stdio MCP ใน Codex หากต้องการใช้ MCP ตัวเดียวกันจาก Codex

อย่าคัดลอก tunnel ID, organization ID, workspace ID หรือ key จากเครื่องนี้ไปใช้กับบัญชีอื่นโดยไม่ตรวจสอบเจ้าของและ scope ใหม่

## พัฒนาและทดสอบ MCP

ติดตั้ง dependency และ build:

```powershell
npm install
npm run build
```

รันทดสอบทั้งหมด:

```powershell
npm test
```

รัน stdio MCP แบบจำกัดอยู่ใต้ root:

```powershell
node dist\index.js --root D:\Projects\Github
```

รัน stdio MCP แบบเปิดทั้งเครื่อง:

```powershell
node dist\index.js --root D:\Projects\Github --dangerously-open-machine
```

ทดสอบ Streamable HTTP เฉพาะ loopback:

```powershell
node dist\index.js --http --http-port 8787 --root D:\Projects\Github --dangerously-open-machine
Invoke-RestMethod http://127.0.0.1:8787/healthz
```

หาก bind ออกจาก loopback ต้องตั้ง `--http-token` หรือ `MCP_HTTP_TOKEN` เสมอ ห้ามเปิดพอร์ต MCP ที่ไม่มี authentication สู่อินเทอร์เน็ต

## แก้ปัญหา

### ChatGPT เห็น plugin แต่เรียก tool ไม่ได้

```powershell
.\scripts\status-tunnel.ps1
.\scripts\start-tunnel.ps1
```

ถ้ายังไม่พร้อม ให้ตรวจละเอียด:

```powershell
.\tools\tunnel-client-v0.0.13\tunnel-client.exe doctor `
  --profile chatgpt-machine-runtime `
  --profile-dir "$env:APPDATA\tunnel-client" `
  --explain
```

### แก้ source แล้ว ChatGPT ยังใช้ behavior เดิม

```powershell
npm test
.\scripts\stop-tunnel.ps1
.\scripts\start-tunnel.ps1
```

จากนั้นเปิดรายละเอียด plugin ใน ChatGPT แล้วกด **รีเฟรช** เพื่อสแกน tool schema ใหม่

### ต้องการตัดสิทธิ์ทันที

รัน `.\scripts\stop-tunnel.ps1` เพื่อตัดเส้นทางจาก ChatGPT Web และกด **ตัดการเชื่อมต่อ** ในหน้า plugin หากต้องการเพิกถอนการเชื่อมต่อระดับบัญชีด้วย

## Security

- ผู้ที่สั่งงาน plugin นี้ได้อาจมีสิทธิ์เทียบเท่าบัญชี Windows ปัจจุบัน
- อย่าใส่ API key, token หรือ password ใน prompt, log, source code หรือ README
- `.tunnel\` ถูก ignore จาก Git แล้ว
- ตรวจ path และคำสั่งก่อนอนุมัติ action ที่เป็น destructive
- ใช้ Secure MCP Tunnel เท่านั้นสำหรับ ChatGPT Web และไม่ควรเปิด local MCP port สู่ public internet
- หากสงสัยว่าคีย์รั่ว ให้ revoke/rotate key ใน OpenAI Platform แล้วสร้างไฟล์ DPAPI ใหม่
