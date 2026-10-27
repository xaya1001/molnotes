# 内容工作目录

内容单元保存在 `MOLNOTES_CONTENT_DIR` 指定的内容目录中，内容目录位于一个 Git 仓库（或它的 worktree）里，网站从数据库读取已发布内容。仓库维护共享运行时、契约与中性测试样本。

`notes/<dir>/` 是一个平面目录，`dir` 与篇目 slug 只用小写字母、数字和单个连字符（`[a-z0-9]+(?:-[a-z0-9]+)*`）。同一目录内 slug 唯一，不同目录可以使用同名篇目。

`directory.json` 只含 `title`（非空字符串）、`intro`（Markdown 字符串）、`order`（大于等于 1 的整数）。目录按 order、slug 排序。每个目录必须有这份文件。

每篇 `<slug>.md` 以 YAML front matter 开始，必填 `title`、`summary`（非空字符串）、`date`（YYYY-MM-DD）、`order`（整数），可选 `updated`（YYYY-MM-DD）。日期必须真实存在，未知字段与重复 YAML key 报错。篇目按 order、slug 排序，order 同时是侧栏里的篇号（0 不编号，用于导读）；页面标题来自 title，正文从 `##` 开始，禁止 `#`。`##`、`###` 生成小节目录，`## 资料来源` 默认收起。

`notes/<dir>/author/` 存放这套笔记的作者资料：写作约定、写作规划、素材与检索记录、待核实清单和修订记录。Agent 写作或修订某套笔记前先读该目录的作者资料，`pull notes/<dir>` 会一并导出，`push` 的输出列出本次发布目录的作者资料。`author/` 里只放 `<slug>.md`，契约与篇目相同（front matter、术语、引用、结构式与图片同样校验，图片放目录的 `assets/`），`order` 只在作者资料内部排序，slug 可以与篇目同名。作者资料随目录存入数据库，仅供内容命令导出与修订使用；网站读取接口、阅读页面、侧栏、阅读记录、首页和搜索只提供读者篇目。作者资料里的站内链接 `<slug>` 指 `author/` 中的另一篇，`../<slug>` 指本目录的篇目。

正文支持 CommonMark 与 GFM 表格；原始 HTML 作为文字显示。强调按 CJK 友好规则识别，`**结论。**后文` 这类标点在标记内侧的写法同样加粗。基组等文字里的星号写成 `\*`（`6-31G\*`），否则会与附近的星号配成斜体。行内公式用 `$...$`，块公式用独立行的 `$$` 包围；行内公式里的 `\_` 按下标 `_` 处理。数值、单位和基团写成普通文字（如 −13.6 kJ/mol、–CH₂–），公式只用于真正的式子。站内链接可以写 `<slug>`、`../<dir>/<slug>`、`/notes/<dir>/<slug>` 或真实的专题章节路径。链接可带查询参数与小节锚点。未知笔记与专题章节在发布时报错。

术语写 `[[占有率]]`，按全站术语表的 `term` 精确查找，不存在的术语报错。

结构式使用 molecule 围栏，smiles 与 caption 成对出现；多组并排呈现，手机换行：

````markdown
```molecule
smiles: CC(=O)Oc1ccccc1C(=O)O
caption: aspirin
```
````

SMILES 在发布时由 RDKit 校验，页面使用共享 MoleculeView。不能解析或缺少配对 caption 时明确报错。

结构式在 SMILES 指定构型的手性中心旁标 (R)/(S)、双键旁标 (E)/(Z)，所以立体标记按原始资料写：原文画出或命名了构型的照写；外消旋、构型未指派或机理中不涉及构型的不写；只有一个手性中心的外消旋体不写；多个手性中心、相对构型确定的外消旋体或某一中心为差向异构混合物时，用 CXSMILES 的增强立体写法（`C[C@]12CCC(=O)C[C@@]1(O)CCCC2=O |&1:1,7|`），图上标 and1；单一异构体但绝对构型未知时用 `|o1:…|`，图上标 or1。专题与笔记的 `smiles` 字段都接受这种写法。

结构式按 RDKit 的二维排版绘制。桥环与笼状骨架上这种排版可能把原子叠在一起、把原子压在键上或让手性中心的 H 压线，`content:preview` 会逐个指出。这时运行 `npm run molecule:layout -- '<SMILES>'`：它从 RDKit、CoordGen 与 PubChem 的二维结构出发分别调整，列出各自剩下的问题，最后一行是推荐的写法，即原 SMILES 后附 CXSMILES 坐标块 `|(x,y,;x,y,;…)|`，按 SMILES 中原子的顺序给出二维坐标，已有增强立体时写在同一个块里（`|(…),&1:1,7|`）。把它写回 `smiles` 字段即可：图按坐标绘制，楔形键与 R/S 仍由 SMILES 的构型决定，原子编号不变。同一骨架的几个分子用 `--like '<已排好的 CXSMILES>'` 沿用同一排法；没有网络时加 `--offline`。

