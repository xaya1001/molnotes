<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { SiteBar } from "@ui";

type CheckState = "passed" | "pending" | "failed" | "unknown";
type UpdateState = "idle" | "running" | "succeeded" | "failed";
type SystemStatus = {
  running: { revision: string | null; image: string | null; health: string };
  latest: { revision: string | null; check: CheckState };
  update: { state: UpdateState; target: string | null; message?: string };
  canUpdate: boolean;
};

const status = ref<SystemStatus | null>(null);
const error = ref("");
const submitting = ref(false);
let timer: ReturnType<typeof setInterval> | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOptionalString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isCheckState(value: unknown): value is CheckState {
  return (
    value === "passed" ||
    value === "pending" ||
    value === "failed" ||
    value === "unknown"
  );
}

function isUpdateState(value: unknown): value is UpdateState {
  return (
    value === "idle" ||
    value === "running" ||
    value === "succeeded" ||
    value === "failed"
  );
}

function parseStatus(value: unknown): SystemStatus {
  if (
    !isRecord(value) ||
    !isRecord(value.running) ||
    !isRecord(value.latest) ||
    !isRecord(value.update)
  ) {
    throw new Error("系统状态格式不正确");
  }
  const { running, latest, update } = value;
  if (
    !isOptionalString(running.revision) ||
    !isOptionalString(running.image) ||
    typeof running.health !== "string" ||
    !isOptionalString(latest.revision) ||
    !isCheckState(latest.check) ||
    !isUpdateState(update.state) ||
    !isOptionalString(update.target) ||
    (update.message !== undefined && typeof update.message !== "string") ||
    typeof value.canUpdate !== "boolean"
  ) {
    throw new Error("系统状态格式不正确");
  }
  return {
    running: {
      revision: running.revision,
      image: running.image,
      health: running.health,
    },
    latest: { revision: latest.revision, check: latest.check },
    update: {
      state: update.state,
      target: update.target,
      ...(update.message === undefined ? {} : { message: update.message }),
    },
    canUpdate: value.canUpdate,
  };
}

async function refresh() {
  try {
    const response = await fetch("/system/api/status", { cache: "no-store" });
    if (!response.ok) throw new Error("系统信息暂时无法获取");
    const body: unknown = await response.json().catch(() => {
      throw new Error("系统信息暂时无法获取");
    });
    status.value = parseStatus(body);
    error.value = "";
  } catch (cause) {
    status.value = null;
    error.value =
      cause instanceof Error ? cause.message : "系统信息暂时无法获取";
  }
}

async function updateSite() {
  if (!status.value?.canUpdate || submitting.value) return;
  submitting.value = true;
  error.value = "";
  try {
    const response = await fetch("/system/api/update", { method: "POST" });
    if (!response.ok) {
      const result: unknown = await response.json().catch(() => null);
      throw new Error(
        isRecord(result) && typeof result.error === "string"
          ? result.error
          : "更新未能启动",
      );
    }
    await refresh();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "更新未能启动";
  } finally {
    submitting.value = false;
  }
}

const updateLabel = computed(() => {
  if (submitting.value || status.value?.update.state === "running")
    return "正在更新网站";
  if (status.value?.update.state === "failed") return "上次更新失败";
  if (!status.value) return "正在读取系统信息";
  if (
    status.value.running.revision === status.value.latest.revision &&
    status.value.running.revision
  ) {
    return "已经是最新版本";
  }
  if (status.value.canUpdate) return "有可用更新";
  if (status.value.latest.check === "pending") return "等待版本检查";
  return "暂无可用更新";
});

function shortRevision(revision: string | null | undefined) {
  return revision ? revision.slice(0, 7) : "暂不可用";
}

const checkLabels: Record<CheckState, string> = {
  passed: "已通过",
  pending: "进行中",
  failed: "未通过",
  unknown: "暂不可用",
};

