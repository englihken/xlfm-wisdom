# 简报队列（架构师维护；CC 只改「状态」栏）

规则见 `AGENTS.md`。Ken 说「继续」即从上往下取第一条「待执行」。**开工第一步先把 docs/briefs、docs/canon、migrations 提交**（见 AGENTS.md）。

| # | 简报 | 模型 | 状态 | 报告 |
|---|---|---|---|---|
| 3 | `2026-09-13-fellow-practitioner-mode.md` — 判级（level）、同修轮、不替已在修的人规划功课、长者关怀标记、R26–R31 | [opus]（分类器提示词若调不准再换 fable） | 已交付 · `docs/reviews/2026-09-13-fellow-practitioner.md`（R26/R27/R30/R31/F1/F2 两遍全绿；R29 修后 2/2；R28 第二轮结构断言 0/6，待架构师 7） | `docs/reviews/2026-09-13-fellow-practitioner.md` |
| 5 | `2026-09-13-xfz-retrieval-and-prayer-guard.md` — 小房子组合检索根因（p2 块、话题粘住整通对话、生产探针、出处归属）；祈求词不进引文块 + 护栏只核对开头；en/id 祈求词；小房子祈求词按《念诵指南》p17/p31；本机 pinned 卡读 `docs/canon/pinned-cards.json`；智库「重同步」按钮 | [opus] | 待执行 | `docs/reviews/2026-09-13-xfz-retrieval-and-prayer-guard.md` |
| 4 | Sonnet 观察第 3 天（做完 #3、#5 再跑，同一份数字一起看）：夜审首批 Sonnet 判定（NI 率 vs 17% 基线）、访客流量上的 strip／尾巴率、citation_no_date 比例、zh work_karma chip、cron/summarize 与 cron/review 对预热对话的处理、探针三问 | [opus] | 待执行 | `docs/reviews/2026-09-13-sonnet-watch-day3.md` §5 起 |

## 已交付（近期）

| 简报 | 报告 |
|---|---|
| `2026-09-13-xiaofangzi-entry.md`（首轮三部都开；关系类分档一 (a)） | `docs/reviews/2026-09-13-sonnet-watch-day3.md` §1 |
| `2026-09-13-prayer-form.md` §1–§3（§4 丢失 → 并入 #5） | `docs/reviews/2026-09-13-prayer-form.md` |
| `2026-09-12-test-contacts.md` | `docs/reviews/2026-09-13-sonnet-watch.md` §4 |
| `2026-09-12-full-sutra-names.md` | `docs/reviews/2026-09-13-sonnet-watch.md` §1 |
| `2026-09-12-strip-tails.md` | `docs/reviews/2026-09-12-strip-tails.md` |
| `2026-09-11-model-switch.md` | `docs/reviews/2026-09-11-model-switch.md` |
| `2026-09-11-homepage-quotes.md` | `docs/reviews/2026-09-11-homepage-quotes.md` |
| `2026-09-11-batch-4-addendum.md` / `batch-4-prompt-consolidation.md` | `docs/reviews/2026-09-11-batch-4.md` |

## 待 Ken（不在队列里）
- `/dashboard/wisdom`：功课卡 `15eb9282` **退役再批准**（重同步 Pinecone 副本；之后 CC 跑一次 `warm-chips-prod.ts`）。
- 「47 部著作」→「数十部著作」？
- 智库草稿 9 条 + 「功课遍数的上限与注意」（`c0b0dd44`）：委员会讨论后批准。

## 架构师已答（CC 报告里的「待架构师」）
- prayer-form §1 放生祈求词不改 ✅；en/id 祈求词改开头（#5）；祈求词引文误判 → 护栏只核开头（#5）；小房子祈求词按《念诵指南》（#5）；智库重同步按钮（#5）。
- day-3 §1.3 a/b → #5 第 1 节；c 出处归属 → #5 第 1.4；关系类 (a) 保持；两条智库草稿已按三部口径改（SQL 已做）。
