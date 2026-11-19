<script setup lang="ts">
import { ref, useTemplateRef, watch } from 'vue'
import { useAccountStore } from '../stores/account'
import { normalizeStoredSettings } from '../stores/settingsPersistence'
import { useUserSettingsStore } from '../stores/userSettings'
import { AccountApiError, getCapabilities } from '../utils/accountApi'
import { projectCloudSettings } from '../utils/cloudSettings'
import AppBanner from './AppBanner.vue'

const account = useAccountStore()
const settings = useUserSettingsStore()
const username = ref('')
const password = ref('')
const visiblePassword = ref(false)
const loadingCapabilities = ref(false)
const canLogin = ref(false)
const submitting = ref(false)
const errorMessage = ref('')
const usernameField = useTemplateRef('usernameField')
let discovery: AbortController | undefined
const activator = ref<HTMLElement | null>(null)

async function loadCapabilities() {
  discovery?.abort()
  const request = new AbortController()
  discovery = request
  canLogin.value = false
  errorMessage.value = ''
  loadingCapabilities.value = true
  try {
    const result = await getCapabilities(request.signal)
    if (!request.signal.aborted) canLogin.value = result.password
  } catch {
    if (!request.signal.aborted) errorMessage.value = '账号登录暂不可用，请重试'
  } finally {
    if (!request.signal.aborted) loadingCapabilities.value = false
  }
}

watch(() => account.loginDialogOpen, (open, _, onCleanup) => {
  if (open) {
    activator.value = document.activeElement instanceof HTMLElement ? document.activeElement : null
    void loadCapabilities()
    onCleanup(() => discovery?.abort())
  } else {
    username.value = ''
    password.value = ''
    errorMessage.value = ''
    visiblePassword.value = false
  }
})

async function submit() {
  if (!canLogin.value || submitting.value || !username.value.trim() || !password.value) return
  submitting.value = true
  errorMessage.value = ''
  try {
    settings.persistImmediate()
    const candidate = projectCloudSettings(normalizeStoredSettings(JSON.parse(settings.exportSettings())))
    await account.signIn(username.value, password.value, candidate)
  } catch (error) {
    const code = error instanceof AccountApiError ? error.code : undefined
    if (code === 'INVALID_CREDENTIALS') errorMessage.value = '用户名或密码不正确'
    else if (code === 'LOGIN_RATE_LIMITED') errorMessage.value = '尝试次数过多，请稍后再试'
    else if (code === 'INVALID_INPUT') errorMessage.value = '请检查用户名和密码格式'
    else errorMessage.value = '登录失败，请重试'
  } finally {
    password.value = ''
    submitting.value = false
  }
}
</script>

<template>
  <v-dialog
    v-model="account.loginDialogOpen"
    :persistent="submitting"
    max-width="440"
    aria-labelledby="account-login-title"
    @after-enter="usernameField?.focus()"
    @after-leave="activator?.focus()"
  >
    <v-card>
      <form @submit.prevent="submit">
        <v-card-title id="account-login-title">登录 NotifAI</v-card-title>
        <v-card-text>
          <p class="mb-4">使用维护者分配的 NotifAI 账号，不要输入校园账号密码。</p>
          <AppBanner v-if="errorMessage" type="error" class="mb-4" aria-live="polite">
            {{ errorMessage }}
          </AppBanner>
          <v-text-field
            ref="usernameField"
            v-model="username"
            label="用户名"
            name="username"
            autocomplete="username"
            autocapitalize="none"
            spellcheck="false"
            :disabled="submitting"
            maxlength="32"
            required
          />
          <v-text-field
            v-model="password"
            label="密码"
            name="password"
            autocomplete="current-password"
            :type="visiblePassword ? 'text' : 'password'"
            :disabled="submitting"
            maxlength="256"
            required
            hide-details
          >
            <template #append-inner>
              <v-btn
                type="button"
                variant="text"
                :aria-label="visiblePassword ? '隐藏密码' : '显示密码'"
                @click="visiblePassword = !visiblePassword"
              >{{ visiblePassword ? '隐藏' : '显示' }}</v-btn>
            </template>
          </v-text-field>
        </v-card-text>
        <v-card-actions class="justify-end flex-wrap">
          <v-btn :disabled="submitting" @click="account.loginDialogOpen = false">取消</v-btn>
          <v-btn
            v-if="!canLogin"
            :loading="loadingCapabilities"
            :disabled="loadingCapabilities"
            @click="loadCapabilities"
          >重试连接</v-btn>
          <v-btn
            v-else
            type="submit"
            color="primary"
            variant="flat"
            :loading="submitting"
            :disabled="submitting || !username.trim() || !password"
          >登录</v-btn>
        </v-card-actions>
      </form>
    </v-card>
  </v-dialog>
</template>
