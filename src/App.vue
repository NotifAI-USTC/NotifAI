<script setup lang="ts">
import { ref, watch } from 'vue'
import { useTheme } from 'vuetify'
import { useRouter } from 'vue-router'
import { useUserSettingsStore } from './stores/userSettings'
import { useWindowSize } from './composables/useWindowSize'
import { useSnackbar } from './composables/useSnackbar'
import { useForegroundDdlReminder } from './composables/useForegroundDdlReminder'

const router = useRouter()
const store = useUserSettingsStore()
const theme = useTheme()
const { isMobile } = useWindowSize()
const snackbar = useSnackbar()
useForegroundDdlReminder()

const activeTab = ref('Home')
const tabs = [
  { name: 'Home', path: '/', icon: '$home', label: '首页' },
  { name: 'Calendar', path: '/calendar', icon: '$calendar', label: '日历' },
  { name: 'Subscription', path: '/subscription', icon: '$tagMultiple', label: '订阅' },
  { name: 'User', path: '/user', icon: '$account', label: '我的' },
]

// 路由变化时同步激活标签
watch(
  () => router.currentRoute.value.path,
  (path) => {
    if (path.startsWith('/detail')) return
    const tab = tabs.find((t) => t.path === path)
    if (tab) activeTab.value = tab.name
  },
  { immediate: true },
)

// 深色模式同步
watch(
  () => store.isDark,
  (dark) => {
    theme.change(dark ? 'dark' : 'light')
  },
  { immediate: true },
)

watch(
  () => store.persistenceError,
  (message) => {
    if (!message) return
    snackbar.showError(message)
    store.clearPersistenceError()
  },
  { immediate: true },
)
</script>

<template>
  <v-app>
    <!-- 桌面端：侧边导航栏 -->
    <v-navigation-drawer v-if="!isMobile" permanent rail>
      <v-list nav density="compact">
        <v-list-item
          v-for="tab in tabs"
          :key="tab.name"
          :prepend-icon="tab.icon"
          :title="tab.label"
          :active="activeTab === tab.name"
          rounded="lg"
          @click="router.push(tab.path)"
        />
      </v-list>
    </v-navigation-drawer>

    <!-- 主内容区 -->
    <v-main>
      <router-view />
    </v-main>

    <!-- 移动端：底部导航栏 -->
    <v-bottom-navigation v-if="isMobile" v-model="activeTab" grow>
      <v-btn v-for="tab in tabs" :key="tab.name" :to="tab.path" :value="tab.name">
        <v-icon>{{ tab.icon }}</v-icon>
        <span>{{ tab.label }}</span>
      </v-btn>
    </v-bottom-navigation>
    <!-- 全局提示 -->
    <v-snackbar
      v-model="snackbar.show.value"
      :color="snackbar.color.value"
      :timeout="snackbar.timeout.value"
      location="top"
    >
      {{ snackbar.text.value }}
      <template #actions>
        <v-btn variant="text" @click="snackbar.hide()">关闭</v-btn>
      </template>
    </v-snackbar>
  </v-app>
</template>

<style>
/* 全局样式 */
</style>
