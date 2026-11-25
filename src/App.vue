<script setup lang="ts">
import {
  computed,
  defineComponent,
  inject,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from 'vue'
import { useTheme } from 'vuetify'
import { useRouter } from 'vue-router'
import { ACCOUNT_STARTUP_READY, useUserSettingsStore } from './stores/userSettings'
import { useAccountStore } from './stores/account'
import { useWindowSize } from './composables/useWindowSize'
import { useSnackbar } from './composables/useSnackbar'
import { useForegroundDdlReminder } from './composables/useForegroundDdlReminder'
import OnboardingModal from './components/OnboardingModal.vue'
import AccountLoginDialog from './components/AccountLoginDialog.vue'
import SsoSignupDialog from './components/SsoSignupDialog.vue'
import AppBanner from './components/AppBanner.vue'

const icpRecordNumber = import.meta.env.VITE_ICP_RECORD_NUMBER?.trim()
const policeRecordNumber = import.meta.env.VITE_POLICE_RECORD_NUMBER?.trim()
const policeRecordCode = policeRecordNumber?.match(/\d+(?=\s*号?$)/)?.[0]
const policeRecordUrl = policeRecordCode
  ? `https://beian.mps.gov.cn/#/query/webSearch?code=${policeRecordCode}`
  : 'https://beian.mps.gov.cn/'

const router = useRouter()
const store = useUserSettingsStore()
const account = useAccountStore()
const accountStartupReady = inject(ACCOUNT_STARTUP_READY, () => ref(false), true)
const theme = useTheme()
const { isMobile } = useWindowSize()
const snackbar = useSnackbar()
const ForegroundDdlReminder = defineComponent({
  setup() {
    useForegroundDdlReminder()
    return () => null
  },
})

const startupLogoutFailed = ref(false)
const ssoError = ref('')
const accountOverlaysReady = ref(false)
const showGuestOverlays = computed(() =>
  accountOverlaysReady.value && !account.user && !account.transitioning,
)
const showRoute = computed(() =>
  !account.transitioning &&
  (store.scopeReady || ['Home', 'Calendar', 'Detail'].includes(String(router.currentRoute.value.name))),
)
let sessionCheckPending = false
const showSsoSignup = computed(() => {
  const { name, query } = router.currentRoute.value
  return showGuestOverlays.value && name === 'User' && query.sso === 'signup'
})

async function logoutUnavailableAccount() {
  startupLogoutFailed.value = false
  try {
    await account.signOut()
  } catch {
    startupLogoutFailed.value = true
  }
}

function checkCurrentSession() {
  if (accountStartupReady.value) void account.checkSession()
  else sessionCheckPending = true
}

async function startAccount() {
  // The app shell and public routes do not wait for the account network.
  await nextTick()
  await account.bootstrap()
  // Reconcile changes received during bootstrap before activating any scope.
  while (sessionCheckPending && !account.transitioning) {
    sessionCheckPending = false
    await account.checkSession()
  }
  accountStartupReady.value = true
}

function onStorage(event: StorageEvent) {
  if (event.key === account.sessionChangeKey) checkCurrentSession()
}

function onVisibility() {
  if (document.visibilityState === 'visible') checkCurrentSession()
}

function onPageShow(event: PageTransitionEvent) {
  if (event.persisted) checkCurrentSession()
}

function retryAccountStartup() {
  window.location.reload()
}

async function clearSsoReturn() {
  const route = router.currentRoute.value
  const query = { ...route.query }
  delete query.sso
  await router.replace({ name: 'User', query, hash: route.hash })
}

async function dismissSsoSignup(message?: string) {
  if (!showSsoSignup.value) return
  if (message && !account.user && !account.transitioning) {
    ssoError.value = message
    account.loginDialogOpen = true
  }
  await clearSsoReturn()
}

async function handleSsoReturn() {
  await router.isReady()
  const route = router.currentRoute.value
  const result = route.query.sso
  if (route.name !== 'User') return
  if (result === 'signup') {
    if (account.user) await clearSsoReturn()
    else account.loginDialogOpen = false
    return
  }
  if (result !== 'ok' && result !== 'failed') return
  await clearSsoReturn()
  if (result === 'ok' && account.user) {
    account.notifySessionChange()
    return
  }
  const message = '单点登录未完成，请重试。'
  if (account.user) {
    snackbar.showError(message)
  } else {
    ssoError.value = message
    account.loginDialogOpen = true
  }
}

onMounted(() => {
  window.addEventListener('storage', onStorage)
  window.addEventListener('pageshow', onPageShow)
  document.addEventListener('visibilitychange', onVisibility)
  void startAccount()
})
onBeforeUnmount(() => {
  window.removeEventListener('storage', onStorage)
  window.removeEventListener('pageshow', onPageShow)
  document.removeEventListener('visibilitychange', onVisibility)
})

watch(
  () => store.scopeReady,
  async (ready) => {
    if (!ready) return
    await handleSsoReturn()
    accountOverlaysReady.value = true
  },
  { immediate: true },
)

// Retain the feed only while browsing a notice; other sections start a new feed visit.
const retainedPages = computed(() =>
  ['Home', 'Detail'].includes(String(router.currentRoute.value.name)) ? ['Home'] : [],
)

const activeTab = ref('Home')
const tabs = [
  { name: 'Home', path: '/', icon: '$home', label: '首页' },
  { name: 'Calendar', path: '/calendar', icon: '$calendar', label: '日历' },
  { name: 'Favorites', path: '/favorites', icon: '$star', label: '收藏' },
  { name: 'User', path: '/user', icon: '$account', label: '我的' },
]

function getActiveTab(path: string): string | undefined {
  if (path === '/user' || path.startsWith('/user/')) return 'User'
  return tabs.find((tab) => tab.path === path)?.name
}

// 路由变化时同步激活标签
watch(
  () => router.currentRoute.value.path,
  (path) => {
    if (path.startsWith('/detail')) return
    const tab = getActiveTab(path)
    if (tab) activeTab.value = tab
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
    <!-- 桌面端：侧边导航栏（悬停展开显示文字） -->
    <v-navigation-drawer
      v-if="!isMobile"
      permanent
      rail
      expand-on-hover
      rail-width="48"
      class="app-nav"
    >
      <v-list nav density="compact">
        <v-list-item
          v-for="tab in tabs"
          :key="tab.name"
          :title="tab.label"
          :active="activeTab === tab.name"
          rounded="lg"
          @click="router.push(tab.path)"
        >
          <template #prepend>
            <v-icon :icon="tab.icon" size="20" />
          </template>
        </v-list-item>
      </v-list>
    </v-navigation-drawer>

    <!-- 主内容区 -->
    <v-main class="app-main">
      <v-container v-if="store.scopeReady && !account.transitioning && (account.pageNotice || (account.startupUnavailable && (store.hasOnboarded || account.user)))">
        <AppBanner v-if="account.pageNotice" type="warning" class="mb-2" role="status">
          {{ account.pageNotice === 'discarded'
            ? '账号已切换，未同步修改未保存'
            : '本机偏好仍保留，但无法在此标签页提供导入。' }}
          <template #append>
            <v-btn variant="text" @click="account.pageNotice = null">关闭</v-btn>
          </template>
        </AppBanner>
        <AppBanner v-if="account.startupUnavailable" type="warning" role="status">
          <p v-if="startupLogoutFailed">退出登录失败，请重试。</p>
          <p v-else-if="account.user">无法加载 {{ account.user.displayName }} 的云端设置。可继续浏览通知，偏好暂不可编辑。</p>
          <p v-else>账号服务暂不可用。仍可使用本机游客设置。</p>
          <div class="d-flex flex-wrap ga-2 mt-2">
            <v-btn variant="tonal" :disabled="account.loggingOut" @click="retryAccountStartup">重试连接</v-btn>
            <v-btn
              v-if="account.user"
              variant="text"
              :disabled="account.loggingOut"
              :loading="account.loggingOut"
              @click="logoutUnavailableAccount"
            >退出登录</v-btn>
          </div>
        </AppBanner>
      </v-container>
      <router-view v-if="showRoute" v-slot="{ Component }">
        <keep-alive :include="retainedPages">
          <component :is="Component" />
        </keep-alive>
      </router-view>
    </v-main>

    <ForegroundDdlReminder v-if="store.scopeReady && !account.transitioning" />
    <!-- 首次使用引导：持久化完成前不允许误触关闭。 -->
    <SsoSignupDialog v-if="showSsoSignup" @dismiss="dismissSsoSignup" />
    <OnboardingModal v-if="showGuestOverlays && !showSsoSignup && !store.hasOnboarded" />
    <AccountLoginDialog
      v-if="showGuestOverlays && !showSsoSignup"
      :sso-error="ssoError"
      @clear-sso-error="ssoError = ''"
    />

    <!-- 移动端：底部导航栏 -->
    <v-bottom-navigation v-if="isMobile" v-model="activeTab" grow>
      <v-btn v-for="tab in tabs" :key="tab.name" :to="tab.path" :value="tab.name">
        <v-icon>{{ tab.icon }}</v-icon>
        <span>{{ tab.label }}</span>
      </v-btn>
    </v-bottom-navigation>
    <v-footer
      v-if="icpRecordNumber || policeRecordNumber"
      app
      :order="1"
      class="d-flex flex-wrap align-center justify-center ga-2 text-body-small"
    >
      <a v-if="icpRecordNumber" href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">
        {{ icpRecordNumber }}
      </a>
      <a
        v-if="policeRecordNumber"
        :href="policeRecordUrl"
        target="_blank"
        rel="noopener noreferrer"
        class="d-inline-flex align-center ga-1"
      >
        <img src="/icons/police-record.png" alt="" width="20" height="20" />
        {{ policeRecordNumber }}
      </a>
    </v-footer>
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
@layer notifai-components {
  /* Route app bars change layout padding. Apply it immediately so v4's
     layout observer doesn't interrupt a padding transition mid-resize. */
  .app-main {
    transition: none;
  }

  .app-nav.v-navigation-drawer--rail.v-navigation-drawer--expand-on-hover:not(
      .v-navigation-drawer--is-hovering
    )
    .v-list-item {
    padding-inline: 6px;
  }
}
</style>
