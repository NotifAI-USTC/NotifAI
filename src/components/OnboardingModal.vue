<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useUserSettingsStore } from '../stores/userSettings'
import type { OnboardingIdentity } from '../stores/userSettings'
import { useWindowSize } from '../composables/useWindowSize'
import { fetchSources } from '../utils/request'
import { DEPARTMENTS, getNoticeCategoryName } from '../types/notice'
import type { NoticeCategoryKey, SourceItem } from '../types/notice'

interface ChannelOption {
  name: string
  group: '校级部门' | '二级学院'
  icon: string
}

interface IdentityPreset {
  value: OnboardingIdentity
  title: string
  description: string
  icon: string
  channels: string[]
  categories: NoticeCategoryKey[]
  selectAll?: boolean
}

const SCHOOL_SOURCE_ICONS: Readonly<Record<string, string>> = {
  教务处: '$school',
  本科生院: '$accountGroup',
  学工部: '$account',
  科研部: '$flask',
  校团委: '$bullhornOutline',
  迎新特辑: '$calendarCheck',
}

const FALLBACK_SCHOOL_OPTIONS: readonly ChannelOption[] = [
  { name: '教务处', group: '校级部门', icon: '$school' },
  { name: '本科生院', group: '校级部门', icon: '$accountGroup' },
  { name: '学工部', group: '校级部门', icon: '$account' },
  { name: '科研部', group: '校级部门', icon: '$flask' },
  { name: '校团委', group: '校级部门', icon: '$bullhornOutline' },
  { name: '迎新特辑', group: '校级部门', icon: '$calendarCheck' },
]

const FALLBACK_SECONDARY_OPTIONS: readonly ChannelOption[] = DEPARTMENTS.filter(
  (department) => department.group === '二级学院',
).map((department) => ({
  name: department.name,
  group: '二级学院',
  icon: '$domain',
}))

const FRESHMAN_CHANNELS = ['教务处', '本科生院', '迎新特辑']
const UNDERGRADUATE_CHANNELS = ['教务处', '本科生院']
const POSTGRADUATE_CHANNELS = ['科研部']
const FRESHMAN_CATEGORIES: NoticeCategoryKey[] = [
  'course_selection',
  'exam',
  'scholarship',
  'course_info',
  'campus_event',
  'logistics',
]
const UNDERGRADUATE_CATEGORIES: NoticeCategoryKey[] = [
  'course_selection',
  'exam',
  'scholarship',
  'competition',
  'abroad',
  'internship_job',
]
const POSTGRADUATE_CATEGORIES: NoticeCategoryKey[] = [
  'academic_lecture',
  'research',
  'graduation',
  'internship_job',
  'abroad',
]

const store = useUserSettingsStore()
const { isMobile } = useWindowSize()

const identityPresets: readonly IdentityPreset[] = [
  {
    value: 'freshman',
    title: '新生',
    description: '优先关注教务、本科生院与迎新信息',
    icon: '$school',
    channels: FRESHMAN_CHANNELS,
    categories: FRESHMAN_CATEGORIES,
  },
  {
    value: 'undergraduate',
    title: '本科生',
    description: '关注教务、本科生院等本科培养信息',
    icon: '$domain',
    channels: UNDERGRADUATE_CHANNELS,
    categories: UNDERGRADUATE_CATEGORIES,
  },
  {
    value: 'postgraduate',
    title: '研究生',
    description: '关注科研与研究生相关信息',
    icon: '$flask',
    channels: POSTGRADUATE_CHANNELS,
    categories: POSTGRADUATE_CATEGORIES,
  },
  {
    value: 'custom',
    title: '全部',
    description: '关注所有来源，之后可自行调整',
    icon: '$accountGroup',
    channels: [],
    categories: [],
    selectAll: true,
  },
]

const currentStep = ref(1)
const draftIdentity = ref<OnboardingIdentity>(store.userIdentity)
const draftSelectAll = ref(store.subscriptionMode === 'all')
const draftChannels = ref<string[]>(
  store.subscribedChannels.length > 0 ? [...store.subscribedChannels] : [...FRESHMAN_CHANNELS],
)
const draftCategories = ref<NoticeCategoryKey[]>(
  store.categoryMode === 'custom' ? [...store.subscribedCategories] : [...FRESHMAN_CATEGORIES],
)
const draftKeywords = ref<string[]>([...store.blackKeywords])
const newKeyword = ref('')
const sources = ref<SourceItem[] | null>(null)
const sourcesLoading = ref(false)
const sourcesError = ref('')
let sourceRequestController: AbortController | null = null

