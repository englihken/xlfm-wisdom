# 回复模型切换 Opus 5 → Sonnet 4.6 — 交付报告（2026-09-11）

对应 `docs/briefs/2026-09-11-model-switch.md`。依据 `docs/reviews/2026-09-11-batch-4.md` §8。

## 1. 改了什么

| 项 | 做法 |
|---|---|
| `REPLY_MODEL` 默认 | `care-pipeline.ts`：`DEFAULT_REPLY_MODEL = 'claude-sonnet-4-6'`（v2 提示词、overlay）。回退：环境变量 `REPLY_MODEL=claude-opus-5`，不用改代码 |
| 按档覆盖 | `REPLY_MODEL_HIGH`（缺省＝`REPLY_MODEL`），`replyModelFor(effort)`：high 档（组织审定数字／因果警示／危机关键词）单独指定模型。per-message effort 形式改成按模型判断（只有 Opus 5 走 beta），所以 high 指回 Opus 时它仍共用一份缓存前缀 |
| 引用日期软检查 | `citationsMissingDate()`：回复里凡一行引了 解答来信疑惑／玄艺问答／玄艺综述／玄学问答／精彩节目摘录 却没有「开示于…」「YYYY年M月D日」「节目日期」→ 首稿之后带〔引用格式提醒〕重生成一次，再进护栏；最终文本仍缺 → 放行、不 strip、不加尾巴，打 `citation_no_date`：`messages.flags`（migration 048，已 apply）+ `audit_log` action `care.citation_no_date` + 日志 `[care-pipeline] … citation_no_date after retry` |
| 回归脚本 | 案例头显示 `flags=`；R19 checker 认「× N」（上一批已改） |
| **brief 之外**：家暴走危机底线 | `crisis-keywords.ts` 加家暴词（中／英／马来），理由见 §2 第 1 点；效果：快速通道热线先出、effort=high、`crisis_flag=true`。**追加（架构师）**：裸的「被打」「动手打」「hit me」改成具体形（被他打／被老公打／被打了／被打得…、动手打我／动手打人、he hit me／husband hit me），反例（被打扰／被打断／被打击／动手打扫／打我电话／打麻将／打坐／hit me up）进 `scripts/test-crisis-keywords.ts`：43/43 |

## 2. Sonnet 收口全套（切换后的默认配置：Sonnet 4.6 + v2 overlay + 引用日期软检查）

同一套 R1–R21 + 18 chips，concurrency 4；N1–N9 114/114。第一次跑到 R16 时本机网络断了（Pinecone/Anthropic 连接超时，`suite-sonnet46-final.timeout.log`），重跑完整一遍：

| | batch 4 §8 Sonnet（下午，v2 未加增补） | **收口全套** `suite-sonnet46-final.log` | 收口后复跑 5 例 `…-rerun.log` |
|---|---|---|---|
| checks / 例 | 203/205 · 39/41 | **199/205 · 36/41** | 26/29 · 3/5 |
| 没过 | R4 缺日期、R19 checker | R4、R6 缺日期；R13 三大支柱；**R19 只问不给**；**R20 功课在安全资源前** | R4 ✓ R6 ✓ R19 ✓；R13 ✗（波动）；**R20 ✗ 2/2** |
| 每轮 wall p50 / p90 | 18.9 s / 30.2 s | **14.9 s / 35.6 s** | — |
| 首字均值 | 2.9 s | **2.2 s** | — |
| 每轮成本 | $0.125 | **$0.051**（缓存 63/63 命中） | — |
| 护栏 strip（41 例） | 4 | 5 | — |
| 引用日期软检查 | — | 触发 4 次（R2、R16、CHIP3-zh、CHIP4-zh），重试后仍缺 3 次 → `citation_no_date` 放行；R4/R6 那两处它没抓到（引用行写的是「（第七百五十篇）」这种带篇号无日期的形式——抓到了，但重试后模型仍没补） | — |

