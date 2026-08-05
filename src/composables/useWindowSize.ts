import { ref, onMounted, onUnmounted } from 'vue'

const MOBILE_BREAKPOINT = 960
const canUseWindow = typeof window !== 'undefined'

const width = ref(canUseWindow ? window.innerWidth : 0)
const isMobile = ref(canUseWindow ? window.innerWidth < MOBILE_BREAKPOINT : false)
let subscriberCount = 0

function onResize() {
  if (!canUseWindow) return
  width.value = window.innerWidth
  isMobile.value = window.innerWidth < MOBILE_BREAKPOINT
}

function subscribe() {
  if (!canUseWindow) return

  subscriberCount += 1
  if (subscriberCount === 1) {
    onResize()
    window.addEventListener('resize', onResize)
  }
}

function unsubscribe() {
  if (!canUseWindow || subscriberCount === 0) return

  subscriberCount -= 1
  if (subscriberCount === 0) {
    window.removeEventListener('resize', onResize)
  }
}

/**
 * 响应式窗口尺寸 composable
 * 全局共享同一份数据，避免重复监听
 */
export function useWindowSize() {
  onMounted(subscribe)
  onUnmounted(unsubscribe)

  return { width, isMobile }
}