store.registerSources([
  ...FALLBACK_SCHOOL_OPTIONS.map((channel) => channel.name),
  ...FALLBACK_SECONDARY_OPTIONS.map((channel) => channel.name),
])

const progress = computed(() => (currentStep.value / 4) * 100)
// 校级部门和二级学院都允许不订阅，完成后由 store 将空列表解释为“全部来源”。
const canContinueFromChannels = computed(() => true)
const schoolOptions = computed<ChannelOption[]>(() => {
  if (sources.value === null) return [...FALLBACK_SCHOOL_OPTIONS]
  return sources.value
    .filter((source) => source.group === '校级部门')
    .map((source) => ({
      name: source.name,
      group: '校级部门',
      icon: SCHOOL_SOURCE_ICONS[source.name] ?? '$domain',
    }))
})
const secondaryOptions = computed<ChannelOption[]>(() => {
  if (sources.value === null) return [...FALLBACK_SECONDARY_OPTIONS]
  return sources.value
    .filter((source) => source.group === '二级学院')
    .map((source) => ({ name: source.name, group: '二级学院', icon: '$domain' }))
})
const allChannelNames = computed(() => {
  const names =
    sources.value === null
      ? [
          ...FALLBACK_SCHOOL_OPTIONS.map((channel) => channel.name),
          ...FALLBACK_SECONDARY_OPTIONS.map((channel) => channel.name),
        ]
      : sources.value.map((source) => source.name)
  return Array.from(new Set(names))
})
const selectedSchoolCount = computed(() => {
  if (draftSelectAll.value) return schoolOptions.value.length
  const selected = new Set(draftChannels.value)
  return schoolOptions.value.filter((channel) => selected.has(channel.name)).length
})
const selectedSecondaryCount = computed(() => {
  if (draftSelectAll.value) return secondaryOptions.value.length
  const selected = new Set(draftChannels.value)
  return secondaryOptions.value.filter((channel) => selected.has(channel.name)).length
})
const selectedCategorySummary = computed(() => {
  if (draftCategories.value.length === 0) return '全部分类'
  return draftCategories.value.map(getNoticeCategoryName).join('、')
})

function selectedIdentity(value: OnboardingIdentity): boolean {
  return draftIdentity.value === value
}

function resolvePresetChannels(channels: readonly string[]): string[] {
  if (sources.value === null) return [...channels]
  const available = new Set(allChannelNames.value)
  return channels.filter((channel) => available.has(channel))
}

function selectIdentity(preset: IdentityPreset): void {
  draftIdentity.value = preset.value
  draftSelectAll.value = Boolean(preset.selectAll)
  draftChannels.value = resolvePresetChannels(preset.channels)
  draftCategories.value = [...preset.categories]
}

function isChannelSelected(channel: string): boolean {
  return draftSelectAll.value || draftChannels.value.includes(channel)
}

function toggleChannel(channel: string): void {
  if (draftSelectAll.value) {
    draftSelectAll.value = false
    draftChannels.value = allChannelNames.value.filter((name) => name !== channel)
    return
  }

  const index = draftChannels.value.indexOf(channel)
  if (index >= 0) {
    draftChannels.value.splice(index, 1)
  } else {
    draftChannels.value.push(channel)
  }
}

async function loadSources(force = false): Promise<void> {
  if (sourcesLoading.value || (!force && sources.value !== null)) return

  sourceRequestController?.abort()
  const controller = new AbortController()
  sourceRequestController = controller
  sourcesLoading.value = true
  sourcesError.value = ''

  try {
    const loadedSources = await fetchSources(controller.signal)
    if (controller.signal.aborted) return
    sources.value = loadedSources
    store.registerSources(loadedSources.map((source) => source.name))

    // 来源列表是动态数据。若用户尚未手动改成“全部/自定义”，将静态
    // 预设裁剪到当前 API 真正存在的来源，避免保存无法在引导页选择的名称。
    if (draftIdentity.value !== 'custom' && !draftSelectAll.value) {
      draftChannels.value = resolvePresetChannels(draftChannels.value)
    }
  } catch (error) {
    if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
      return
    }
    sources.value = null
    sourcesError.value =
      error instanceof Error
        ? `${error.message}，已展示内置来源列表`
        : '来源列表加载失败，已展示内置来源列表'
  } finally {
    if (sourceRequestController === controller) {
      sourceRequestController = null
      sourcesLoading.value = false
    }
  }
}

