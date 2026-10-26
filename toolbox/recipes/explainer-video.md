# 嵌入章节的讲解视频

在有具体讲解脚本和分镜时建立独立 Remotion 制作目录。Agent 用代码生成画面、字幕和时序，渲染成视频文件；网页用原生 `<video controls playsinline>` 在对应章节播放。视频制作源码与最终网页入口分别维护，科学结构图、引用和术语可复用经核对的项目素材。

仓库内可运行的中性示例位于 `toolbox/video/`。从项目根目录运行 `npm run video:render`，生成 `public/showcase/explainer.mp4`，随后运行 `npm run dev`，在 `/showcase/` 中检查浏览器播放。画面和字幕由 `scene.tsx` 的帧数决定；正式专题先写分镜和可核对的旁白，再将音轨加入 Remotion 源码，并在专题页提供文字稿。此示例是无旁白的制作与嵌入验证。

验收检查分镜所表达的科学含义、字幕、配音、静音播放、封面、视频长度和移动端画面。需要点击步骤或调参数的讲解由网页中的 Vue SVG 组件实现。

参考：[Remotion 基础](https://www.remotion.dev/docs/the-fundamentals)、[Remotion Agent Skills](https://www.remotion.dev/docs/ai/skills)。
