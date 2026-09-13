# 同修轮 · 增补：level 怎么定（架构师答 CC 09-13）

选 **方案 1（关键词线索，回复前、零延迟）**，加两层兜底；不要在每轮回复前多打一次 Haiku——首字 2.2 s 是刚拿回来的，不拿去换判级。

1. **回复前**：`level-cues.ts` 在检索前机械匹配访客**本轮＋本通对话所有访客轮**（不只本轮），取最高级；再与 `conversations.level`（已持久化的）和 `contacts.stage`（义工设的，同修＝experienced）取最高。判不准宁可判高。
2. **回复后**：现有的 `after()` Haiku 分类器多返回一个 `level` 字段，写回 `conversations.level`——**只升不降**（migration 051 已 apply：`conversations.level`、`conversations.needs_care`，文件 `migrations/051_conversations_level_needs_care.sql`）。第 2 轮起，线索表漏掉的细微情况由它补上。
3. **提示词兜底**：同修轮章节开头写明——「即使系统判级为 new／beginner，只要访客的话里显示出已在修行（线索：清修、境界、要经者、自存、自己的功课遍数、许过的愿、拜师、年事已高等），就按同修轮回答，不出功课块、不问有没有念经」。模型看得到整通对话，这一层覆盖线索表和分类器都漏掉的情况，零延迟。
4. `needs_care`：同样三处——线索（年事已高／安老院／身体不好／孤单／家人不修／独居）回复前打；`after()` Haiku 返回 `needs_care` 写回；收件箱「关怀跟进」筛选读这个列。
5. 线索命中率作为回归的一部分：R26–R31 六例回复前判级必须已是 experienced（不靠 after()）；反例两条必须不是。