function nextStep(): void {
  if (currentStep.value === 1) {
    currentStep.value = 2
    void loadSources()
    return
  }
  if (currentStep.value === 2 && !canContinueFromChannels.value) return
  if (currentStep.value === 2) {
    currentStep.value = 3
    void loadSources()
    return
  }
  currentStep.value = Math.min(4, currentStep.value + 1)
}

function previousStep(): void {
  currentStep.value = Math.max(1, currentStep.value - 1)
}

function addKeyword(): void {
  const keyword = newKeyword.value.trim().slice(0, 200)
  if (!keyword || draftKeywords.value.includes(keyword) || draftKeywords.value.length >= 50) {
    return
  }
  draftKeywords.value.push(keyword)
  newKeyword.value = ''
}

function removeKeyword(keyword: string): void {
  draftKeywords.value = draftKeywords.value.filter((item) => item !== keyword)
}

function complete(): void {
  store.completeOnboarding({
    identity: draftIdentity.value,
    channels: draftSelectAll.value ? [] : [...draftChannels.value],
    categories: [...draftCategories.value],
    keywords: [...draftKeywords.value],
  })
}

onBeforeUnmount(() => {
  sourceRequestController?.abort()
})
</script>

<template>
  <v-dialog
    :model-value="true"
    persistent
    scrollable
    :fullscreen="isMobile"
    max-width="500"
    aria-labelledby="onboarding-title"
    content-class="onboarding-dialog"
  >
    <v-card class="onboarding-card">
      <v-card-title class="onboarding-header">
        <div class="d-flex align-center ga-3">
          <v-avatar color="primary" size="42" aria-hidden="true">
            <v-icon color="white">$robot</v-icon>
          </v-avatar>
          <div>
            <h2 id="onboarding-title" class="text-h6">欢迎使用 NotifAI-USTC</h2>
            <p class="text-caption text-medium-emphasis mb-0">用一分钟设置你的通知看板</p>
          </div>
        </div>
        <v-chip size="small" color="primary" variant="tonal">{{ currentStep }} / 4</v-chip>
      </v-card-title>

      <v-progress-linear
        :model-value="progress"
        color="primary"
        height="4"
        aria-label="入门引导进度"
      />

      <v-card-text class="onboarding-body">
        <section v-if="currentStep === 1" aria-labelledby="onboarding-welcome-title">
          <div class="text-center py-4">
            <v-icon color="primary" size="56" aria-hidden="true">$robot</v-icon>
            <h3 id="onboarding-welcome-title" class="text-h5 mt-3 mb-2">校园通知，一眼看懂</h3>
            <p class="text-body-2 text-medium-emphasis">
              NotifAI-USTC 帮你从分散的校园通知中快速找到真正重要的信息。
            </p>
          </div>

          <div class="feature-grid">
            <v-card variant="tonal" class="feature-card pa-4">
              <v-icon color="primary" size="28" aria-hidden="true">$robot</v-icon>
              <div class="text-subtitle-2 mt-2">AI 智能提炼</div>
              <div class="text-caption text-medium-emphasis mt-1">
                自动提取摘要、截止时间、面向对象和行动地点。
              </div>
            </v-card>
            <v-card variant="tonal" class="feature-card pa-4">
              <v-icon color="error" size="28" aria-hidden="true">$clockAlert</v-icon>
              <div class="text-subtitle-2 mt-2">DDL 倒计时</div>
              <div class="text-caption text-medium-emphasis mt-1">
                重要日程集中高亮，减少错过选课和报名的风险。
              </div>
            </v-card>
            <v-card variant="tonal" class="feature-card pa-4">
              <v-icon color="secondary" size="28" aria-hidden="true">$checkCircleOutline</v-icon>
              <div class="text-subtitle-2 mt-2">免登录与本地存储</div>
              <div class="text-caption text-medium-emphasis mt-1">
                不要求创建账号，偏好设置保存在当前设备。
              </div>
            </v-card>
          </div>
        </section>

        <section v-else-if="currentStep === 2" aria-labelledby="onboarding-preferences-title">
          <h3 id="onboarding-preferences-title" class="text-h6 mb-2">先告诉我们你的身份</h3>
          <p class="text-body-2 text-medium-emphasis mb-4">
            选择一个预设后，仍可以在下方调整校级部门；下一步可以单独选择二级学院。
          </p>

          <div class="identity-grid" role="list" aria-label="身份预设">
            <v-btn
              v-for="preset in identityPresets"
              :key="preset.value"
              class="identity-option text-none"
              :color="selectedIdentity(preset.value) ? 'primary' : undefined"
              :variant="selectedIdentity(preset.value) ? 'tonal' : 'outlined'"
              :aria-pressed="selectedIdentity(preset.value)"
              @click="selectIdentity(preset)"
            >
              <v-icon start>{{ preset.icon }}</v-icon>
              <span class="text-left">
                <strong class="d-block">{{ preset.title }}</strong>
                <small>{{ preset.description }}</small>
              </span>
              <v-icon v-if="selectedIdentity(preset.value)" end>$check</v-icon>
            </v-btn>
          </div>

          <v-alert type="info" variant="tonal" density="compact" class="mt-4 mb-4">
            <div class="text-caption text-medium-emphasis">该身份预设自动关注的通知分类</div>
            <div class="text-body-2 mt-1">{{ selectedCategorySummary }}</div>
            <div class="text-caption text-medium-emphasis mt-1">
              完成引导后，可以在个人中心的“订阅与屏蔽”中修改。
            </div>
          </v-alert>

          <v-alert v-if="sourcesError" type="warning" variant="tonal" class="mb-4" role="status">
            {{ sourcesError }}
            <template #append>
              <v-btn
                prepend-icon="$refresh"
                variant="text"
                size="small"
                aria-label="重试加载来源列表"
                @click="loadSources(true)"
              >
                重试
              </v-btn>
            </template>
          </v-alert>

          <v-progress-circular
            v-if="sourcesLoading"
            indeterminate
            color="primary"
            class="d-block mx-auto my-8"
            aria-label="正在加载校级部门来源"
          />

          <template v-else>
            <div class="d-flex align-center justify-space-between mt-6 mb-2">
              <h4 class="text-subtitle-1">校级部门</h4>
              <span class="text-caption text-medium-emphasis">
                {{ draftSelectAll ? '当前关注所有来源' : `已选 ${selectedSchoolCount} 个` }}
              </span>
            </div>

            <div
              v-if="schoolOptions.length > 0"
              class="d-flex flex-wrap ga-2 mb-3 channel-chips"
              role="group"
              aria-label="校级部门订阅"
            >
              <v-chip
                v-for="channel in schoolOptions"
                :key="channel.name"
                filter
                clickable
                :color="isChannelSelected(channel.name) ? 'primary' : undefined"
                :variant="isChannelSelected(channel.name) ? 'tonal' : 'outlined'"
                :aria-pressed="isChannelSelected(channel.name)"
                @click="toggleChannel(channel.name)"
              >
                <v-icon start size="16">{{ channel.icon }}</v-icon>
                {{ channel.name }}
              </v-chip>
            </div>
            <v-alert
              v-else
              type="info"
              variant="tonal"
              density="compact"
              class="mt-2"
              role="status"
            >
              当前没有可选的校级部门来源，可以直接跳过此步。
            </v-alert>
          </template>
        </section>

        <section v-else-if="currentStep === 3" aria-labelledby="onboarding-secondary-title">
          <h3 id="onboarding-secondary-title" class="text-h6 mb-2">选择二级学院订阅</h3>
          <p class="text-body-2 text-medium-emphasis mb-4">
            可以选择多个二级学院，也可以暂时不选，之后可在个人中心继续调整。
          </p>

          <v-progress-circular
            v-if="sourcesLoading"
            indeterminate
            color="primary"
            class="d-block mx-auto my-8"
            aria-label="正在加载二级学院来源"
          />

          <v-alert v-if="sourcesError" type="warning" variant="tonal" class="mb-4" role="status">
            {{ sourcesError }}
            <template #append>
              <v-btn
                prepend-icon="$refresh"
                variant="text"
                size="small"
                aria-label="重试加载二级学院来源"
                @click="loadSources(true)"
              >
                重试
              </v-btn>
            </template>
          </v-alert>

          <template v-if="!sourcesLoading">
            <div class="d-flex align-center justify-space-between mb-2">
              <h4 class="text-subtitle-1">二级学院</h4>
              <span class="text-caption text-medium-emphasis">
                {{ draftSelectAll ? '当前关注所有来源' : `已选 ${selectedSecondaryCount} 个` }}
              </span>
            </div>

            <div
              v-if="secondaryOptions.length > 0"
              class="d-flex flex-wrap ga-2 channel-chips"
              role="group"
              aria-label="二级学院订阅"
            >
              <v-chip
                v-for="channel in secondaryOptions"
                :key="channel.name"
                filter
                clickable
                :color="isChannelSelected(channel.name) ? 'primary' : undefined"
                :variant="isChannelSelected(channel.name) ? 'tonal' : 'outlined'"
                :aria-pressed="isChannelSelected(channel.name)"
                @click="toggleChannel(channel.name)"
              >
                <v-icon start size="16">{{ channel.icon }}</v-icon>
                {{ channel.name }}
              </v-chip>
            </div>
            <v-alert
              v-else
              type="info"
              variant="tonal"
              density="compact"
              class="mt-2"
              role="status"
            >
              当前没有可选的二级学院来源，可以直接跳过此步。
            </v-alert>
          </template>
        </section>

        <section v-else aria-labelledby="onboarding-filter-title">
          <h3 id="onboarding-filter-title" class="text-h6 mb-2">设置 AI 过滤关键词</h3>
          <p class="text-body-2 text-medium-emphasis mb-4">
            添加你暂时不关心的主题，首页会自动减少相关通知；也可以直接跳过。
          </p>

          <v-text-field
            v-model="newKeyword"
            label="屏蔽关键词"
            placeholder="例如：考研、社团招新"
            prepend-inner-icon="$tagPlus"
            append-inner-icon="$plus"
            maxlength="200"
            clearable
            @keyup.enter="addKeyword"
            @click:append-inner="addKeyword"
          />

          <div v-if="draftKeywords.length > 0" class="d-flex flex-wrap ga-2 mt-2">
            <v-chip
              v-for="keyword in draftKeywords"
              :key="keyword"
              closable
              color="warning"
              :aria-label="`移除关键词 ${keyword}`"
              @click:close="removeKeyword(keyword)"
            >
              {{ keyword }}
            </v-chip>
          </div>
          <v-alert v-else type="info" variant="tonal" density="compact" class="mt-2">
            不设置关键词也可以，之后可在个人中心的“订阅与屏蔽”中随时修改。
          </v-alert>
        </section>
      </v-card-text>

      <v-card-actions class="onboarding-actions pa-4">
        <v-btn v-if="currentStep > 1" variant="text" @click="previousStep">
          <v-icon start>$chevronLeft</v-icon>
          上一步
        </v-btn>
        <v-spacer />
        <v-btn v-if="currentStep === 1" color="primary" @click="nextStep">
          开始个性化配置
          <v-icon end>$chevronRight</v-icon>
        </v-btn>
        <v-btn
          v-else-if="currentStep === 2"
          color="primary"
          :disabled="!canContinueFromChannels"
          @click="nextStep"
        >
          下一步：选择二级学院
          <v-icon end>$chevronRight</v-icon>
        </v-btn>
        <v-btn v-else-if="currentStep === 3" color="primary" @click="nextStep">
          下一步：AI 过滤设置
          <v-icon end>$chevronRight</v-icon>
        </v-btn>
        <v-btn
          v-if="currentStep === 4"
          color="primary"
          prepend-icon="$checkCircleOutline"
          @click="complete"
        >
          开启我的智能看板
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.onboarding-dialog {
  width: min(500px, calc(100vw - 32px));
}

