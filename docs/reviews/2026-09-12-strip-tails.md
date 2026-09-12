# strip 24%／尾巴 21% 的修法 — 交付报告（2026-09-12）

对应 `docs/briefs/2026-09-12-strip-tails.md`。顺序 B → A → C，模型不回退。

## B. strip 不再留孤儿祈求词（`src/lib/verbatim-guard.ts`）

- **功课行只换数字、不删句**：`isHomeworkLine()`（以 📿 开头，或含《经名》且带遍／张）命中时，`stripViolations` 不再删句子，而是把违规的数字＋单位换成 `（遍数以官方资料为准）`（`COUNT_PLACEHOLDER`），经名、祈求词都留下。替换是**成对**的：同一行「《大悲咒》每天7遍、《礼佛大忏悔文》每天7遍」只换礼佛那个 7遍（`replaceCountTokens` 用 `extractNumberPairsByLine` 给每个数字段找到它绑的主语）。
- **整行删掉时带走孤儿**：非功课的裸数字句（「每天念 21 遍。」）整行删掉后，紧随其后的祈求词行（念之前祈求／祈求：／请大慈大悲观世音菩萨…）一并删。
- **尾巴**：`chooseGuardTail` 在有占位符时返回 `partial`（scoped 说明），只有既无数字也无占位符才 `blanket`；`extractNumberTokens` 对占位符返回空，所以 `scrubContradictoryRefusal`／`isOverStripped` 的既有分支不受影响（经名还在 → 不再触发过度 strip 重生成）。
- **N10** 进 `test-verbatim-guard.ts`：`d7897fd1` 07:14 那条草稿（案例来源里的 往生咒 21 → `number_case_generalized`）→ 输出「📿 **《往生咒》每天（遍数以官方资料为准）**」＋祈求词，无孤儿、不过度 strip、尾巴 partial；N10b 裸数字行连祈求词一起删；N10c 同行一好一坏只换坏的。N8 和「gutted shape」两条旧断言按新语义改（礼佛行保留、不再被掏空）。**124/124。**

## A. 标准遍数卡钉进每一轮

- **`wisdom-sync.ts`**：`WisdomEntryForSync.pinned`，记录 metadata 多一个 `pinned`（批准时随 upsert 写进 Pinecone）。
- **`vector-search.ts`**：`getPinnedCanonPassages()`——有 Supabase 时读 `wisdom_entries where status='approved' and pinned=true`，用 `buildWisdomRecord` 生成和 Pinecone 里一模一样的文本，作为 `type=canonical_ruling`、`book=组织审定`、`pinned=true` 的 passage；进程内缓存 5 分钟。本机脚本没有 Supabase 钥匙时走 Pinecone `filter {pinned:true, type:canonical_ruling}`（同一条记录）。`searchRelevantTeachings` 的每次返回都 `withPinnedCanon()` 追加（去重），zh/en/id 一样，不参与排序、不受 topK 限制。
- **失效钩子**：`invalidateChipAnswers()` 开头调 `invalidatePinnedCanon()`；智库路由在 **批准、退役、已批准条目被改回草稿** 三处都调 `invalidateChipAnswers`（原来只有批准）。
- **护栏（A.2）**：`checkDraft` 本来就先查「任一非案例来源」再查案例（`general.has(p)` 在 `cases.has(p)` 之前），卡进了 `chunkTexts` 就自然成为非案例来源；`care-pipeline` 的 `canonicalTexts` 按 `type=canonical_ruling` 收，卡自动进 canonical 层。`test-guard-with-retrieval.ts` 加了模型无关的断言：案例块「往生咒21」＋卡「21、27或49遍」→「《往生咒》每天 21 遍」放行；没有卡则仍是 `number_case_generalized`；卡单独能落地 解结咒21／消灾49／大悲咒7，不落地卡里没有的 33遍。
- **A.3**：卡＋161 礼佛卡同时在 canonical 层：「《礼佛大忏悔文》每天 3 遍」无 `number_canonical_conflict`；「旧版写 13遍」仍 conflict。**7/7。**
- **现状**：卡 `15eb9282…` 仍是 `draft`，`pinned=true`——**Ken 在 `/dashboard/wisdom` 批准后才生效**（脚本最后一行打印「pinned cards attached to a live retrieval: 0 — entry not approved yet」）。智库页面没改：`pinned` 由架构师用 SQL 设，页面不显示也不能改它。

## C. 顺带

- 夜审 `refreshChipAnswers` 预算 150 s → 270 s（`/api/cron/review`，`maxDuration` 已是 300）。
- **程序补日期**（`care-pipeline.ts` `fillCitationDates`）：软检查重试之后、打标记之前，引用行仍没日期就从检索段落 metadata 补——《解答来信疑惑（第N篇）》按 `post_title` 里的「（N）」找到那条 `original_date` → 行内补「（开示于YYYY年M月D日）」；玄艺问答／玄艺综述／玄学问答／精彩节目摘录 → 同书的检索段落只有一个日期时补「（YYYY年M月D日节目）」，多个日期或没检到就留给 `citation_no_date`。不经模型。探针：第七百五十篇补上、《玄艺问答》两个候选日期不补、《玄艺综述》没段落不补。
- **R22–R24** 进 `test-regression-live.ts`（访客原话原样）：R22 `d7897fd1` 四轮（梦见蛇 → 有 → 大悲咒21 → 心经21），断言 ≥2 部经各带遍数、无孤儿祈求词、无 blanket 尾巴、占位符只能贴着经名；R23「眼睛不好是不是有灵性」：不套图腾、给功课或小房子、无尾巴、无孤儿；R24「化解三六九关劫的小房子怎么念？」：含「分开／分别」、含祈求词和「关劫」、无尾巴、无孤儿。共用 `orphanPrayer()` 检查（祈求行上两行内必须有经名）。
- 回归脚本 `test-guard-with-retrieval.ts` 一条 08-29 的旧断言（「记忆里的 大悲咒 21遍 必被判」）在 09-11 的枚举／合行修复后已经不成立——《入门手册》p29「念《大悲咒》7 - 21 遍」检到时 21 是有据的；改成按规则断言（检到就放行，没检到就判）。**20/20。**

## 验证
- tsc 零错；eslint 零错。`test-verbatim-guard.ts` 124/124；`test-guard-with-retrieval.ts` 20/20（含 A.2/A.3）；`test-crisis-keywords.ts` 43/43。
- **R22–R24 与 R10/R13/R14/R18 各跑 2 次**：按 brief 等 Ken 批准 10 条智库条目、重预热 18 条 chips 之后再跑，写进 `docs/reviews/2026-09-13-sonnet-watch.md`（本报告不含）。

## 部署
__DEPLOY__
