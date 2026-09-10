# 延迟 + 审计第一批修复 — 交付报告（2026-09-10/11）

对应架构师 brief 2026-09-10（完整版）。原始日志全部在 `docs/reviews/latency-2026-09-10/`。

## 0. 迁移文件

`4d43cc0 migrations: write back 043–046 (applied live, audit F10)`。

## 1. 发送键一直灰（回归修复）

**前**：`/api/chat` 在 `[DONE]` 之后还 `await classifyAndSaveCategory` + `await processFailedReplies({budgetMs:60_000})` 才 `close()`。访客已经看到回复，输入框却继续禁用，最长 60 秒；点「新对话」时旧 fetch 不中止，旧回调更新"数组最后一项"。

**后**：

- 服务端先返回 `Response`（SSE），所有工作在流内进行；`[DONE]` 一出就 `controller.close()`。
- 分类、排水、chip 写回全部放进 `after()`（`next/server`，Vercel 上即 `waitUntil`）——在 `POST` 作用域注册，由流内在关闭后 resolve，保证真的跑完，不是裸 fire-and-forget。
- 前端 `isLoading` 在收到 `[DONE]` 事件即清；每轮 `requestId` + `AbortController`，「新对话」中止旧 fetch，旧回调按 `requestId` 丢弃；消息有稳定 `id`，回调按 id 更新，不再碰"最后一项"。
- 轮询单飞（上一次没回来不发下一次；本轮流式进行中不轮询），游标改 `(created_at, id)`，`/api/chat/updates` 新增 `afterId`。

回归项：发问 → 回复出现的瞬间发送键可用；回复中点新对话 → 旧回复不落进新对话（生产验证见 §7）。

## 2. 六个 chip 走缓存（`chip_answers`，migration 046）

- `QUICK_QUESTIONS` 移到 `src/lib/quick-questions.ts`，页面与服务端共用同一份原文（三语）。
- `/api/chat` 收到**开场轮**的 chip 原文时先查表（`invalidated_at is null` 且 `generated_at` 24h 内）；命中直接走现有 SSE 协议（conversation → sources → text → persisted → [DONE]），仍然创建 conversation / messages 行。只限开场轮：对话中途同样的文字会受 入门锚定 上下文影响，不该用缓存答案。
- 未命中 → 正常管线，`after()` 里写回；只有 `guard=clean|passed_after_retry` 且未拒答才写（表上有 check）。
- 夜间刷新：`/api/cron/review`（16:30 UTC）开头 `refreshChipAnswers({force:true, budgetMs:150_000, concurrency:6})`，最旧优先；另有 `/api/cron/refresh-chips[?force=1]`（CRON_SECRET）供外部 pinger / 部署后手动预热。Hobby 只允许两条 cron，所以没有新增 vercel.json 条目。
- 智库条目批准（`PATCH action=approve`）→ `invalidateChipAnswers()` 把全部条目 `invalidated_at=now()`。

**命中延迟**：生产实测见 §7。缓存路径只有一次 DB 读 + 一次 messages 插入 + 一次 update，没有 Pinecone、没有模型调用。

## 3. 思考强度按轮次分档

规则（`chooseReplyEffort`，care-pipeline）：

| 档 | 条件 |
|---|---|
| low | `homework_baseline` / `little_house_baseline` 命中，或 分诊跟进（上一条助手问「念过经吗」） |
| high | `canonical_ritual_numbers` / `karma_warning` 命中，或任一访客轮命中危机关键词 |
| medium | 其余 |

抽样映射：礼佛遍数 / 观音圣诞 → high；轻生、堕胎果报 → high；六个中文 chip 中 失眠/吵架/第一步/家人生病 → low，工作业障/孩子情绪 → medium；EN/ID chip 全部 medium（`homework_baseline` 关键词表偏中文，这是关键词覆盖问题，本批没扩）；分诊跟进「没有」→ low；危机之后的任何后续轮保持 high。

