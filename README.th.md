# 🚀 ChatGPT Pilot (`chatgpt-pilot`) — ภาษาไทย

[![GitHub license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Monorepo](https://img.shields.io/badge/monorepo-pnpm-orange.svg)](pnpm-workspace.yaml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/protocol-Model_Context_Protocol-purple.svg)](https://modelcontextprotocol.io/)

**ChatGPT Pilot** คือสถานีการทำงานและสะพานเชื่อมต่อ Model Context Protocol (MCP) แบบรวมศูนย์ (All-in-One Local MCP Workstation & Runtime Gateway) สำหรับเชื่อมต่อเครื่อง Local เข้ากับ ChatGPT และ Codex โดยรวมขีดความสามารถการพัฒนาทั้งหมดไว้เบื้องหลัง MCP Gateway ตัวเดียว แบ่งออกเป็น 4 เสาหลัก (Four Pillars):

```
                  ┌─────────────────────────────────────────────────────────┐
                  │                 ChatGPT / Codex Client                  │
                  └────────────────────────────┬────────────────────────────┘
                                               │
                                      Stdio / HTTP Stream
                                               │
                                               ▼
                  ┌─────────────────────────────────────────────────────────┐
                  │        ChatGPT Pilot Gateway (`apps/server`)            │
                  │   - ระบบแยก Process ทำงาน พร้อม Supervisor Circuit      │
                  │   - บันทึกประวัติและนโยบายความปลอดภัย (NDJSON Audit)     │
                  │   - Hybrid Surface (toolpy + capability_registry)       │
                  └───────┬──────────────┬──────────────┬─────────────┬─────┘
                          │              │              │             │
              ┌───────────┴───┐   ┌──────┴──────┐ ┌─────┴─────┐ ┌─────┴──────────┐
              │ 💻 Coding/Sys │   │  🧠 Think   │ │ 📚 Skills │ │   💾 Memory    │
              │  apps/server  │   │  ThinkForge │ │ Skill Hub │ │ Living Book    │
              └───────────────┘   └─────────────┘ └───────────┘ └────────────────┘
```

---

## 🌟 4 เสาหลักของระบบ (The Four Pillars)

### 1. 💻 Coding & System Execution (`apps/server`)
- **จัดการไฟล์และ Codebase**: อ่านไฟล์, แก้ไขแบบ Transactional block replacement, ค้นหาโค้ดความเร็วสูง (`read_file`, `write_file`, `edit_file`, `find_files`, `search_code`)
- **จัดการคำสั่งและ Process**: ควบคุม Process ทำงานเบื้องหลัง มี PID และ Offset ติดตาม Output สตรีมสด (`shell`, `start_process`, `read_process_output`, `process_write`, `process_wait`)
- **ระบบ Git ปลอดภัยสูง**: มีการตรวจ Verification Gate ก่อน Commit เสมอ (`git_status`, `git_diff`, `git_commit_verified`) ป้องกันการ Commit โค้ดที่รัน Test ไม่ผ่าน
- **IPython Runtime (`toolpy`)**: สภาพแวดล้อมรัน Python แบบ Stateful ในหน่วยความจำ ช่วยให้ Agent ประกอบคำสั่งหลายอย่างเข้าด้วยกันได้ใน Cell เดียว ประหยัด Token และ Latency ต่ำ

### 2. 🧠 Think: Cognitive Accelerators (`packages/thinkforge`)
- **ThinkForge MCP**: เครื่องมือช่วยคิดแบบมีโครงสร้างสำหรับ AI Agent เพื่อขยายมุมมอง, ท้าทายสมมติฐานเดิม, จัดกรอบปัญหาใหม่, และทดสอบความแข็งแกร่งของระบบ (`think_diverge`, `think_converge`, `think_challenge`, `think_reframe`, `think_perspective_swap`, `think_stress_test`)

### 3. 📚 Skills: Dynamic Skills Engine (`packages/skill-hub` + `skills/`)
- **Skill Hub Gateway**: คลังและระบบประมวลผลกระบวนการทำงานอัตโนมัติรวบรวมไว้กว่า **111+ Curated Agent Skills** (ครอบคลุมทั้ง Software Engineering, UI/UX Design, Product, DevOps และ Debugging)
- โหลดและทำงานแบบไดนามิก ไม่กินพื้นที่ Token ตอนเริ่มบทสนทนา

### 4. 💾 Memory: Living Memory Book ("สมองหนังสือ") (`packages/memory`)
- **Pure Markdown Second Brain**: สถาปัตยกรรมบันทึกความจำด้วยไฟล์ Markdown บริสุทธิ์ 100% ไม่พึ่งพา SQL หรือไฟล์ Binary ไร้ปัญหา C++ dependency บน Windows อ่านเข้าใจง่ายและ Git-friendly
- **สารบัญหลัก (`TOC.md`)**: รวบรวมหัวข้อหลัก (Chapters), หัวข้อย่อย (Subtopics) และดัชนีเวลา (Timesteps) ทั้งหมด
- **สรุปภาพรวม (`SUMMARY.md`)**: สรุป Executive Summary ของความรู้ทั้งหมดในระบบ
- **หมวดหมู่หลัก (`chapters/`)**:
  - `01-identity.md`: ข้อมูลตัวตน, รูปแบบการทำงาน, ประสบการณ์ และ preference ของ developer
  - `02-projects.md`: สรุปโปรเจกต์ที่กู้คืนและใช้งานอยู่ (Loom Agent, Clew, Oracle, ThinkForge ฯลฯ)
  - `03-architecture.md`: Architecture DNA, Persistent loops, safeguards และเทคนิคต่างๆ
  - `04-timeline.md`: ลำดับเหตุการณ์และประวัติงานตั้งแต่เริ่มต้น
- **ความจำตามช่วงเวลา (`timesteps/`)**: บันทึกเหตุการณ์ตามวันและเดือน เช่น `2026-09-05.md`, `September-2026.md` เพื่อให้เรียกดูย้อนหลัง (Temporal Recall) ได้อย่างแม่นยำ
- **Self-Seeding**: มีโฟลเดอร์ `seed/` ในตัว เมื่อนำไปรันเครื่องใหม่จะสร้างสมองเริ่มต้นให้อัตโนมัติทันที

---

## 📁 โครงสร้างโปรเจกต์ (Monorepo Layout)

```text
chatgpt-pilot/
├── .pilot/                      # โฟลเดอร์เก็บข้อมูลกลาง (Audit logs, Config, Memory)
├── apps/
│   ├── server/                  # แกนหลัก MCP Server, Tunnel Supervisor & Gateway
│   └── playground/              # ชุดทดสอบและจำลองการทำงานของนักพัฒนา
├── packages/
│   ├── memory/                  # ระบบสมองหนังสือ Markdown Living Memory Book
│   │   ├── seed/                # ไฟล์ต้นฉบับสำรอง (Identity, Projects, Architecture)
│   │   └── src/
│   │       ├── book.ts          # BrainBook Engine (TOC, Chapters, Timesteps, Search)
│   │       └── index.ts         # MCP Server entrypoint & Standalone CLI
│   ├── thinkforge/              # เครื่องมือ Cognitive Accelerators & คิดวิเคราะห์
│   ├── skill-hub/               # ประตูเชื่อมต่อและค้นหา Agent Skills
│   ├── mcp-server/              # Minimal standalone MCP server adapter
│   └── core/                    # Shared contracts, types, and schemas
├── skills/                      # 111+ กระบวนการและทักษะ Agent ขั้นสูง
├── scripts/                     # สคริปต์ควบคุมระบบและ Tunnel
└── docs/                        # เอกสารสถาปัตยกรรมและคู่มือการใช้งาน
```

---

## 🚀 เริ่มต้นใช้งานด่วน (Quick Start)

### ข้อกำหนดระบบ
- **Node.js**: `v20+` หรือ `v22+`
- **Package Manager**: `pnpm` (v9 หรือ v10)
- **ระบบปฏิบัติการ**: Windows, macOS, หรือ Linux

### 1. ติดตั้งและคอมไพล์โปรเจกต์

```bash
# Clone repository
git clone https://github.com/JonusNattapong/chatgpt-pilot.git
cd chatgpt-pilot

# ติดตั้ง dependencies และ build ทุกแพ็กเกจ
pnpm install
pnpm build
```

### 2. ตรวจสอบสถานะการเชื่อมต่อ (Zero-Config Auto Discovery)

ระบบมาพร้อมกับ **Zero-Config Discovery** ที่จะค้นหาแพ็กเกจภายในทั้งหมด (`packages/memory`, `packages/thinkforge`, `packages/skill-hub`, `skills/`) อัตโนมัติโดยไม่ต้องใส่ flag กำหนด path เอง:

```bash
# ตรวจสอบการทำงานแบบปกติ (Legacy Surface)
pnpm check

# ตรวจสอบการทำงานแบบไฮบริด (Hybrid Surface: toolpy + capability_registry)
pnpm check:hybrid
```

### 3. รันชุดทดสอบ (Unit & Integration Tests)

```bash
# ทดสอบทั้ง Monorepo (138 tests ครบถ้วน)
pnpm test
```

---

## 🛠️ การใช้งานผ่าน Command Line (CLI)

### ควบคุม Workstation และ Tunnel (`pnpm pilot`)

```bash
# เปิดใช้งาน Tunnel เชื่อมต่อไปยัง ChatGPT
pnpm pilot up

# ตรวจสอบสถานะ Tunnel และ Gateway
pnpm pilot status

# ปิดการทำงานของ Tunnel
pnpm pilot down

# ตรวจสุขภาพระบบและ Config
pnpm pilot doctor
```

### เรียกดูและจัดการสมอง (`pilot-memory`)

สามารถเรียกค้นความจำ สารบัญ หรือหัวข้อย่อยได้โดยตรงผ่าน Terminal:

```bash
# ดูสารบัญหลัก (Master Table of Contents)
node packages/memory/dist/index.js toc

# ดูสรุปภาพรวม (Executive Summary)
node packages/memory/dist/index.js summary

# อ่านบทหลัก หรือเจาะจงเฉพาะหัวข้อย่อย
node packages/memory/dist/index.js read 02-projects "Loom Agent"

# ระลึกความจำตามช่วงเวลา (Timestep)
node packages/memory/dist/index.js time 2026-09-05
node packages/memory/dist/index.js time latest

# ค้นหาข้อความในความจำทั้งหมด
node packages/memory/dist/index.js search "Jupyter runtime"

# ดูสถิติของสมอง (จำนวนบท, คำ, ขนาดไฟล์)
node packages/memory/dist/index.js stats
```

---

## 🔌 รายการ MCP Tools ทั้งหมด

### 💻 System & Coding Tools (`machine_*`)
- `read_file`: อ่านไฟล์ทั้งไฟล์ หรือระบุช่วงบรรทัด พร้อมระบุ SHA-256
- `write_file`: เขียนหรือสร้างไฟล์ใหม่พร้อมสร้างโฟลเดอร์ให้อัตโนมัติ
- `edit_file`: แก้ไขข้อความในไฟล์อย่างแม่นยำ พร้อมรายงานตำแหน่งใกล้เคียงหากไม่ตรง
- `find_files`: ค้นหาไฟล์ตาม pattern หรือนามสกุล ข้ามโฟลเดอร์ dependencies อัตโนมัติ
- `search_code`: ค้นหาข้อความหรือ regex ในโค้ดด้วย ripgrep
- `shell`: รันคำสั่ง shell ในสภาพแวดล้อมที่ควบคุม
- `start_process`: เริ่มรัน process ในเบื้องหลัง พร้อมระบบติดตาม PID และ Output offset
- `read_process_output`: อ่านผลลัพธ์ stdout/stderr เพิ่มเติมจาก process ที่กำลังทำงาน
- `process_write`: ส่ง input ไปยัง stdin ของ process
- `process_wait`: รอให้ process ทำงานเสร็จสิ้นพร้อมรับ exit code
- `git_status`: ตรวจสอบสถานะ Git working tree
- `git_diff`: แสดง unified diff ของการเปลี่ยนแปลง
- `git_commit_verified`: ตรวจสอบความถูกต้องของโปรเจกต์ (test/build) ก่อนทำ commit
- `toolpy`: รันคำสั่ง Python บน persistent IPython environment เพื่อเรียกใช้ tool อื่นๆ ร่วมกัน

### 💾 Living Memory Tools (`memory_*`)
- `memory_toc`: แสดงสารบัญหลัก (Chapters, Subtopics, Timesteps)
- `memory_summary`: อ่านบทสรุปภาพรวมของทั้งระบบ หรือเฉพาะบทที่ระบุ
- `memory_read_topic`: อ่านเนื้อหาในบท หรือดึงเฉพาะหัวข้อย่อย (Subtopic) ออกมา
- `memory_recall_time`: ระลึกความจำตามช่วงเวลา/วันที่ (เช่น `2026-09-05`, `latest`)
- `memory_search`: ค้นหาข้อความในไฟล์ความจำทั้งหมด
- `memory_remember`: บันทึกความจำ เหตุการณ์ หรือการตัดสินใจใหม่ลงใน Timestep และอัปเดตสารบัญ
- `memory_stats`: รายงานขนาดไฟล์ จำนวนคำ จำนวนบท และพาธจัดเก็บ
- `memory_recall`: ฟังก์ชันค้นหาอเนกประสงค์ (รองรับ query, topic, timestep)

### 🧠 Cognitive Tools (`think_*`)
- `think_diverge`: ขยายทางเลือกและแตกประเด็นความคิดออกไปหลากหลายทิศทาง
- `think_converge`: สรุปและคัดกรองไอเดีย จัดลำดับความสำคัญ และสังเคราะห์ข้อสรุป
- `think_challenge`: วิพากษ์สมมติฐาน ค้นหาช่องโหว่ และจุดบกพร่องที่อาจมองข้าม
- `think_reframe`: เปลี่ยนกรอบและมุมมองในการตั้งคำถามหรือโจทย์
- `think_perspective_swap`: วิเคราะห์สถานการณ์ผ่านมุมมองของตัวละคร/ผู้มีส่วนได้ส่วนเสียอื่น
- `think_stress_test`: ทดสอบความแข็งแกร่งของแผนงานเมื่อเจอสถานการณ์วิกฤตหรือโหลดสูง

### 📚 Skills Tools (`skills_*`)
- `skills_list`: แสดงรายชื่อทักษะทั้งหมด 111+ รายการในคลัง
- `skills_get_spec`: ดูรายละเอียดและขั้นตอนการทำงานของทักษะที่เลือก
- `skills_run`: สั่งรันขั้นตอนการทำงานตามทักษะที่กำหนด

---

## 🛡️ ความปลอดภัยและการควบคุม (Security & Governance)

- **Workspace Boundary Enforcement**: โหมดปลอดภัย (Safe mode) จะจำกัดการทำงานของคำสั่งและไฟล์ให้อยู่ใน Root โฟลเดอร์ของโปรเจกต์เท่านั้น
- **Supervisor Circuit Breaker**: Process การทำงานเบื้องหลังมีการส่ง heartbeat ตรวจสอบสุขภาพ และ restart ตัวเองให้อัตโนมัติเมื่อเกิดการค้างหรือแครช
- **Immutable Audit Logging**: ทุกคำสั่งและการแก้ไขไฟล์จะถูกบันทึกไว้อย่างโปร่งใสใน `.pilot/audit.ndjson`
- **Precondition Verification**: การแก้โค้ดทุกครั้งจะตรวจเช็ก hash ของไฟล์ก่อน ป้องกันการเขียนทับโดยไม่ตั้งใจ

---

## 📄 ลิขสิทธิ์ (License)

MIT © [JonusNattapong](https://github.com/JonusNattapong)