.onboarding-card {
  max-height: min(760px, calc(100dvh - 32px));
  overflow: hidden;
}

.onboarding-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex: 0 0 auto;
}

.onboarding-body {
  overflow-y: auto;
}

.feature-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.feature-card {
  min-height: 150px;
}

.identity-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.identity-option {
  justify-content: flex-start;
  min-height: 72px;
  padding: 10px 12px;
  white-space: normal;
  height: auto;
  text-align: left;
}

.identity-option :deep(.v-btn__content) {
  white-space: normal;
  overflow: visible;
}

.identity-option small {
  display: block;
  color: rgb(var(--v-theme-on-surface-variant));
  font-weight: 400;
  line-height: 1.35;
  white-space: normal;
  word-break: break-word;
}

.channel-chips :deep(.v-chip--variant-tonal) {
  border: thin solid transparent;
}

.onboarding-actions {
  flex: 0 0 auto;
  border-top: 1px solid rgb(var(--v-theme-outline-variant));
}

@media (max-width: 959px) {
  .onboarding-dialog {
    width: 100%;
    margin: 0;
  }

  .onboarding-card {
    max-height: 100dvh;
    min-height: 100dvh;
    border-radius: 0;
  }

  .feature-grid {
    grid-template-columns: 1fr;
  }

  .feature-card {
    min-height: 0;
  }
}

@media (max-width: 420px) {
  .identity-grid {
    grid-template-columns: 1fr;
  }

  .onboarding-actions {
    align-items: stretch;
    flex-wrap: wrap;
  }

  .onboarding-actions .v-btn {
    flex: 1 1 auto;
  }
}
</style>
