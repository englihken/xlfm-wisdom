# Sonnet 4.6 观察 — 第 1 天（2026-09-12）

对应 `docs/briefs/2026-09-11-model-switch.md` §观察期。切换上线：2026-09-11 约 18:05 MYT（合并见 git log「model switch」；下面 SQL 里的 `<切换时刻>` 用 `18:05`）。

> **状态：基线已算，当天数据待明早补。** 下面「基线」是 09-11 会话里算好的；「09-12 数据」各栏留空，明早按每栏给的 SQL／步骤填。

## 0. 切换前 Opus 5 基线（09-04 → 09-11，生产）

### 0.1 每轮时长（`messages` user→assistant 时间差；整轮 wall，不是首字）

| 日 | 轮数 | p50 | p90 |
|---|---|---|---|
| 09-05 | 33 | 31.1 s | 57.2 s |
| 09-06 | 51 | 32.2 s | 78.6 s |
| 09-07 | 22 | 31.2 s | 90.7 s |
| 09-08 | 24 | 35.8 s | 100.1 s |
| 09-09 | 22 | 53.2 s | 142.5 s |
| 09-10 | 40 | 36.3 s | 73.2 s |
| 09-11（切换前为主，含本会话的测试对话） | 55 | 23.7 s | 44.7 s |

七天合并：**p50 ≈ 33 s，p90 ≈ 80 s**。回退线「首轮 p50 > 15 s 连续两天」是首字口径，生产首字只能从 Vercel 日志 `[care-pipeline] timing … first_text_ms=` 读；本表是整轮时长的代理。

### 0.2 审核未过率（`conversation_reviews`，新尺子）

- 旧尺子（切换前 7 天，98 通）：needs_improvement 1 通（1.0%），c/d/e/f 类 0——不能当基线，因为旧尺子不惩罚「该答不答」。
- **新尺子基线：** 今晚 00:30 的夜审是新尺子第一次跑生产对话，审的是 09-11 全天——绝大部分是 Opus 回复（切换在傍晚）。所以 **09-12 早上 `conversation_reviews` 里 09-11 的判定 = 切换前 Opus 在新尺子下的基线**，不用另算；09-13 早上看到的 09-12 判定 = Sonnet 首日。想要 7 天口径再用 `calibrate-review-rubric.ts` 重跑导出集（batch 3 §4 的做法）。参考值：batch 3 校准集里「带拒答尾巴」的 Opus 对话 38 通新尺子翻了 33 通；「干净」的 20 通 19 通仍 good。
  ```sql
  select r.verdict, count(*) from conversation_reviews r join conversations c on c.id=r.conversation_id
  where c.created_at >= '2026-09-11 00:00+08' and c.created_at < '2026-09-11 <切换时刻> +08' group by 1;
  ```

### 0.3 其他
- `failed_replies` 近 7 天：0。
- 护栏（`audit_log` action=`care.guard`，近 7 天，只记护栏动过的轮）：stripped **29**、passed_after_retry 57、clean-but-scrubbed 11；同期 assistant 轮约 192 → **strip 率 ≈ 15%**（回退线就是 15%，Opus 本来就贴着线）。

## 1. 09-12 数据（明早填）

### 1.1 18 条 chips（00:30 刷新后应全部是 Sonnet 生成）
```sql
select chip_key, language, to_char(generated_at at time zone 'Asia/Kuala_Lumpur','MM-DD HH24:MI') as generated_myt,
       invalidated_at is null as live, guard_outcome, model, length(answer_text) as chars,
       position('查不到相关原文' in answer_text) > 0 as blanket_tail,
       (select count(*) from regexp_matches(answer_text, '\d+\s*遍', 'g')) as bian_counts
from chip_answers order by language, chip_key;
```
逐条看：有没有 blanket 尾巴、遍数齐不齐（zh 至少两部经各带遍数）、正文 ≤ 400 字（功课块不计——去掉 📿／祈求／⚠️／🔗 行再数）。有问题的那条：`update chip_answers set invalidated_at=now() where chip_key=… and language=…;` 然后 `npx tsx scripts/warm-chips-prod.ts --only <key>:<lang>`。

| chip | zh | en | id |
|---|---|---|---|
| insomnia | | | |
| family_conflict | | | |
| work_karma | | | |
| child_emotions | | | |
| beginner_first_step | | | |
| family_illness | | | |

### 1.2 每轮时长（同 0.1 的 SQL，限 `created_at >= '2026-09-11 <切换时刻> +08'`）
| | 轮数 | p50 | p90 |
|---|---|---|---|
| Sonnet 首日 | | | |

### 1.3 审核（00:30 那一跑）
```sql
select r.verdict, count(*) from conversation_reviews r join conversations c on c.id=r.conversation_id
where c.created_at >= '2026-09-11 <切换时刻> +08' group by 1;
select r.reason from conversation_reviews r join conversations c on c.id=r.conversation_id
where c.created_at >= '2026-09-11 <切换时刻> +08' and r.verdict='needs_improvement';
```
未过率 vs 基线 0.2：高于 1.5 倍 → 先 `REPLY_MODEL_HIGH=claude-opus-5`（若只有 high 档露怯）→ 报架构师。

### 1.4 护栏 / 引用日期
```sql
select after->>'outcome' as outcome, count(*) from audit_log where action='care.guard' and created_at >= '2026-09-11 <切换时刻> +08' group by 1;
select count(*) from audit_log where action='care.citation_no_date' and created_at >= '2026-09-11 <切换时刻> +08';
select count(*) from messages where flags @> array['citation_no_date'] and created_at >= '2026-09-11 <切换时刻> +08';
```
strip > 15% 或尾巴明显增多 → 报架构师。

### 1.5 人工审（回退线：任何一条过了护栏但数字无据，或门槛说错「先念两周」「要会四部经」→ 立即整体回退，贴对话）
```sql
select m.conversation_id, left(m.content, 400) from messages m where m.role='assistant' and m.created_at >= '2026-09-11 <切换时刻> +08'
and (m.content like '%两周%' or m.content like '%两个礼拜%' or m.content like '%会四部经%' or m.content like '%熟练才%') ;
```

### 1.6 未回复 / 队列
```sql
select count(*) from failed_replies where created_at >= '2026-09-11 <切换时刻> +08';
```

## 2. 结论（明早写）
