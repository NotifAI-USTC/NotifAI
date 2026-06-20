import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { NoticeItem } from '../types/notice'

const STORAGE_KEY = 'notifai-user-settings'

export type DarkMode = 'auto' | 'light' | 'dark'

interface StoredSettings {
  subscribedDepts: string[]
  blacklistKeywords: string[]
  starredIds: string[]
  readIds: string[]
  darkMode: DarkMode
}

function loadSettings(): StoredSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      return {
        subscribedDepts: parsed.subscribedDepts ?? [],
        blacklistKeywords: parsed.blacklistKeywords ?? [],
        starredIds: parsed.starredIds ?? [],
        readIds: parsed.readIds ?? [],
        darkMode: parsed.darkMode ?? 'auto',
      }
    }
  } catch {
    // 数据损坏时回退为默认值
  }
  return {
    subscribedDepts: [],
    blacklistKeywords: [],
    starredIds: [],
    readIds: [],
    darkMode: 'auto',
  }
}

function saveSettings(s: StoredSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
}

export const useUserSettingsStore = defineStore('userSettings', () => {
  const saved = loadSettings()

  // ---- 状态 ----
  const subscribedDepts = ref<string[]>(saved.subscribedDepts)
  const blacklistKeywords = ref<string[]>(saved.blacklistKeywords)
  const starredIds = ref<string[]>(saved.starredIds)
  const readIds = ref<string[]>(saved.readIds)
  const darkMode = ref<DarkMode>(saved.darkMode)

  /** 已拉取通知的内存缓存，避免重复请求 */
  const noticeCache = ref<Map<string, NoticeItem>>(new Map())

  // ---- 查询 ----
  const isSubscribed = computed(() => (dept: string) => subscribedDepts.value.includes(dept))
  const isStarred = computed(() => (id: string) => starredIds.value.includes(id))
  const isRead = computed(() => (id: string) => readIds.value.includes(id))

  /** 实际是否处于深色模式 */
  const isDark = computed(() => {
    if (darkMode.value === 'dark') return true
    if (darkMode.value === 'light') return false
    // auto: 跟随系统
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  })

  /** 用户主动收藏且未过期的通知 */
  const urgentStarredIds = computed(() => starredIds.value)

  // ---- 内部：持久化 ----
  function persist(): void {
    saveSettings({
      subscribedDepts: subscribedDepts.value,
      blacklistKeywords: blacklistKeywords.value,
      starredIds: starredIds.value,
      readIds: readIds.value,
      darkMode: darkMode.value,
    })
  }

  // ---- 操作 ----
  function toggleDepartment(dept: string): void {
    const idx = subscribedDepts.value.indexOf(dept)
    if (idx >= 0) {
      subscribedDepts.value.splice(idx, 1)
    } else {
      subscribedDepts.value.push(dept)
    }
    persist()
  }

  function addKeyword(keyword: string): void {
    const kw = keyword.trim()
    if (kw && !blacklistKeywords.value.includes(kw)) {
      blacklistKeywords.value.push(kw)
      persist()
    }
  }

  function removeKeyword(keyword: string): void {
    const idx = blacklistKeywords.value.indexOf(keyword)
    if (idx >= 0) {
      blacklistKeywords.value.splice(idx, 1)
      persist()
    }
  }

  function toggleStar(id: string): void {
    const idx = starredIds.value.indexOf(id)
    if (idx >= 0) {
      starredIds.value.splice(idx, 1)
    } else {
      starredIds.value.push(id)
    }
    persist()
  }

  function markRead(id: string): void {
    if (!readIds.value.includes(id)) {
      readIds.value.push(id)
      persist()
    }
  }

  function setDarkMode(mode: DarkMode): void {
    darkMode.value = mode
    persist()
  }

  /** 缓存通知数据供跨页面使用 */
  function cacheNotice(notice: NoticeItem): void {
    noticeCache.value.set(notice.id, notice)
  }

  function cacheNotices(notices: NoticeItem[]): void {
    for (const n of notices) {
      noticeCache.value.set(n.id, n)
    }
  }

  function getCachedNotice(id: string): NoticeItem | undefined {
    return noticeCache.value.get(id)
  }

  return {
    // 状态
    subscribedDepts,
    blacklistKeywords,
    starredIds,
    readIds,
    darkMode,
    noticeCache,
    // 查询
    isSubscribed,
    isStarred,
    isRead,
    isDark,
    urgentStarredIds,
    // 操作
    toggleDepartment,
    addKeyword,
    removeKeyword,
    toggleStar,
    markRead,
    setDarkMode,
    cacheNotice,
    cacheNotices,
    getCachedNotice,
  }
})
