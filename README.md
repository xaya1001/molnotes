# 分子笔记（molnotes）

面向化学研究者的交互式学习网站：笔记本用于按目录连续阅读，专题用于交互练习和核对原文证据，复习页汇总进度、错题、书签与笔记。共享界面在 `src/ui/`。网站从内容快照读取专题、笔记与资源，学习记录保存在一个 SQLite 文件。`/showcase/` 是共享组件示例。

仓库只包含网站运行时、内容契约、制作工具与中性测试样本，不包含学习内容。

## 配置

所有设置来自环境变量；带 `_FILE` 后缀的同名变量指向保存该值的文件。缺少必需设置时命令报错。

| 变量                                                 | 用途                                                                                    |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `MOLNOTES_RECORDS_FILE`                              | 学习记录的 SQLite 文件，目录须已存在，文件不存在时创建；镜像默认 `/data/records.sqlite` |
| `MOLNOTES_CONTENT_SNAPSHOT`                          | 网站读取的内容快照目录，通常是指向当前快照的软链，默认 `/content/current`               |
| `MOLNOTES_CONTENT_DIR`                               | 内容工作目录，见 [内容手册](docs/content.md)                                            |
| `MOLNOTES_CONTENT_RELEASES`                          | `content publish` 写入快照并维护 `current` 软链的发布根                                 |
| `MOLNOTES_MATERIALS_DIR`、`MOLNOTES_MATERIALS_CACHE` | 原始资料书架与渲染缓存，默认仓库的 `materials/`（不进入 Git）                           |
| `MOLNOTES_SYSTEM_SOCKET`                             | 可选：`/system/api/` 转发到的更新服务 Unix socket，未设置时该接口返回 503               |

## 开发

需要 Node.js 26、npm、Playwright Chromium，以及装有 `scripts/requirements-material.txt` 所列包的 Python 3（资料书架与引用渲染使用）。

```bash
npm ci
MOLNOTES_CONTENT_SNAPSHOT=<快照目录> MOLNOTES_RECORDS_FILE=<记录文件> npm run serve
npm run dev
```

检查与测试：

```bash
npm run check
npm run build
npx playwright install chromium
npm run test:e2e
```

浏览器测试前先 `npm run build`；测试自动由 `tests/fixtures/content/` 中的中性样本构建内容快照、把学习记录写入临时 SQLite 文件、启动服务并清理。成功路径的视觉验收截图按需生成：`MOLNOTES_CAPTURE_EVIDENCE=1 npm run test:e2e -- tests/content-runtime.spec.ts`。

## 制作内容

```bash
npm run site:new -- receptor-basics "受体基础" "通过互动图示认识受体" 靶点案例
npm run content -- build <输出目录>
npm run content -- publish
npm run content -- publish --rollback <提交号>
```

`build` 把内容目录校验、编译成快照；`publish` 从已提交的 HEAD 构建快照并切换 `current`，网站在下一个请求读到新快照。内容契约见 [内容手册](docs/content.md)，块目录与制作工具见 [工具箱](toolbox/GUIDE.md)。

## 镜像与更新服务

`main` 的 Check 构建 ARM64 镜像，以准确 revision 标签推送到本仓库的 GHCR，并用样本快照与临时记录目录做浏览器冒烟。容器运行 `node server/web.mjs`，监听 8080，只读挂载快照发布根到 `/content`，学习记录写入可写的 `/data`；`/healthz` 检查快照与记录文件可用。

`server/server.mjs` 是可选的主机更新服务：读取运行中的镜像与远端 `main` 的 Check 结果，在 `/system/` 页面上把站点更新到已通过检查的准确镜像 digest，失败时回滚到上一镜像。它的设置由服务进程的环境提供：`MOLNOTES_CHECKOUT`、`MOLNOTES_GITHUB_REPOSITORY`、`MOLNOTES_ORIGIN`、`MOLNOTES_CONTAINER`、`MOLNOTES_COMPOSE_FILE`、`MOLNOTES_SYSTEM_SOCKET`、`MOLNOTES_DEPLOY_LOG_DIR`、`MOLNOTES_RELEASE_ROOT`。
