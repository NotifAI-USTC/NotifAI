/**
 * 震动反馈工具
 */

// 检查是否支持震动
export function isHapticsSupported(): boolean {
  return 'vibrate' in navigator
}

// 中等反馈
export function hapticMedium(): void {
  if (isHapticsSupported()) {
    navigator.vibrate(20)
  }
}

// 收藏反馈
export function hapticStar(): void {
  if (isHapticsSupported()) {
    navigator.vibrate([10, 30, 10])
  }
}

// 已读反馈
export function hapticRead(): void {
  if (isHapticsSupported()) {
    navigator.vibrate(15)
  }
}