**缓存前缀的实测发现**：Opus 5 上顶层 `output_config.effort` 会让**每一档各有一份**缓存的 system 前缀（tiered 首跑：low 首次 MISS(create)、medium 首次 MISS(create)、high 因为前一轮 off 跑过而 HIT），并不是互相失效，而是三份并存——冷门档（high）会更常付 49k tokens 的 1h 写入（≈ $0.49/次）。改用文档给的 cache-preserving 形式：`messages` 里一条 effort-only 的 `role:'system'` 消息（beta `mid-conversation-output-config-2026-07-01`）。探针：low 创建 → high 读 49,276 → medium 读 49,276，三档共用一份前缀。Opus 5 走这条路径；其他模型（Sonnet A/B）用顶层形式；若 beta 返回 400 自动回退顶层并记日志。

**改前 / 改后**（`scripts/measure-latency.ts`，同一组 5 段对话 8 轮，顺序执行，effort off = 09-10 之前的行为）：

| | off（改前） | tiered（改后） |
|---|---|---|
| 首字 first_text 均值 | 15.2 s | 8.6 s |
| 首字 p50 / p90 | 14.1 s / 30.2 s | 8.1 s / 21.7 s |
| 模型调用总时长 均值 | 24.4 s | 18.2 s |
| 输出 tokens 均值 | 1372 | 964 |
| 每轮 wall p50 / p90 | 37.3 s / 70.0 s | 19.9 s / 49.7 s |
| 护栏重试 | 3 / 8 轮 | 2 / 8 轮 |

按档：low 6 次调用 first_text 均值 6.6 s、总时长 14.8 s；medium 11.6 s / 24.1 s；high 11.8 s / 22.3 s（high 与 off 的默认档相同，差异是样本）。

**R1–R15**：首跑 35 例（R + 18 chips）155/158；R1b「cites 组织审定」和 R13「gives the 功课 first」两项没过。复跑 R1b/R13 两次（tiered）全过、再跑一次 tiers off 也全过：R1b 是 sources 三个槽位的排序随机性（回复里 `参考：` 行提到的书被排前，把 组织审定 挤出前三；三次跑分别在第 1、第 3、第 0 位），R13 原回复第一句就是「那我们就从功课开始」，是 checker 的措辞正则漏了「从功课开始」——已补进 checker。最终版代码（per-message effort）再跑一次完整 R1–R15：ALL PASS（§6 末行）。

## 4. 等待时的进度阶段

SSE `type:'stage'`：`retrieving`（检索前）→ `drafting`（第一次模型调用前）→ `verifying`（草稿到手做逐字核对；重试调用也算这一段）。前端在等待气泡显示「检索台长开示中… / 撰写中… / 核对原文中…」（三语）。不改任何生成逻辑；`onStage` 回调抛错也吞掉。

## 5. 小改动

- **F12** WhatsApp `loadHistory`：`order(created_at desc).limit(20)` 再 `reverse()`——取最新 20 条。
- **F09** `homework_baseline` 关键词加：什么是心灵法门 / 心灵法门是什么 / 介绍一下 / what is Guan Yin Citta / apa itu。
- **F06** `reply-recovery`：生成前查 `isAiDraftEnabled()`，关了 → `ai_disabled`，把 claim 原样退回（status/attempts/last_attempt_at 不变），本轮停止；插入回复前再查 `status != volunteer_handling`，并查该访客消息之后有没有更新的消息——有助手/义工回复 → `already_answered`，有更新的访客消息 → `skipped`（不插入过期回复）。
- **F02** reconcile：`account_id` 的 UUID 校验移到 update 之前；update 加 `.eq('payment_status','verified')` CAS；只对 update 实际返回的行入账 / 记审计，全部被别人先对账 → 409；"先对账再入账"顺序保留。

## 6. Sonnet 4.6 vs Opus 5（只测量，不换默认）

