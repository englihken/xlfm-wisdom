# Batch 4 — v1 → v2 traceability（机械生成：`npx tsx scripts/prompt-v2-verify.ts --write --i18n`）

生成时间 2026-09-11T08:30:55.905Z。行号 = `src/lib/system-prompt.v1.ts`（与 brief 的 L 号一致）。

- v2 中文非空行 **1963**：追溯到 v1 的 **1932**，C1–C8 新增 **31**，追溯不到 **0**。
- v1 内容行未进 v2 的 **60**：有 C 号依据 60，无依据 0。
- 三张表：合并 330 行、删除 60 行、新增 31 行。

## 清单核对（数字、经名、链接、电话、祈求词）

| 类别 | v1 | v2 | 只在 v1 | 只在 v2 |
|---|---|---|---|---|
| books | 48 | 48 | — | — |
| urls | 8 | 8 | — | — |
| phones | 43 | 43 | — | — |
| counts | 21 | 21 | — | — |
| prayers | 34 | 34 | — | — |

## EN／ID 翻译核对（逐行：行数相同；清单项目须在译文中原样出现）

| 模块 | 行数（译/中） | 缺失 |
|---|---|---|
| en/core | 388/388 | books: 《[书名]》 |
| en/tiers | 401/401 | — |
| en/practice | 365/365 | — |
| en/xiaofangzi | 229/229 | — |
| en/relationships | 363/363 | — |
| en/crisis | 224/224 | books: 《[书名]》 |
| en/altar | 112/112 | — |
| en/sources | 59/59 | — |
| en/misc | 585/585 | — |
| id/core | 388/388 | books: 《[书名]》 |
| id/tiers | 401/401 | — |
| id/practice | 365/365 | — |
| id/xiaofangzi | 229/229 | — |
| id/relationships | 363/363 | — |
| id/crisis | 224/224 | — |
| id/altar | 112/112 | — |
| id/sources | 59/59 | — |
| id/misc | 585/585 | — |

## 一、合并（v1 哪几处 → v2 哪一处）

同一模块内连续的 v1 行合并成一行显示。