时间线与流程图用 timeline、flow 围栏，围栏内是 YAML，取值与专题 `timeline`、`flow` 块相同，另可写 `caption`。时间线的日期写 `YYYY`、`YYYY-MM` 或 `YYYY-MM-DD`，按比例定位；`show` 替换显示的日期（`""` 不显示），`between` 表示原文只给出前后两个日期的事件，画成空心虚线点；`accent` 标出唯一的强调；`spans` 是时段条，`brackets` 是轴下的括号，`markers` 是贯穿各泳道的竖线；`lanes` 分泳道；`axis` 可固定 `from`、`to` 与刻度间隔 `every`（年），`ticks` 写 `none`（不画刻度）、年份列表（只在这些年份写刻度）或 `month`（按月），不足一年的轴默认按月，按月的轴在同一年之内时日期只写月日、年份写进图注；`even: true` 改为只按先后等距排列。事件的 `mark` 是点的形状 `dot`、`diamond`、`square` 或 `ring`（空心），可与 `accent` 组合；`legend` 是图下一行形状与文字的对照，每项写 `mark`（可列几种）、`accent` 与 `text`；竖线可 `accent`，`text` 可省（只写日期），`below` 是轴下方的另一行字。流程图由 `nodes` 与 `edges` 组成，最多 20 个节点。节点写 `id` 与 `text`，`kind` 为 `ask`（判断）、`end`（起止）或 `note`（旁注），默认是普通框；`tone: accent` 标出强调、`tone: muted` 标出没有走通的路；`tag` 是框上的小字。框内文字按短语断行，要在指定处换行就把文字加上双引号并写 `\n`。`edges` 的一行可以是一条链 `a > b > c`，也可以是一条带选项的边：`text` 是箭头上的字，`dashed: true` 画虚线，`side: true` 把目标画在源节点旁边，不占主线（这个节点不能再连别的边），`from` 写成列表表示几个节点汇合到同一个目标。节点按连线分层排开，同一层的顺序先按 `nodes` 的书写顺序，再为减少交叉调整。框里的文字在自左向右排时读得顺（每行约 5 个字以上、不超过 6 行）就自左向右；没有分支的直链一行读不顺时折成几行横排（每行一样多，行末用折线箭头接到下一行行首），每行只能放一个框时才自上而下；其他流程图取框更宽的方向；自上而下时，若主线每层只有一个节点、而旁边的侧出口、旁注或对齐的另一列把框挤窄，这些节点就折到所属主线节点下方缩进排列。`direction: right` 或 `down` 在桌面宽度下固定方向，窄屏仍按框宽选择。`over` 是整张图上方的括号，`note` 是图下方的一行字：

````markdown
```timeline
caption: 西咪替丁项目，1964–1976 年
axis: {from: 1964, to: 1976, every: 2}
events:
  - {date: 1964, text: 搭起大鼠筛子}
  - {date: 1968-02, show: 1968 年初, text: 主管下令：再保一年, accent: true}
  - {between: [1968, 1970], text: 回头看胍基组胺：部分激动}
spans:
  - {from: 1964, to: 1968, text: 4 年，200 多个组胺类似物，没有一个达标}
brackets:
  - {from: 1964, to: 1976, text: 12 年}
```

```flow
nodes:
  - {id: hits, text: hit 列表, kind: end}
  - {id: s1, tag: 1 排除假阳性, text: 加去垢剂复测；查结构}
  - {id: out1, text: 剔除：聚集体、反应性基团, tone: muted}
  - {id: q1, text: 复测还有活性？, kind: ask}
  - {id: s2, text: "确认结合\n挑系列"}
  - {id: drop, text: 放弃, tone: muted}
edges:
  - hits > s1 > q1
  - {from: s1, to: out1, side: true}
  - {from: q1, to: s2, text: 是}
  - {from: q1, to: drop, text: 否, dashed: true}
```
````

日期不存在、事件落在轴外或未知字段时发布报错并指出行号；流程图的未知或重复节点 id、连成环、没有连线的节点、超过 20 个节点和链的写法错误也在发布与预览时报错，报错指出第几个节点或第几条边并列出已有的 id。时间线与流程图的文字进入笔记搜索。

`npm run content:preview -- notes/<dir>[/<slug>] | sites/<slug>` 不发布，用当前 checkout 的组件把内容工作目录里这些单元的时间线、流程图和结构式在 1366 px 与 390 px 下各截一张图，输出截图路径（默认在 `~/.cache/molnotes/preview/`，可用 `MOLNOTES_PREVIEW_DIR` 指定）、写法错误（文件与行号）和版面警告：标签或框重叠、引线穿过标签、标签离它的点过远、竖线穿过标签、图例与图重叠、连线穿过框或文字、连线文字与框重叠、框过窄（含文字每行平均不到约 5 个字或超过 6 行）、文字溢出、字号过小、图比版面宽、结构式渲染失败。写好或改过一张图后先预览，警告清零再发布。选写法、各种形状的模板与每条警告的改法见 [时间线与流程图](../toolbox/recipes/figures.md)。