同一套 R1–R15 + 18 chips + 入门轮（R12/R13/R14 在 R 套里），`--concurrency 4`，同一份分档规则；`REPLY_MODEL=claude-sonnet-4-6` 环境变量覆盖。

| | Opus 5（默认） | Sonnet 4.6 |
|---|---|---|
| 检查通过 | 155 / 158（32/35 例全绿） | 154 / 158（32/35 例全绿） |
| 未过的检查 | R1b cites 组织审定（槽位随机，复跑 2/2 过）；R13 功课优先措辞（checker 已补）；CHIP3-zh 带 scoped「没有写明遍数」句（已改为只记录） | R6 cites 玄艺问答 + 节目日期（回复引文开头断裂、丢了出处，护栏 stripped）；R14 缺《解结咒》；R13 三大经文没写全 |
| 护栏结果 clean / retry / stripped | 26 / 7 / 2 | 26 / 5 / 4 |
| 每轮 wall p50 / p90 | 27.5 s / 62.3 s | 14.6 s / 33.3 s |
| 首字均值 | 13.6 s | 2.8 s |
| 每轮平均成本 | $0.148（38 轮 $5.63） | $0.112（38 轮 $4.26） |

备注：Sonnet 的 CHIP6-id 只回了一个分诊问题（125 tokens）就过了 chip 的三条轻检查；R15 危机轮 Opus 用了 107 s（high，两次调用，5262 tokens）。Sonnet 在顶层 effort 形式下缓存命中 39/48（每档一份前缀 + 冷启动）。

最终版代码（per-message effort，Opus 5）完整 R1–R15 单独再跑（`suite-opus-5-final.log`）：**ALL PASS，86/86 检查，17/17 例全绿**；每轮 wall p50 23.1 s / p90 55.8 s，首字均值 11.0 s，缓存命中 25/26（一份共用前缀），每轮 $0.134。

## 7. 部署与生产验证

见本文件末尾追加的记录。

## 不在本批

系统提示词矛盾清单（另开）；F01 数字护栏第二批（先写负例测试）；EN/ID chip 的 `homework_baseline` 关键词覆盖（会让 EN/ID chip 也走 low 档，需要另议）。

### 7.1 部署

`017c4da Merge branch 'fix/guard-grounded-numbers'` → main → Vercel。上线判定：`POST /api/chat` 收到坏 JSON 从 500 变成 `400 {"error":"Invalid JSON"}`（新路由才有）。

### 7.2 生产实测（2026-09-11 00:2x MYT，Chrome，真实访客路径，xlfm-wisdom.vercel.app/qa）

| 场景 | 结果 |
|---|---|
| chip 未命中（首次点「失眠」） | 阶段标签「检索台长开示中…」0.01 s → 「撰写中…」4.1 s；回复 22.9 s 出现；`/api/chat` 总耗时 24.5 s；回复出现后输入框立即可用 |
| chip 命中（新对话再点同一 chip，两次） | 回复 2.2 s / 2.2 s 出现，`/api/chat` 2.6 s / 3.5 s（含 contact 查找、conversation + 两条 messages 写入）；发送键在回复出现后 0.5 s 内可用 |
| 新对话不串 | 发问「我和先生经常吵架…」→ 3.5 s 后（撰写中）点「新对话」→ 页面清空 → 点 chip → 命中回复 2.2 s；再等 30 s，旧回复（先生/婚姻/吵架）**没有**出现在新对话，气泡只有 2 个，输入框可用 |

命中延迟没有做到 brief 写的 <1 s：路径上还有 4 次 Supabase 往返（contact 查找 + 更新、conversation 创建、user 消息、assistant 消息 + last_message_at）串行发生，加上 Vercel 函数启动。把这些写入并行化 / 合并成一次 RPC 可以再压，但那会动 persistInbound 的所有权检查顺序，留给下一批。
