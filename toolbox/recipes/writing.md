# 写作手册

写作 Agent 在正文写 Markdown 和 YAML；需要补图的位置写 `request`，交给补全 Agent 处理。
分子结构、时间线、流程图和能量图可直接写围栏。
开始写某套笔记前先读它的 `author/` 资料。
以下用 `sample` 目录和 `observe` 篇目演示，实际写作替换为所在目录与篇名。

## 笔记与小节

笔记放在 `notes/<目录>/<篇名>.md`；目录和篇名用小写字母、数字与单个连字符。
目录的 `directory.json` 写成 `{"title":"观察笔记","intro":"比较给定的样本。","order":1}`。
每篇 front matter 必填 `title`、`summary`、`date`、`order`；可加 `updated` 日期，日期写真实的 `YYYY-MM-DD`。
正文从 `##` 开始，`##`、`###` 生成小节目录，`## 资料来源` 默认收起。
详见[笔记契约](../../docs/content.md#内容工作目录)与[来源引用](../../docs/content.md#来源与引用)。

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

## 分子结构

`molecule` 中每组 `smiles` 与 `caption` 配对；多组可在同一围栏里依次写。
SMILES 按资料中的连接关系与立体构型填写。
详见[结构式字段](../../docs/content.md#内容工作目录)。

```molecule
smiles: CCO
caption: 样品结构
```

## 时间线

`timeline` 写 `caption`、`events`，每个事件写 `date` 和短句 `text`。
日期可用 `YYYY`、`YYYY-MM`、`YYYY-MM-DD`；`axis` 固定起止与年份刻度间隔，`accent: true` 强调重点。
详见[时间线契约](../../docs/content.md#内容工作目录)与[更多模板](figures.md#模板)。

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
详见[流程图契约](../../docs/content.md#内容工作目录)与[更多模板](figures.md#模板)。

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
默认只画定性高低，`scale: true` 显示刻度与数值；详见[能量图字段](../../docs/content.md#内容工作目录)。

```energy
points:
  - 0 A
  - 90 TS1
  - -25 B
marks:
  - { from: A, to: TS1 }
caption: 比较初始状态与峰顶
```

## 提示块

引用块首行写 `[!要点]` 或 `[!易错]`，同行文字是可省略的标题。
要点写必须带走的依据或结论，一节至多一个；易错写错误推理及纠正，其他补充内容放正文。
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
下面每例都包含该类请求的必填字段；详见[资源请求契约](../../docs/content.md#内容工作目录)。

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
以下两帧示例表示加成前后；详见[化学图 YAML 与箭头端点](../../docs/content.md#figure-yaml-compilation)。

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
详见[Markdown 练习章契约](../../docs/content.md#markdown-练习章)。

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
详见[术语表契约](../../docs/content.md#术语表)。

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
详见[笔记链接](../../docs/content.md#内容工作目录)与[专题路径](../../docs/content.md#专题)。

```markdown
[同目录篇目](observe#比较)
[另一目录篇目](../other/observe)
[笔记绝对路径](/notes/sample/observe)
[对应练习](/practice/sample/observe)
```
