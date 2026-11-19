<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue'
import { useAccountStore } from '../stores/account'
import { AccountApiError, getOidcSignup, normalizeDisplayName } from '../utils/accountApi'
import AppBanner from './AppBanner.vue'

const emit = defineEmits<{ dismiss: [message?: string] }>()
const account = useAccountStore()
const lifetime = new AbortController()
const nicknameField = useTemplateRef<{ focus: () => void }>('nicknameField')
const nickname = ref('')
const formId = ref<string | null>(null)
const loading = ref(true)
const submitting = ref(false)
const errorMessage = ref('')
const nicknameError = '请输入 1–32 个字符的昵称，不含控制字符'
const restartMessages = {
  SSO_SIGNUP_REQUIRED: '注册已过期，请重新使用单点登录',
  SSO_ALREADY_REGISTERED: '此身份已有账号，请重新使用单点登录',
  ACCOUNT_CHANGED: '当前登录状态已改变，请重新使用单点登录',
} as const

function active() {
  return !lifetime.signal.aborted && !account.user && !account.transitioning
}

async function handleError(error: unknown, phase: 'load' | 'submit') {
  if (!active()) return
  const code = error instanceof AccountApiError ? error.code : undefined
  if (code === 'SSO_SIGNUP_REQUIRED' || code === 'SSO_ALREADY_REGISTERED' || code === 'ACCOUNT_CHANGED') {
    await account.checkSession()
    if (active()) emit('dismiss', restartMessages[code])
  } else if (code === 'SSO_PROVIDER_UNAVAILABLE' || code === 'ACCOUNTS_DISABLED') {
    emit('dismiss', '单点登录暂不可用')
  } else if (phase === 'load') {
    errorMessage.value = '暂时无法验证单点登录，请重试'
  } else {
    errorMessage.value = code === 'INVALID_INPUT' ? nicknameError : '创建账号失败，请重试'
  }
}

async function load() {
  loading.value = true
  errorMessage.value = ''
  try {
    const form = await getOidcSignup(lifetime.signal)
    if (!active()) return
    formId.value = form.formId
    await nextTick()
    if (active()) nicknameField.value?.focus()
  } catch (error) {
    await handleError(error, 'load')
  } finally {
    loading.value = false
  }
}

async function submit() {
  if (!formId.value || submitting.value || !active()) return
  const normalized = normalizeDisplayName(nickname.value)
  if (!normalized) {
    errorMessage.value = nicknameError
    return
  }
  submitting.value = true
  errorMessage.value = ''
  try {
    await account.registerWithOidc(formId.value, normalized)
  } catch (error) {
    await handleError(error, 'submit')
  } finally {
    submitting.value = false
  }
}

function cancel() {
  if (!submitting.value) emit('dismiss')
}

onMounted(load)
onBeforeUnmount(() => lifetime.abort())
</script>

<template>
  <v-dialog
    :model-value="true"
    :persistent="submitting"
    max-width="440"
    aria-labelledby="sso-signup-title"
    @update:model-value="(open) => { if (!open) cancel() }"
    @after-enter="nicknameField?.focus()"
  >
    <v-card>
      <form @submit.prevent="submit">
        <v-card-title id="sso-signup-title">创建 NotifAI 账号</v-card-title>
        <v-card-text>
          <p v-if="formId" class="mb-4">昵称仅用于显示；此账号只能通过单点登录。</p>
          <p v-else-if="loading" role="status">正在确认单点登录</p>
          <AppBanner v-if="errorMessage" type="error" class="mb-4" aria-live="polite">
            {{ errorMessage }}
          </AppBanner>
          <v-text-field
            v-if="formId"
            ref="nicknameField"
            v-model="nickname"
            label="账号昵称"
            name="nickname"
            autocomplete="nickname"
            :disabled="submitting"
            hide-details
          />
        </v-card-text>
        <v-card-actions class="justify-end flex-wrap">
          <v-btn type="button" :disabled="submitting" @click="cancel">取消</v-btn>
          <v-btn v-if="!formId && !loading" type="button" @click="load">重试</v-btn>
          <v-btn
            v-if="formId"
            type="submit"
            color="primary"
            variant="flat"
            :loading="submitting"
            :disabled="submitting"
          >创建账号</v-btn>
        </v-card-actions>
      </form>
    </v-card>
  </v-dialog>
</template>
