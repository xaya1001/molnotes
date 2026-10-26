<script setup lang="ts">
import { PageHeading } from "@ui";
</script>

<template>
  <article class="page-reading">
    <PageHeading
      eyebrow="Video"
      title="讲解视频"
      summary="Remotion 按帧生成讲解动画，网页以原生播放器展示。"
    />
    <div class="prose">
      <figure>
        <video controls playsinline preload="metadata">
          <source src="/showcase/explainer.mp4" type="video/mp4" />
          浏览器无法播放本视频。
        </video>
        <figcaption>
          文字稿：先辨认对象 A 与 B；让 A 接近 B；观察相邻后的几何关系。
        </figcaption>
      </figure>
    </div>
  </article>
</template>

<style scoped>
video {
  width: 100%;
  border-radius: var(--radius);
  background: var(--ink);
}
</style>