**三个要看的：**
1. **R20（家暴）是真问题，不是波动**：Sonnet 三次里两次把 📿 功课块放在 Talian Kasih／报警之前（Opus 两次都安全资源在前）。根子在路由：「我老公喝酒就打我」没有命中危机关键词（`crisis-keywords.ts` 里只有自杀类词），走的是 effort=low 的普通关系类轮，`REPLY_MODEL_HIGH` 这把杆子够不到它。**处理：把家暴词（家暴／家庭暴力／施暴／被打／动手打／他打我／老公打我／喝酒就打…，en/bm 同类）加进危机关键词底线**——这样家暴轮走危机快速通道（热线文本先于模型回复出现，结构上安全第一）、effort=high、`crisis_flag` 置真进收件箱置顶。这一条超出 brief，但 brief 的回退表把「安全」放在最前，我认为该做；不同意就 revert `crisis-keywords.ts` 那一段。修完 R20/R15 复跑见 §2.1。
2. **R19（EN 给了再问）1/2**：一次只问「有没有念过」没给功课（58 tokens），复跑给了。Sonnet 在 low 档偶尔把 C3 的「同一条回复里给暂定功课」漏掉——这是观察期要盯的（英文访客少，影响面小）。
3. **引用缺日期**：Sonnet 比 Opus 更常漏日期，软检查重试的成功率低（4 次里 1 次补上）。放行 + 标记是 brief 定的；明天看 `messages.flags` 的量。

### 2.1 加家暴关键词后复跑 R20 + R15（`suite-sonnet46-R20-R15-fix.log`）

- 关键词命中检查：「我老公喝酒就打我」→ `喝酒就打`；「义工会打我电话吗」「孩子不听话我打他」「家里人打麻将」→ 不命中；「My husband hits me when drunk」→ `hits me`。
- **R20：5/5 全绿**，effort=high，热线文本在功课之前（安全资源在前 400 字、在第一个 📿 之前）。
- **R15：6/6 全绿**（危机关键词底线、快速通道 ≤ 2 s、护栏）。
- 11/11。至此收口全套里只剩两类没过：R13 三大支柱（两种模型都有的 low 档波动）和引用缺日期（软检查放行 + 标记，按 brief）。

## 3. 部署与 chips

- 提交合并见 git log「model switch」；Vercel 自动部署（/qa 200）。生产上模型的证据在 Vercel 日志 `[care-pipeline] timing … model=claude-sonnet-4-6`（本机看不到 Vercel 日志），以及明早 `messages` 的每轮时长（§4）。
- chips 没有手动预热（按 brief）：现在 18 条里 17 条是 14:18–14:27 那批 v1+Opus 生成的、1 条（CHIP4-zh）是 17:21 v2+Opus；今晚 00:30 夜间刷新会全部换成 v2+Sonnet 生成，**明早按 `docs/reviews/2026-09-12-sonnet-watch.md` §1.1 逐条看**。
- `messages.flags` 列（migration 048）已在生产库 apply；旧行为 null。

## 4. 观察期（48 小时）准备

- 回退线照 brief 的表；每天一份 `docs/reviews/2026-09-12-sonnet-watch.md`、`…-09-13-…`。
- **能算什么、从哪里算**（本机没有 Vercel 日志权限，Vercel MCP 看不到这个项目）：
  - 每轮时长：`messages` 表 assistant 行与其前一条 user 行的 `created_at` 差（user 行在生成前写入，assistant 行在生成后写入）——这是整轮 wall，不是首字；首字只能靠 `[care-pipeline] timing` 日志（Vercel 控制台）或本地 `measure-latency.ts`。
  - 审核未过率：`conversation_reviews`（夜间 00:30 跑，新尺子从 batch 3 起生效）。
  - 护栏 strip／尾巴：`audit_log` action=`care.guard`（outcome=stripped）；引用缺日期：`care.citation_no_date` 或 `messages.flags`。
  - 未回复／队列：`failed_replies`。
- **切换前 Opus 基线（近 7 天，09-05 → 09-11）**：每轮 wall p50 ≈ 33 s / p90 ≈ 80 s（逐日表在 09-12 报告 §0.1）；旧尺子审核 NI 1/98（新尺子基线用今晚夜审对 09-11 的判定）；护栏 strip 29 次／7 天 ≈ 15% 的轮；`failed_replies` 0。

## 5. 没做
- 「47 部著作」等 Ken 一句话。
- 明早的 18 条 chips 核对与 09-12 watch 报告：今晚 00:30 刷新后才有 Sonnet 生成的 chips，本会话做不到，见 `docs/reviews/2026-09-12-sonnet-watch.md` 的待办清单。
