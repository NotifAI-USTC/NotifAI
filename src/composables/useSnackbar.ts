import { ref } from 'vue'

const show = ref(false)
const text = ref('')
const color = ref<'error' | 'success' | 'warning' | 'info'>('error')
const timeout = ref(3000)

/**
 * 全局 Snackbar 提示 composable
 */
export function useSnackbar() {
  function showError(msg: string) {
    text.value = msg
    color.value = 'error'
    timeout.value = 4000
    show.value = true
  }

  function showSuccess(msg: string) {
    text.value = msg
    color.value = 'success'
    timeout.value = 2000
    show.value = true
  }

  function showWarning(msg: string) {
    text.value = msg
    color.value = 'warning'
    timeout.value = 3000
    show.value = true
  }

  function showInfo(msg: string) {
    text.value = msg
    color.value = 'info'
    timeout.value = 2500
    show.value = true
  }

  function hide() {
    show.value = false
  }

  return {
    show,
    text,
    color,
    timeout,
    showError,
    showSuccess,
    showWarning,
    showInfo,
    hide,
  }
}
