# 时间线与流程图

笔记和专题里按日期排开的事件、方框加箭头的流程，用数据写，由共享组件渲染：按日期比例定位，标签不重叠，手机上改为竖排，图里的文字能被搜索。字段的完整定义与发布校验见 [内容工作目录](../../docs/content.md)，本页讲怎么选、怎么写、怎么查。

## 选写法

| 要表达的                                         | 写法                                                    |
| ------------------------------------------------ | ------------------------------------------------------- |
| 事件发生在什么时候、间隔多长                     | `timeline`                                              |
| 只看先后，不看间隔                               | `timeline` 加 `axis: {even: true}`                      |
| 几条线索并行（几家公司、几种病毒）               | `timeline` 加 `lanes`                                   |
| 一步接一步的流程、分出几条路、判断、汇合、侧出口 | `flow`                                                  |
| 数值、曲线、坐标                                 | 专题用 `chart` 块；笔记按 note-figures skill 用代码出图 |
| 机理、通路、循环、器官、空间关系、历史场景       | 按 note-figures skill 出图                              |
| 分子结构                                         | `molecule` 围栏或块                                     |

一张图只回答一个问题：图注说清它回答什么，图里只放回答所需的事件或步骤。

## 写好的要点

- 文字照原文，标签和框里写短句：一个标签或框通常不超过 25 个字。说明留给正文。
- 断行按短语：只在标点后、英文词旁的空格处断，数字与单位（`90 nM`）、`88,000`、`26.8%` 不拆。没有标点的长句会在中间折行；要指定断在哪里，把文字加双引号并写 `\n`，如 `"2018 至 2020 年\n集采与国谈"`。
- `accent` 只给图要读者先看到的那一处（一张图一两处）；`muted` 只表示没有走通的那条路。
- 原文只给出前后两个日期的事件写 `between`，不要自己编一个年份。
- 时间线的 `show` 用于原文的说法（“1968 年初”“1951 年春”）；日期仍按最接近的月份写，定位才准。
- 流程图同一层的左右顺序先按 `nodes` 的书写顺序，所以把想放在左边（或上边）的路写在前面。

## 模板

### 单线时间线：时段与括号

```timeline
caption: 某项目 12 年：从建立筛选到上市
axis: {from: 1964, to: 1976, every: 2}
events:
  - {date: 1964, text: 建立动物筛选}
  - {date: 1968-01, show: 1968 年初, text: 主管决定：再给一年, accent: true}
  - {between: [1968, 1970], text: 回头看最初的类似物}
  - {date: 1970, text: "第一个拮抗剂\n注射有效，口服不行"}
  - {date: 1976, text: 上市, accent: true}
spans:
  - {from: 1964, to: 1968, text: 4 年，200 多个类似物，没有一个达标}
brackets:
  - {from: 1964, to: 1976, text: 12 年}
```

### 只看先后

```timeline
caption: 一个药走到新适应症的几步
axis: {even: true}
events:
  - {date: 1937, text: 动物实验}
  - {date: 1951-01, show: 1951 年初, text: 一次晚饭}
  - {date: 1957, text: 获批，适应症是另一种病}
  - {date: 1960-05-09, text: 获批用于新适应症, accent: true}
```

### 多条泳道、竖线与图例

```timeline
caption: 两条线索：从发现到第一批药
axis: {from: 1960, to: 2030, every: 10}
markers:
  - {date: 1989-02, text: 结构发表}
legend:
  - {mark: diamond, text: 发现}
  - {mark: [dot, ring], accent: true, text: 有了能测药的筛子（空心：凑合）}
  - {mark: square, text: 药或终点}
lanes:
  - label: 甲
    events:
      - {date: 1983, mark: diamond, text: 被找到}
      - {date: 1984, mark: dot, accent: true, text: 有了筛子}
      - {date: 1987, mark: square, text: 第一个药}
  - label: 乙
    events:
      - {date: 1965, mark: diamond, text: 被找到}
      - {date: 1991, mark: ring, accent: true, text: 凑合的筛子}
      - {date: 1998, mark: square, text: 第一个药}
```

竖线可写 `accent: true` 和 `below`（轴下方的一行字）；`axis.ticks` 写年份列表时只在这些年份标刻度，写 `none` 不画刻度。

### 一年之内，按月

```timeline
caption: 2026 年 4 月到 10 月获批的几个药
legend:
  - {mark: dot, accent: true, text: 新办法}
  - {mark: dot, text: 老办法}
events:
  - {date: 2026-04-01, accent: true, text: "药甲\n小分子模仿肽"}
  - {date: 2026-05-15, text: "药乙\n抑制合成酶"}
  - {date: 2026-08-13, accent: true, text: "药丙\n分子胶"}
  - {date: 2026-10-20, accent: true, text: "药丁\n反义核酸"}
```

不足一年的轴自动按月标刻度，日期只写月日，年份放进图注。

### 直链

