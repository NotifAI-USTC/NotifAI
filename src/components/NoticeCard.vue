<script setup lang="ts">
import { ref, computed } from 'vue'
import { useUserSettingsStore } from '../stores/userSettings'
import type { NoticeItem } from '../types/notice'
import { isUrgent, formatRemaining } from '../utils/date'
import { hapticStar, hapticRead, hapticMedium } from '../utils/haptics'
import { recommendTags, getTagColor } from '../utils/tags'
import ShareDialog from './ShareDialog.vue'
import FolderDialog from './FolderDialog.vue'

const props = defineProps<{
  notice: NoticeItem
  isRead?: boolean
}>()

const emit = defineEmits<{
  click: [id: string]
  read: [id: string]
  star: [id: string]
}>()

const store = useUserSettingsStore()

const urgent = computed(() => isUrgent(props.notice.deadline))
const remainingText = computed(() => formatRemaining(props.notice.deadline))

const showShare = ref(false)
const showFolder = ref(false)
const showTagMenu = ref(false)
const newTag = ref('')

const isPinned = computed(() => store.isPinned(props.notice.id))
const isImportant = computed(() => store.isImportant(props.notice.id))
const noticeTags = computed(() =>
  Object.hasOwn(store.customTags, props.notice.id) ? store.customTags[props.notice.id] : [],
)
const recommendedTags = computed(() => recommendTags(props.notice))

const cardClasses = computed(() => ({
  'notice-card': true,
  'notice-card--read': props.isRead,
  'notice-card--pinned': isPinned.value,
  'notice-card--important': isImportant.value,
}))

function handleClick() {
  emit('click', props.notice.id)
}

function handleRead() {
  hapticRead()
  emit('read', props.notice.id)
}

function handleStar() {
  hapticStar()
  emit('star', props.notice.id)
}

function handlePin() {
  hapticMedium()
  store.togglePin(props.notice.id)
}

function handleImportant() {
  hapticMedium()
  store.toggleImportant(props.notice.id)
}

function addTag(tag: string) {
  store.addCustomTag(props.notice.id, tag)
}

function removeTag(tag: string) {
  store.removeCustomTag(props.notice.id, tag)
}

function addCustomTag() {
  if (newTag.value.trim()) {
    addTag(newTag.value.trim())
    newTag.value = ''
  }
}
</script>

