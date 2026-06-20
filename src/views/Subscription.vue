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
    <van-nav-bar title="订阅与屏蔽" fixed placeholder />

    <!-- 部门分组列表 -->
    <van-cell-group
      v-for="group in deptGroups"
      :key="group"
      :title="group"
      class="dept-group"
    >
      <van-cell
        v-for="dept in groupedDepts(group)"
        :key="dept.id"
        :title="dept.name"
        center
      >
        <template #right-icon>
          <van-switch
            :model-value="store.isSubscribed(dept.name)"
            size="22px"
            @update:model-value="store.toggleDepartment(dept.name)"
          />
        </template>
      </van-cell>
    </van-cell-group>

    <!-- 黑名单关键词 -->
    <van-cell-group title="AI 黑名单关键词" class="keyword-group">
      <div class="keyword-input-row">
        <van-field
          v-model="newKeyword"
          placeholder="输入不关心的关键词，如'考研'"
          clearable
          @keyup.enter="onAddKeyword"
        />
        <van-button
          type="primary"
          size="small"
          round
          @click="onAddKeyword"
        >
          添加
        </van-button>
      </div>
      <div class="keyword-tags" v-if="store.blacklistKeywords.length > 0">
        <van-tag
          v-for="kw in store.blacklistKeywords"
          :key="kw"
          closeable
          size="medium"
          type="warning"
          @close="store.removeKeyword(kw)"
        >
          {{ kw }}
        </van-tag>
      </div>
      <div v-else class="empty-keywords">
        <span class="text-muted">暂无屏蔽关键词</span>
      </div>
    </van-cell-group>
  </div>
</template>

<style scoped>
.subscription-page {
  padding-bottom: 60px;
  min-height: 100vh;
  background: var(--notifai-bg-page);
}

.dept-group {
  margin: 12px;
  border-radius: 10px;
  overflow: hidden;
}

.dept-group :deep(.van-cell__title) {
  font-size: 15px;
}

.keyword-group {
  margin: 12px;
  border-radius: 10px;
  overflow: hidden;
}

.keyword-input-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: var(--notifai-bg-card);
}

.keyword-input-row :deep(.van-field) {
  flex: 1;
  padding: 0;
}

.keyword-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 12px 16px;
  background: var(--notifai-bg-card);
}

.empty-keywords {
  padding: 16px;
  text-align: center;
  background: var(--notifai-bg-card);
}

.text-muted {
  color: var(--notifai-text-muted);
  font-size: 13px;
}
</style>
