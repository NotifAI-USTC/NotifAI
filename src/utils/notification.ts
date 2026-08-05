/** 当前页面的浏览器通知工具（不包含后台调度）。 */

import { resolveAppAssetUrl } from './appUrl'

// 检查浏览器是否支持通知
export function isNotificationSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window
}

// 请求通知权限
export async function requestNotificationPermission(): Promise<NotificationPermission | null> {
  if (!isNotificationSupported()) {
    console.warn('浏览器不支持通知功能')
    return null
  }

  try {
    return await Notification.requestPermission()
  } catch (error) {
    console.error('请求浏览器通知权限失败', error)
    return null
  }
}

// 获取当前通知权限状态
export function getNotificationPermission(): NotificationPermission | null {
  if (!isNotificationSupported()) {
    return null
  }
  return Notification.permission
}

// 发送本地通知
export function sendNotification(
  title: string,
  options?: NotificationOptions,
): Notification | null {
  if (!isNotificationSupported() || Notification.permission !== 'granted') {
    return null
  }

  try {
    const notification = new Notification(title, {
      icon: resolveAppAssetUrl('icons/icon.svg'),
      ...options,
    })

    // 点击通知时聚焦窗口
    notification.onclick = () => {
      window.focus()
      notification.close()
    }

    return notification
  } catch (error) {
    console.error('创建浏览器通知失败', error)
    return null
  }
}
