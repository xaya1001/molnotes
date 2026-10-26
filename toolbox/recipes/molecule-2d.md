# 二维分子结构

正式内容先核对结构，再把原始 SMILES 交给 `@ui` 的结构组件。记录 PubChem CID / ChEMBL ID、原始 SMILES、立体化学与核对日期；中间体同时记录可追溯的化学名称及原始 Scheme 页码。图像用于核对，不从无法辨认的键线猜 SMILES。专利原图继续作为证据。

## 分子、性质与选择

`MoleculeView` 接收 `name`、`smiles`。`highlightAtoms` / `highlightBonds` 为零基索引数组，`labels` 为 `{ [atomIndex]: text }`。索引是传入 SMILES 的 RDKit 解析顺序；不要换用规范化 SMILES 后复用旧索引。`selectable="atoms"` 或 `"bonds"` 开启点选，`v-model:selected` 双向绑定索引数组，`disabled` 锁定选择。鼠标、Tab、Enter 与空格均可操作，选中圈/键和文字读数同步呈现。

结构使用 RDKit `fixedBondLength: 28` 与统一 600 × 360 绘图坐标，避免小分子自动撑满画布；超出画布的结构由 RDKit 缩小。SVG 的 viewBox 按结构、标记与箭头的实际包围盒加 12 单位边距裁剪，显示宽度按裁剪宽度 / 600 同步缩小，去除空白而不放大小分子。同宽容器内键长一致。未开启 `selectable` 时，`selected` 以外层虚线圈保留预测位置，`highlightAtoms` 以实线圈表示核对位点；图例放在结构外，重合时两圈均可见。

```vue
<MoleculeView
  name="乙醇"
  smiles="CCO"
  selectable="atoms"
  v-model:selected="selected"
/>
<MolecularProperties smiles="CCO" />
```

`MolecularProperties` 根据同一个 SMILES 显示平均分子量（g·mol⁻¹）、Wildman–Crippen cLogP、Ertl TPSA（Å²）、NumHBD、NumHBA 与 NumRotatableBonds，并标计算方法。这些是给定结构的计算值，不能当成实测 logD、pH 下的分布或代谢预测。`SubstituentExplorer` 接收 `site` 与 `variants: { name, smiles }[]`，只切换作者核对过的完整结构和性质，不提供结构编辑器。

## 反应与机理

- `ReactionStep` 的 `step` 包含 `title`、`reactants` / `products`（`{ name, smiles }[]`）、`reagents`、`conditions`、可选 `yield` 与 `explanation`。试剂在箭头上方，条件/收率在下方；低宽度屏幕纵向排布。
- `SynthesisRoute` 的 `routes` 为 `{ id, title, steps: ReactionStepData[] }[]`，支持路线切换、步骤按钮与前后浏览。各步的收率统计范围由内容作者写明。
- `MechanismViewer` 的 `frames` 为 `{ name, smiles, explanation, arrows }[]`。每个箭头 `{ from, to, electrons: 1 | 2, bend? }` 的端点是 `{ atom: index }` 或 `{ bond: index }`，不是像素；`bend` 为有符号曲率比例。双钩表示电子对，鱼钩表示单电子。多个分子用同一 SMILES 的点号分隔，索引在该整体图内编号；帧内键中心和原子坐标由 RDKit 绘图取得。每帧需独立核对电子流、电荷与产物，绘图库不证明机理成立。

## 先预测再揭晓

`PredictionExercise` 接收 `prompt` 与 `canSubmit`，默认插槽提供 `{ submitted }`，提交后才创建 `#result` 插槽；`@submit` 回调读取专题自己的作答状态，写入专题记录。原子/键练习使用 `MoleculeView`，选项或 SAR 预测表可在默认插槽用原生表单。题目切换时用题目 id 作为 `key`。提交前只传空高亮和空标签，任何会透露答案的结构、说明与摘录都放在 `#result` 中；记录、评分和恢复由专题负责。

## 原文与阅读

`SourceExcerpt` 接收 `excerpt` 和 `sources`；`ReadingGuide` 接收 `items` 和 `sources`。共享类型 `Excerpt` / `ReadingItem` 保持专题制作规范的字段；`sources` 至少有 `id`、`title`。文本以转义文本呈现，原页图使用可放大的 `UiFigure`。`validateEvidence(sources, excerpts, reading)` 可在数据装配时检查；渲染时同样检查来源，不存在即报错。大图使用专题 `static/assets/` 与资源清单，原始 PDF 不进入仓库。

## 加载与边界

运行时精确锁定 `@rdkit/rdkit@2026.3.6`（BSD-3-Clause）。挂载分子或性质组件后，才动态导入加载器并请求同域 JS/WASM 资源；不使用 CDN。计算后立即释放 RDKit 分子句柄。加载或解析失败保留 SMILES 和原因，结构组件提供重试。普通 SMILES 不能表达阻转异构体的轴构型，这类分子须保留原图与说明。

不需要运行时交互的固定插图可使用 `toolbox/molecule-2d/render.py`：按其 `requirements.txt` 安装 Python RDKit，传 `--smiles` 与 `--output` 生成 SVG。实时高亮、原子选择和性质计算使用上述组件。完整 API 演示见 `/showcase/molecule`。

参考：[RDKit.js](https://rdkitjs.com/)、[RDKit 二维绘图](https://www.rdkit.org/docs/GettingStartedInPython.html)。