<template>
  <v-card :class="cardClasses" :elevation="isRead ? 1 : isImportant ? 4 : 2">
    <!-- 置顶标记 -->
    <v-chip v-if="isPinned" size="x-small" color="primary" variant="tonal" class="pin-badge">
      <v-icon size="12">$pin</v-icon>
    </v-chip>

    <div
      class="notice-card__open"
      :aria-label="`打开通知：${notice.title}`"
      role="link"
      tabindex="0"
      @click="handleClick"
      @keydown.enter.prevent="handleClick"
      @keydown.space.prevent="handleClick"
    >
      <!-- 标题 -->
      <v-card-title class="text-subtitle-1 font-weight-bold pa-0 mb-2 line-clamp-2">
        <v-icon v-if="isImportant" size="16" color="error" class="mr-1">$alertCircle</v-icon>
        {{ notice.title }}
      </v-card-title>

      <!-- AI 摘要 -->
      <v-card-subtitle class="notice-summary text-body-2 pa-0 mb-3">
        {{ notice.aiSummary || '暂无 AI 摘要' }}
      </v-card-subtitle>
    </div>

    <v-card-text class="pt-0">
      <!-- 标签 -->
      <v-chip-group column class="pa-0">
        <v-chip size="small" color="primary" variant="tonal">
          {{ notice.source }}
        </v-chip>

        <v-chip
          v-if="notice.deadline"
          size="small"
          :color="urgent ? 'error' : 'default'"
          :variant="urgent ? 'flat' : 'outlined'"
        >
          <v-icon start size="small">$clockOutline</v-icon>
          {{ remainingText }}
        </v-chip>

        <v-chip v-if="isRead" size="small" color="grey" variant="outlined"> 已读 </v-chip>

        <!-- 自定义标签 -->
        <v-chip
          v-for="tag in noticeTags"
          :key="tag"
          size="small"
          :color="getTagColor(tag)"
          variant="tonal"
          closable
          @click:close.stop="removeTag(tag)"
        >
          {{ tag }}
        </v-chip>
      </v-chip-group>
    </v-card-text>

    <!-- 操作按钮 -->
    <v-card-actions class="card-actions">
      <v-spacer />
      <v-btn
        v-if="!isRead"
        icon
        size="small"
        variant="text"
        aria-label="标记通知为已读"
        @click.stop="handleRead"
      >
        <v-icon>$checkCircleOutline</v-icon>
        <v-tooltip activator="parent" location="top">标记已读</v-tooltip>
      </v-btn>
      <v-btn
        icon
        size="small"
        variant="text"
        :color="isPinned ? 'primary' : 'default'"
        :aria-label="isPinned ? '取消置顶通知' : '置顶通知'"
        @click.stop="handlePin"
      >
        <v-icon>{{ isPinned ? '$pin' : '$pinOutline' }}</v-icon>
        <v-tooltip activator="parent" location="top">{{
          isPinned ? '取消置顶' : '置顶'
        }}</v-tooltip>
      </v-btn>
      <v-btn
        icon
        size="small"
        variant="text"
        :color="isImportant ? 'error' : 'default'"
        :aria-label="isImportant ? '取消重要标记' : '标记为重要通知'"
        @click.stop="handleImportant"
      >
        <v-icon>{{ isImportant ? '$alertCircle' : '$alertCircleOutline' }}</v-icon>
        <v-tooltip activator="parent" location="top">{{
          isImportant ? '取消重要' : '标记重要'
        }}</v-tooltip>
      </v-btn>
      <v-btn
        icon
        size="small"
        variant="text"
        :color="store.isStarred(notice.id) ? 'amber' : 'default'"
        :aria-label="store.isStarred(notice.id) ? '取消收藏通知' : '收藏通知'"
        @click.stop="handleStar"
      >
        <v-icon>{{ store.isStarred(notice.id) ? '$star' : '$starOutline' }}</v-icon>
        <v-tooltip activator="parent" location="top">
          {{ store.isStarred(notice.id) ? '取消收藏' : '收藏' }}
        </v-tooltip>
      </v-btn>
      <v-btn
        icon
        size="small"
        variant="text"
        aria-label="选择收藏夹"
        @click.stop="showFolder = true"
      >
        <v-icon>$folderStarOutline</v-icon>
        <v-tooltip activator="parent" location="top">选择收藏夹</v-tooltip>
      </v-btn>
      <v-btn
        icon
        size="small"
        variant="text"
        aria-label="为通知添加标签"
        @click.stop="showTagMenu = true"
      >
        <v-icon>$tagPlus</v-icon>
        <v-tooltip activator="parent" location="top">添加标签</v-tooltip>
      </v-btn>
      <v-btn icon size="small" variant="text" aria-label="分享通知" @click.stop="showShare = true">
        <v-icon>$shareVariant</v-icon>
        <v-tooltip activator="parent" location="top">分享</v-tooltip>
      </v-btn>
    </v-card-actions>
  </v-card>

  <!-- 分享对话框 -->
  <ShareDialog v-if="showShare" :notice="notice" @close="showShare = false" />

  <!-- 收藏夹对话框 -->
  <FolderDialog v-if="showFolder" :notice="notice" mode="select" @close="showFolder = false" />

  <!-- 标签菜单 -->
  <v-dialog v-model="showTagMenu" max-width="400">
    <v-card>
      <v-card-title>添加标签</v-card-title>
      <v-divider />
      <v-card-text>
        <!-- 推荐标签 -->
        <div v-if="recommendedTags.length > 0" class="mb-4">
          <div class="text-caption text-medium-emphasis mb-2">推荐标签</div>
          <div class="d-flex flex-wrap ga-2">
            <v-chip
              v-for="tag in recommendedTags"
              :key="tag"
              size="small"
              :color="getTagColor(tag)"
              variant="outlined"
              @click="addTag(tag)"
            >
              <v-icon start size="small">$plus</v-icon>
              {{ tag }}
            </v-chip>
          </div>
        </div>

        <!-- 自定义标签输入 -->
        <div class="d-flex ga-2">
          <v-text-field
            v-model="newTag"
            label="自定义标签"
            density="compact"
            hide-details
            @keyup.enter="addCustomTag"
          />
          <v-btn color="primary" @click="addCustomTag">添加</v-btn>
        </div>

        <!-- 已添加标签 -->
        <div v-if="noticeTags.length > 0" class="mt-4">
          <div class="text-caption text-medium-emphasis mb-2">已添加标签</div>
          <div class="d-flex flex-wrap ga-2">
            <v-chip
              v-for="tag in noticeTags"
              :key="tag"
              size="small"
              :color="getTagColor(tag)"
              closable
              @click:close="removeTag(tag)"
            >
              {{ tag }}
            </v-chip>
          </div>
        </div>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn @click="showTagMenu = false">关闭</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.notice-card {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  border-radius: 8px;
  position: relative;
}

.notice-summary {
  opacity: 1;
}

.notice-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.notice-card__open {
  cursor: pointer;
  padding: 16px 16px 0;
}

.notice-card__open:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: -2px;
}

.notice-card--read {
  opacity: 0.65;
}

.notice-card--pinned {
  border-left: 3px solid rgb(var(--v-theme-primary));
}

.notice-card--important {
  border-left: 3px solid rgb(var(--v-theme-error));
}

.pin-badge {
  position: absolute;
  top: 8px;
  right: 8px;
  background: rgba(var(--v-theme-primary), 0.1);
  border-radius: 50%;
  padding: 4px;
}

.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.card-actions {
  opacity: 0;
  transition: opacity 0.2s ease;
}

.notice-card:hover .card-actions,
.notice-card:focus-within .card-actions {
  opacity: 1;
}

/* 移动端始终显示操作按钮 */
@media (max-width: 960px) {
  .card-actions {
    opacity: 1;
  }
}
</style>
