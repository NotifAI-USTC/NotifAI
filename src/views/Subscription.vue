<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useUserSettingsStore } from '../stores/userSettings'
import { fetchSources } from '../utils/request'
import { DEPARTMENTS } from '../types/notice'
import type { SourceItem } from '../types/notice'

const store = useUserSettingsStore()
const router = useRouter()
const newKeyword = ref('')

const sources = ref<SourceItem[] | null>(null)
const loading = ref(true)
const loadError = ref('')
const sourceGroupOrder = ['校级部门', '二级学院', '其他'] as const
const sourceGroupRank = new Map<string, number>(
  sourceGroupOrder.map((group, index) => [group, index]),
)

/** 分组来源：优先使用后端 GET /sources；失败时回退到静态部门表 */
const groupedSources = computed(() => {
  const groups = new Map<string, SourceItem[]>()
  const list =
    sources.value ??
    DEPARTMENTS.map((d) => ({ name: d.name, group: d.group, noticeCount: 0 }))
  for (const item of list) {
    const group = item.group || '其他'
    const arr = groups.get(group) ?? []
    arr.push(item)
    groups.set(group, arr)
  }
  return [...groups.entries()]
    .sort(([groupA], [groupB]) => {
      const rankA = sourceGroupRank.get(groupA) ?? sourceGroupOrder.length
      const rankB = sourceGroupRank.get(groupB) ?? sourceGroupOrder.length
      if (rankA !== rankB) return rankA - rankB
      return groupA.localeCompare(groupB, 'zh-CN')
    })
    .map(([group, items]) => ({ group, items }))
})

async function loadSources(): Promise<void> {
  loading.value = true
  loadError.value = ''
  try {
    const loadedSources = await fetchSources()
    store.registerSources(loadedSources.map((source) => source.name))
    sources.value = loadedSources
  } catch (error) {
    sources.value = null
    loadError.value =
      error instanceof Error ? error.message : '来源列表加载失败，已展示内置部门'
  } finally {
    loading.value = false
  }
}

function onAddKeyword(): void {
  if (newKeyword.value.trim()) {
    store.addKeyword(newKeyword.value.trim())
    newKeyword.value = ''
  }
}

onMounted(() => {
  void loadSources()
})
</script>

<template>
  <div class="subscription-page">
    <h1 class="sr-only">订阅与屏蔽</h1>
    <v-app-bar color="surface" elevation="1">
      <v-btn
        icon="$arrowLeft"
        variant="text"
        aria-label="返回个人中心"
        title="返回个人中心"
        @click="router.push({ name: 'User' })"
      />
      <v-app-bar-title>订阅与屏蔽</v-app-bar-title>
    </v-app-bar>

    <v-container>
      <!-- 来源加载提示 -->
      <v-progress-circular
        v-if="loading"
        indeterminate
        color="primary"
        class="d-block mx-auto my-8"
        aria-label="正在加载来源列表"
      />

      <v-alert v-else-if="loadError" type="warning" variant="tonal" class="mb-4" role="status">
        {{ loadError }}
        <template #append>
          <v-btn
            prepend-icon="$refresh"
            variant="text"
            size="small"
            aria-label="重试加载来源列表"
            @click="loadSources"
          >
            重试
          </v-btn>
        </template>
      </v-alert>

      <!-- 部门分组列表 -->
      <v-card v-for="group in groupedSources" :key="group.group" class="mb-4">
        <v-card-title class="text-subtitle-1 font-weight-bold">
          {{ group.group }}
        </v-card-title>
        <v-divider />
        <v-list>
          <v-list-item
            v-for="dept in group.items"
            :key="dept.name"
            :title="dept.name"
            :subtitle="dept.noticeCount > 0 ? `共 ${dept.noticeCount} 条通知` : undefined"
          >
            <template #append>
              <v-switch
                :model-value="store.isSubscribed(dept.name)"
                color="primary"
                hide-details
                :aria-label="`订阅${dept.name}通知`"
                @update:model-value="store.toggleDepartment(dept.name)"
              />
            </template>
          </v-list-item>
        </v-list>
      </v-card>

      <!-- 黑名单关键词 -->
      <v-card>
        <v-card-title class="text-subtitle-1 font-weight-bold"> AI 黑名单关键词 </v-card-title>
        <v-divider />
        <v-card-text>
          <v-row dense class="mb-4">
            <v-col>
              <v-text-field
                v-model="newKeyword"
                placeholder="输入不关心的关键词，如'考研'"
                variant="outlined"
                density="compact"
                hide-details
                @keyup.enter="onAddKeyword"
              />
            </v-col>
            <v-col cols="auto">
              <v-btn color="primary" @click="onAddKeyword">添加</v-btn>
            </v-col>
          </v-row>

          <v-chip-group v-if="store.blacklistKeywords.length > 0" column>
            <v-chip
              v-for="kw in store.blacklistKeywords"
              :key="kw"
              closable
              color="warning"
              @click:close="store.removeKeyword(kw)"
            >
              {{ kw }}
            </v-chip>
          </v-chip-group>
          <v-card v-else flat class="text-center pa-4 bg-transparent">
            <v-icon size="32" color="grey" class="mb-2">$tagOffOutline</v-icon>
            <v-card-subtitle>暂无屏蔽关键词</v-card-subtitle>
          </v-card>
        </v-card-text>
      </v-card>
    </v-container>
  </div>
</template>

<style scoped>
.subscription-page {
  min-height: 100vh;
  background: rgb(var(--v-theme-background));
}
</style>
