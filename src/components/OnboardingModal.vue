<script setup lang="ts">
import { computed, ref } from 'vue'
import { useUserSettingsStore } from '../stores/userSettings'
import type { OnboardingIdentity } from '../stores/userSettings'
import { useWindowSize } from '../composables/useWindowSize'

interface ChannelOption {
  name: string
  group: '校级部门' | '院级单位'
  icon: string
}

interface IdentityPreset {
  value: OnboardingIdentity
  title: string
  description: string
  icon: string
  channels: string[]
  selectAll?: boolean
}

const CHANNEL_OPTIONS: readonly ChannelOption[] = [
  { name: '教务处', group: '校级部门', icon: '$school' },
  { name: '本科生院', group: '校级部门', icon: '$accountGroup' },
  { name: '学工部', group: '校级部门', icon: '$account' },
  { name: '科研部', group: '校级部门', icon: '$flask' },
  { name: '校团委', group: '校级部门', icon: '$bullhornOutline' },
  { name: '迎新特辑', group: '校级部门', icon: '$calendarCheck' },
  { name: '计算机学院', group: '院级单位', icon: '$domain' },
  { name: '大数据学院', group: '院级单位', icon: '$magnifyScan' },
  { name: '物理学院', group: '院级单位', icon: '$flask' },
  { name: '工程科学学院', group: '院级单位', icon: '$domain' },
]

const FRESHMAN_CHANNELS = ['教务处', '本科生院', '迎新特辑']
const COMPUTER_CHANNELS = ['教务处', '计算机学院']
const POSTGRADUATE_CHANNELS = ['科研部', '计算机学院']

const store = useUserSettingsStore()
const { isMobile } = useWindowSize()

const identityPresets: readonly IdentityPreset[] = [
  {
    value: 'freshman',
    title: '2026 级新生',
    description: '优先关注教务与迎新信息',
    icon: '$school',
    channels: FRESHMAN_CHANNELS,
  },
  {
    value: 'undergraduate',
    title: '计算机学院学生',
    description: '关注校级与计算机学院通知',
    icon: '$domain',
    channels: COMPUTER_CHANNELS,
  },
  {
    value: 'postgraduate',
    title: '研究生',
    description: '关注科研与院系信息',
    icon: '$flask',
    channels: POSTGRADUATE_CHANNELS,
  },
  {
    value: 'custom',
    title: '通用 / 全选',
    description: '先查看所有来源，再自行调整',
    icon: '$accountGroup',
    channels: [],
    selectAll: true,
  },
]

const currentStep = ref(1)
const draftIdentity = ref<OnboardingIdentity>(store.userIdentity)
const draftSelectAll = ref(store.subscriptionMode === 'all')
const draftChannels = ref<string[]>(
  store.subscribedChannels.length > 0
    ? [...store.subscribedChannels]
    : [...FRESHMAN_CHANNELS],
)
const draftKeywords = ref<string[]>([...store.blackKeywords])
const newKeyword = ref('')

store.registerSources(CHANNEL_OPTIONS.map((channel) => channel.name))

const progress = computed(() => (currentStep.value / 3) * 100)
const canContinueFromChannels = computed(
  () => draftSelectAll.value || draftChannels.value.length > 0,
)

function selectedIdentity(value: OnboardingIdentity): boolean {
  return draftIdentity.value === value
}

function selectIdentity(preset: IdentityPreset): void {
  draftIdentity.value = preset.value
  draftSelectAll.value = Boolean(preset.selectAll)
  draftChannels.value = [...preset.channels]
}

function isChannelSelected(channel: string): boolean {
  return draftSelectAll.value || draftChannels.value.includes(channel)
}

function toggleChannel(channel: string): void {
  if (draftSelectAll.value) {
    draftSelectAll.value = false
    draftChannels.value = CHANNEL_OPTIONS.map((option) => option.name).filter(
      (name) => name !== channel,
    )
    draftIdentity.value = 'custom'
    return
  }

  const index = draftChannels.value.indexOf(channel)
  if (index >= 0) {
    draftChannels.value.splice(index, 1)
  } else {
    draftChannels.value.push(channel)
  }
  draftIdentity.value = 'custom'
}

function nextStep(): void {
  if (currentStep.value === 2 && !canContinueFromChannels.value) return
  currentStep.value = Math.min(3, currentStep.value + 1)
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
    keywords: [...draftKeywords.value],
  })
}
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
        <v-chip size="small" color="primary" variant="tonal">{{ currentStep }} / 3</v-chip>
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
            选择一个预设后，仍可以在下方调整关注来源。
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

          <div class="d-flex align-center justify-space-between mt-6 mb-2">
            <h4 class="text-subtitle-1">关注来源</h4>
            <span class="text-caption text-medium-emphasis">
              {{ draftSelectAll ? '当前关注所有来源' : `已选 ${draftChannels.length} 个` }}
            </span>
          </div>

          <div class="channel-group" v-for="group in ['校级部门', '院级单位']" :key="group">
            <div class="text-caption text-medium-emphasis mb-2">{{ group }}</div>
            <div class="d-flex flex-wrap ga-2 mb-3">
              <v-chip
                v-for="channel in CHANNEL_OPTIONS.filter((option) => option.group === group)"
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
          </div>
        </section>

        <section v-else aria-labelledby="onboarding-filter-title">
          <h3 id="onboarding-filter-title" class="text-h6 mb-2">设置 AI 过滤关键词</h3>
          <p class="text-body-2 text-medium-emphasis mb-4">
            添加你暂时不关心的主题，首页会自动减少相关通知。
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
            不设置也可以，之后可在订阅页面随时修改。
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
          下一步：AI 过滤设置
          <v-icon end>$chevronRight</v-icon>
        </v-btn>
        <v-btn
          v-if="currentStep === 3"
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
}

.identity-option small {
  display: block;
  color: rgb(var(--v-theme-on-surface-variant));
  font-weight: 400;
  line-height: 1.35;
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