图片写 `![说明](assets/<file>)`，说明显示在图下方作为图注（可带图号，如"图 1　……"），为空时不显示图注；文件名使用字母、数字、下划线、点和连字符。源文件放 `notes/<dir>/assets/`，网站以 `/notes/<dir>/assets/<file>` 提供；缺图拒绝发布。生成的图在 `notes/<dir>/prompts/<file>.md` 保存生成它的 prompt，`<file>` 与 `assets/` 中的图片文件名相同；prompt 随资源记录入库并由 `pull` 导出，网站不提供，没有对应图片或内容为空时拒绝发布。所有资源按 SHA-256 存在私有对象存储，数据库记录路径、哈希、大小与内容类型。

## 来源与引用

内容工作目录根部的 `sources.json` 是全站唯一的来源登记表，键为来源 id（与 slug 同样的写法），值为 `{ file, title, kind, author?, edition? }`：`file` 是 `materials/` 下的相对路径，只能是 `.pdf`、`.epub` 或存档网页 `.html`；`title` 是页面上显示的书名（如 `示例手册`），`kind` 是类型（如 教材、手册、网页）。同一个文件只登记一次，未知字段报错。书架集合有 `manifest.json` 时，原始网址、下载日期和哈希从清单读取，不写进登记表。页面只显示书名与位置，不显示书架路径或文件名。

引用写法：PDF 写 `src:<id>#<首页>-<末页>`（单页 `src:<id>#<页>`），页码是从 1 开始的 PDF 页序，一次最多 60 页；可接 `&print=<首页的印刷页码>`（数字时后续页依次递增，罗马数字等只标首页）和 `&rect=<x0>,<y0>,<x1>,<y1>`（首页上的 PDF points 矩形）。存档网页只写 `src:<id>`。顺序固定为页码、`print`、`rect`，页码之间用 ASCII 连字符。EPUB 写 `src:<id>#ch=<路径>`，可接 `&sec=<路径>`：`ch` 是书内导航目录里一个条目的位置路径（`python3 -I scripts/material.py nav <epub>` 列出全部条目，例如第二部分下的第 2 个条目是 `4.2`），被引的就是该条目从起点到下一个不属于它的条目之间的正文；`sec` 是被引小节在这个条目之下的相对路径（`4.2.2` 写作 `ch=4.2&sec=2`），读者打开时定位到这里。

笔记里引用写成链接 `[PDF 第 429–435 页](src:textbook#429-435)`，正文和"资料来源"都可以用，目录简介也可以；链接文字就是读者看到的按钮文字。专题里 `sources[]` 用 `cite`（引用数组）指向书架来源，摘录与阅读指引条目（顶层或章节内的 `excerpts`、`reading`）可各写一个 `cite`，读者点开 `locator` 看原文。专题来源不再写 `file`。

`push` 发布时校验：登记表存在且合法、引用的来源已登记、文件在书架上、有清单时哈希一致、PDF 引用带页码且不越界、矩形在首页内、存档网页所在集合的 `manifest.json` 声明了正文元素（`article: { tag, class }`）并能抽出正文、正文图片在清单里有存档副本、EPUB 引用带章节且该条目存在、小节在章节之下且能定位、章节能抽出正文且不超过 50 万字符、章节图片是书内的 PNG、JPEG、GIF 或 WebP。任何一项失败整次发布不生效，错误给出文件与位置。被引页及前后各 1 页渲染为 WebP，存档网页与 EPUB 章节的正文与图一起作为 `cited/` 资源上传；这些资源由书架重新生成，`pull` 不导出。覆盖来源登记表前校验本次发布后全站全部单元的引用（含作者资料与目录介绍），仍在使用的来源缺失或类型不匹配时拒绝发布。`pull --all` 同时导出 `sources.json`。书架位置默认是仓库的 `materials/`，可用 `MOLNOTES_MATERIALS_DIR` 指定，渲染缓存可用 `MOLNOTES_MATERIALS_CACHE` 指定。

## 术语表

内容工作目录根部的 `glossary.json` 是全站唯一的术语表，是一个数组，每条为 `{ term, full, definition, confusion }`：`term` 是术语名（全站唯一，首尾无空白，不含 `]` 与换行），`full` 是英文原词或全称，`definition` 是释义，`confusion` 是易混点，四项都是非空字符串，未知字段报错。笔记用 `[[术语]]` 引用，专题章节用 `terms`（术语名数组，章内不重复）列出本章用到的术语；章节正文里这些术语首次出现时成为术语按钮。

