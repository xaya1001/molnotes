# 写作手册

写作 Agent 在正文写 Markdown 和 YAML；需要补图的位置写 `request`，交给补全 Agent 处理。
分子结构、时间线、流程图和能量图可直接写围栏。
开工只读本手册这一份通用文件，按以下顺序工作：

1. 读该系列 `author/` 约定（基调、人名、自己这一篇的主线）和 `author/plan.md` 中本篇的条目与分工。
2. 跑 `npm run content -- series <目录>`，了解已写篇目的小节与首次定义的术语。
3. 凭自己的知识写正文；需要的图写成 `request` 围栏或下文的文字图围栏。不读教材、不上网，没把握的数值在回报里列出。
4. 写完直接交稿，不跑 check、不修格式；检查与修正由审查方落库时完成。

不编造引用和页码；资料来源由审查核实后补上。
数字带体系、溶剂、温度或比较基准；正文直接讲知识，按本系列样稿写，不复述资料的章节与叙事。
术语首次写“中文（英文）”，之后用中文或通用简称；药物首次写中文通用名加英文，外国人名一般用姓。
下面的语法足够常规写作；遇到未覆盖的字段时才按需查[内容契约](../../docs/content.md)或[全站写作规定](../../private/docs/requirements.md#写作)。
以下用 `sample` 目录和 `observe` 篇目演示，实际写作替换为所在目录与篇名。

## 笔记与小节

笔记放在 `notes/<目录>/<篇名>.md`；目录和篇名用小写字母、数字与单个连字符。
目录的 `directory.json` 写成 `{"title":"观察笔记","intro":"比较给定的样本。","order":1}`。
每篇 front matter 必填 `title`、`summary`、`date`、`order`；可加 `updated` 日期，日期写真实的 `YYYY-MM-DD`。
正文从 `##` 开始，`##`、`###` 生成小节目录，`## 资料来源` 默认收起。

```markdown
---
title: 观察样本
summary: 比较给定的数量与结构。
date: 2026-01-01
order: 1
---

## 观察

A 有两个，B 有一个。

### 比较

A 比 B 多一个。

## 资料来源

[示例资料](https://example.org/)
```

## 文字与公式

正文用 `{化学名}` 标出本段论证的底物、产物和对照物，例如 `{溴甲烷}`。试剂、溶剂、化学式和基团照常写，例如 `碳酸钠`、`NaN₃`、`–CH₂–`。
立体与位次前缀用 Markdown 斜体，括号与连字符保持正体，例如 `{(*R*)-乳酸}`、`*tert*-`、`*N*-`、`*cis*-`、`*o*-`、`*m*-`、`*p*-`。图注写 `(*R*)-乳酸`。
字面花括号写 `\{` 和 `\}`。

化学式、离子、基团、单位、数值和简单符号用普通文字与 Unicode 上下标。
正例：`NaN₃`、`Cl⁻`、`–CH₂–`、`ΔΔG‡ ≈ 2.7 kcal/mol`、`10⁻¹² s`、`k₁`、`SN2`。
反例：`$\text{NaN}_3$`、`$\mathrm{Cl}^{-}$`、`$10^{-12}$ s`、`$k_1$`。
去掉 `$` 用 Unicode 能写得一样清楚，就用普通文字。
速率方程、Eyring、Hammett，以及带分式、对数、求和、矩阵或行列式的推导用公式；行内式子用 `$...$`，成段的式子用独立行的 `$$` 包围。

```markdown
速率满足 $v = k[A][B]$。

$$
v = k[A][B]
$$
```

## 分子结构

`molecule` 中每组 `smiles` 与 `caption` 配对；多组可在同一围栏里依次写。
SMILES 按资料中的连接关系与立体构型填写。

```molecule
smiles: CCO
caption: 样品结构
```

## 时间线

`timeline` 写 `caption`、`events`，每个事件写 `date` 和短句 `text`。
日期可用 `YYYY`、`YYYY-MM`、`YYYY-MM-DD`；`axis` 固定起止与年份刻度间隔，`accent: true` 强调重点。

```timeline
caption: 样本观察的三个阶段
axis: { from: 2020, to: 2022, every: 1 }
events:
  - { date: 2020, text: 开始观察 }
  - { date: 2021, text: 比较样本, accent: true }
  - { date: 2022, text: 汇总结果 }
```

## 流程图

`flow` 的 `nodes` 写唯一 `id` 和短句 `text`，`edges` 用 `a > b > c` 连成链。
节点可用 `kind: end` 表示起止、`kind: ask` 表示判断；分支边写 `{from: a, to: b, text: 是}`。
`side` 可省略：节点未显式标记侧出口、且恰有一条出边继续到非叶子时，其余单入边叶子自动作为侧出口。
多层分支在窄屏按大纲缩进排列，同一分支里的连续步骤保持同一缩进。

```flow
caption: 样本记录流程
nodes:
  - { id: start, text: 收集样本记录, kind: end }
  - { id: compare, text: 比较样本数量 }
  - { id: finish, text: 整理观察结果, kind: end }
edges:
  - start > compare > finish
```

```flow
caption: 样本分类流程
nodes:
  - { id: start, text: 样本数量够吗, kind: ask }
  - { id: check, text: 记录完整吗, kind: ask }
  - { id: collect, text: 补充样本 }
  - { id: record, text: 填写记录 }
  - { id: review, text: 核对来源 }
  - { id: ready, text: 开始比较, kind: end }
  - { id: fill, text: 补充记录, kind: end }
edges:
  - { from: start, to: check, text: 是 }
  - { from: start, to: collect, text: 否 }
  - collect > record > review
  - { from: check, to: ready, text: 是 }
  - { from: check, to: fill, text: 否 }
```

## 能量图

`energy` 的 `points` 每行写「相对能量 标签」，至少 3 个点，奇数位置是极小点、偶数位置是高于两侧的过渡态。
`paths` 可叠加 2–3 条有唯一 `name` 的路径，`focus: true` 强调其中一条；`rds` 指定本路径的决速步。
`marks` 用点标签写 `from`、`to`，极小点到过渡态默认标 `ΔG‡`，极小点到极小点默认标 `ΔG°`。
默认只画定性高低，`scale: true` 显示刻度与数值。

```energy
points:
  - 0 A
  - 90 TS1
  - -25 B
marks:
  - { from: A, to: TS1 }
caption: 比较初始状态与峰顶
```

## 表格

宽表把项目较多的一维写成行，例如比较三个样品的十项指标时，每行写一项指标。

## 提示块

引用块首行写 `[!要点]` 或 `[!易错]`，同行文字是可省略的标题。
要点写依据或结论；易错写错误推理及纠正。
块内可写段落、列表、行内公式、术语与引用，不嵌套提示块、标题、图或表格；其他 `[!X]` 类型会报错。

```markdown
> [!要点] 比较相邻状态
> 能垒取峰顶与初始状态的差值。

> [!易错]
> 终态较低时，仍要单独比较能垒。
```

## 资源请求

笔记正文与 Markdown 练习章都可在所需位置写 `request` 围栏。
图注写在 `caption`，图片文件名只用字母、数字、下划线、点和连字符。
下面每例都包含该类请求的必填字段。

### image：示意图

必填 `kind`、`file`、`caption`、`prompt`。
`prompt` 写要画的内容、读者应看到的要点、元素的相对位置与连接方向；格式和视觉风格由补全者按 note-figures 附加。
示意图不画确切的分子结构：需要读者看清连接或原子的分子写成 `figure` 请求或 `molecule` 围栏，示意图里的分子只画成带名称的轮廓、偶极或电荷分布。

```request
kind: image
file: sample-overview.png
caption: 两组样本的数量比较
prompt: >-
  左侧放 A 组两个圆点，右侧放 B 组一个圆点，组名分别标 A、B。
  两组水平对齐，读者应一眼看出 A 比 B 多一个圆点。
```

### figure：机理与反应

必填 `kind`、`caption`、`figure`；`figure` 内写完整化学图 YAML。
机理用 `kind: mechanism` 与 `frames`，每帧有稳定 `id` 和带原子映射号的 `smiles`；相邻帧相同映射号对应同一原子。
电子箭头 `arrows` 从 `lp(n)`（孤对电子）或 `pi(n,m)`（π 键）指向 `atom(n)` 或 `between(n,m)`（新键中点），`electrons: 2` 表示一对电子。
以下两帧示例表示加成前后；需要其他端点时按需查[化学图 YAML](../../docs/content.md#figure-yaml-compilation)。

```request
kind: figure
caption: 加成前后的电子变化
figure:
  kind: mechanism
  title: 加成示例
  frames:
    - id: before
      title: 成键与电子转移
      smiles: "[CH2:1]=[O:2].[OH-:3]"
      arrows:
        - { from: "lp(3)", to: "between(3,1)", electrons: 2 }
        - { from: "pi(1,2)", to: "atom(2)", electrons: 2 }
    - id: after
      title: 加成后
      smiles: "[CH2:1]([O-:2])[OH:3]"
```

单步反应用 `kind: route`，在 `compounds` 给结构编号，`steps` 的 `from`、`to` 引用这些编号，`above` 写箭头上方的试剂或条件。

```request
kind: figure
caption: 单步转化示例
figure:
  kind: route
  title: 氧化示例
  compounds:
    1: CCO
    2: CC=O
  steps:
    - { id: oxidation, from: 1, to: 2, above: "[O]" }
```

### chart：数据图

必填 `kind`、`file`、`caption`、`data`、`axes`、`point`。
`data` 可用逐行记录，`axes` 写每轴的名称、单位、范围和刻度，`point` 写读者应看到的结论与必要标注。
下面用 `x`、`y` 对应数据列；补全者按这些数值代码出图。

```request
kind: chart
file: sample-counts.png
caption: 两次观察的计数
data:
  - { x: 0, y: 1 }
  - { x: 1, y: 2 }
axes:
  x: { label: 观察序号, range: [0, 1], ticks: [0, 1] }
  y: { label: 数量（个）, range: [0, 2], ticks: [0, 1, 2] }
point: 第二次比第一次多一个；标出两个观测点的数值。
```

## Markdown 练习章

练习专题的 `content.json` 用 `"chapters": ["chapters/observe.md"]` 引用章文件。
章 front matter 必填 `title`、`note`、`refs`；`note` 指向对应的读者笔记，`refs` 可为空。
可加 `number`、`short`、`minutes`、`lead`，正文用段落、`##`、`###`、单层列表和 `question` 或 `request` 围栏。
每题 `id` 在专题内唯一且保持稳定。

```markdown
---
title: 观察练习
note: notes/sample/observe
refs: []
---

## 比较

A 有两个，B 有一个。
```

### choice：选择题

`options` 与 `optionExplanations` 逐项对应，`answer` 是正确选项从 0 起计的下标。

```question
type: choice
id: count-choice
question: 哪组更多？
options: [A, B]
answer: 0
explanation: A 有两个，B 有一个。
optionExplanations: [A 有两个。, B 有一个。]
```

### problem：开放题

`lang` 用 `zh` 或 `en`，`prompt` 写题设，`answer` 写参考答案 `text`、来源 `origin: book | ai` 和依据 `basis`；`parts` 可列小问。

```question
type: problem
id: count-open
lang: zh
prompt: A 有两个，B 有一个，相差多少？
answer:
  text: A 比 B 多一个。
  origin: ai
  basis: 题设中的计数
```

### atoms：点原子

`molecule` 写 `name` 和带映射号的 SMILES（如 `[CH3:30]`），`answer` 写原子映射号。
同一结构的非零映射号唯一，答案中的号必须存在；号码无需连续，`labels` 的键也用映射号。

```question
type: atoms
id: oxygen-atom
question: 选择氧原子。
molecule: { name: 样品, smiles: "[CH3:30][CH2:10][OH:20]" }
answer: [20]
explanation: 映射号 20 对应氧原子。
```

### bonds：点键

`answer` 每项写键两端的原子映射号，端点顺序不限。

```question
type: bonds
id: oxygen-bond
question: 选择碳氧键。
molecule: { name: 样品, smiles: "[CH3:30][CH2:10][OH:20]" }
answer: [[10, 20]]
explanation: 映射号 10 和 20 之间是碳氧键。
```

### atom-set：原子集合

`molecules` 可放多个结构，每个分子各写自己的 `name`、`smiles`、`answer` 映射号列表。

```question
type: atom-set
id: carbon-set
question: 选择所有碳原子。
molecules:
  - name: 样品
    smiles: "[CH3:30][CH2:10][OH:20]"
    answer: [30, 10]
explanation: 两个碳原子的映射号分别为 30 和 10。
```

### ranking：排序题

`options` 写排序项，`answer` 写正确首项在选项中的零起始下标。
读者提交完整排序，判分按首项。

```question
type: ranking
id: count-ranking
question: 按数量从多到少排列。
options: [一个, 三个, 两个]
answer: 1
explanation: 三个最多。
```

### number：数值题

`input.label` 写输入名称，可加 `unit`、`min`、`max`、`step`；`answer` 写数值，`tolerance` 写允许的绝对误差。

```question
type: number
id: count-number
question: 两个加一个是多少？
input: { label: 数量, unit: 个, min: 0, step: 1 }
answer: 3
tolerance: 0
explanation: 两个加一个是三个。
```

## 术语

正文写 `[[术语]]`，名称必须与内容根目录 `glossary.json` 中的 `term` 精确一致。
新增术语时同时向该数组加入条目，四个非空字段为 `term`、`full`、`definition`、`confusion`，`term` 全站唯一。
审查方落库时跑 `npm run content -- check notes/<目录>/<篇名>.md`，修正格式与重复术语，并判断术语链接提示是否需要处理。
新术语可先写进独立 JSON 数组，通过 `--glossary-additions <json>` 一起检查，确认后并入内容根的 `glossary.json`。

```markdown
用[[计数]]比较两组样本。
```

```json
[
  {
    "term": "计数",
    "full": "counting",
    "definition": "确定对象的个数。",
    "confusion": "个数与对象大小分别记录。"
  }
]
```

## 站内链接

同目录写篇名，跨目录写 `../<目录>/<篇名>`，也可写 `/notes/<目录>/<篇名>`；锚点和查询参数可接在路径后。
练习章使用实际 `/practice/<专题>/<章节路径>`，其他专题使用 `/sites/<专题>/<章节路径>`，章节路径以该专题配置为准。
目标笔记和章节必须存在，链接不加 `.md`。

```markdown
[同目录篇目](observe#比较)
[另一目录篇目](../other/observe)
[笔记绝对路径](/notes/sample/observe)
[对应练习](/practice/sample/observe)
```
