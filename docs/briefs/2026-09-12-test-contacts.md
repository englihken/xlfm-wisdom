# 预热／测试对话不再混进关怀收件箱（2026-09-12）

Ken 在收件箱看到一位「匿名访客」的有缘人档案写着「家庭冲突、子女教养压力、工作困顿、家人患病」，而当次对话只是问家人生病念什么。原因不是 IP 归并——网页访客的身份是浏览器里持久的 `browserId`，一人一个；是 **`warm-chips-prod.ts` 把同一语言的六条 chip 都用 `browserId=chip-warm:<lang>` 发出**，六个问题落在同一个 contact 上，档案引擎（按 contact 跨对话演进）如实把六个问题合成了一个人。档案只给义工看，不进回复的提示词，所以不影响任何访客的答案；但收件箱、未回复计数、夜审、复盘都被这 52 通（3 个 contact）污染了。

架构师已做：migration **050** `contacts.is_test`（已 apply；回填 `chip-warm:%`／`test:%`／`test-suite:%` 三个前缀），文件 `migrations/050_contacts_is_test.sql` 随本 brief 提交。

## CC 要做

1. **建 contact 时打标**：`route.ts` 的 find-or-create，`browserId` 以 `chip-warm:` / `test:` / `test-suite:` 开头 → `is_test=true`。前缀集中在 `src/lib/test-traffic.ts` 一处，`isTestBrowserId()`。
2. **过滤**（都按 `contacts.is_test = false`）：收件箱列表与三个 tab 的计数（全部／我接手的／未回复／复盘）；`cron/summarize`（档案与本次对话摘要）；夜审 `cron/review`（`conversation_reviews` 不审测试对话）；`failed_replies` 重试队列照常（预热失败也要知道），但「未回复」tab 不显示测试对话；报表页的对话数。
3. **不要删**这 52 通——它们是 chip 答案的样本，`chip_answers` 页面／脚本仍可引用。
4. 回归脚本 `test-regression-live.ts` 若将来改为打生产 `/api/chat`，一律带 `browserId: test-suite:<case>`；现在它走本地管道，不动。
5. 三个 chip-warm contact 已有的档案文字改成固定一句「（系统预热账号，非真实访客）」，`summary_updated_at` 不动，避免夜审再花钱重写。
6. 报告并进 `docs/reviews/2026-09-13-sonnet-watch.md`；提交合并。