每次 `push` 都读取并校验 `glossary.json`，连同数据库中其他内容一起检查：引用的术语都在表里、字段完整、名称不重复。任何一项失败整次发布不生效；通过后术语表随这次发布存入数据库。只改术语表时，push 任一单元即可发布。`pull --all` 同时导出 `glossary.json`。专题的 `content.json` 不写 `glossary`，写了拒绝发布。全站术语页 `/glossary/` 列出全部术语，每条附用到它的笔记与专题章节。

## 专题

`sites/<slug>/site.json` 含 `title`、`description`、正整数 `order` 与分组 `group`，可选 `label`。`group` 取 `靶点案例`、`药化进阶`、`专利拆解`、`合成与机理`、`谱图`、`读书复习`、`入门专题`、`练习` 之一（集合与顺序由 `scripts/site-catalog.mjs` 的 `siteGroups` 定义），缺失或取值不在集合内时拒绝发布。`练习` 专题使用 `/practice/<slug>/`，笔记链接到的练习专题在首页显示为该套笔记的练习；其余专题使用 `/sites/<slug>/`，侧栏书架按分组展示，没有分组的已发布专题归入“其他”。`content.json` 在专题根目录，遵守 `scripts/topic-content.mjs` 与 `scripts/topic-blocks.mjs` 契约；`static/` 放图、原页图和坐标文件。网站使用 `/sites/<slug>/static/<path>` 提供资源。专题以共享入口在浏览器加载。

专题根路径 `/` 是简介、全部章节与 `sourcesIntro`（专题级来源说明）的首页。章节默认路径是 `/<id>`，可用 `chapterRoute` 或章的 `path` 指定其他路径；章节路径必须唯一，不能是 `/`。章末的资料来源只展示该章 `refs` 中的条目及其 `cite` 原文定位。发布时站内链接必须命中当前栏目与章节路由，练习链接使用 `/practice/<slug>/…`。

### 数据驱动的实验输入

`lab.data` 引用本专题 `data` 中的对象。`first-order-elimination` 接收 `{ presets }`，每条 preset 含 `name`、正数 `halfLife`（小时）、说明 `label` 与来源标记 `source`（正整数或非空字符串）；选择值是数组下标，默认第一条，选择项按数组顺序显示。其余时间输入、归一化浓度和一级消除计算由共享模型定义。

`assay-panel-ratio` 使用计算契约：`{ caption, endpoints, rows, ratio }`。`endpoints` 的每条为 `{ value, label, columns }`，默认第一条，`value` 在数据内唯一；`columns` 包含名称列、测量列（保留单位与检测体系）和比值列。`rows` 每条含 `name`，并以各 endpoint 的 `value` 为键保存有限非负数数组；数组长度等于对应 `columns.length - 2`。`ratio: { numerator, denominator }` 是测量数组内从零开始的整数索引，每个终点的分母必须大于零。标题、标签、来源与数值全部由内容提供。

`atp-competition` 接收 ATP 实验对象。`variants` 和 `inhibitors` 是非空、唯一的名称数组，决定行与选项顺序；`inhibitorLabels` 提供各抑制剂的选项标签，默认第一项。`kd[抑制剂][变体]` 与 `km[变体]` 含有限正数 `value` 和有限非负 `sd`，单位分别为 nM 和 µM；其他来源字段随内容保留。`atpSteps` 是非空的有限非负 ATP 浓度数组（µM），`defaultStep` 是合法整数索引。`roles: { reference, numerator, denominator }` 显式指向变体名称，分子与分母须不同；`comparisonAtp` 是非空的有限非负 ATP 浓度数组。`parameterCaption`/`comparisonCaption`、五列 `parameterColumns`/四列 `comparisonColumns` 和 `referenceWarning` 均由内容提供；参照与分子项的表观 Ki 比值小于 1 时显示该提示。模型按原公式计算并保留测量不确定度。

`atp-selectivity` 接收 `{ variants, comparison, caption, columns }`。每个 variant 含唯一非空 `name`、正数 `kd`（nM）和 `km`（µM）；`comparison: { numerator, denominator }` 指向两个不同的名称。非空 `caption` 和五列非空 `columns` 保留检测对象、单位与来源说明；行按数组顺序显示。两种 ATP 模型的比较角色缺失、重名或指向未知条目时拒绝发布。

`assay-correlation` 复用数据表的 `columns`、`rows` 和 `alternates`，并增加 `correlation: { defaultX, defaultY, cohort: { keys, description } }`。轴选项按 `columns` 顺序生成，默认轴须是已知列；共同样本组至少含两个唯一已知列，`description` 说明这些列均有确切值的样本口径。两个所选轴都在组内时，按全部组列均为确切值筛选；其他组合只按所选两列筛选。`agreedOnly=yes` 排除任一单元格带 alternate 的整行；`no` 分别使用 alternate 值与 listed 值计算，名称取 `alternates.alternate/listed`。缺失值和上下限均不作为确切值，Spearman 统计保持并列秩取平均、少于三对或零方差无法计算的规则。配置缺失、列名未知或组键重复时拒绝发布。

