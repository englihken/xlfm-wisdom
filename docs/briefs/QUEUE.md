# 简报队列（架构师维护；CC 只改「状态」栏）

规则见 `AGENTS.md`。Ken 说「继续」即从上往下取第一条「待执行」。**开工第一步先把 docs/briefs、docs/canon、migrations 提交**（见 AGENTS.md）。

| # | 简报 | 模型 | 状态 | 报告 |
|---|---|---|---|---|
| **0** | **`2026-09-24-doctrine-guard.md` — 教义护栏（Ken 09-24 紧急）**：提示词绝对禁忌加「不教回向」「不为别处的灵性念经」「台长说过后面只接检索原文」，`practice.ts` 回向一节按第 77 问原文重写；新 `doctrine-guard.ts`（回向词／超度对象／归因三检测器，接现有重试→剥除流程，不加 blanket 尾巴，归因第一阶段只重试＋flag）；夜审标准加 g/h/i；R35／R36／R37；08-01 起离线扫描报告＋归因阈值校准样本；**§7 义工留言回访可见**（`pending-replies` 接口＋`/qa` 留言卡＋机器人读义工留言）。功课卡 `15eb9282` 三段新内容与 `docs/canon/pinned-cards.json`（updated_at 2026-09-24T11:57:47Z）架构师已做，随 canon 提交 | [opus] | 已交付 · `docs/reviews/2026-09-24-doctrine-guard.md` | `docs/reviews/2026-09-24-doctrine-guard.md` |
| 1 | `2026-09-24-quote-memory-and-prayer-fidelity.md` — 义工挑战案 `0bec6764` 的根治：已核实引文跨轮记忆（migration 054 `message_quotes`，护栏认前几轮原文、动态块给出处表、不再「撤回真话」）；【参考 N】写篇名＋日期；祈求词逐句核对（九月 608 条里 50 条正文非原文）＋节选软标记；问／答段核对（提问者的话不进引文块）；义理问题同修轮答法（不做表格分层）；访客措辞不提「检索」；R43–R46；离线扫描 | [opus] | 待执行 | `docs/reviews/2026-09-24-quote-memory-and-prayer-fidelity.md` |
| 2 | `2026-09-24-homework-intake-flow.md` — 功课分诊先问再给（架构师改定 C3）：`level=new` 的首轮不出 📿／遍数，程序保底剥除＋固定问句「刚接触还是已在念经做功课」＋SSE `quick_replies` 两个点选；点初学者 → 入门轮三部；点已在念 → 讲教导＋问「现在念哪些经、各几遍」，不替人定功课；明确入门意图直接给；migration 053 已 apply；📿 行只写一个数；R38–R42；报告上线前后 7 天回答率 | [opus] | 待执行 | `docs/reviews/2026-09-24-homework-intake-flow.md` |
| 8 | `2026-09-16-welcome-language.md` — 智慧问答开场弹窗先选语言：弹窗内三语 pill、`?lang=`／localStorage／浏览器语言决定默认、首页 EN／ID 链接带参数；第三语言名称待 Ken 定（Bahasa Malaysia vs Indonesia） | [opus] | 待执行 | `docs/reviews/2026-09-16-welcome-language.md` |
| 9 | `2026-09-16-xfz-sop-topic-pin.md` — 东方台秘书处小房子 SOP（2017.12）按话题钉入（migration 052 `pinned_topic`）；小房子祈求词统一为东方台写法（指南写法仍认）；**`/little-house/method` 网页（样稿 `docs/mockups/little-house-method.html`）+ 机器人「短答＋链接」**；R33／R34 | [opus] | 待执行 | `docs/reviews/2026-09-16-xfz-sop-topic-pin.md` |

## 已交付（近期）

| 简报 | 报告 |
|---|---|
| #7 Sonnet 观察第 4–6 天（09-14 → 09-16） | `docs/reviews/2026-09-16-sonnet-watch-day4-6.md`（夜审 NI 41.2→0→16.0%，不回退；访客 blanket 尾巴四天 0；chips 18/18 live；探针 3/3；EN 同修一例绿） |
| #6 `2026-09-13-architect-answers-2.md` | `docs/reviews/2026-09-16-architect-answers-2.md`（A1/A2/A3/A7/B1/B2/C 全做；修掉 pinned 卡被旧副本顶掉的检索 bug；R32 1/2、R29 长度、R32 断言严格度待架构师） |
| `2026-09-13-fellow-practitioner-mode.md`（+ addendum） | `docs/reviews/2026-09-13-fellow-practitioner.md` |
| `2026-09-13-xfz-retrieval-and-prayer-guard.md` | `docs/reviews/2026-09-13-xfz-retrieval-and-prayer-guard.md` |
| Sonnet 观察第 3 天 | `docs/reviews/2026-09-13-sonnet-watch-day3.md` §5 |
| `2026-09-13-xiaofangzi-entry.md` | `docs/reviews/2026-09-13-sonnet-watch-day3.md` §1 |
| `2026-09-13-prayer-form.md` §1–§3 | `docs/reviews/2026-09-13-prayer-form.md` |
| `2026-09-12-test-contacts.md` / `full-sutra-names.md` | `docs/reviews/2026-09-13-sonnet-watch.md` |
| `2026-09-12-strip-tails.md` | `docs/reviews/2026-09-12-strip-tails.md` |
| `2026-09-11-model-switch.md` / `homepage-quotes.md` / `batch-4-*` | 同名 reviews |

## 待 Ken（不在队列里）
- `/dashboard/review`：**27 通「教义纠正-回向」×21「教义纠正-超度附近灵性」×6**（09-24 架构师手标，open）。**最急：`aa792a3e`（heavy，已同时标关怀跟进）**——恐惧症发作、幻听叫她许愿、妈妈刚往生、独自在国外、失眠；机器人开错了往生咒、还自创了「收回愿」祈求词。请义工今天回访：更正为小房子给自己的要经者（第 113 问张数）、许错愿→礼佛忏悔＋跟菩萨说明、关心身心并劝看医生、帮她联系当地共修会——请义工按 reason 里的话回访更正；`ff422e0a`（Serdang 学生，宿舍靠近坟场）今天就要更正。
- `/dashboard/wisdom`：功课卡 `15eb9282` 点 **「重同步」**（新按钮；audit_log 里到 09-24 还没看到）。
- 「47 部著作」→「数十部著作」？
- 智库草稿 9 条 + 「功课遍数的上限与注意」（`c0b0dd44`）+ **小房子 SOP（`9b711282`，东方台 2017.12 转录）**：委员会讨论后批准。SOP 这一条与 #7 小房子规格卡互补，可以一起批。
