# 三维结构查看

先确定真实结构文件及来源、链、配体和需要解释的区域。页面需要用户旋转、缩放或选择残基时，可在该页按需引入 3Dmol.js，并把结构文件作为项目资源由同域名提供。

## 选哪一个

只旋转和高亮：看 `src/showcase/ProteinViewer.vue`，结构文件为 `public/showcase/1crn.pdb`，来源为 [RCSB PDB 1CRN](https://www.rcsb.org/structure/1CRN)。组件在点击后才加载 3Dmol.js 与同域结构文件；无 WebGL 时提供来源链接和文字说明。正式专题通过共享结构块提供核对过的结构、链和说明。

要让读者量距离、点预设的接触：用共享的 `StructureLab`，演示在 `/showcase/structure`，props 与数据形状见 `GUIDE.md` 的“结构量距”。两者职责分别为：`ProteinViewer` 不读取原子、不算数，`StructureLab` 解析坐标并由坐标算出每个显示的距离。页面文字要引用某个原子间距离，或结论依赖几个残基的相对位置时用 `StructureLab`，其余用 `ProteinViewer`。

## 用 StructureLab 的步骤

1. 在 RCSB 条目页核对标题、分辨率、链号、配体残基名和残基编号，不凭记忆写；多份拷贝时只取一份，写明是哪一条链。
2. 把 `toolbox/structure/extract-subset.mjs` 复制到内容工作目录的 `sites/<slug>/tools/`，按专题改写，脚本头记录来源 PDB 号、链、残基、取数日期和完整文件的 SHA-256。运行后得到的子集去掉氢原子、水和第一个构象以外的原子，文件头 REMARK 写明来源；坐标文件放在内容工作目录的 `static/`，由 `content push` 上传到私有对象存储。
3. 在 `content.json` 的 `data.structures` 写结构集合（`defineStructureSet` 的输入，`url` 指向本专题静态资源），例如：

```json
{
  "fetchedOn": "2026-10-13",
  "entries": [
    {
      "id": "181L",
      "label": "181L · 空腔里的苯",
      "url": "/sites/<slug>/static/181L.pdb",
      "source": {
        "pdb": "181L",
        "title": "…",
        "resolution": 1.8,
        "note": "Morton 1995, Biochemistry"
      },
      "subset": {
        "residues": { "A": [60, 162] },
        "hetero": [{ "chain": "A", "resn": "BNZ", "resi": 400 }]
      },
      "ligand": { "chain": "A", "resn": "BNZ", "resi": 400, "name": "苯" },
      "layers": [
        {
          "label": "溶菌酶 C 端结构域",
          "select": { "chain": "A" },
          "style": "cartoon",
          "color": "grey"
        },
        {
          "label": "苯",
          "select": { "chain": "A", "resi": [400] },
          "style": "stick",
          "color": "green",
          "radius": 0.2
        }
      ],
      "labels": { "chain": "A", "resi": [99, 111] },
      "presets": [
        {
          "id": "v111",
          "label": "苯 C5 … V111 侧链 CG1",
          "a": { "chain": "A", "resi": 400, "atom": "C5" },
          "b": { "chain": "A", "resi": 111, "atom": "CG1" },
          "expect": 3.43
        }
      ]
    }
  ]
}
```

4. 原子名和残基号先对坐标文件核对，再写进预设；`expect` 取两位小数，由坐标算出，不手填。同一专题里多个条目的链号、残基编号和构建常常不同，逐条目写，不套用。
5. 发布前对每个条目运行 `verifyStructure`，再对页面文字引用的关键距离按两位小数核对。
6. 页面接入：使用 `{ "type": "structure-lab", "set": "structures" }` 块。结构与距离读数始终可见，预测题的答案和解释放在题目结果区。
7. 验收：数据文件能加载，预设按钮显示坐标算出的距离，WebGL 不可用时距离仍显示，点两个原子后出现距离，390 px 宽度不横向溢出。

图中注明结构来源和展示范围；结构视图不直接证明未展示的动力学、功能或临床结论。

## 留在专题内

只在单个条目内量距。跨结构的位移要先叠合，在专题的 `tools/` 脚本里完成并把变换后的坐标写进各自的子集；叠合的参照原子由序列比对选定，不凭残基编号相同假定对应。位移数值在内容制作时用 `pdb.ts` 的函数计算并核对。

参考：[3Dmol.js 文档](https://3dmol.csb.pitt.edu/doc/)。