`ternary-equilibrium` 与 `degradation-recovery` 的原始读数对象增加 `overlays.concentration`/`overlays.time`，各含非空 `label` 和非空 `choices`。每个选项含唯一非空 `value`（保留值 `none` 用于不叠加）、非空 `label` 和非空 `series`。系列为 `{ kind, dataset, name }`，`dataset` 指向同一对象中已有原始读数，`name` 保留来源与测量说明。浓度模型支持 `signal-peak`（正数 `dose` 的 log10 与 `signal / max(signal) × 100`）及 `protein-decrease-peak`（非负 `dose`，只绘正剂量；以全部原始 `level` 的最大 `100-level` 归一化）。时间模型支持 `protein-time`（`hours` 对 `level`）及 `protein-washout`（先绘 `[pretreatHours,start]`，再绘 `[pretreatHours+hours,level]`）。原始数组须非空、配对等长，测量值和时间非负有限，归一化分母为正；允许零水平及时间系列超过 100% 的测量值。数据保留原始量纲和证据，归一化仅用于叠加展示。模型的数值输入、方程和默认 `none` 保持共享定义；跨类型系列或无效引用拒绝发布。

`saturated-chair` 接收 `{ rows, referenceTemperature, referenceLabel, defaultDeltaG }`。每条参考行保留非空 `substituent`、有限且不重复的 `deltaG`（kJ/mol）、有限正数 `k`、0–100 的有限 `percent` 和可选布尔 `lowerBound`。参考温度为 250–350 K 的有限数值，标签非空；默认自由能差为 −25–25 kJ/mol 内的参考行值。模型仅在输入温度精确等于 `referenceTemperature` 且自由能差精确命中一行时显示原始印刷值及其下限；其余状态只显示通用两态平衡计算。温度数值控件及公式由共享模型定义。

`radical-selectivity` 与 `radical-distribution` 共用 `{ alkanes, measured, halogens, defaults, sourceLabel }`。烷烃含唯一 `id`、名称及一/二/三级氢的正整数 `counts` 和逐项对应的 `products`；一级氢为参照。实测行按唯一 `(alkane, halogen)` 配对，含对应氢类型的 `shares: { op, value }`、`page/condition/note`；确切百分比合计 100，界限支持参照 `<` 配合其他类型 `>`，不当作确切比例。卤素按数组顺序提供唯一 `id/label`、因子来源 `source` 和 `offered.secondary/tertiary`。因子仅支持 `{ kind: "measured", alkane }`（须能从同卤素实测行推导该氢类型的确切因子）或 `{ kind: "printed", value }`（有限正数）。`defaults` 指定已知 `estimateAlkane/offeredAlkane/halogen`；`sourceLabel` 与实测 note 保留出处和限定说明。输入因子预测与实测分开显示，教材核对/提供因子结果沿用 reveal 状态；缺失、重复、矛盾或无法给出因子的内容拒绝发布。

`enolates-pka-dmso` 与 `enolates-pka-water` 共用 `{ donors, bases, defaults }`。非空条目数组各含唯一且互不重复的 `id`、非空 `label`；供体另含 `name`，碱另含共轭酸 `acid`。每项 `values` 至少包含一个已知标尺 `dmso/water`，各标尺为非空 `{ value, source }` 数组，数值有限、来源非空；同标尺多条印刷值分别保留。`defaults: { donorId, baseId }` 必须指向当前模型标尺上有值的条目；选项按首个数值升序排列。模型 ID 固定标尺，读数按供体值在外、碱值在内组成全部组合，缺失标尺不借用其他溶剂。来源、结构和 `fetchedFrom` 等元数据随内容保留；ΔpKa、K、阈值 3 及格式由共享模型定义。

`strategy-hammett-sigma` 与 `strategy-hammett-rate` 共用 `{ referencePka, substituents, reactions, defaults }`。参照 pKa 有限；非空取代基数组各含唯一非空 `id/name` 及有限 `pkaPara/pkaMeta/sigmaPara/sigmaMeta`，非空反应数组各含唯一非空 `id/name` 和有限 `rho`。选项沿原数组次序；`defaults: { subId, reaction, sigmaPosition, ratePosition }` 指向已知条目，两个位置限 `para/meta`。练习按参照 pKa 与对应位置 pKa 的差四舍五入到 0.01，与猜测差的绝对值小于 0.005 才判对；速率比及图使用对应位置的印刷 σ，保留其与计算值的独立性。图按取代基数组顺序逐项取 para、meta 后稳定按 σ 升序排列，标题点数取实际长度；公式与坐标域由模型定义。`bands`、反应解释、页码等证据元数据随内容保留。

