# chatgpt-skills (108 ตัว)

Sources:
- https://github.com/mattpocock/skills (cloned 2026-09-03, depth 1)
- https://github.com/blader/humanizer (cloned 2026-09-03, depth 1)
- https://github.com/obra/superpowers — skills/ ทั้ง 14 ตัว (2026-09-03; frontmatter ผ่านทั้ง 14 ไม่ต้องแก้)
- https://github.com/Digidai/product-manager-skills — SKILL.md + knowledge/ + templates/ + examples/ + bin/ (2026-09-03; แก้: ย้าย type ลง metadata)
- https://github.com/mvanhorn/last30days-skill — skills/last30days (2026-09-03; แก้: ย้าย version/argument-hint/homepage/repository/author/user-invocable ลง metadata; ตัด assets/ 14MB กับ dev-scripts ตาม .skillignore)
- https://github.com/CloudAI-X/threejs-skills — skills/ 10 ตัว (2026-09-03; SKILL.md เดี่ยว, frontmatter ผ่านทั้ง 10 ไม่ต้องแก้)
- https://github.com/ChromeDevTools/chrome-devtools-mcp — skills/ 7 ตัว (2026-09-03; frontmatter ผ่านทั้ง 7 ไม่ต้องแก้)
- https://github.com/freestylefly/awesome-gpt-image-2 — agents/skills/gpt-image-2-style-library (2026-09-03; frontmatter ผ่านไม่ต้องแก้)
- https://github.com/langchain-ai/deepagents — libs/code/examples/skills/skill-creator (2026-09-03, sparse)
- https://github.com/PracticalSwan/agent-skills — frontend-design (2026-09-03, sparse)
- https://github.com/iuliandita/skills — skills/databases (2026-09-03, sparse)
- https://github.com/magnus919/agent-skills — qa-methodology, playwright, platform-engineering, adr-authoring (2026-09-03, sparse)
- https://github.com/tomzx/agents — skills/create-observability (2026-09-03, sparse)
- https://github.com/JPeetz/agent-skills — skills/documentation-content/technical-documentation (2026-09-03, sparse)
- https://github.com/tt-a1i/archify — archify/ (2026-09-03, sparse)
- https://github.com/Leonxlnx/taste-skill — skills/ ทั้ง 13 ตัว (2026-09-03)
- https://github.com/Imbad0202/academic-research-skills — academic-paper, academic-paper-reviewer, academic-pipeline, deep-research (2026-09-03)
- https://github.com/coreyhaines31/marketingskills — skills/ 31 ตัวตามรายการด้านล่าง (2026-09-03, sparse; frontmatter ผ่านทั้ง 31 ไม่ต้องแก้)

## โฟลเดอร์
- `chatgpt-skills/<skill-name>/` = ทั้ง directory ของ skill (SKILL.md + references/agents/)
- `chatgpt-skills/zips/<skill-name>.zip` = ไฟล์สำหรับ upload ทีละตัวที่ `chatgpt.com/skills`
  - แต่ละ ZIP หุ้มด้วย **โฟลเดอร์ชื่อเดียวกับ skill** (`<skill-name>/SKILL.md`) ตาม spec — อย่าแตกไฟล์แล้ว zip ใหม่แบบไม่มีโฟลเดอร์หุ้ม

