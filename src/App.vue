<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useUserSettingsStore } from './stores/userSettings'

const router = useRouter()
const store = useUserSettingsStore()

const active = ref(0)

const tabs = [
  { name: 'Home', path: '/', icon: 'home-o', label: '首页' },
  { name: 'Subscription', path: '/subscription', icon: 'cluster-o', label: '订阅' },
  { name: 'User', path: '/user', icon: 'user-o', label: '我的' },
]

// 路由变化时同步激活标签
watch(
  () => router.currentRoute.value.path,
  (path) => {
    // 详情页保留首页高亮
    if (path.startsWith('/detail')) {
      active.value = 0
      return
    }
    const idx = tabs.findIndex((t) => t.path === path)
    if (idx >= 0) active.value = idx
  },
  { immediate: true },
)

// ---- 深色模式：动态挂载 van-theme-dark 类 ----
function applyTheme(): void {
  const html = document.documentElement
  if (store.isDark) {
    html.classList.add('van-theme-dark')
  } else {
    html.classList.remove('van-theme-dark')
  }
}

// 系统偏好变化时自动更新（auto 模式下）
const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
mediaQuery.addEventListener('change', applyTheme)

watch(() => store.isDark, applyTheme)

onMounted(() => {
  applyTheme()
})
</script>

<template>
  <router-view />
  <van-tabbar v-model="active" route placeholder>
    <van-tabbar-item
      v-for="tab in tabs"
      :key="tab.name"
      :to="tab.path"
      :icon="tab.icon"
    >
      {{ tab.label }}
    </van-tabbar-item>
  </van-tabbar>
</template>

<style>
.van-tabbar {
  z-index: 999;
}
</style>