`route-ledger` 接收 `{ inputLabel, routes, mass }`。`inputLabel` 是假定收率输入的标签，范围 0–100%，默认 100%，步长 1。每条 route 含非空 `title`、`claimedText`、0–1 的 `claimed` 和非空 `steps`；每步含非空 `name`、`note`、0–1 的 `yield`，可选布尔 `assumed` 标记由输入替代的收率。`mass` 含非空 `title`、0–1 的 `claimed`、可解析为有限正分子量的 `startFormula`/`productFormula`（支持 C、H、F、N、O），以及正数 `startGrams`、`startMol`、`productGrams`。路线来源与证据元数据由专题保留；模型按连续步骤累计收率，并按质量和物质的量核算。

这些模型的数据缺失或非法时拒绝发布；块的 `defaults` 和 `presets` 必须命中数据生成的选择项及模型输入范围。其他模型继续使用静态输入或其既有数据契约。预测题的 `readout` 只提供 `{ model, input }`，因此使用无需数据即可生成输入的模型。

## 内容命令

`MOLNOTES_CONTENT_DIR` 指定内容仓库，未设置时内容命令报错。`npm run content -- push notes/<dir>` 或 `push sites/<slug>` 可接受多个单元（例如 `push sites/a sites/b notes/x`），在同一个事务中校验整组与数据库中其他内容的站内链接、术语、SMILES 和资源完整性，然后上传缺失资源并在一个事务内替换单元。校验错误给出文件与位置，数据库保持不变。发布时会重新编译受术语变化影响的笔记；索引在 API 的一致性快照内计算。

`npm run content -- build <输出目录>` 读取内容目录里的全部单元、`sources.json` 与 `glossary.json`，做与 `push` 相同的校验、引用解析和编译，把结果写成快照：`snapshot.json`（`format: 1`、`commit`、`builtAt`，以及 `topics`、`directories`、`notes`、`glossary`、`registry`、`assets`，各项与数据库对应表保存的行相同）和 `files/<单元>/<路径>`（内容资源原样复制，被引页渲染在 `<单元>/cited/`）。输出目录不能已存在；任何校验失败都不写出。`build` 不检查提交，`commit` 为 `null`。

`npm run content -- publish` 要求内容目录在 HEAD 下没有未提交、未跟踪或被忽略的文件（构建前后各查一次），把 HEAD 的内容构建到 `MOLNOTES_CONTENT_RELEASES` 指定的发布根下的 `<提交号>/`，完成后以一次 rename 把 `current` 换成指向它的相对软链，再删除旧快照，连同 `current` 指向的共保留最近 5 个。同一提交再次发布时重新构建并替换该快照。`publish --rollback <提交号>`（可用唯一前缀）把 `current` 指回一个保留着的快照，不构建。

`pull <单元>` 与 `pull --all` 导出源文件、JSON 与资源，同路径文件覆盖，用于建立新的内容仓库或核对线上状态，导出后与已提交内容的差异由 `git diff` 显示；本地已有且 SHA-256 相同的资源不再下载，其余资源经按哈希存放的本地缓存（默认 `~/.cache/molnotes/assets`，可用 `MOLNOTES_ASSET_CACHE` 指定）并行获取；`pull --all` 另外导出 `sources.json` 与 `glossary.json`。`remove <单元>` 在其他内容引用该单元时拒绝，并指出引用文件与位置。`list` 列出已发布单元。上传失败不会提交数据库；资源对象按哈希保留，不自动物理删除。

内容目录可以是 Git 仓库的根目录，也可以是仓库里的一个子目录，正文、JSON 与资源文件都提交；`MOLNOTES_CONTENT_DIR` 不在 Git 工作树里时内容命令报错退出。提交号属于整个仓库，内容目录以外的改动不影响发布，未提交文件按仓库根目录的相对路径列出。`push` 只发布已提交的内容：要发布的单元以及根部的 `sources.json`、`glossary.json` 有未提交的改动、未跟踪或被忽略的文件时拒绝，并列出这些文件。库里为每个单元记下发布时的提交、时间与推送者；推送者由命令自动取 `<用户>@<主机>`，设置了 `MOLNOTES_PUSHER` 时附在其后（用于区分同一用户的不同会话）。`push` 在发布事务内持锁检查：库里记下的提交不是当前 HEAD 的祖先（或本仓库没有这个提交）时整次拒绝、数据库不变，列出这些单元和它们的提交、时间、推送者，合并后再推；库里还没有提交记录的单元，库里内容（`pull` 会导出的全部文件，JSON 按值、资源按哈希比较）与当前提交一致时直接发布并记下提交，不一致时拒绝，先 `pull` 该单元、用 `git diff` 核对并提交后再推。库里没有的单元按新建发布。`remove` 要求该单元已在当前提交中删除，同样做祖先检查，删除后库里记下这次删除的提交，没有合并这次删除的分支不能把单元推回来。`list` 每行列出单元、发布时的短提交、时间与推送者（没有记录的显示 `-`）。

