<script setup lang="ts">
import { ref } from 'vue'
import { useUserSettingsStore } from '../stores/userSettings'
import { DEPARTMENTS } from '../types/notice'

const store = useUserSettingsStore()
const newKeyword = ref('')

function onAddKeyword(): void {
  if (newKeyword.value.trim()) {
    store.addKeyword(newKeyword.value.trim())
    newKeyword.value = ''
  }
}

function groupedDepts(key: string) {
  return DEPARTMENTS.filter((d) => d.group === key)
}

const deptGroups = ['校级部门', '二级学院']
</script>

<template>
  <div class="subscription-page">
    <h1 class="sr-only">订阅与屏蔽</h1>
    <v-app-bar color="surface" elevation="1">
      <v-app-bar-title>订阅与屏蔽</v-app-bar-title>
    </v-app-bar>

    <v-container>
      <!-- 部门分组列表 -->
      <v-card v-for="group in deptGroups" :key="group" class="mb-4">
        <v-card-title class="text-subtitle-1 font-weight-bold">
          {{ group }}
        </v-card-title>
        <v-divider />
        <v-list>
          <v-list-item v-for="dept in groupedDepts(group)" :key="dept.id" :title="dept.name">
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