## รายการ (108)
1. setup-matt-pocock-skills
2. domain-modeling
3. codebase-design
4. research
5. grilling (ต้นทาง: skills/productivity/grilling — ตัวอื่นเรียกใช้)
6. grill-with-docs
7. to-spec
8. to-tickets
9. tdd
10. diagnosing-bugs
11. implement
12. code-review
13. improve-codebase-architecture
14. humanizer (blader — ลบกลิ่น AI, skill เดี่ยว ติดตัวเดียวจบ)
15. verification-before-completion (obra/superpowers — บังคับมีหลักฐานก่อนพูดว่างานเสร็จ)
16. skill-builder (ต้นทาง deepagents skill-creator — เปลี่ยนชื่อเพราะ ChatGPT จองชื่อ `skill-creator` ไว้; มี scripts/init_skill.py + quick_validate.py)
17. resolving-merge-conflicts (mattpocock — เข้าชุดเดิม)
18. prototype (mattpocock — throwaway prototype พิสูจน์ design/state/UI)
19. frontend-design (PracticalSwan — UI/UX, accessibility, responsive; แก้ frontmatter: ย้าย version/last_updated/tags ลง metadata)
20. databases (iuliandita — Postgres/Mongo/MySQL/MSSQL, migration, EXPLAIN)
21. qa-methodology (magnus919 — test strategy, regression, quality gates, CI triage)
22. playwright (magnus919 — E2E, selectors, network mocking; แก้ `->` เป็น `→` ใน description)
23. create-observability (tomzx — logs/metrics/traces/alerts ตั้งแต่ระดับ feature; แก้: ย้าย argument-hint ลง metadata)
24. platform-engineering (magnus919 — Docker/K8s/Terraform/telemetry/Grafana/release)
25. technical-documentation (JPeetz — README/ADR/API docs/runbook; แก้: ย้าย version/author/platforms/tags/geo ลง metadata)
26. adr-authoring (magnus919 — ADR lifecycle)
27. archify (tt-a1i — architecture/workflow/sequence/data-flow/lifecycle diagrams เป็น HTML+SVG standalone; ~1.5MB zip, frontmatter ผ่านไม่ต้องแก้)
28. design-taste-frontend (Leonxlnx/taste-skill ตัวหลัก — โฟลเดอร์เดิมชื่อ taste-skill, เปลี่ยนให้ตรง frontmatter `name`)
29. design-taste-frontend-v1 (รุ่น v1 — เดิม taste-skill-v1)
30. brandkit (ไม่ต้องเปลี่ยนชื่อ)
31. industrial-brutalist-ui (เดิม brutalist-skill)
32. gpt-taste (เดิม gpt-tasteskill)
33. image-to-code (เดิม image-to-code-skill)
34. imagegen-frontend-web (ไม่ต้องเปลี่ยนชื่อ)
35. imagegen-frontend-mobile (ไม่ต้องเปลี่ยนชื่อ)
36. minimalist-ui (เดิม minimalist-skill)
37. high-end-visual-design (เดิม soft-skill)
38. redesign-existing-projects (เดิม redesign-skill)
39. stitch-design-taste (เดิม stitch-skill, มี DESIGN.md ประกอบ)
40. full-output-enforcement (เดิม output-skill)
41. deep-research (Imbad0202 — systematic review, source verification, meta-analysis; 53 ไฟล์)
42. academic-paper (เขียน paper IMRaD/APA7; 63 ไฟล์)
43. academic-paper-reviewer (peer review 2-stage; 28 ไฟล์)
44. academic-pipeline (orchestrator 10-stage ครอบ 3 ตัวบน; แก้ `->` เป็น `→` ใน description)
45-75. Marketing Skills by Corey Haines (31 ตัว, `product-marketing` เป็น foundation ที่ตัวอื่นอ่านก่อน):
ab-testing, ad-creative, ai-seo, analytics, churn-prevention, cold-email, competitors,
content-strategy, copy-editing, copywriting, emails, free-tools, launch, marketing-ideas,
marketing-psychology, onboarding, cro, ads, paywalls, popups, pricing, product-marketing,
programmatic-seo, referrals, revops, sales-enablement, schema, seo-audit, signup,
site-architecture, social
76-88. obra/superpowers ที่เหลืออีก 13 ตัว (ตัวที่ 14 คือ verification-before-completion มีอยู่แล้ว):
brainstorming, dispatching-parallel-agents, executing-plans, finishing-a-development-branch,
receiving-code-review, requesting-code-review, subagent-driven-development, systematic-debugging,
test-driven-development, using-git-worktrees, using-superpowers, writing-plans, writing-skills
89. product-manager-skills (Digidai — SaaS metrics, PRD review, roadmap, discovery, PLG; 30 ไฟล์)
90. last30days (mvanhorn — social listening 30 วัน Reddit/X/YouTube/TikTok/HN; 121 ไฟล์, ~800KB zip)
91-100. CloudAI-X/threejs-skills (10 ตัว, SKILL.md เดี่ยว):
threejs-fundamentals, threejs-geometry, threejs-materials, threejs-textures, threejs-lighting,
threejs-animation, threejs-interaction, threejs-loaders, threejs-shaders, threejs-postprocessing
101-107. ChromeDevTools/chrome-devtools-mcp (7 ตัว):
chrome-devtools, chrome-devtools-cli, a11y-debugging, cookie-debugging, debug-optimize-lcp,
memory-leak-debugging, troubleshooting
108. gpt-image-2-style-library (freestylefly — GPT-Image2 style library + prompt templates; 6 ไฟล์)

## ลำดับติดตั้งแนะนำ
```text
setup-matt-pocock-skills
domain-modeling, codebase-design, research
grilling, grill-with-docs
to-spec, to-tickets
tdd, diagnosing-bugs, implement
code-review, improve-codebase-architecture
```

## หมายเหตุ
- `grill-with-docs`, `implement` เป็น stub ที่ delegate ไป skill อื่น (เช่น grilling + domain-modeling) — ต้องติดตั้งคู่กันถึงจะทำงาน อย่าติดตัวเดียว
- รัน `setup-matt-pocock-skills` หนึ่งครั้งต่อ repo ก่อนใช้ตัวอื่น (กำหนด issue tracker, labels, ตำแหน่งเอกสาร)
