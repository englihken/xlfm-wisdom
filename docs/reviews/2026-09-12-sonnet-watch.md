# Sonnet 4.6 观察 — 第 1 天（2026-09-12）

对应 `docs/briefs/2026-09-11-model-switch.md` §观察期。切换上线：2026-09-11 约 18:05 MYT（合并 `efadbcc`）。本报告在 09-12 20:10 MYT 写（不是早上——当天才拿到指令），数据窗口 = 切换后 26 小时，**只有 33 轮／13 通对话，样本小**。

## 0. 切换前 Opus 5 基线

### 0.1 每轮时长（`messages` user→assistant 时间差；整轮 wall，不是首字）

| 日 | 轮数 | p50 | p90 |
|---|---|---|---|
| 09-05 | 33 | 31.1 s | 57.2 s |
| 09-06 | 51 | 32.2 s | 78.6 s |
| 09-07 | 22 | 31.2 s | 90.7 s |
| 09-08 | 24 | 35.8 s | 100.1 s |
| 09-09 | 22 | 53.2 s | 142.5 s |
| 09-10 | 40 | 36.3 s | 73.2 s |
| 09-11（切换前为主） | 55 | 23.7 s | 44.7 s |

七天合并 **p50 ≈ 33 s，p90 ≈ 80 s**。首字只能从 Vercel 日志 `[care-pipeline] timing … first_text_ms=` 读，本机看不到。

### 0.2 审核（新尺子）
- 旧尺子近 7 天：NI 1/98（1.0%）——不能当 c/d/e/f 基线。
- 新尺子第一次夜审（09-12 00:30）对 09-11 对话只判了 **4 通**（good 3、needs_improvement 1）——夜审只审有复盘条件的对话，样本太小，**基线还立不起来**；用 batch 3 校准集做参考：Opus「带拒答尾巴」38 通新尺子翻 33 通，「干净」20 通 19 通仍 good。

### 0.3 护栏 / 尾巴 / 队列（切换前 7 天，09-04 18:05 → 09-11 18:05）
- assistant 轮 **263**；护栏 stripped **29（11%）**；「查不到相关原文」blanket 尾巴 **5（1.9%）**；`failed_replies` 0。

## 1. 09-12 数据（切换后 26 h，09-11 18:05 → 09-12 20:10）

### 1.1 18 条 chips（00:30 刷新）

刷新结果：**15/18 换成了 Sonnet 生成**（01:10–01:12），3 条还是 09-11 的 Opus（zh family_illness、zh work_karma、id insomnia）——夜审开头的 `refreshChipAnswers` 有 150 s 预算，15 条用完了。18 条全部 live、**0 条 blanket 尾巴**。

| chip | zh | en | id |
|---|---|---|---|
| insomnia | ✓ Sonnet clean，3 个遍数，正文 54 字 | ✓ Sonnet clean，4 个 times | Opus（未刷到）→ 重生成 |
| family_conflict | ✓ Sonnet clean，3 个遍数，正文 161 字 | ✓ Sonnet clean，3 个 times | ✓ Sonnet clean |
| work_karma | Opus（未刷到）→ 重生成 | ✓ Sonnet clean，3 个 times | ✓ Sonnet clean |
| child_emotions | ⚠️ Sonnet passed_after_retry，**0 个遍数**（只剩《心经》＋祈求词，遍数被护栏拿掉）→ 重生成 | ✓ Sonnet clean，5 个 times | ✓ Sonnet passed_after_retry，3 个 times |
| beginner_first_step | ✓ Sonnet clean，2 个遍数，正文 96 字 | ✓ Sonnet clean，3 个 times | ✓ Sonnet clean |
| family_illness | Opus（未刷到）→ 重生成 | ⚠️ Sonnet clean 但**没有遍数**（「recite as much as possible」）→ 重生成 | ✓ Sonnet clean，4 个 times |

正文字数（去掉 📿／祈求／⚠️／🔗 行）：zh 四条 Sonnet chip 54–361 字，都在 ≤ 400 内；en/id 600–1,500 字符（英文／印尼文按字符数，没有对应的 400 字线）。