数据库连接取 `MOLNOTES_DATABASE_URL`，或 `MOLNOTES_DATABASE_URL_FILE` 指向的文件；两者都没有时报错。资源存储见 README 的配置表；本地测试可设置 `MOLNOTES_ASSET_STORE=dir:<绝对路径>`。

## 协作流程

每个改内容的任务在内容仓库的独立 worktree 与分支上修改并提交，只检出要改的单元（`git sparse-checkout set --cone <内容目录>/notes/<dir> <内容目录>/sites/<slug>`，内容目录与仓库根部的文件总会检出）；审阅后合并到 `main`，从 `main` 发布。按字审阅正文与作者资料：

```bash
git diff --word-diff=plain --word-diff-regex='[A-Za-z0-9_]+|[^[:space:]]' main...<分支> -- '*.md'
```

回滚是 `git revert <提交>` 后 `push` 涉及的单元。发布校验在一个事务里完成，失败不写入，所以不需要先向别的数据库试推。开发数据库只用于在浏览器里操作专题交互：交互会写入学习记录，不能在生产库上试。开发库不与生产同步，与内容仓库对不上而推不进去时，删除并重建这个数据库，再从内容仓库 `main` 分批推入全部单元。

## 学习记录

专题学习记录与笔记最近打开、读过状态由网站保存；滚动位置留在当前浏览器。写入失败显示“未保存”，内存值保留，点击重试可继续保存。复习页导出全部学习记录。

## 专利专题单元

专利共享块在 `content.json` 声明 `data.sources`、`data.collections`、`data.claims`、`data.sarCases` 与 `data.synthesis`；字段与路由见 [块目录](../toolbox/GUIDE.md)。每个 `data.sources.<id>` 为 `{ title, pages, size, image, text, paragraphs }`，必填 `size: [width, height]` 是 PDF points 单位的正数尺寸（例如 A4 `[595, 842]`）；矩形引用按该来源尺寸校验和定位。来源页图放 `static/pages/`，来源的 `image` 用 `{page}` 替换从 1 开始的 PDF 页序；OCR 放 `static/pages-text.json`，是与页数等长的字符串数组。多个来源各自指定页图路径与文本 JSON，引用用 `source` 区分。

制备等长正文放按需 JSON（例如 `static/example-bodies.json`），对象的键映射到字符串正文；`body` 字段写 `{ "url": "/sites/<slug>/static/example-bodies.json", "key": "1" }`。页图与正文仅在打开时加载，资源仍随专题单元一起发布。

发布时检查记录间引用、权利要求引用、页序和矩形范围、页图与片段资源、正文 JSON 的键以及 OCR 页数。SMILES 与范围定义 `scope.smarts` 由 RDKit 解析；空结构须在制作记录和该条 `notes` 中说明未确认原因。校验失败拒绝整组发布。

比较记录保存为 `pins: { <collectionId>: [id] }`，逐条笔记为 `recordNotes: { "<collectionId>/<id>": "正文" }`。浏览器和服务端共用由内容派生的校验：未知编号、重复比较编号、超出 `pins.max` 或超过 30000 字的笔记拒绝写入。

## Agent 专利研究记录

Agent 在私有内容工作目录补充数据，通过同一 `push` 事务发布；浏览器承担检索、阅读与比较。中性可运行样例是 `tests/fixtures/content/sites/fable-patent/content.json`，运行契约为 `scripts/patent-contract.mjs`、`scripts/patent-research.mjs` 和 `src/ui/topic/patent.ts`。原始专利、OCR、核对截图和真实数据不得进入源码仓库。已有分档、编号与学习记录可继续使用。

collection 的内部 `id` 唯一且保持稳定。跨来源编号相同时使用如 `alpha-46`、`beta-46` 的内部 ID，并以普通 `text` 字段保留原编号；不得为新增来源改写全部旧 ID。化合物引用写 `{collection,id}`，引用的是该来源的实际化学身份；制备中的局部产物另建记录，不能用最终实施例代替中间产物。未核对的结构省略 SMILES，并在 notes 说明。路线链接优先显示记录的 `shortName` 文本字段，可用短中文名称标识局部产物；原文全名仍作为独立字段保留。

### 活性测量

在 collection 的 `assays` 中按稳定键登记 `{title,target,endpoint,conditions,unit,evidence}`。每个 assay 键代表同一测定体系、条件和单位；条件不同另建键。未知条件在文字中明示。未知单位用 `unit: null` 并提供 `unitReason`；不以空串或猜测单位替代。`evidence` 为原页引用数组，全局 assay 证据必须写 `source`。

字段声明 `{key,label,kind:"measurement",filter:true,sort:true}`；每条记录必须提供该字段，值为 `{assay,status:"reported",qualifier,value,ref}`，qualifier 为 `=`、`<`、`<=`、`>`、`>=` 或 `range`。范围用 value 与 upper 保留上下界。缺失值写 `{assay,status,reason,ref?}`，status 为 `unreported`、`not-tested` 或 `unresolved`，不得附加数值或 qualifier。记录内 ref 可继承 record.source。一个字段保存一个观察值；需要并排多次测定时声明多个测量字段，避免覆盖。

