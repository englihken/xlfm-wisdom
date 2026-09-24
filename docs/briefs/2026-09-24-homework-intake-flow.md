# 功课分诊：先问再给＋点选回答（2026-09-24）[opus]

Ken 09-24：教功课之前先弄清楚对方有没有开始念——「你是初学者还是已经开始修心灵法门了？」没开始 → 初学者模板；开始了 → 问现在念什么、各几遍，再建议。现在的做法（08-30 C3「给了再问」：暂定功课＋分诊问题写在同一条）数据上不成立：

- 09-11 起真实访客的首条机器人回复：**有 📿 功课块、没问分诊问题 → 35 通，只有 34% 的人再说了一句话**；功课块＋问句 44 通 52%；没有功课块的 200 通 66%。只看散客（每人 ≤6 通）：功课块单独出现 17 通，**只有 1 通有下文**。
- Sonnet 在 44% 的功课首答里根本没问那句话（35/79），规则靠提示词管不住。
- 首句「我最近失眠」「梦到儿子上法庭」没有任何修行线索，`levelFromCues` 只能判 `new`，等 Haiku 判完级，3–7 遍的功课块已经发出去了——给老同修开初学者功课，就是 Ken 看到的「人不见了」。
- 功课卡上「3-7 遍」是范围，📿 行照抄成「每天 3-7 遍」，初学者不知道念几遍。

**架构师改定 C3：先问再给。** 09-11 冲突登记表 C3 条目已加注。

## 0. 架构师已做
migration `053_conversations_triage.sql` 已 apply（`conversations.triage_asked_at timestamptz`、`triage_answer text check in ('beginner','practising')`），文件在 `migrations/`，开工第一步一起提交。

## 1. 什么时候问（`care-pipeline.ts` `decideTurnLevel` 之后，机械判定，不靠模型）

本轮是**分诊轮**，当且仅当：`level === 'new'`（线索、持久化 level、义工 stage 都没有）且本通 `triage_asked_at` 为空且不是危机轮。分诊轮只问一次；问了就写 `triage_asked_at`。

不问的情况（照旧走各自的轮）：
- 访客话里已有线索 → beginner／practising／experienced（现有逻辑）。
- **明确的入门意图直接给功课**：`BEGINNER_CUES` 加 `想开始念经|想学念经|想开始修|入门第一步|第一步|怎么开始|从哪里开始|从哪开始|how do I start|want to start chanting|mula membaca` → 判 beginner → 入门轮三部（不问）。
- 危机轮（安全资源优先），闲聊／问候。

## 2. 分诊轮怎么答

动态块加一段【本轮：分诊轮】：
- 一两句共情；针对问题讲师父的教导（可引原文 1 段）；**经名可以点（「心灵法门一般会念《心经》开智慧、去烦恼」），但不出 📿 功课块、不写遍数张数、不写祈求词**。
- 结尾固定一句：zh「先问一下：你是刚接触心灵法门，还是已经在念经做功课了？」／en "Quick question first: are you new to Guan Yin Citta Dharma Door, or already chanting daily?"／id 与欢迎弹窗同一种语言写法（Bahasa 名称待 #8 定）。
- **机械保底**（模型不听话也不会漏）：分诊轮的回复先经 `stripHomeworkForTriage()`——删 📿 行、祈求行（`isHomeworkLine`／`isPrayerLine`）、「每天 N 遍」句（复用 `stripViolations` 的句级删除）；若回复提到经名／念经／功课而没有那句固定问句，程序把问句接在末尾。
- SSE 新事件 `{ type: 'quick_replies', options: [{ label, text }] }`，在 `text` 事件之后发；两个选项：
  - zh：「我是初学者，还没开始念」／「我已经在念经做功课了」
  - en："I'm new — haven't started chanting" / "I already chant daily"
  - id：对应写法
  `text` 就是点了之后作为访客消息发出去的原文（见 §3 的线索）。
