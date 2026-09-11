# 首页引言核实与修正 — 交付报告（2026-09-11）

对应 `docs/briefs/2026-09-11-homepage-quotes.md`。核实语料是架构师做的，我只改线上组件、建登记表、加检查。

## 1. 线上改动（三处，逐字用 brief 的替换文案）

| 组件 | 改前 | 改后 |
|---|---|---|
| `src/components/MasterLuSection.tsx` | 「台长非常非常地爱你们，希望你们每个人都要想通。」— 卢军宏台长 | 「好好相信观世音菩萨，你们的明天一定会更美。」— 卢军宏台长 · 2014 年 6 月香港弘法解答会（3）台长语 |
| `src/components/BaihuaFofa.tsx` | 「想得通就是开悟，没有烦恼就是有智慧。」— 卢军宏台长 | 「想得通就是开悟，没有烦恼**的人**就是有智慧。」— 卢军宏台长 2012 年 11 月 11 日悉尼法会 |
| `src/components/WisdomQA.tsx` | 来源：卢台长精彩节目摘录 · 玄学问答 2015年5月22日 · 师父原话，未经修改 | 来源：《玄艺综述》2015 年 5 月 23 日 · 卢台长精彩节目摘录（东方台 2015 年 7 月 19 日发布） · 师父原话，未经修改（句子不动） |

- Hero（「不要着急，有菩萨在，什么都不怕。」）按 brief 只登记、不上线——现线上 Hero 没有署名引言。
- 「所有回答均基于卢台长的原始开示内容，我们不添加、不修改、不曲解任何内容。AI 只负责帮您找到最相关的开示。」线上原句未动（Design v2 的绝对化版本不采用，由 Ken 在 Design 那边处理）。「47 部著作」这次没碰——它不在 brief 要我改的三处里，见 §4。

## 2. 登记表 `docs/site-quotes.json`

四条署名引言（Hero、认识心灵法门、白话佛法、智慧问答）各带 `text / attribution / source / verified_by: "architect" / verified_on: "2026-09-11"`；另有 `not_a_quote` 一条记「让世界充满观世音菩萨慈悲的爱」出自《白话佛法》前言，不能署台长。文件头写明：**只有架构师核实过的句子才能进表；进表是唯一放行依据。**

## 3. 检查 `scripts/check-site-quotes.ts`（挂在 `npm run lint`）

- 扫 `src/components/**/*.tsx` 与 `src/app/**/page.tsx`：(a) 「…」括起的 JSX 文本（跨行、`<br />` 分开的也算）；(b) `quote-card-body` 段落的正文。凡 6 行内出现「台长」/「师父」署名的，句子必须逐字在登记表里，否则退出码 1。
- 只看至少 6 个汉字的句子，避免把 `{props.children}` 这类运行时容器或代码残片当引言。
- `package.json`：`"lint": "eslint && tsx scripts/check-site-quotes.ts"`。现在跑：4 条署名引言全部命中登记表，0 条未登记。
- 机器人回复里的引用（`assistant-message.tsx` 的金色卡片）是运行时内容，由护栏（`verbatim-guard.ts`）逐字核对，不在这个检查范围。

## 4. 没做／提醒
- 「47 部著作」（`MasterLuSection` 等处）brief 说口径说不清就改「数十部著作」或写实际本数——这条没在「Claude Code 要做的」清单里，我没改，等 Ken 定口径。
- 新引言以后进表前，先给架构师在语料里核实（30 本书 PDF + lujunhong2or 快照）。
