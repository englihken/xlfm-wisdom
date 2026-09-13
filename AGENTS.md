<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# 工作方式（架构师 ↔ Claude Code）

- 架构师（Cowork 会话）写简报到 `docs/briefs/`，并维护队列 **`docs/briefs/QUEUE.md`**。数据库迁移由架构师 apply，文件写回 `migrations/`；组织审定卡的快照在 `docs/canon/pinned-cards.json`（架构师每次改卡后重新导出）。
- **Ken 说「继续」「go」「next」或只是让你开始时：先读 `docs/briefs/QUEUE.md`**，取第一条「待执行」的简报，读完再动手；一条做完（含报告、提交、合并——合并自己做，不用发链接）再取下一条。执行前把该条改成「执行中」，交付后改成「已交付 · 报告路径」。队列空了就说队列空了。
- **开工第一步**：`git add docs/briefs docs/canon migrations && git commit -m "architect: briefs/canon/migrations"`（架构师直接写在工作树，没有提交）。之后才开分支。**永远不要**对 `docs/briefs/`、`docs/canon/`、`migrations/` 做 `git checkout --`、`git stash`、`git reset --hard`、`git clean`——09-13 一份简报的第 4 节就是这样丢的。
- 每条简报的报告写到简报指定的 `docs/reviews/…` 路径，随代码一起提交。追溯表、回归日志放 `docs/reviews/<批次目录>/`。
- 简报里标 `[opus]` 的是纯执行，Ken 可用 Opus 跑；标 `[fable]` 的需要探因。
- 不要改 `docs/briefs/` 里的简报内容（有异议写进报告的「待架构师」一节）；`QUEUE.md` 只改状态栏。
- 智库条目（`wisdom_entries`）内容归架构师与委员会，代码不写死教义数字；祈求词与遍数以 pinned 功课卡为准。本机没有 Supabase 凭据时，pinned 卡从 `docs/canon/pinned-cards.json` 读（与生产同一文本）。
- 只用只读 git 命令读历史（架构师端也是）；提交、合并由你完成。
