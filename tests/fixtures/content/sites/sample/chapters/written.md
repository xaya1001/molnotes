---
title: 书面观察
note: notes/reader-test/second
number: 3
short: 练习
minutes: 5
lead: 比较并记录中性样本。
refs: []
---

## 比较样品

在同样的观察范围内逐一计数。

```question
type: choice
id: written-choice
question: 哪个样品更多？
options: [A, B]
answer: 0
explanation: A 有两个，B 有一个。
optionExplanations: [A 有两个，数量较多。, B 只有一个，数量较少。]
source: 中性计数样本
reset: true
```

```question
type: problem
id: written-open
lang: zh
prompt: 怎样记录两个样品的差异？
parts: [计算两者数量之差。]
answer:
  text: A 比 B 多一个。
  origin: ai
  basis: 中性计数样本的题设
```

## 结构观察

```question
type: atoms
id: written-atom
question: 选择氧原子。
molecule:
  name: 样品结构
  smiles: 'C1C[C@H]2CCC[C@H]2C1[OH:20]'
answer: [20]
explanation: 氧原子连接碳与氢。
```
