<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { showToast } from 'vant'
import { useUserSettingsStore } from '../stores/userSettings'
import type { DarkMode } from '../stores/userSettings'
import { fetchNoticeById } from '../utils/request'
import { calculateRemainingDays } from '../utils/date'
import type { NoticeItem } from '../types/notice'

const router = useRouter()
const store = useUserSettingsStore()

const starredNotices = ref<NoticeItem[]>([])
const showFeedbackPopup = ref(false)
const feedbackText = ref('')

const iconDangerColor = computed(() =>
  store.isDark ? '#ff453a' : '#ee0a24',
)

const darkModeLabels: Record<DarkMode, string> = {
  auto: '跟随系统',
  light: '浅色',
  dark: '深色',
}

// ---- 拉取已收藏通知的详情 ----
onMounted(async () => {
  const ids = store.urgentStarredIds
  const items: NoticeItem[] = []
  for (const id of ids) {
    const cached = store.getCachedNotice(id)
    if (cached && cached.deadline) {
      items.push(cached)
    } else {
      try {
        const notice = await fetchNoticeById(id)
        if (notice.deadline) {
          items.push(notice)
        }
      } catch {
        // 跳过拉取失败的通知
      }
    }
  }
  // 按截止时间升序：最近截止的排前面
  items.sort((a, b) => {
    if (!a.deadline || !b.deadline) return 0
    return new Date(a.deadline).getTime() - new Date(b.deadline).getTime()
  })
  starredNotices.value = items
})

// ---- Android 物理返回键处理 ----
function onPopupOpen(): void {
  history.pushState({ popupOpen: true }, '')
  window.addEventListener('popstate', closePopup)
}

function closePopup(): void {
  showFeedbackPopup.value = false
  window.removeEventListener('popstate', closePopup)
}

function onPopupClose(): void {
  window.removeEventListener('popstate', closePopup)
}

onUnmounted(() => {
  window.removeEventListener('popstate', closePopup)
})

// ---- 剩余天数 ----
function remainingDays(deadline: string | null): string {
  const d = calculateRemainingDays(deadline)
  if (d === null) return '未知'
  if (d < 0) return '已过期'
  if (d === 0) return '今天'
  return `剩 ${d} 天`
}

function goToDetail(id: string): void {
  router.push({ name: 'Detail', params: { id } })
}

function submitFeedback(): void {
  if (feedbackText.value.trim()) {
    showToast('感谢你的反馈！')
    feedbackText.value = ''
    closePopup()
  }
}
</script>

<template>
  <div class="user-page">
    <van-nav-bar title="个人中心" fixed placeholder />

    <!-- 用户简况区 -->
    <div class="user-profile">
      <van-image
        round
        width="80"
        height="80"
        src=""
        class="user-avatar"
      >
        <template #error>
          <div class="avatar-placeholder">USTC</div>
        </template>
      </van-image>
      <p class="user-name">科大新同学</p>
    </div>

    <!-- Ddl 追踪列表 -->
    <van-cell-group inset class="ddl-group">
      <van-cell
        title="⏳ 我的 Ddl 倒计时"
        label="收藏通知的截止倒计时"
        center
      >
        <template #icon>
          <van-icon name="clock-o" :color="iconDangerColor" size="18" />
        </template>
      </van-cell>

      <van-cell
        v-for="item in starredNotices"
        :key="item.id"
        :title="item.title"
        :label="`截止时间: ${item.deadline || '未提及'}`"
        :value="remainingDays(item.deadline)"
        value-class="text-highlight"
        is-link
        @click="goToDetail(item.id)"
      />

      <div v-if="starredNotices.length === 0" class="empty-ddl">
        <p class="text-muted">暂无收藏的 Ddl 通知</p>
        <p class="text-muted hint">去首页左滑收藏通知吧~</p>
      </div>
    </van-cell-group>

    <!-- 系统入口 -->
    <van-cell-group class="settings-group">
      <van-cell
        title="偏好与渠道管理"
        icon="setting-o"
        is-link
        to="/subscription"
      />
      <van-cell
        title="用户意见反馈箱"
        icon="comment-o"
        is-link
        @click="showFeedbackPopup = true"
      />
    </van-cell-group>

    <!-- 深色模式 -->
    <van-cell-group title="外观" class="settings-group">
      <van-cell title="深色模式" icon="closed-eye" center>
        <template #default>
          <div class="theme-toggle-row">
            <van-tag
              v-for="mode in (['auto', 'light', 'dark'] as DarkMode[])"
              :key="mode"
              :type="store.darkMode === mode ? 'primary' : 'default'"
              size="medium"
              plain
              @click="store.setDarkMode(mode)"
            >
              {{ darkModeLabels[mode] }}
            </van-tag>
          </div>
        </template>
      </van-cell>
    </van-cell-group>

    <!-- 反馈弹窗 -->
    <van-popup
      v-model:show="showFeedbackPopup"
      position="bottom"
      :style="{ height: '40%', borderRadius: '16px 16px 0 0' }"
      @open="onPopupOpen"
      @closed="onPopupClose"
    >
      <div class="feedback-popup">
        <h3>意见反馈</h3>
        <van-field
          v-model="feedbackText"
          type="textarea"
          rows="5"
          placeholder="请告诉我们你的想法或建议..."
          autosize
        />
        <van-button
          type="primary"
          round
          block
          :disabled="!feedbackText.trim()"
          @click="submitFeedback"
        >
          提交反馈
        </van-button>
      </div>
    </van-popup>
  </div>
</template>

<style scoped>
.user-page {
  padding-bottom: 60px;
  min-height: 100vh;
  background: var(--notifai-bg-page);
}

/* 用户简况 */
.user-profile {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 32px 0 24px;
}

.user-avatar {
  border: 3px solid var(--notifai-border);
}

.avatar-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, var(--notifai-brand), var(--notifai-brand-2));
  color: #fff;
  font-weight: 700;
  font-size: 16px;
}

.user-name {
  margin-top: 12px;
  font-size: 18px;
  font-weight: 600;
  color: var(--notifai-text-primary);
}

/* Ddl 列表 */
.ddl-group {
  margin: 12px;
  border-radius: 10px;
  overflow: hidden;
}

.ddl-group :deep(.text-highlight) {
  color: var(--notifai-danger);
  font-weight: 700;
  font-size: 16px;
}

.empty-ddl {
  padding: 32px 16px;
  text-align: center;
  background: var(--notifai-bg-card);
}

.empty-ddl .hint {
  margin-top: 8px;
  font-size: 12px;
}

/* 设置入口 */
.settings-group {
  margin: 12px;
  border-radius: 10px;
  overflow: hidden;
}

/* 反馈弹窗 */
.feedback-popup {
  padding: 24px 16px;
}

.feedback-popup h3 {
  text-align: center;
  margin: 0 0 16px;
  font-size: 17px;
  color: var(--notifai-text-primary);
}

.feedback-popup :deep(.van-field) {
  background: var(--notifai-bg-page);
  border-radius: 8px;
  margin-bottom: 16px;
  padding: 10px;
}

.text-muted {
  color: var(--notifai-text-muted);
  font-size: 13px;
}

.theme-toggle-row {
  display: flex;
  gap: 8px;
}

.theme-toggle-row .van-tag {
  cursor: pointer;
  transition: opacity 0.2s;
}

.theme-toggle-row .van-tag:active {
  opacity: 0.7;
}
</style>
