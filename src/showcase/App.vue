<script setup lang="ts">
import { TopicShell } from "@ui";
import { groups } from "./pages";
</script>

<template>
  <TopicShell
    title="工具箱示例"
    description="专题共享界面与制作工具的接入示例"
    :groups="groups"
  >
    <RouterView />
  </TopicShell>
</template>
