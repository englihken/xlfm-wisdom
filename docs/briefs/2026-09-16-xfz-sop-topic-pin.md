# 小房子 SOP（东方台秘书处 2017.12）按话题钉入 + 小房子祈求词统一（2026-09-16）[opus]

Ken 提供东方台秘书处《小房子念诵方法与注意事项（初学者）》修订 2017.12（样张 `docs/canon/xiaofangzi-sop-dongfangtai-2017-12.png`）。架构师逐条转录为智库条目 **`9b711282`**（`pinned_topic='xiaofangzi'`，draft，待 Ken 批准），并与《念诵指南》逐项核对：组合、念诵顺序（第 44 页第 7 问）、红笔／八分满（第 20 页）、由敬赠处点燃／拜谢词（第 31–33 页）全部一致；差别只在念诵前祈求的写法（指南 p17 短句 vs 海报全圣号长句），两种都是官方写法。

## 1. 按话题钉入（migration 052 已 apply，文件 `migrations/052_wisdom_entries_pinned_topic.sql`）

- `getPinnedCanonPassages()` 多取一类：`status='approved' and pinned_topic = ctx.topic`，只在 `RetrievalContext.topic` 命中时附上（现有 `pinned=true` 的照旧每轮附）。同一缓存、同一失效钩子。
- `docs/canon/pinned-cards.json` 快照增加 `pinned_topic` 字段（架构师维护）；本机无凭据时同样从文件读。
- 现在 topic 只有 `xiaofangzi`；`altar`／`fangsheng`／`dreams`／`crisis` 是预留值，检索侧先不判。

## 2. 小房子祈求词统一为东方台 2017.12 写法

- 提示词 `xiaofangzi.ts`：念诵前「祈请南无大慈大悲救苦救难广大灵感观世音菩萨摩诃萨帮助我 XXX，能够将所念的小房子送给 YYY」；烧送前「祈请南无大慈大悲救苦救难广大灵感观世音菩萨摩诃萨帮助我 XXX 能够将这 N 张小房子送给 YYY」；点燃前「祈请大慈大悲观世音菩萨慈悲我」；烧时「请大慈大悲观世音菩萨慈悲」；烧完「拜谢南无大慈大悲观世音菩萨帮助我 XXX 能够将这些小房子送给 YYY。感恩大慈大悲观世音菩萨保佑！」。追溯标 `ken-0916-xfz-sop`。
- 护栏祈求词开头清单加「祈请南无大慈大悲救苦救难广大灵感观世音菩萨摩诃萨帮助我」；《念诵指南》p17／p31 的两组照旧认（都是官方写法，访客问「指南里怎么写」时也要能答）。
- 「如何念诵小房子」类问题（R25 第 2 轮「如何念诵，可以教我吗」）：按 SOP 顺序答——写敬赠落款 → 念诵前祈求 → 念诵顺序（9→3+49→3+84→3+87→9，并说明不是唯一）→ 红笔点圈八分满 → 念完整张写日期 → 烧送（有／无佛台两套）→ 拜谢。功课块写法不变（📿 全称）。
- 回归：R24／R25 断言接受东方台写法与指南写法；新增 R33「小房子怎么点」（红笔、正中、八分满、不打勾不涂满、念完整张才写日期）、R34「没有佛台怎么烧小房子」（心香、一遍大悲咒一遍心经、举过头顶、由敬赠处点燃、烧时只说那一句、拜谢）。

## 2.5 SOP 网页 `/little-house/method`（Ken 09-16：让人点开看版面，而不是读一长段）

- 架构师做了网页版样稿 `docs/mockups/little-house-method.html`（同一份也发布在 claude.ai artifact 供 Ken 预览）：标题栏、注意事项、念诵前祈求、念诵顺序（9→3+49→3+84→3+87→9 的步骤轨）、点圈正误示意（SVG）、样张示意（SVG 画四列圆圈、敬赠、落款、日期）、烧送有／无佛台两个分页、《念诵指南》补充、来源与联系。
- CC 在 Next.js 里做成 `/little-house/method`：用站点的 sun-gold 设计令牌（`globals.css`），文字**逐字用智库条目 `9b711282` 的内容**（不要另写），页面底部标「东方台秘书处 修订 2017.12」；`check-site-quotes` 不管它（不是台长引言），但加一条单测：页面正文与 `docs/canon/pinned-cards.json`／智库条目文本一致（避免两处漂移）。手机优先、可打印。
- **机器人回复改为「短答＋链接」**：访客问怎么念／怎么点／怎么烧小房子时，正文只给最关键的 3–4 句（例如念诵前的祈求、顺序一句、红笔八分满、念完写日期），然后一行「📄 完整步骤（东方台秘书处 2017.12）：https://xlfm.my/little-house/method」；具体子问题（「用什么笔」「没有佛台怎么烧」）仍在正文答。链接进现有的「🔗」链接保护清单。
- 回归：R25 第 2 轮「如何念诵，可以教我吗」正文 ≤ 300 字且含该链接；R33／R34 仍要求正文答到点。
- 以后英文版：`books/english/A Guide to Reciting the Combination of Buddhist Scriptures - Little Houses.pdf` 是官方英译，可作 `/en/little-house/method` 的文本来源；不在本次。

## 3. 报告
`docs/reviews/2026-09-16-xfz-sop-topic-pin.md`，随代码提交合并；Ken 批准 `9b711282` 后跑一次 R24／R25／R33／R34。