**重生成（invalidate → 访客路径，20:11–20:15 MYT，`chips-0912-rewarm.log`）：**
- zh family_illness → Sonnet clean，3 个遍数 ✓；id insomnia → Sonnet clean，3 个 kali ✓；en family_illness → Sonnet clean，2 个 times ✓。
- **zh child_emotions**：两次都是 passed_after_retry、**0 个遍数**——回复给《心经》（为孩子、为自己）＋祈求词，遍数每次被护栏拿掉（检索到的段落里没有对应的遍数）。内容本身没错（读了一遍：引《解答来信疑惑》「先改变自己」、《白话佛法》「拿别人的错误惩罚自己」、《玄艺问答》给孩子念心经），只是没有数字。Opus 版本（17:21）同样是 passed_after_retry。**留着这条**，标为「无遍数」。
- **zh work_karma**：三次都被 strip（每次 3 个 verifying 阶段 = 重试 → 过度 strip 再生成 → 仍 strip），没有存进缓存。现在这条是 **invalidated**，访客点它会走完整生成（有回复，只是没有 <1 s 的缓存）；00:30 刷新会再试。Opus 版本（09-11 14:18）是 passed_after_retry 有存。**这是 1.4 里 strip 率高的同一件事的一个具体样本。**

### 1.2 每轮时长（切换后，31 轮有前一条 user 行）

| | 轮数 | p50 | p90 | 缓存命中（<2 s） |
|---|---|---|---|---|
| Opus 基线（7 天） | 263 | ≈ 33 s | ≈ 80 s | — |
| **Sonnet 首日** | 31 | **16.8 s** | **37.6 s** | 1 |

整轮 p50 减半，p90 减一半多。首字数字要看 Vercel 日志。

### 1.3 审核（00:30 那一跑）
切换后的对话还没被夜审（下一次 09-13 00:30）。**明天补。**

### 1.4 护栏 / 引用日期（切换后 33 轮）

| 指标 | Opus 基线（7 天） | Sonnet 26 h | 回退线 |
|---|---|---|---|
| 护栏 stripped | 29/263 = **11%** | **8/33 = 24%**（5 通对话） | > 15% → 报架构师 |
| passed_after_retry | 57/263 | 8/33 | — |
| blanket 尾巴「查不到相关原文」 | 5/263 = **1.9%** | **7/33 = 21%** | 明显增多 → 报架构师 |
| `citation_no_date`（新） | — | 5/33 = 15% | 观察 |

**两项都过线，按表报架构师。** 但要一起看两件事：(1) 样本只有 33 轮，8 次 strip 里 5 通对话；(2) 同期护栏本身也变了（枚举 + 合行，只会少 strip 不会多），所以这不是护栏变严。是 Sonnet 更常写来源里没有的遍数，然后被 strip 出尾巴。这和收口全套里 Sonnet strip 5 vs Opus 7 的方向相反，说明生产问题分布和回归集不一样。

### 1.5 人工审
- 机械扫：切换后 33 条回复里含「两周／两个礼拜／会四部经／熟练才／先念一两个礼拜」的 **0 条**；`crisis_flag` 置真的 0 通；`failed_replies` 0。
- 随机读 6 条 Sonnet 回复：近视眼（引《解答来信疑惑》，功课 7/7 + 准提神咒，结构对）、念经不能集中（引《白话佛法》两段，方法四条）、梦到 19 岁大劫（「台长曾开示类似情况，建议 49 张小房子一拨一拨念」——转述语气过了护栏，但读起来接近给数字，边缘）、梦到路边生小孩（只问了两个分诊问题，没给方法）、两条「🙏」短回应处理正常。**没有数字无据、没有门槛说错的**，所以不触发整体回退。

### 1.6 未回复 / 队列
`failed_replies` 切换后 0。

## 2. 结论（第 1 天）

- **不回退**：回退线里「立即整体回退」的那一条（过了护栏但数字无据／门槛说错）没有命中；未回复 0；时长大幅改善。
- **要报架构师的两项**：strip 率 24%（基线 11%）、blanket 尾巴 21%（基线 1.9%）。26 h、33 轮，明天再看一天再定；若 09-13 仍是这个水平，建议先按档回退看 `REPLY_MODEL_HIGH=claude-opus-5` 有没有用——不过 strip 主要发生在 low/medium 档的功课轮，按档回退大概率够不到，那时候就要整体回退或者给 Sonnet 加一条「只写来源里有的遍数」的更硬提示（要架构师定）。
- chips：5 条重生成（见 1.1）；建议把夜审里 `refreshChipAnswers` 的预算从 150 s 提到 270 s（`/api/cron/refresh-chips` 用的就是 270 s），不然每晚都会剩 3 条——这一条等架构师点头。
- 明天（09-13）同一份表：审核（第一次有 Sonnet 判定）、strip／尾巴是否回落、时长。