```flow
caption: 从取样到回输：每个病人一批
over: 从取样到回到同一位病人：几个星期
note: 每个病人一批，没有库存
nodes:
  - {id: s1, tag: 病人静脉, text: 取样}
  - {id: s2, text: 分离细胞}
  - {id: s3, text: 激活}
  - {id: s4, text: 转入基因}
  - {id: s5, text: "扩增\n9 到 11 天", tone: accent}
  - {id: s6, text: 检测}
  - {id: s7, tag: 回到静脉, text: 回输}
edges:
  - s1 > s2 > s3 > s4 > s5 > s6 > s7
```

一行放不下时自动折成几行横排，行末用折线箭头接到下一行行首。

### 分出两条路

```flow
caption: 同一个起点，两条路
nodes:
  - {id: start, text: 原料, kind: end}
  - {id: work, text: 溶解、沉淀、重结晶}
  - {id: a1, text: 得到一种酸, tone: muted}
  - {id: a2, text: 没有作用, tone: muted}
  - {id: b1, text: 母液没有倒掉, tone: accent}
  - {id: b2, text: 加碱，析出结晶}
  - {id: b3, text: 后来叫某某, kind: end}
edges:
  - start > work > a1 > a2
  - work > b1 > b2
  - {from: b2, to: b3, dashed: true}
```

### 每一步的侧出口

```flow
caption: 一份列表的处理顺序与每一步淘汰的
nodes:
  - {id: list, text: 筛选得到的列表, kind: end}
  - {id: s1, tag: 1 排除假阳性, text: 复测；查结构}
  - {id: x1, text: 剔除：聚集体、干扰读数的, tone: muted}
  - {id: s2, tag: 2 确认结合, text: 新批次复测}
  - {id: x2, text: 剔除：确认不了的, tone: muted}
  - {id: done, text: 进入下一阶段, kind: end}
edges:
  - list > s1 > s2 > done
  - {from: s1, to: x1, side: true}
  - {from: s2, to: x2, side: true}
```

侧出口的节点画在源节点旁边，不再连别的边。

### 判断

```flow
caption: 先便宜后贵的排查
nodes:
  - {id: q, text: 纯酶很强，细胞弱很多, kind: end}
  - {id: s1, text: 提高 ATP 复测 IC50}
  - {id: a1, text: IC50 明显变大？, kind: ask}
  - {id: r1, text: 部分差距来自 ATP 竞争}
  - {id: s2, text: 测外排比}
edges:
  - q > s1 > a1
  - {from: a1, to: r1, text: 是}
  - {from: a1, to: s2, text: 否}
```

### 汇合

```flow
caption: 三个条件指向同一个结果;
nodes: -{ id: a, tag: 条件一, text: "审评接轨\n数据可以出去" } -
  { id: b, tag: 条件二, text: "融资放开\n有钱做管线" } -
  { id: c, tag: 条件三, text: "国内价格被压低", tone: accent } -
  { id: goal, text: "出海\n把分子授权出去" };
edges: -{ from: [a, b, c], to: goal };
```

几条边汇合时不带文字；要给每条箭头写字，就一条边写一个 `from`，各带 `text`。

## 预览与改图

写好或改过一张图，先在内容工作目录预览，再发布：

```bash
npm run content:preview -- notes/<dir>/<slug>
```

输出每张图在 1366 px 与 390 px 下的截图路径、写法错误（文件与行号）和版面警告。打开两张截图看一遍，警告清零再 `content push`。

| 警告                                 | 改法                                                                          |
| ------------------------------------ | ----------------------------------------------------------------------------- |
| 标签重叠、引线穿过标签、竖线穿过标签 | 缩短标签；同一年的几件事合成一个标签；组件会先自动收窄标签，仍不行时才报出    |
| 标签离它的点过远                     | 同上；事件太密时考虑拆成两条泳道                                              |
| 框太窄，文字断成 N 行                | 缩短框里的字，或用 `\n` 指定断行；同一层节点太多时把一部分改成侧出口或拆图    |
| 连线穿过框或文字、连线文字与框重叠   | 调整 `nodes` 的书写顺序；缩短箭头上的字                                       |
| 图比版面宽、字号过小                 | 节点或事件太多：拆成两张图                                                    |
| 渲染失败                             | 结构式的 SMILES 不能解析，按报错改                                            |
| 第 N 个结构：原子重叠、压在键上等    | 运行 `npm run molecule:layout -- '<SMILES>'`，把推荐的带坐标写法写回 `smiles` |

专题里写同样的数据：`{"type": "timeline", "timeline": {…}, "caption": "…"}` 或 `{"type": "flow", "flow": {…}}`；大块数据可以放进 `data`，块里写它的键名。

## 边界

流程图最多 20 个节点，只能单向（不能连成环）；催化循环、反馈环、通路网络和需要空间位置的示意图按 note-figures skill 出图。时间线不画数值；要比较数字，用图表或表格，数字也要在正文里写出。
