# ChatGPT Machine MCP

[English](README.md) | **ไทย**

ใช้ ChatGPT Web เชื่อมต่อกับเครื่อง Windows ที่เชื่อถือได้ผ่าน OpenAI Secure MCP Tunnel เพื่อให้ ChatGPT สามารถตรวจสอบ แก้ไข build และควบคุมงานบนเครื่องผ่าน MCP tools ที่กำหนดไว้อย่างชัดเจน

README นี้เป็นคู่มือการติดตั้ง สำหรับรายละเอียดเรื่อง tools, architecture, transport, security และการพัฒนา ดู **[คู่มือเชิงเทคนิคภาษาไทย](https://jonusnattapong.github.io/ChatGPTMCP/index.th.html)**

## สิ่งที่ต้องมี

- Windows 10/11 หรือ macOS (Apple Silicon / Intel)
- Node.js 20 ขึ้นไป
- Git
- GitHub CLI (`gh`)
- บัญชี ChatGPT ที่สามารถใช้ custom MCP apps/connectors ได้
- OpenAI Platform organization ที่สามารถสร้าง Secure MCP Tunnel ได้

## การติดตั้ง

### 1. Clone และตรวจสอบโปรเจกต์

```powershell
Set-Location D:\Projects\Github
gh repo clone JonusNattapong/ChatGPTMCP
Set-Location D:\Projects\Github\ChatGPTMCP
npm install
npm test
```

### 2. ดาวน์โหลด `tunnel-client`

ไฟล์ binary นี้ตั้งใจไม่เก็บไว้ใน Git repository

```powershell
New-Item -ItemType Directory -Force tools\tunnel-client-v0.0.13 | Out-Null
gh release download v0.0.13 --repo openai/tunnel-client --pattern tunnel-client-v0.0.13-windows-amd64.zip --dir tools
Expand-Archive -LiteralPath tools\tunnel-client-v0.0.13-windows-amd64.zip -DestinationPath tools\tunnel-client-v0.0.13 -Force
Test-Path tools\tunnel-client-v0.0.13\tunnel-client.exe
```

![ดาวน์โหลด tunnel-client](docs/tunnel-client-release-annotated.png)

### 3. สร้าง Tunnel

เปิด OpenAI Platform → Organization settings → **Tunnels** → **Create tunnel** แล้วตั้งชื่อ เช่น `ChatGPT Machine MCP`

![หน้า OpenAI Tunnels](docs/tunnel-page-annotated.png)

สำหรับ tunnel ใหม่ ให้อัปเดต `--tunnel-id` และ `--organization-id` ใน [scripts/start-tunnel.ps1](scripts/start-tunnel.ps1) และอย่าเก็บ runtime API key ไว้ใน source control

### 4. เก็บ Runtime Key ไว้ในเครื่องอย่างปลอดภัย

```powershell
New-Item -ItemType Directory -Force .tunnel | Out-Null
$secureKey = Read-Host 'OpenAI tunnel runtime API key' -AsSecureString
ConvertFrom-SecureString $secureKey | Set-Content .tunnel\control-plane-api-key.dpapi
```

คำสั่งนี้เข้ารหัส key ด้วย Windows DPAPI สำหรับ Windows user ปัจจุบัน โดยโฟลเดอร์ `.tunnel` ถูก ignore จาก Git อยู่แล้ว

### 5. เริ่มการเชื่อมต่อ

ติดตั้ง/link CLI จาก repository เพียงครั้งเดียว:

```powershell
npm install
npm link
```

จากนั้นใช้งานผ่าน operator CLI:

```powershell
chatgpt-local setup
chatgpt-local up
chatgpt-local status
```

คำสั่ง lifecycle และ diagnostics หลัก:

```text
chatgpt-local up
chatgpt-local down
chatgpt-local start   # เปิด Tunnel (ใช้ on หรือ up ได้)
chatgpt-local stop    # ปิด Tunnel และ watchdog (ใช้ off หรือ down ได้)
chatgpt-local restart
chatgpt-local status
chatgpt-local machine list
chatgpt-local doctor
chatgpt-local check
chatgpt-local config show
chatgpt-local version
```

คำสั่งใน `scripts/` ยังใช้สำหรับ debug ได้ แต่การใช้งานปกติควรใช้ `chatgpt-local`

`chatgpt-local setup` จะสร้าง `.chatgpt-machine/config.json` แบบ local และถูก Git ignore ไว้ ใช้กำหนด workspace root, access mode แบบ `workspace` หรือ `unrestricted`, policy, approval mode และ hard deadline ของ supervisor ตรวจค่าที่ใช้อยู่ด้วย `chatgpt-local config show` และคืนค่า default ด้วย `config reset`

ฝั่ง tunnel จะเข้า MCP ผ่าน `dist/supervisor.js` ซึ่งรัน `dist/index.js` เป็น worker แยก process หาก worker crash หรือค้างเกิน hard deadline supervisor จะคืน recoverable error, restart worker, replay MCP initialization และรักษา tunnel process หลักไว้ `chatgpt-local status` จะแสดง worker generation และจำนวน restart จาก `.chatgpt-machine/supervisor.json` ด้วย

ขณะ tunnel ทำงาน watchdog บนเครื่องจะตรวจ managed runtime ทุก 15 วินาที หาก status ล้มเหลวติดต่อกัน 2 ครั้ง จะ reconnect tunnel และเก็บ diagnostics แบบจำกัดขนาดไว้ที่ `.tunnel/watch-tunnel.log`; คำสั่ง `chatgpt-local down` จะหยุด watchdog ก่อนเสมอ จึงไม่มีการเปิด tunnel กลับหลังจากผู้ใช้สั่งปิดเอง.

ดำเนินการต่อเมื่อ tunnel status แสดงว่า:

```text
process_running : True
healthy         : True
ready           : True
```

สำหรับ supervised runtime ควรเห็น `supervisor: ready` เพิ่มด้วย

เมื่อต้องการหยุดหรือ restart การเชื่อมต่อ:

```powershell
chatgpt-local down      # หรือ .\scripts\stop-tunnel.ps1
chatgpt-local restart   # build ใหม่ แล้ว stop/start tunnel
```

### 6. เพิ่ม MCP ใน ChatGPT Web

เปิด Developer mode ใน ChatGPT หากบัญชีของคุณต้องใช้ จากนั้นเพิ่ม MCP app/connector สำหรับ tunnel เลือก `ChatGPT Machine MCP` แล้ว refresh หรือ reconnect tools

ทดสอบด้วยข้อความนี้:

```text
ใช้ machine_status ตรวจว่าเชื่อมต่อเครื่อง local สำเร็จ และอย่าแก้ไขไฟล์
```

หลังแก้โค้ด MCP ให้รัน `npm run build`, stop/start tunnel และ refresh connector เพื่อให้ ChatGPT รับ tool schema เวอร์ชันล่าสุด

คำสั่งตรวจสอบในเครื่องที่มีประโยชน์:

```powershell
chatgpt-local doctor          # ตรวจ dependencies + permission ของ workspace
chatgpt-local check           # ตรวจ effective config + fingerprint ของ contract v6 / 46 tools
npm run smoke                 # ทดสอบ MCP จริง + supervisor recovery
npm run verify                # full test + server contract check
# Preview mutation ทั้งหมดโดยไม่เขียนจริง:
node dist/index.js --root D:\Projects\Github --dry-run
```

MCP contract แบบ legacy ปัจจุบันเป็น v6 มี public tools 46 ตัว พร้อม SHA-256 contract fingerprint ที่คำนวณจากชื่อ, schema และ annotations โดย `runtime_exec` รองรับการรัน Python/IPython แบบ persistent เมื่อใช้ `--dangerously-open-machine` และ `process_wait` จะรอ process ที่เริ่มด้วย `start_process` จนจบภายใน `timeout_ms` (ค่าเริ่มต้น 30 วินาที) แล้วคืน exit code กับ stdout/stderr offsets ถ้าหมดเวลาจะคืน `timedOut: true` และปล่อย process ทำงานต่อ จึงไม่ต้อง poll `process_status` ซ้ำ ๆ

### Hybrid tool surface (ทดลองใช้)

ใช้ `--tool-surface hybrid` (หรือ `MCP_TOOL_SURFACE=hybrid`) เพื่อย่อ tool surface ที่ ChatGPT เห็นจาก low-level tools จำนวนมากให้เหลือ `toolpy` กับ `capability_registry` เท่านั้น Hybrid mode ต้องใช้ `--dangerously-open-machine` เพราะ `toolpy` คือ persistent IPython capability runtime เดิมที่นำมา expose ด้วยชื่อที่ชัดกว่า low-level coding tools ยังอยู่หลัง `toolpy` และ Python ที่โมเดลสร้างสามารถประกอบการทำงานผ่าน `await tools.<name>(...)` ได้ โดย policy, approval, audit, call budget, output bound และ `allow_tools` ยังทำงานเหมือนเดิม ส่วน `capability_registry` ใช้ดู capability ที่มีอยู่โดยจัดกลุ่มเป็น `coding`, `think`, `skills`, `memory` และไม่ expose handler ภายใน กลุ่มสามตัวหลังจะมีข้อมูลเมื่อเชื่อม provider ที่รองรับจริง ระบบจะไม่สร้าง provider ปลอมขึ้นมา

```powershell
# Hybrid ที่ใช้เฉพาะ capability ของเครื่อง local หลัง toolpy
node dist/index.js --root D:\Projects\Github --dangerously-open-machine --tool-surface hybrid --check

# ต่อ local capability providers ทั้งหมด โดย ChatGPT ยังเห็นเพียง
# toolpy + capability_registry
node dist/index.js --root D:\Projects\Github --dangerously-open-machine --tool-surface hybrid `
  --skill-hub-dir D:\Projects\Github\chatgpt-skill-hub `
  --thinkforge-dir D:\Projects\Github\ThinkForge-MCP `
  --memory-dir D:\Projects\Github\ourbook --check
```

provider ทั้งหมดเชื่อมผ่าน persistent stdio MCP client และใช้ schema/authority annotations ที่ provider ประกาศจริง Skill Hub เพิ่ม `skills_skill_*`, ThinkForge เพิ่ม `think_*` ส่วน OurBook ตั้งใจ expose แบบแคบเพียง `memory_recall`, `memory_remember`, `memory_stats` ไม่ยก memory server ทั้งก้อนเข้ามา capability ที่ non-destructive และ closed-world เรียกได้โดย default จาก `toolpy`; mutation อย่าง `skills_skill_sync` และ `memory_remember` ต้องระบุใน `allow_tools` เอง ตัวอย่าง: `hits = await tools.skills_skill_search(query="diagnosing bugs", limit=5); thought = await tools.think_analyze_problem(problem="too many tools"); stats = await tools.memory_stats(); result({'hits': hits, 'thought': thought, 'stats': stats})` สามารถใช้ env `MCP_SKILL_HUB_DIR`, `MCP_THINKFORGE_DIR`, `MCP_MEMORY_DIR` แทน CLI paths ได้

ระหว่าง migration ค่าเริ่มต้นยังเป็น `legacy` เพื่อไม่ให้ connector/script เดิมพังทันที

### OSINT สาธารณะ (เปิดใช้แบบ opt-in)

ใช้ `--enable-osint` (หรือ `MCP_ENABLE_OSINT=1`) เพื่อเปิด `osint_search` และ `osint_fetch` ซึ่งอ่านเฉพาะหน้า HTTPS สาธารณะแบบมีขอบเขต คืนผลค้นหา/ชื่อเรื่อง/ข้อความ/ลิงก์ที่สกัดได้ จำกัดขนาดผลลัพธ์ ปฏิเสธปลายทาง private และไฟล์ binary และไม่ส่ง cookie หรือ credential จากผู้เรียก `scope=onion` ใช้ได้กับ HTTPS `.onion` ที่ระบุชัดเจนเท่านั้น และต้องมี Tor SOCKS5 ในเครื่อง เช่น `--tor-proxy socks5h://127.0.0.1:9050` (หรือ `MCP_TOR_SOCKS_PROXY`) เครื่องมือนี้ไม่ login, ไม่ submit form, ไม่ดาวน์โหลด binary และไม่ crawl ใช้เฉพาะการวิจัยสาธารณะที่ชอบด้วยกฎหมายและเคารพข้อกำหนดของเว็บไซต์

สำหรับงานเขียนโค้ด `read_files` อ่าน text files ได้สูงสุด 50 ไฟล์ใน call เดียวภายใต้ combined byte budget ส่วน `project_snapshot` รวม Git/tree/package/scripts/instructions แบบ bounded เพื่อเข้าใจ repo ได้เร็วขึ้น `machine_status` แยก `runtimeRoot`, `configuredRoot` และ `configApplied` ชัดเจน ทำให้ `restartRequired` อิง live supervisor state จริง นอกจากนี้ synchronous `shell_command` ฝั่ง PowerShell จะ fail-fast เมื่อเจอ PowerShell error และคืน `success`, `hadPowerShellError` กับขนาด output แทนการรายงาน false success

## Multi-machine routing

tunnel เดียวสามารถเป็น gateway ไปยัง MCP node หลายเครื่องได้ โดยเลือกเครื่องแบบ explicit ด้วย machine id, name, hostname, alias, IP หรือ `host:port` เท่านั้น ตัว tool ไม่สามารถส่ง URL ที่ไม่ได้ register ไว้แล้วให้ gateway ยิงออกไปเองได้

เพิ่มเครื่องที่ gateway:

```powershell
chatgpt-local machine add server 192.168.1.20:8787 --hostname HOME-SERVER --alias buildbox --token-env MCP_NODE_SERVER_TOKEN
chatgpt-local machine list
```

registry จะอยู่ที่ `.chatgpt-machine/machines.json` ซึ่งถูก Git ignore อยู่แล้ว ค่า `tokenEnv` เก็บเพียงชื่อ environment variable ไม่เก็บ bearer token จริงในไฟล์ ให้ตั้ง env var ดังกล่าวที่ gateway ก่อนเปิด tunnel

แต่ละ remote node ให้เปิด Streamable HTTP และใช้ bearer token เมื่อ bind ออกนอก loopback:

```powershell
$env:MCP_HTTP_TOKEN = '<node-secret>'
node dist/index.js --http --http-host 0.0.0.0 --http-port 8787 --http-token $env:MCP_HTTP_TOKEN --root D:\Projects --dangerously-open-machine
```

ควรเปิด port เฉพาะ LAN, VPN หรือ Tailscale ที่เชื่อถือได้ Gateway ยอมให้ plain HTTP เฉพาะ local/private address ส่วน public endpoint ต้องเป็น HTTPS `developer` policy ฝั่ง gateway จะ approval-gate `machine_call` ส่วน `machine_read` ไม่ต้องใช้ mutation approval แต่ gateway จะ discover tool ของ remote ก่อนและยอมรันเฉพาะ tool ที่ประกาศ `readOnlyHint=true`; ถ้า annotation หายหรือเป็น mutation จะ fail closed ขณะที่ remote node ยังบังคับ workspace, policy, approval และ audit ของตัวเองอีกชั้น

จาก ChatGPT ใช้ `machines_list` แล้วตามด้วย `machine_probe`, `machine_tools`, `machine_read` หรือ `machine_call` โดย `machine_tools` cache capability ของ remote 60 วินาที พร้อม fingerprint และใช้ `refresh=true` เพื่อบังคับ rediscover ได้ หาก fingerprint เปลี่ยน cache จะถูกแทนที่ งาน read-only ควรใช้ `machine_read(machine="192.168.1.20", tool="git_status", arguments={...})` ส่วน mutation ค่อยใช้ `machine_call` Audit ของ routed calls จะมี `targetMachine` และ `remoteTool` เป็น field ระดับบน ส่วน tools local อย่าง `read_file` ยังทำงานบนเครื่อง gateway ตามปกติ

เมื่อใช้ local HTTP transport สามารถดู recent-call viewer ที่ทำ redaction แล้วได้ที่ `http://127.0.0.1:8787/ui` หากเปิด `MCP_HTTP_TOKEN` endpoint ของ UI จะต้องใช้ Bearer authorization header เดียวกัน

## การติดตั้งบน macOS / Ubuntu / WSL

MCP server, file/process/Git tools และ tunnel lifecycle รองรับ macOS, Ubuntu และ Ubuntu WSL โดย Bash scripts จะใช้ Keychain บน macOS ส่วน Ubuntu/WSL ใช้ได้ทั้ง `CONTROL_PLANE_API_KEY` สำหรับการรันครั้งเดียว หรือ local key file ที่ permission เป็น `600`

```bash
brew install node git gh
git clone https://github.com/JonusNattapong/ChatGPTMCP.git
cd ChatGPTMCP
npm install && npm test

# macOS: Apple Silicon ใช้ darwin-arm64, Intel ใช้ darwin-amd64
mkdir -p tools/tunnel-client-v0.0.13
gh release download v0.0.13 --repo openai/tunnel-client --pattern "tunnel-client-v0.0.13-darwin-*.zip" --dir tools
unzip tools/tunnel-client-v0.0.13-darwin-*.zip -d tools/tunnel-client-v0.0.13
chmod +x tools/tunnel-client-v0.0.13/tunnel-client

# ใส่ OpenAI runtime key ตาม prompt; key จะถูกเก็บใน Keychain
security add-generic-password -U -a "$USER" -s chatgpt-machine-mcp-tunnel -w
export OPENAI_TUNNEL_ID="tunnel_..."
export OPENAI_ORGANIZATION_ID="org_..."
./scripts/start-tunnel.sh
./scripts/status-tunnel.sh
```

หยุด tunnel ด้วย `./scripts/stop-tunnel.sh` และควรดาวน์โหลดเฉพาะ archive ที่ตรงกับ architecture ของเครื่อง อย่า extract หลาย architecture ลง directory เดียวกัน

บน Ubuntu หรือ WSL ให้ใช้ archive `linux-amd64` หรือ `linux-arm64` ให้ตรงกับเครื่อง และเก็บ key โดยไม่ commit เข้า Git:

```bash
mkdir -p .tunnel
umask 077
printf '%s' "$CONTROL_PLANE_API_KEY" > .tunnel/control-plane-api-key
chmod 600 .tunnel/control-plane-api-key
export OPENAI_TUNNEL_ID="tunnel_..."
export OPENAI_ORGANIZATION_ID="org_..."
./scripts/start-tunnel.sh
```

WSL ทำงานอยู่ใน Linux boundary ดังนั้น MCP ที่รันใน WSL จะควบคุมไฟล์และ process ฝั่ง Linux เป็นหลัก หากต้องการให้ ChatGPT ควบคุม native Windows applications, Windows services หรือ Windows filesystem นอก mounted drive paths ให้ใช้ Windows setup ด้านบนแทน

## การเริ่มอัตโนมัติหลังเปิดเครื่อง

โปรเจกต์นี้ **ไม่ได้เปิด tunnel อัตโนมัติหลัง Windows restart** โดยตั้งใจ เพราะ tunnel ที่ active จะเปิด remote access ด้วยสิทธิ์ของ Windows account ที่ใช้รัน process

หากต้องการ auto-start จริง ๆ ให้สร้าง Windows Task Scheduler task ให้รันหลัง sign in ด้วยคำสั่ง:

```powershell
pwsh.exe -NoProfile -ExecutionPolicy Bypass -File D:\Projects\Github\ChatGPTMCP\scripts\start-tunnel.ps1
```

ควรเลือก **Run only when user is logged on** และ **อย่าเก็บ password** ปิดหรือ delete task นี้เมื่อไม่ต้องการให้เครื่องรับ remote access อีกต่อไป

บน macOS ให้ใช้ per-user LaunchAgent เฉพาะเมื่อคุณต้องการ persistent remote access หลัง login จริง ๆ โดยให้รัน `scripts/start-tunnel.sh` พร้อม `OPENAI_TUNNEL_ID` และ `OPENAI_ORGANIZATION_ID` ใน environment ส่วน runtime key ยังคงเก็บใน Keychain ไม่ควรใช้ system-wide daemon สำหรับ setup แบบ user-scoped นี้

## วิธีขอความช่วยเหลือ / ตรวจสอบปัญหา

- ตรวจ status: `./scripts/status-tunnel.ps1`
- Build ใหม่หลังแก้ source: `npm run build`
- Architecture, safety model, tools, HTTP และ development แบบละเอียด: [คู่มือเชิงเทคนิคภาษาไทย](https://jonusnattapong.github.io/ChatGPTMCP/index.th.html)
- English documentation: [README.md](README.md)