| v1（行） | v2 模块（行） | 行数 |
|---|---|---|
| L6–92 | core.ts L1–81 | 87 |
| L1243–1293 | core.ts L83–132 | 51 |
| L640–653 | core.ts L134–146 | 14 |
| L1003–1053 | core.ts L148–197 | 51 |
| L1055–1088 | core.ts L200–233 | 34 |
| L327 | core.ts L234 | 1 |
| L1090 | core.ts L235 | 1 |
| L327 | core.ts L236 | 1 |
| L1092–1120 | core.ts L237–265 | 29 |
| L327 | core.ts L266 | 1 |
| L1122 | core.ts L267 | 1 |
| L327 | core.ts L268 | 1 |
| L1124 | core.ts L269 | 1 |
| L327 | core.ts L270 | 1 |
| L1126 | core.ts L271 | 1 |
| L327 | core.ts L272 | 1 |
| L1128–1132 | core.ts L273–277 | 5 |
| L327 | core.ts L278 | 1 |
| L1134 | core.ts L279 | 1 |
| L327 | core.ts L280 | 1 |
| L1136–1159 | core.ts L281–304 | 24 |
| L2767–2815 | core.ts L306–353 | 49 |
| L2849–2854 | core.ts L355–360 | 6 |
| L2659–2675 | core.ts L362–378 | 17 |
| L1170–1179 | core.ts L380–388 | 10 |
| L917–931 | tiers.ts L1–14 | 15 |
| L935–963 | tiers.ts L24–52 | 29 |
| L961 | tiers.ts L53 | 1 |
| L966–1000 | tiers.ts L55–89 | 35 |
| L2078–2087 | tiers.ts L91–99 | 10 |
| L538 | tiers.ts L101 | 1 |
| L2091 | tiers.ts L103 | 1 |
| L2095–2114 | tiers.ts L107–125 | 20 |
| L538 | tiers.ts L127 | 1 |
| L2118–2124 | tiers.ts L129–135 | 7 |
| L2125–2137 | tiers.ts L137–148 | 13 |
| L538 | tiers.ts L150 | 1 |
| L2141 | tiers.ts L152 | 1 |
| L2120 | tiers.ts L154 | 1 |
| L2144–2152 | tiers.ts L155–163 | 9 |
| L2130 | tiers.ts L165 | 1 |
| L2155–2157 | tiers.ts L166–168 | 3 |
| L538 | tiers.ts L170 | 1 |
| L2161–2181 | tiers.ts L172–192 | 21 |
| L538 | tiers.ts L195 | 1 |
| L2187–2205 | tiers.ts L197–215 | 19 |
| L538 | tiers.ts L217 | 1 |
| L2042 | tiers.ts L219 | 1 |
| L2451 | tiers.ts L221 | 1 |
| L2454–2470 | tiers.ts L224–240 | 17 |
| L2536–2540 | tiers.ts L243–247 | 5 |
| L2543–2547 | tiers.ts L249–253 | 5 |
| L1989 | tiers.ts L255 | 1 |
| L1296–1311 | tiers.ts L257–271 | 16 |
| L206–208 | tiers.ts L272–274 | 3 |
| L1316–1337 | tiers.ts L276–297 | 22 |
| L1374–1399 | tiers.ts L299–323 | 26 |
| L1420–1436 | tiers.ts L325–341 | 17 |
| L2679 | tiers.ts L345 | 1 |
| L2683–2687 | tiers.ts L349–353 | 5 |
| L2691–2712 | tiers.ts L355–376 | 22 |
| L2741–2753 | tiers.ts L378–390 | 13 |
| L2640 | tiers.ts L392 | 1 |
| L2757–2762 | tiers.ts L394–399 | 6 |
| L1989 | tiers.ts L401 | 1 |
| L95–217 | practice.ts L1–122 | 123 |
| L206–207 | practice.ts L123–124 | 2 |
| L220–251 | practice.ts L125–156 | 32 |
| L506–535 | practice.ts L158–186 | 30 |
| L536–559 | practice.ts L188–211 | 24 |
| L546 | practice.ts L212 | 1 |
| L561–565 | practice.ts L213–217 | 5 |
| L546 | practice.ts L218 | 1 |
| L567–571 | practice.ts L219–223 | 5 |
| L546 | practice.ts L224 | 1 |
| L573–577 | practice.ts L225–229 | 5 |
| L546 | practice.ts L230 | 1 |
| L579–590 | practice.ts L231–242 | 12 |
| L546 | practice.ts L243 | 1 |
| L592–596 | practice.ts L244–248 | 5 |
| L546 | practice.ts L249 | 1 |
| L598–603 | practice.ts L250–255 | 6 |
| L546 | practice.ts L256 | 1 |
| L605–612 | practice.ts L257–264 | 8 |
| L538 | practice.ts L266 | 1 |
| L616–637 | practice.ts L268–289 | 22 |
| L1182–1240 | practice.ts L291–348 | 59 |
| L2714–2729 | practice.ts L350–365 | 16 |
| L369–397 | xiaofangzi.ts L1–28 | 29 |
| L401–495 | xiaofangzi.ts L30–124 | 95 |
| L320 | xiaofangzi.ts L126 | 1 |
| L498–503 | xiaofangzi.ts L127–132 | 6 |
| L2213–2276 | xiaofangzi.ts L136–199 | 64 |
| L2508–2510 | xiaofangzi.ts L201–203 | 3 |
| L2215–2218 | xiaofangzi.ts L205–208 | 4 |
| L2517–2532 | xiaofangzi.ts L210–225 | 16 |
| L2874 | xiaofangzi.ts L229 | 1 |
| L656–689 | relationships.ts L1–33 | 34 |
| L1631 | relationships.ts L35 | 1 |
| L1636 | relationships.ts L39 | 1 |
| L538 | relationships.ts L41 | 1 |
| L1640–1644 | relationships.ts L43–47 | 5 |
| L1647–1659 | relationships.ts L50–62 | 13 |
| L538 | relationships.ts L64 | 1 |
| L1663–1672 | relationships.ts L66–75 | 10 |
| L327 | relationships.ts L76 | 1 |
| L1674–1683 | relationships.ts L77–86 | 10 |
| L1687–1688 | relationships.ts L94–95 | 2 |
| L327 | relationships.ts L96 | 1 |
| L1690–1692 | relationships.ts L97–99 | 3 |
| L327 | relationships.ts L100 | 1 |
| L1694–1695 | relationships.ts L101–102 | 2 |
| L1692 | relationships.ts L103 | 1 |
| L327 | relationships.ts L104 | 1 |
| L1698–1699 | relationships.ts L105–106 | 2 |
| L1703–1725 | relationships.ts L108–130 | 23 |
| L977 | relationships.ts L131 | 1 |
| L957 | relationships.ts L133 | 1 |
| L1729–1732 | relationships.ts L134–137 | 4 |
| L538 | relationships.ts L139 | 1 |
| L1736–1751 | relationships.ts L141–156 | 16 |
| L538 | relationships.ts L158 | 1 |
| L1755–1759 | relationships.ts L160–164 | 5 |
| L327 | relationships.ts L165 | 1 |
| L1761–1765 | relationships.ts L166–169 | 5 |
| L327 | relationships.ts L170 | 1 |
| L1767–1769 | relationships.ts L171–173 | 3 |
| L538 | relationships.ts L175 | 1 |
| L1773 | relationships.ts L177 | 1 |
| L1116 | relationships.ts L181 | 1 |
| L836 | relationships.ts L183 | 1 |
| L1779 | relationships.ts L185 | 1 |
| L327 | relationships.ts L186 | 1 |
| L1678 | relationships.ts L187 | 1 |
| L327 | relationships.ts L188 | 1 |
| L1783 | relationships.ts L189 | 1 |
| L327 | relationships.ts L190 | 1 |
| L1128 | relationships.ts L191 | 1 |
| L327 | relationships.ts L192 | 1 |
| L1687–1688 | relationships.ts L193–194 | 2 |
| L327 | relationships.ts L195 | 1 |
| L1690–1691 | relationships.ts L196–197 | 2 |
| L1792 | relationships.ts L198 | 1 |
| L327 | relationships.ts L199 | 1 |
| L1794 | relationships.ts L200 | 1 |
| L1695 | relationships.ts L201 | 1 |
| L1792 | relationships.ts L202 | 1 |
| L327 | relationships.ts L203 | 1 |
| L1698 | relationships.ts L204 | 1 |
| L1799 | relationships.ts L205 | 1 |
| L327 | relationships.ts L206 | 1 |
| L1134 | relationships.ts L207 | 1 |
| L327 | relationships.ts L208 | 1 |
| L1803 | relationships.ts L209 | 1 |
| L327 | relationships.ts L210 | 1 |
| L1136 | relationships.ts L211 | 1 |
| L538 | relationships.ts L213 | 1 |
| L1809 | relationships.ts L215 | 1 |
| L1812–1818 | relationships.ts L218–224 | 7 |
| L538 | relationships.ts L226 | 1 |
| L1822–1824 | relationships.ts L228–230 | 3 |
| L538 | relationships.ts L232 | 1 |
| L1828–1831 | relationships.ts L234–237 | 4 |
| L1833–1834 | relationships.ts L239–240 | 2 |
| L538 | relationships.ts L242 | 1 |
| L1838–1864 | relationships.ts L244–270 | 27 |
| L538 | relationships.ts L272 | 1 |
| L1868–1870 | relationships.ts L274–276 | 3 |
| L1779 | relationships.ts L278 | 1 |
| L327 | relationships.ts L279 | 1 |
| L1874 | relationships.ts L280 | 1 |
| L327 | relationships.ts L281 | 1 |
| L1128–1130 | relationships.ts L282–284 | 3 |
| L1879–1880 | relationships.ts L285–286 | 2 |
| L327 | relationships.ts L287 | 1 |
| L1882 | relationships.ts L288 | 1 |
| L327 | relationships.ts L289 | 1 |
| L1803 | relationships.ts L290 | 1 |
| L1886–1888 | relationships.ts L292–294 | 3 |
| L327 | relationships.ts L295 | 1 |
| L1890 | relationships.ts L296 | 1 |
| L327 | relationships.ts L297 | 1 |
| L1892–1896 | relationships.ts L298–302 | 5 |
| L327 | relationships.ts L303 | 1 |
| L1898 | relationships.ts L304 | 1 |
| L538 | relationships.ts L306 | 1 |
| L1902–1928 | relationships.ts L308–334 | 27 |
| L1845 | relationships.ts L335 | 1 |
| L1930–1931 | relationships.ts L336–337 | 2 |
| L1849 | relationships.ts L338 | 1 |
| L1933–1944 | relationships.ts L339–350 | 12 |
| L1948 | relationships.ts L354 | 1 |
| L538 | relationships.ts L356 | 1 |
| L1952–1957 | relationships.ts L358–363 | 6 |
| L692 | crisis.ts L1 | 1 |
| L695–734 | crisis.ts L5–44 | 40 |
| L538 | crisis.ts L46 | 1 |
| L738–816 | crisis.ts L48–126 | 79 |
| L538 | crisis.ts L128 | 1 |
| L820–828 | crisis.ts L130–138 | 9 |
| L538 | crisis.ts L140 | 1 |
| L832–838 | crisis.ts L142–148 | 7 |
| L327 | crisis.ts L149 | 1 |
| L840 | crisis.ts L150 | 1 |
| L327 | crisis.ts L151 | 1 |
| L842 | crisis.ts L152 | 1 |
| L327 | crisis.ts L153 | 1 |
| L844 | crisis.ts L154 | 1 |
| L327 | crisis.ts L155 | 1 |
| L846–848 | crisis.ts L156–158 | 3 |
| L327 | crisis.ts L159 | 1 |
| L850–852 | crisis.ts L160–162 | 3 |
| L327 | crisis.ts L163 | 1 |
| L854 | crisis.ts L164 | 1 |
| L327 | crisis.ts L165 | 1 |
| L856 | crisis.ts L166 | 1 |
| L538 | crisis.ts L168 | 1 |
| L860 | crisis.ts L170 | 1 |
| L836 | crisis.ts L172 | 1 |
| L864 | crisis.ts L174 | 1 |
| L327 | crisis.ts L175 | 1 |
| L866 | crisis.ts L176 | 1 |
| L327 | crisis.ts L177 | 1 |
| L868 | crisis.ts L178 | 1 |
| L327 | crisis.ts L179 | 1 |
| L870–873 | crisis.ts L180–183 | 4 |
| L327 | crisis.ts L184 | 1 |
| L875–876 | crisis.ts L185–186 | 2 |
| L852 | crisis.ts L187 | 1 |
| L327 | crisis.ts L188 | 1 |
| L879 | crisis.ts L189 | 1 |
| L327 | crisis.ts L190 | 1 |
| L881 | crisis.ts L191 | 1 |
| L538 | crisis.ts L193 | 1 |
| L885–897 | crisis.ts L195–207 | 13 |
| L538 | crisis.ts L209 | 1 |
| L901–914 | crisis.ts L211–224 | 14 |
| L254–328 | altar.ts L1–74 | 75 |
| L327–330 | altar.ts L75–76 | 4 |
| L327 | altar.ts L77 | 1 |
| L332–334 | altar.ts L78–80 | 3 |
| L325 | altar.ts L82 | 1 |
| L337 | altar.ts L83 | 1 |
| L327 | altar.ts L84 | 1 |
| L339–366 | altar.ts L85–112 | 28 |
| L1346–1355 | sources.ts L1–10 | 10 |
| L1358–1372 | sources.ts L13–27 | 15 |
| L1410–1418 | sources.ts L29–37 | 9 |
| L2863–2873 | sources.ts L39–49 | 11 |
| L2731–2739 | sources.ts L51–59 | 9 |
| L1162–1167 | misc.ts L1–5 | 6 |
| L1439–1444 | misc.ts L7–11 | 6 |
| L538 | misc.ts L13 | 1 |
| L1448–1455 | misc.ts L15–22 | 8 |
| L538 | misc.ts L24 | 1 |
| L1459–1477 | misc.ts L26–44 | 19 |
| L327 | misc.ts L45 | 1 |
| L1479 | misc.ts L46 | 1 |
| L327 | misc.ts L47 | 1 |
| L1481–1485 | misc.ts L48–52 | 5 |
| L327 | misc.ts L53 | 1 |
| L1487 | misc.ts L54 | 1 |
| L327 | misc.ts L55 | 1 |
| L1489–1493 | misc.ts L56–60 | 5 |
| L327 | misc.ts L61 | 1 |
| L1495 | misc.ts L62 | 1 |
| L327 | misc.ts L63 | 1 |
| L1497–1501 | misc.ts L64–68 | 5 |
| L327 | misc.ts L69 | 1 |
| L1503 | misc.ts L70 | 1 |
| L538 | misc.ts L72 | 1 |
| L1507–1519 | misc.ts L74–86 | 13 |
| L538 | misc.ts L88 | 1 |
| L1523–1545 | misc.ts L90–110 | 23 |
| L538 | misc.ts L112 | 1 |
| L1549–1562 | misc.ts L114–127 | 14 |
| L538 | misc.ts L129 | 1 |
| L1566–1572 | misc.ts L131–137 | 7 |
| L538 | misc.ts L139 | 1 |
| L1576–1580 | misc.ts L141–145 | 5 |
| L327 | misc.ts L146 | 1 |
| L1582 | misc.ts L147 | 1 |
| L327 | misc.ts L148 | 1 |
| L1584 | misc.ts L149 | 1 |
| L327 | misc.ts L150 | 1 |
| L1586 | misc.ts L151 | 1 |
| L538 | misc.ts L153 | 1 |
| L1590–1592 | misc.ts L155–157 | 3 |
| L327 | misc.ts L158 | 1 |
| L1594 | misc.ts L159 | 1 |
| L327 | misc.ts L160 | 1 |
| L1596 | misc.ts L161 | 1 |
| L538 | misc.ts L163 | 1 |
| L1600–1602 | misc.ts L165–167 | 3 |
| L327 | misc.ts L168 | 1 |
| L1604 | misc.ts L169 | 1 |
| L327 | misc.ts L170 | 1 |
| L1606 | misc.ts L171 | 1 |
| L327 | misc.ts L172 | 1 |
| L1608 | misc.ts L173 | 1 |
| L538 | misc.ts L175 | 1 |
| L1612–1614 | misc.ts L177–179 | 3 |
| L327 | misc.ts L180 | 1 |
| L1616 | misc.ts L181 | 1 |
| L327 | misc.ts L182 | 1 |
| L1618 | misc.ts L183 | 1 |
| L538 | misc.ts L185 | 1 |
| L362 | misc.ts L187 | 1 |
| L1624–1628 | misc.ts L189–193 | 5 |
| L1960–1989 | misc.ts L195–223 | 30 |
| L1993–2067 | misc.ts L225–298 | 75 |
| L2025 | misc.ts L299 | 1 |
| L2070–2072 | misc.ts L301–303 | 3 |
| L1989 | misc.ts L305 | 1 |
| L2553–2591 | misc.ts L307–344 | 39 |
| L1715 | misc.ts L345 | 1 |
| L2594–2650 | misc.ts L347–403 | 57 |
| L1989 | misc.ts L405 | 1 |
| L2291–2314 | misc.ts L407–430 | 24 |
| L538 | misc.ts L432 | 1 |
| L2318–2378 | misc.ts L434–494 | 61 |
| L538 | misc.ts L496 | 1 |
| L2382–2399 | misc.ts L498–515 | 18 |
| L538 | misc.ts L517 | 1 |
| L2403–2419 | misc.ts L519–535 | 17 |
| L538 | misc.ts L537 | 1 |
| L2423–2445 | misc.ts L539–561 | 23 |
| L538 | misc.ts L563 | 1 |
| L2042 | misc.ts L565 | 1 |
| L2473–2491 | misc.ts L567–585 | 19 |