数值上下限要求选定 assay 且单位已知，只有观察值的整个可能区间满足边界才通过，例如 `<20 nM` 通过上限 25，`>20 nM` 不通过上限 25。阈值不是精确值。排序仅对当前选定 assay 中有已知单位的 `=` 精确值排序，其他状态保留编号顺序并置后；未选 assay 时按编号。不同 assay、单位与条件之间不作隐式换算或效力排名。CSV 保存测量对象及完整 assay 定义，保留 qualifier、单位、条件、缺失原因和证据。

### 分组、权利要求与假设

`kind:"assignments"` 字段的值是数组，每项为 `{group,basis,evidence,claims,limit,pattern?}`。basis 是 `author`（原文归类）、`agent`（Agent 归类）或 `chemical-pattern`（声明的化学模式）；后者必须填写 pattern。每项必须有原页证据、关联 claims 数组（无关联写空数组）和具体 limit。此字段可筛选；列表、详情、比较和 CSV 保留依据与局限。`claims` 是证据关联，不代表完整法律覆盖。权利要求页的模式匹配结果区分 matched、not-matched、unmodeled，只说明声明的 SMARTS 子结构匹配情况。

既有 `sarCases` 可加 `analysis:{kind,rationale,evidence}`，kind 为 `observation`、`design-around-hypothesis` 或 `unresolved`，配合 cases 的 finding、limit、ids 和 claims 展示原文观察、推论或待核实问题。设计绕开假设必须写明证据、推理和局限，不能将模式阴性解释为法律结论。

### 连接合成路线

声明块 `{type:"synthesis-network",network:"<key>"}` 与 `data.synthesis.<key>:{title,procedures?,steps,routes}`。章节显示同一组件，独立路径为 `/synthesis/<key>`；复用 collection 化合物详情和 source 原页页面。

每个 step 有唯一 `id`、`title`、`strategy`、`reactants`、`products`、`evidence`、`yield`；可有 `owner` 指向最终制备归属记录、`limit` 说明批次或原文局限。反应物和产物都是 collection 引用数组。直接条件写 `reagents`、`conditions`，未报告的条件明确写“未报告”。程序复用写 `procedure` 指向 network.procedures 键及 `procedureNote` 说明引用原文与适用范围。procedure 包含 `{reagents,conditions,evidence,sourceRecord?}`；可将未展开的条件写“未核验，见所引程序”，不猜测数量或操作。step 的 reagents/conditions 覆盖对应程序字段时必须有 `overrideEvidence`；不会继承质量或收率，程序表不保存 yield，也不产生不同产物间的物料边。

单步 yield 明确写 `{status:"unreported",reason}` 或 `{status:"reported",value,unit:"%",basis,product,ref}`。reported 百分比在 0–100 之间，product 必须属于该步产物。质量独立写 `isolatedMass:{value,unit,state,product,ref}`，单位 mg/g/kg，state 为 crude/purified；粗品 24 g 不等于 24%。

每条 route 为 `{id,title,scaffold,target,startingMaterials,steps,extent,limit,evidence,reportedYield?}`。extent 是 complete 或 fragment，limit 说明核验边界；片段显示“已核验片段”，总步骤与最长路径只统计所列步骤。startingMaterials 明确列出该路线没有上游生产步骤的起始身份。每条路线选择一个无环、目标可达、产物生产者唯一的步骤图；无关步骤、悬空引用、循环和不一致的起始边界拒绝发布。不同路线可共享中间体、选择替代生产路径，按骨架和反应策略筛选并比较两条路线。骨架相同不代表合成相同。

原文跨步骤报告的收率放在 route.reportedYield：`{value,unit:"%",basis,product,ref,scopeStepIds}`；scopeStepIds 明确列出连续身份连接的两个或更多步骤。各边仍填其单步未报告状态。界面标明“原文合并收率”和步骤范围，不将该值归到最后一步，也不计算或连乘总体收率。化学身份连接不证明物料为同一批次，批次差异在 step.limit 与 route.limit 写明。

assay、procedure、step、route、合并收率和 analysis 的全局证据必须显式指定 source；记录内 measurement/assignments 证据可继承 record.source。证据引用沿用 `{source,page,end?,rect?}`，page 是 PDF 页序，不能以首个来源作为多专利研究的默认归属。

只有“按 Example X”引用而尚未展开步骤时，可写 network.references：每项 `{record,procedure,note,evidence,reagents?,conditions?,overrideEvidence?,yield:{status:"unreported",reason}}`，procedure.sourceRecord 指向 X。它呈现原文明示的程序关系与替换试剂，不产生反应物/产物边，不猜测批次、步骤、数量或收率。替换字段必须有 overrideEvidence；程序关系拒绝自引用和循环。
