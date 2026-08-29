# AGENTS.md

## Project purpose

โปรเจกต์นี้เป็น local MCP bridge สำหรับให้ ChatGPT Web ผ่าน OpenAI Secure MCP Tunnel และ Codex ผ่าน local stdio เข้าถึงเครื่อง Windows

เครื่องมือที่ตั้งใจรองรับมีเพียง:

- `machine_status`
- `shell_command`
- `apply_patch`

อย่าเพิ่ม `codex exec`, tool สำหรับมอบงานต่อ หรือ tool `ask` เว้นแต่ผู้ใช้ร้องขอใหม่อย่างชัดเจน

## Current installation

- Project root: `D:\Projects\Github\ChatGPTMCP`
- Default workspace: `D:\Projects\Github`
- Runtime alias: `chatgpt-machine`
- Runtime profile: `chatgpt-machine-runtime`
- ChatGPT plugin name: `ChatGPT Machine MCP`
- Codex MCP name: `chatgpt_machine`
- Tunnel client binary: `tools\tunnel-client-v0.0.13\tunnel-client.exe`
- Runtime key reference: `.tunnel\control-plane-api-key.dpapi`

รักษาชื่อและ identity เดิมของ tunnel, runtime alias, plugin และ Codex MCP เว้นแต่ผู้ใช้ขอให้เปลี่ยน ห้ามสร้าง tunnel หรือ plugin ซ้ำโดยไม่ตรวจของเดิมก่อน

## Required workflow

เมื่อแก้ source:

1. อ่านโค้ดและ tests ที่เกี่ยวข้องก่อนแก้
2. รักษา tool contract และ MCP annotations โดยเฉพาะ destructive/open-world metadata
3. รัน `npm test`
4. ถ้า behavior หรือ schema เปลี่ยน ให้ restart Tunnel และกด Refresh plugin ใน ChatGPT
5. ตรวจทั้ง `healthz` และ `readyz` และทดสอบ tool ที่เกี่ยวข้องจริงก่อนรายงานว่าสำเร็จ

อย่ารายงานว่า service พร้อมจากการมี process เพียงอย่างเดียว ต้องมี `process_running=true`, `healthy=true`, `ready=true` และ `runtime_state=ready`

## Runtime operations

ใช้ helper scripts ที่ project root:

```powershell
.\scripts\start-tunnel.ps1
.\scripts\status-tunnel.ps1
.\scripts\stop-tunnel.ps1
```

`tunnel-client v0.0.13` ไม่มีคำสั่ง `runtimes start`; การเปิดหรือเชื่อมใหม่ใช้ `runtimes connect` ห้ามเขียนเอกสารหรือ automation ให้เรียกคำสั่งที่ไม่มีอยู่

Codex ใช้ MCP ผ่าน stdio โดยตรง ไม่ต้องพึ่ง Tunnel ตรวจ config ด้วย:

```powershell
codex mcp get chatgpt_machine
```

## Secret handling

- ห้ามอ่าน แสดง คัดลอก decode หรือบันทึก plaintext runtime API key ใน output, log, source, README หรือ AGENTS
- ไฟล์ key ใช้ Windows DPAPI/`ConvertFrom-SecureString` และถูก ignore ด้วย `.gitignore`
- อนุญาตให้ helper script ถอดรหัส key เข้า environment ของ process ชั่วคราวเพื่อเปิด runtime แต่ห้ามพิมพ์ค่าออกมา
- ล้าง `CONTROL_PLANE_API_KEY` จาก process ของ script ใน `finally`
- หาก key file หายหรือถอดรหัสไม่ได้ ให้หยุดและให้ผู้ใช้สร้าง key ใหม่ ห้ามเดาหรือฝังคีย์

## Safety boundaries

โหมดติดตั้งปัจจุบันคือ `--dangerously-open-machine` ซึ่งอนุญาต arbitrary shell และ absolute paths ทั้งเครื่อง:

- ใช้ read-only check ก่อน action ที่ลบ เขียนทับ ย้าย หรือเปลี่ยน system state
- ไม่ลดระดับ confirmation/permission ของ ChatGPT plugin โดยไม่ขอผู้ใช้
- ห้ามเปิด HTTP MCP ออกจาก loopback โดยไม่มี bearer token
- ไม่ตั้ง Windows auto-start, Scheduled Task หรือ service โดยไม่ได้รับคำขอชัดเจน เพราะเป็นการทำให้ remote machine access ทำงานถาวร
- อย่าแก้หรือ commit ไฟล์ใต้ `.tunnel\`

## Documentation

เมื่อเปลี่ยน command, path, tool schema, startup behavior หรือ security boundary ให้อัปเดต `README.md` และส่วนที่เกี่ยวข้องในไฟล์นี้พร้อมกัน ตัวอย่างต้องใช้ PowerShell/Windows และต้องไม่ใส่ secret จริง