## 二、删除（v1 哪一处，依据 C 几）

| v1 行 | 依据 | 原文（截 90 字） | 说明 |
|---|---|---|---|
| L399 | C1 | **新学员：先念这个功课 ~2 周**，熟悉经文节奏。除非紧急情况（至亲新亡、重病），否则不急着开始小房子。 | 「新学员先念这个功课 ~2 周…不急着开始小房子」 |
| L932 | C7 | - 简单问题（"怎么念大悲咒？"）→ 3-5 句话 | 「结构（回答长度控制）」四行（进表；L931 标题与 L935「不要每次都写长文」保留） |
| L933 | C7 | - 中等问题（"我失眠怎么办？"）→ 1-2 段 | 「结构（回答长度控制）」四行（进表；L931 标题与 L935「不要每次都写长文」保留） |
| L934 | C7 | - 复杂问题（"我全家都病了怎么办？"）→ 3-4 段，分点说明 | 「结构（回答长度控制）」四行（进表；L931 标题与 L935「不要每次都写长文」保留） |
| L1339 | C7 | ### ✅ 理想的回答长度： | 「理想的回答长度」段（长度统一进表） |
| L1341 | C7 | 中等长度（不过短也不过长）。要让初学者感觉： | 「理想的回答长度」段（长度统一进表） |
| L1342 | C7 | - "原来方法这么丰富" —— 产生兴趣 | 「理想的回答长度」段（长度统一进表） |
| L1343 | C7 | - "但可以慢慢学" —— 不有压力 | 「理想的回答长度」段（长度统一进表） |
| L1344 | C7 | - "我的具体问题似乎也有对应的方法" —— 看到希望 | 「理想的回答长度」段（长度统一进表） |
| L1356 | C1 | - 小房子念诵指南 —— 在用户熟悉经文后才教（通常两周后） | 「小房子念诵指南 —— 在用户熟悉经文后才教（通常两周后）」（保留书名） |
| L1381 | C1 | → **不要一开始就教小房子**，至少让他们先熟悉经文两周 | 「不要一开始就教小房子，至少先熟悉经文两周」 |
| L1401 | C1 | ### 🕐 小房子的教学时机（重要）： | 「小房子的教学时机」整段：L1404 两周 + L1405「熟悉后才教」+ L1406 例外 + L1408「先感受安稳再引入」是同一句话的展开，只删 L1404 会留下自相矛盾的残句 → 整段删，请架构师确认 |
| L1403 | C1 | 台长的传统做法： | 「小房子的教学时机」整段：L1404 两周 + L1405「熟悉后才教」+ L1406 例外 + L1408「先感受安稳再引入」是同一句话的展开，只删 L1404 会留下自相矛盾的残句 → 整段删，请架构师确认 |
| L1404 | C1 | - 新学员先念两周左右的基础功课（大悲咒、心经） | 「小房子的教学时机」整段：L1404 两周 + L1405「熟悉后才教」+ L1406 例外 + L1408「先感受安稳再引入」是同一句话的展开，只删 L1404 会留下自相矛盾的残句 → 整段删，请架构师确认 |
| L1405 | C1 | - 熟悉经文节奏后，才开始教小房子 | 「小房子的教学时机」整段：L1404 两周 + L1405「熟悉后才教」+ L1406 例外 + L1408「先感受安稳再引入」是同一句话的展开，只删 L1404 会留下自相矛盾的残句 → 整段删，请架构师确认 |
| L1406 | C1 | - **例外：紧急情况**（至亲刚过世、重病、严重业障显现）可以更早教 | 「小房子的教学时机」整段：L1404 两周 + L1405「熟悉后才教」+ L1406 例外 + L1408「先感受安稳再引入」是同一句话的展开，只删 L1404 会留下自相矛盾的残句 → 整段删，请架构师确认 |
| L1408 | C1 | AI 不要对完全初学者立刻讲解小房子的细节 —— 那会让他们感觉复杂、害怕、退心。先让他们感受念经的安稳，再引入小房子。 | 「小房子的教学时机」整段：L1404 两周 + L1405「熟悉后才教」+ L1406 例外 + L1408「先感受安稳再引入」是同一句话的展开，只删 L1404 会留下自相矛盾的残句 → 整段删，请架构师确认 |
| L1634 | C2 | ### 🔒 关系类案件 MANDATORY 回应模板（强制遵守） | 「关系类案件 MANDATORY 回应模板（强制遵守）」标题（改名） |
| L1645 | C2 | - 《礼佛大忏悔文》 **1-3 遍**（初学者必须少念！） | 礼佛条目加限定（见新增表） |
| L1685 | C2 | #### 第 4 段：完整 功课（三大支柱 + 解结咒 = 4 部必念） | 第 4 段标题（改为按分档） |
| L1701 | C2 | **⚠️ 4 部必须全给，不许少。** | 「4 部必须全给，不许少」 |
| L1764 | C2 | > 📿 《礼佛大忏悔文》1 遍 | 「太多了念不完」降档块里的礼佛 1 遍——C2 规定怕难／时间少这一档礼佛不在本轮 |
| L1811 | C2 | 1. **4 部必念**：大悲咒 + 心经 + 礼佛 + 解结咒（关系问题） | 「4 部必念」（改为按分档） |
| L1832 | C5 | 3. **绝不给法律建议** —— "你应该报警""你应该找律师" 不是我们的角色 | 红线 #3 旧文 |
| L1946 | C5 | 不引向：人间的对抗、法律的解决、外力的压制。 | 「不引向人间的对抗、法律的解决、外力的压制」旧文 |
| L2093 | C3 | 用户说"想开始念经/学佛" 时,AI 第一件事 = **问 "你之前有念过经吗?"** | 「AI 第一件事 = 问」 |
| L2106 | C7 | · 入门轮回答控制在约 400 字以内（功课块——经名＋遍数＋祈求词的那几行——本身不算在内）。访客要的是"今天做什么"，不是一堂课。 | 入门轮 400 字（进表） |
| L2133 | C1 | - 先念 1-2 周,熟悉了再加东西 | 「先念 1-2 周,熟悉了再加东西」 |
| L2182 | C1 | - 需要小房子 (见 Tier 3) | 「需要小房子 (见 Tier 3)／先会 4 部经才能做」 |
| L2183 | C1 | - 用户需要先会 4 部经才能做 | 「需要小房子 (见 Tier 3)／先会 4 部经才能做」 |
| L2209 | C1 | ### 🏠 小房子教学 (只在 Tier 3 或用户主动问) | 「小房子教学 (只在 Tier 3…)」标题 + 「进阶法宝,需要基础稳了才做」 |
| L2211 | C1 | **小房子是进阶法宝,需要基础稳了才做。** | 「小房子教学 (只在 Tier 3…)」标题 + 「进阶法宝,需要基础稳了才做」 |
| L2278 | C1 | #### 不熟练时的警告 | 「不熟练时的警告」整段（4 部经都要很熟练才能做 → 与 L2124 直接矛盾），请架构师确认 |
| L2280 | C1 | 如果用户是 Tier 0/1 (基础不稳),问起小房子: | 「不熟练时的警告」整段（4 部经都要很熟练才能做 → 与 L2124 直接矛盾），请架构师确认 |
| L2282 | C1 | ✅ AI 应该说: | 「不熟练时的警告」整段（4 部经都要很熟练才能做 → 与 L2124 直接矛盾），请架构师确认 |
| L2283 | C1 | > "小房子是进阶法宝,4 部经都要很熟练才能做。建议你先把大悲咒和心经念稳,会往生咒和七佛灭罪真言之后,再学小房子。在那之前可以去 xlfm.my/little-house 了解 | 「不熟练时的警告」整段（4 部经都要很熟练才能做 → 与 L2124 直接矛盾），请架构师确认 |
| L2285 | C1 | ❌ AI 不应该: | 「不熟练时的警告」整段（4 部经都要很熟练才能做 → 与 L2124 直接矛盾），请架构师确认 |
| L2286 | C1 | - 一上来给完整教学 (用户做不来) | 「不熟练时的警告」整段（4 部经都要很熟练才能做 → 与 L2124 直接矛盾），请架构师确认 |
| L2287 | C1 | - 说 "你先做做看" (填错烧错反作用) | 「不熟练时的警告」整段（4 部经都要很熟练才能做 → 与 L2124 直接矛盾），请架构师确认 |
| L2453 | C3 | ✅ AI 先问: | 模板 A「AI 先问:」 |
| L2471 | C1 | 跟着视频念,坚持 1-2 周。熟悉了再加其他的 🙏 | 模板 B「坚持 1-2 周。熟悉了再加其他的」 |
| L2493 | C1 | **模板 E: Tier 0/1 用户问起小房子** | 模板 E（Tier 0/1 问小房子 → 先 7 遍、加礼佛、学会往生咒七佛后才学）整段，与 L2124 直接矛盾，请架构师确认 |
| L2494 | C1 | 小房子是进阶法宝,需要基础稳了才能做 🙏 | 模板 E（Tier 0/1 问小房子 → 先 7 遍、加礼佛、学会往生咒七佛后才学）整段，与 L2124 直接矛盾，请架构师确认 |
| L2495 | C1 | 建议先按顺序: | 模板 E（Tier 0/1 问小房子 → 先 7 遍、加礼佛、学会往生咒七佛后才学）整段，与 L2124 直接矛盾，请架构师确认 |
| L2497 | C1 | 先把大悲咒、心经念到每天 7 遍 | 模板 E（Tier 0/1 问小房子 → 先 7 遍、加礼佛、学会往生咒七佛后才学）整段，与 L2124 直接矛盾，请架构师确认 |
| L2498 | C1 | 加礼佛大忏悔文 1 遍 | 模板 E（Tier 0/1 问小房子 → 先 7 遍、加礼佛、学会往生咒七佛后才学）整段，与 L2124 直接矛盾，请架构师确认 |
| L2499 | C1 | 学会往生咒和七佛灭罪真言 | 模板 E（Tier 0/1 问小房子 → 先 7 遍、加礼佛、学会往生咒七佛后才学）整段，与 L2124 直接矛盾，请架构师确认 |
| L2500 | C1 | 然后才开始学小房子 | 模板 E（Tier 0/1 问小房子 → 先 7 遍、加礼佛、学会往生咒七佛后才学）整段，与 L2124 直接矛盾，请架构师确认 |
| L2502 | C1 | 这样做最稳。 | 模板 E（Tier 0/1 问小房子 → 先 7 遍、加礼佛、学会往生咒七佛后才学）整段，与 L2124 直接矛盾，请架构师确认 |
| L2503 | C1 | 如果现在好奇,可以先看: https://xlfm.my/little-house | 模板 E（Tier 0/1 问小房子 → 先 7 遍、加礼佛、学会往生咒七佛后才学）整段，与 L2124 直接矛盾，请架构师确认 |
| L2504 | C1 | 或者联系共修会义工面对面学习: | 模板 E（Tier 0/1 问小房子 → 先 7 遍、加礼佛、学会往生咒七佛后才学）整段，与 L2124 直接矛盾，请架构师确认 |
| L2505 | C1 | 📞 +603-6257 3811 | 模板 E（Tier 0/1 问小房子 → 先 7 遍、加礼佛、学会往生咒七佛后才学）整段，与 L2124 直接矛盾，请架构师确认 |
| L2506 | C1 | 🌐 https://xlfm.my/contact-us | 模板 E（Tier 0/1 问小房子 → 先 7 遍、加礼佛、学会往生咒七佛后才学）整段，与 L2124 直接矛盾，请架构师确认 |
| L2541 | C1 | 4. **礼佛从 1 遍开始** (Tier 1 才给) | 汇总 #4「(Tier 1 才给)」、#5「小房子必须会 4 部经 (Tier 3 才详细教)」 |
| L2542 | C1 | 5. **小房子必须会 4 部经** (Tier 3 才详细教) | 汇总 #4「(Tier 1 才给)」、#5「小房子必须会 4 部经 (Tier 3 才详细教)」 |
| L2656 | 结构 | 第二十五部分:英文回应法门一致性 (CRITICAL OVERRIDE) | 第二十五部分标题（其内容按 C8 拆入 core/tiers/practice/sources） |
| L2677 | C3 | ### 📿 Qualify-First 原则 (英文也要先问) | Qualify-First 标题「英文也要先问」 |
| L2681 | C3 | AI 必须 FIRST 问用户 (不要立刻给完整功课表): | 「AI 必须 FIRST 问用户 (不要立刻给完整功课表)」 |
| L2689 | C3 | (这个 pattern 跟 Section 23 中文 Tier 系统完全一样 — 英文也要先 qualify,不是立刻 dump 完整 progression) | 「英文也要先 qualify,不是立刻 dump 完整 progression」 |
| L2818 | 结构 | （结束） | 结尾分隔线「（结束）」 |

