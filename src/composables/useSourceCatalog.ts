import { onBeforeUnmount, ref } from 'vue'
import { useUserSettingsStore } from '../stores/userSettings'
import { DEPARTMENTS } from '../types/notice'
import type { SourceItem } from '../types/notice'
import { fetchSources } from '../utils/request'

/** API 不可用时的最小来源目录；成功请求后以后端目录为准。 */
const FALLBACK_SOURCES: SourceItem[] = DEPARTMENTS.map((department) => ({
  name: department.name,
  group: department.group,
  noticeCount: 0,
}))

export function useSourceCatalog() {
  const store = useUserSettingsStore()
  const sourceItems = ref<SourceItem[] | null>(null)
  const loading = ref(false)
  const error = ref('')
  let controller: AbortController | null = null

  async function loadSources(force = false): Promise<boolean> {
    if (loading.value || (!force && sourceItems.value !== null)) return false

    controller?.abort()
    const requestController = new AbortController()
    controller = requestController
    loading.value = true
    error.value = ''

    try {
      const loadedSources = await fetchSources(requestController.signal)
      if (requestController.signal.aborted) return false
      sourceItems.value = loadedSources
      // 成功响应是当前目录的权威快照，清理已经不存在的本地来源，
      // 避免动态来源目录与订阅切换白名单长期漂移。
      store.replaceAvailableSources(loadedSources.map((source) => source.name))
      return true
    } catch (requestError) {
      if (
        requestController.signal.aborted ||
        (requestError instanceof Error && requestError.name === 'AbortError')
      ) {
        return false
      }
      sourceItems.value = null
      // 网络失败不是“目录为空”的证明。只补充静态来源，保留已经从
      // 服务端发现或由用户保存的动态来源，避免一次临时断网改写用户偏好。
      store.registerSources(FALLBACK_SOURCES.map((source) => source.name))
      error.value =
        requestError instanceof Error
          ? `${requestError.message}，已展示内置来源`
          : '来源列表加载失败，已展示内置来源'
      return false
    } finally {
      if (controller === requestController) {
        controller = null
        loading.value = false
      }
    }
  }

  onBeforeUnmount(() => {
    controller?.abort()
    controller = null
  })

  return {
    sourceItems,
    loading,
    error,
    loadSources,
  }
}
