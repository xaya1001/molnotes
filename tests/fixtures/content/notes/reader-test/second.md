---
title: 第二篇观察
summary: 接着第一篇比较两组读数。
date: 2026-10-17
order: 2
---

## 比较

把两组读数并排，看差别从哪里来。

## 记录

读数写进表格，单位与条件一起记。

```timeline
caption: 两组读数的时间
events:
  - {date: 2024-03, text: 第一组读数}
  - {date: 2025-09, text: 第二组读数, accent: true}
```

## 单步路径

> [!要点] 比较峰顶与初始状态
> 能垒取过渡态与初始状态的能量差。
>
> - 先找相邻的极小点。
> - 再比较峰顶的高度。

```energy
axis: 自由能 G
scale: true
points:
  - 0 初始样品 A
  - 96 [A⋯B]‡
  - -96 终态样品 B
marks:
  - {from: 初始样品 A, to: "[A⋯B]‡"}
  - {from: 初始样品 A, to: 终态样品 B}
caption: 单步路径的能垒与反应能
```

## 连续步骤

> [!易错] 终态高度与能垒分别比较
> 终态较低时，路径仍可能经过较高的过渡态。

```energy
points:
  - 0 初始样品 A
  - 90 TS1
  - 50 中间状态 B
  - 60 TS2
  - -5 中间状态 C
  - 0 TS3
  - -25 终态样品 D
rds: TS1
marks:
  - {from: 初始样品 A, to: TS1}
caption: 两个中间状态连接连续步骤
```

## 路径叠加

```energy
paths:
  - name: 路径 A
    focus: true
    rds: TS1
    points:
      - 0 初始样品 A
      - 90 TS1
      - 50 中间状态 B
      - 60 TS2
      - -20 终态样品 C
  - name: 路径 B
    points:
      - 0 初始样品 A
      - 132 [A⋯C]‡
      - -20 终态样品 C
marks:
  - {from: 初始样品 A, to: TS1, text: ΔG‡(A)}
  - {from: 初始样品 A, to: "[A⋯C]‡", text: ΔG‡(B)}
caption: 两条路径共享初始与终态
```

## 两种终态

```energy
paths:
  - name: 路径 A（较低峰顶）
    points:
      - 0 初始样品 A
      - 80 TS1
      - 30 中间状态 B
      - 45 TS(A)
      - -30 终态样品 C
  - name: 路径 B（较低终态）
    points:
      - 0 初始样品 A
      - 80 TS1
      - 30 中间状态 B
      - 60 TS(B)
      - -55 终态样品 D
marks:
  - {from: TS(A), to: TS(B), text: ΔΔG‡}
  - {from: 终态样品 C, to: 终态样品 D, text: ΔΔG°}
caption: 共享前段之后通向两种终态
```

## 结构对照

```molecule
smiles: c1ccccc1C#C
caption: 样品 C
smiles: c1ccccc1CC
caption: 样品 D
```

```molecule
smiles: C[C@H](N)O |(-1.5,0,;0,0,;0,1.5,;1.5,0,)|
caption: 样品 E
```

```molecule
smiles: C[Si](C)(C)C
caption: 样品 F
```

```molecule
smiles: CCO |(0,0,;3,0,;4.5,2.598,)|
caption: 样品 A
smiles: CCOC(=O)C1CCN(CC1)C(=O)OC(C)(C)C
caption: 样品 B
```

```molecule
smiles: CCOC(=O)C1CCN(CC1)C(=O)OC(C)(C)C
abbreviations: Boc, CO₂Et
caption: 样品 B 缩写
smiles: C[C@H](O)/C=C/C(=O)O
caption: 构型样品
```