function healthLabel(health: string | undefined) {
  if (health === "healthy") return "正常";
  if (health === "unhealthy") return "异常";
  return "暂不可用";
}

onMounted(() => {
  void refresh();
  timer = setInterval(() => void refresh(), 10000);
});
onUnmounted(() => {
  if (timer) clearInterval(timer);
});
</script>

<template>
  <div class="system">
    <SiteBar />
    <main class="system-main">
      <header class="system-heading">
        <p class="eyebrow">Site Status</p>
        <h1>系统信息</h1>
        <p class="lede">查看网站运行版本，并在新版本通过检查后更新。</p>
      </header>

      <p v-if="error" class="callout callout--caution" role="alert">
        {{ error }}
      </p>

      <section aria-labelledby="versions-title">
        <h2 id="versions-title" class="section-label">版本与运行状态</h2>
        <dl class="status-list">
          <div>
            <dt>当前网站</dt>
            <dd class="num revision">
              {{ shortRevision(status?.running.revision) }}
            </dd>
          </div>
          <div>
            <dt>运行状态</dt>
            <dd>{{ healthLabel(status?.running.health) }}</dd>
          </div>
          <div>
            <dt>镜像摘要</dt>
            <dd class="num digest">
              {{ status?.running.image ?? "暂不可用" }}
            </dd>
          </div>
          <div>
            <dt>最新版本</dt>
            <dd class="num revision">
              {{ shortRevision(status?.latest.revision) }}
            </dd>
          </div>
          <div>
            <dt>版本检查</dt>
            <dd>{{ checkLabels[status?.latest.check ?? "unknown"] }}</dd>
          </div>
        </dl>
      </section>

      <section class="update" aria-labelledby="update-title">
        <div>
          <h2 id="update-title" class="section-label">网站更新</h2>
          <p class="update-state" role="status">{{ updateLabel }}</p>
          <p v-if="status?.update.message" class="update-message">
            {{ status.update.message }}
          </p>
        </div>
        <button
          class="button button--primary"
          type="button"
          :disabled="!status?.canUpdate || submitting"
          @click="updateSite"
        >
          更新网站
        </button>
      </section>
    </main>
  </div>
</template>

<style scoped>
.system-main {
  max-width: var(--measure);
  margin-inline: auto;
  padding: var(--space-7) var(--gutter) var(--space-8);
}

.system-heading {
  margin-bottom: var(--space-6);
  padding-bottom: var(--space-5);
  border-bottom: 1.5px solid var(--ink);
}

h1 {
  margin: var(--space-2) 0 var(--space-3);
  font-size: var(--text-3xl);
  font-weight: 600;
  line-height: var(--leading-tight);
}

.lede {
  margin: 0;
  color: var(--ink-soft);
}

.section-label {
  margin: var(--space-6) 0 var(--space-2);
  color: var(--ink-muted);
  font: 500 var(--text-xs) / 1.5 var(--font-sans);
  letter-spacing: 0.14em;
}

.status-list {
  margin: 0;
  border-top: 1px solid var(--rule);
}

.status-list div {
  display: grid;
  grid-template-columns: 7rem 1fr;
  gap: var(--space-4);
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--rule);
}

dt {
  color: var(--ink-muted);
  font: var(--text-sm) / 1.9 var(--font-sans);
}

dd {
  margin: 0;
  min-width: 0;
}

.revision {
  font-size: var(--text-lg);
}

.digest {
  overflow-wrap: anywhere;
  font-size: var(--text-sm);
}

.update {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--space-4);
  margin-top: var(--space-6);
}

.update-state {
  margin: 0;
  font-weight: 600;
}

.update-message {
  margin: var(--space-2) 0 0;
  color: var(--ink-soft);
}

@media (max-width: 30rem) {
  .status-list div {
    grid-template-columns: 1fr;
    gap: 0;
  }

  .update .button {
    width: 100%;
  }
}
</style>
