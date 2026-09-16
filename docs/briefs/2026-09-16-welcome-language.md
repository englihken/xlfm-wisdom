# 智慧问答开场页：先选语言，再看说明（2026-09-16）[opus]

Ken：英文访客打开 `/qa`，开场说明全是中文，只能硬着头皮点「我明白了」——等于没同意什么。查了代码：**三种语言的开场文案早就在 `src/app/qa/page.tsx` 的 `TRANSLATIONS` 里**（zh／en／id 的 welcome* 全套），问题只是三处：

1. `useState<'zh'|'en'|'id'>('zh')`——永远先开中文；
2. 语言切换（中文／EN／ID）在聊天页顶栏，**被开场弹窗盖住**，访客点掉弹窗之前根本切不了；
3. 首页 Header 的「EN / ID → 智慧问答」链接是裸的 `/qa`，不带语言。

## 要做

1. **弹窗顶部放语言切换**：三个 pill「中文 · English · Bahasa」，点了弹窗文案（含按钮）立刻换；同一个 `language` state。
2. **首次进入的默认语言**：优先级 `?lang=` → `localStorage.xlfm_lang` → `navigator.language`（`zh*`→zh；`en*`→en；`ms*`／`id*`→id；其他→en）→ 兜底 zh。选定后写 `localStorage.xlfm_lang`；顶栏切换也写。
3. **首页链接带语言**：Header「EN / ID」拆成两个链接 `/qa?lang=en`、`/qa?lang=id`；WisdomQA 区块的按钮保持 `/qa`（中文页来的就是中文）。
4. **第三语言的名字要说清**：现在代码里叫 `id`、提示词包装句写 "Respond in Bahasa Indonesia"，但弹窗文案是马来文（「mulakan」「Kecemasan Perubatan」「Keganasan Rumah Tangga」），chips 又是印尼文（「kali」「istirahat」）。**Ken 定**：马来西亚总会的第三语言是 Bahasa Malaysia 还是 Bahasa Indonesia？定了之后：pill 标签、包装句、弹窗文案、chips 统一成一种；代码键 `id` 不用改。
5. 弹窗里「基于台长 47 部著作」那行：Ken 若定「数十部」则三语一起改（`welcomeOffer1`）。
6. 回归：Playwright 三条——`/qa?lang=en` 首屏弹窗英文、按钮英文；`Accept-Language: id` 无参数进入 → 马来／印尼文；弹窗里切中文后 `localStorage.xlfm_lang=zh`，刷新仍中文。

## 不在本次（另议）

首页本身只有中文。英文／印尼文访客从首页进来，看不懂「心灵法门是什么」。做英文首页是另一个 brief：文案可以译，**台长引言不能译成「原话」**——保留中文原句，下面放标注为译文的英文（「translation」），登记表照样只登中文原句。等 Ken 决定要不要做。

## 报告
`docs/reviews/2026-09-16-welcome-language.md`，随代码提交合并。