- WhatsApp 路径没有按钮，问句照发，访客打字回答。

## 3. 点了之后怎么走（线索驱动，`level-cues.ts`）

- 「我是初学者，还没开始念」→ `BEGINNER_SELF_REPORT_RE` 命中「还没开始念」→ beginner → 现有入门轮：三部都开（大悲咒 3、心经 3、礼佛 1）＋祈求词＋教念视频。写 `triage_answer='beginner'`。
- 「我已经在念经做功课了」→ `PRACTISING_CUES`「在念功课」命中 → practising → **同一条回复**里：讲这个问题的师父教导（practising 规则：默认不给遍数，问到或教义数字才给）＋结尾一句「现在每天念哪些经、各几遍？我看看有没有需要留意的」。写 `triage_answer='practising'`。访客报了功课（「大悲咒 7 心经 7」→『报自己的遍数』线索）→ 下一轮：对照功课卡说缺了哪一部必做功课（「功课卡上《礼佛大忏悔文》是必做功课」），针对问题点经名，遍数只从检索原文的范围里给或不给，**个人功课的调整请义工面谈**——不替已在修的人定功课。
- en／id 线索补上：`haven'?t started|never chanted|i'?m new|new to|beginner|belum mula|baru (mengenali|kenal)` → beginner；`already chant|chant(ing)? daily|sudah (membaca|mula|baca)` → practising。
- 访客不答、另问别的 → 正常答那一题，不再问第二次（`triage_asked_at` 已有值）。之后若明确问「念什么经／几遍」而 level 仍是 new → 给入门三部，开头加一句「如果你已经在做功课，就按你现在的功课，不用改」。
- 义工 stage 照旧优先（09-16 A2）。

## 4. 前端（`src/app/qa/page.tsx`）
- 收到 `quick_replies` → 在最后一条机器人气泡下方渲染两个按钮（样式沿用首页 chips），点一下＝把 `text` 当访客消息发送；访客一旦打字或点了按钮，按钮消失；刷新页面不保留。
- 三语文案放 `TRANSLATIONS`。

## 5. 顺带：📿 行只写一个数
`tiers.ts` 入门轮：📿 行写一个数（大悲咒 3、心经 3、礼佛 1），正文一句「念顺了再加到 7 遍」；不写「3-7 遍」「3–7 遍」。护栏对 3 照样通过（卡上是 3-7 的范围）。回归 R12／R18 加断言：📿 行不含 `\d+\s*[-–—~至到]\s*\d+\s*遍`。

## 6. 回归（`scripts/test-regression-live.ts`）
- R38 首轮无线索「我最近失眠很严重，念什么经好？」→ 无 📿、无 `\d+遍`、含固定问句、SSE 里有 `quick_replies`（脚本读原始 SSE）。
- R39 R38 → 点「我是初学者，还没开始念」→ 三部各带遍数＋祈求词（同 R12 断言）＋📿 行单数。
- R40 R38 → 点「我已经在念经做功课了」→ 无 📿、含「现在每天念哪些经」问句、有针对失眠的师父教导（经名或原文）；再答「大悲咒 7 心经 7」→ 无 📿、提到礼佛是必做功课、有「义工面谈」一句。
- R41 「入门第一步」chip → 首轮直接三部（不问）。
- R42 EN "I have severe insomnia, which sutras should I recite?" → 问句＋按钮；点 "I already chant daily" → 无 count lines。
- 现有 R12／R13／R18／R19／R20 按新流程调整前置轮次（R19「给了再问 EN」改为分诊轮断言）。全套跑一次。

## 7. 报告
`docs/reviews/2026-09-24-homework-intake-flow.md`：上线前后各 7 天——分诊问句的回答率（目标 ≥60%）、功课轮之后访客继续对话的比例、level 分布；`triage_answer` 两类各多少；分诊轮被程序剥掉 📿 的次数（模型不听话的频率）。