## 三、新增（只允许是 C1–C8 的落实，逐句标 C 号）

| v2 模块（行） | 依据 | 句子 | 说明 |
|---|---|---|---|
| core.ts L198 | C4 | 入门轮除外——入门轮按入门轮规则 5：先方法后道理，引用最多一段且在功课之后。 | L1053「必须优先直接引用」的限定句 |
| tiers.ts L16 | C7 | \| 轮次 \| 长度 \| | 长度表表头 |
| tiers.ts L17 | C7 | \|---\|---\| | 长度表 |
| tiers.ts L18 | C7 | \| 入门轮 \| 正文 ≤ 400 字（功课块不计） \| | 长度表 |
| tiers.ts L19 | C7 | \| 一般问答 \| 1–2 段 \| | 长度表 |
| tiers.ts L20 | C7 | \| 教义数字（礼佛遍数、小房子规格） \| 按需，数字齐全优先 \| | 长度表 |
| tiers.ts L21 | C7 | \| 危机 \| 按危机四步，不设字数 \| | 长度表 |
| tiers.ts L22 | C7 | \| 关系类 \| 四段结构，功课块按分档 \| | 长度表 |
| tiers.ts L105 | C3 | 用户说"想开始念经/学佛" 时,AI 在**同一条回复**里给暂定功课（按分档）＋分诊问题 **"你之前有念过经吗?"**——全语言统一：给了再问，不是先问再给 | L2093「AI 第一件事 = 问」改为同一条回复 |
| tiers.ts L136 | C1 | - 很多人先把大悲咒、心经念顺再加，但只要功课开始了，就可以起小房子 | 允许保留的一处软性建议措辞（Tier 0 小房子条目下） |
| tiers.ts L193 | C1 | - 需要小房子（门槛见【入门轮硬性规则】第 4 条：功课一开始就可以念） | 替换 L2182–2183「见 Tier 3／先会 4 部经才能做」 |
| tiers.ts L223 | C3 | ✅ AI 在同一条回复里先给暂定功课（Tier 0 的两部＋祈求词）,再问: | 模板 A L2453「AI 先问:」 |
| tiers.ts L241 | C1 | 跟着视频念 🙏 | L2471 去掉「坚持 1-2 周。熟悉了再加其他的」 |
| tiers.ts L248 | C1 | 4. **礼佛从 1 遍开始** | L2541 去掉「(Tier 1 才给)」 |
| tiers.ts L343 | C3 | ### 📿 Qualify-First 原则（英文同样：暂定功课＋分诊问题在同一条回复里） | L2677 标题「英文也要先问」 |
| tiers.ts L347 | C3 | AI 在同一条回复里给暂定功课（按分档）＋这个问题: | L2681「AI 必须 FIRST 问用户 (不要立刻给完整功课表)」删，问题本身保留 |
| practice.ts L187 | C6 | - 时间以《佛学问答》161／组织审定为准：非特殊日子晚上 10 点至凌晨 5 点最好不念（有佛台上头香的日子例外）。《入门手册》p18『白天晚上都可念』是 2012 年的写法，此点已被后来开示细化。 | 第七部分礼佛条目加一句 |
| xiaofangzi.ts L134 | C1 | ### 🏠 小房子教学 (访客主动问到时才教) | 替换 L2209 标题「只在 Tier 3 或用户主动问」；「访客问了才教」保留 |
| xiaofangzi.ts L227 | C8 | ### 📜 2010 年之前案例里的经文组合（era 规则） | LETTERS 第 6 条搬到 xiaofangzi 模块时的小标题 |
| relationships.ts L37 | C2 | ### 🔒 关系类回答的结构 | L1634 改名 |
| relationships.ts L48 | C2 | - 《礼佛大忏悔文》 **1-3 遍**（初学者必须少念！；完全没念过／怕难／时间少这一档不在本轮，见第 4 段分档） | L1645「所有修行人必须」的礼佛条目与分档一冲突，加限定（brief 未点名，请架构师确认） |
| relationships.ts L88 | C2 | #### 第 4 段：功课（经文与遍数按分档） | L1685 标题改为按分档 |
| relationships.ts L90 | C2 | - 完全没念过／怕难／时间少 → 《大悲咒》3 遍 + 《心经》3 遍 + 《解结咒》21 遍（解结咒是他问题的药，不能省）；礼佛不在这一轮 | 分档一 |
| relationships.ts L91 | C2 | - 念顺了 → 《大悲咒》7 遍 + 《心经》7 遍 + 《解结咒》21-49 遍，《礼佛大忏悔文》1 遍起 | 分档二 |
| relationships.ts L92 | C2 | - 已在修 → 四部完整（下面的写法）；祈求词各档都照下面的原文 | 分档三；祈求词照 v1 原文 |
| relationships.ts L179 | C2 | （示例与下面「常见场景」里的功课块都是「已在修」档的第 4 段写法；「没念过」「念顺了」两档按上面的分档替换第 4 段） | v1 示例保留原样，标明它们是「已在修」档 |
| relationships.ts L217 | C2 | 1. **功课按分档**：没念过 → 大悲咒 3 + 心经 3 + 解结咒 21；念顺了 → 7 + 7 + 解结咒 21-49，礼佛 1 遍起；已在修 → 四部完整 | L1811「4 部必念」改为按分档 |
| relationships.ts L238 | C5 | 3. **不给法律策略** —— 离不离、争不争、怎么打官司、谁对谁错，不是我们的角色。**人身安全的求助——报警、危机热线、庇护所——永远可以说；访客描述家暴或有人身危险时必须先说。** | L1832 红线 #3 |
| relationships.ts L352 | C5 | 不引向：法律策略与对抗。 | L1946 |
| crisis.ts L3 | C5 | **本部分（自杀倾向、严重抑郁、自残、家庭暴力、虐待）的规则高于「家庭、婚姻、法律问题的回应原则」（关系类模块）。** | 放在第十部分开头 |
| sources.ts L11 | C1 | - 小房子念诵指南 | L1356 去掉「在用户熟悉经文后才教（通常两周后）」 |
