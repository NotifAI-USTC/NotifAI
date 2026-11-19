<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAccountStore } from '../stores/account'
import { useUserSettingsStore } from '../stores/userSettings'
import { defaultCloudSettings } from '../utils/cloudSettings'
import AppBanner from './AppBanner.vue'

const account = useAccountStore()
const store = useUserSettingsStore()
const confirmation = ref<'logout' | 'overwrite' | null>(null)
const errorMessage = ref('')
const syncLabel = computed(() => {
  switch (account.syncStatus) {
    case 'saving': return '正在同步'
    case 'dirty': return '未同步'
    case 'conflict': return '其他设备已更新设置'
    default: return ''
  }
})

async function signOut() {
  errorMessage.value = ''
  try {
    await account.signOut()
  } catch {
    errorMessage.value = '退出登录失败，请重试'
  }
}

async function applyRemote() {
  errorMessage.value = ''
  try {
    const settings = await account.useCloudVersion()
    store.applyCloudSettings(settings ?? defaultCloudSettings())
  } catch {
    errorMessage.value = '读取云端设置失败，请重试'
  }
}

function importLocal() {
  const candidate = account.importCandidate
  if (!candidate || account.unsynced || account.loadingCloud || account.loggingOut) return
  store.applyCloudSettings(candidate)
  void account.importLocal(candidate)
}

function confirm() {
  const action = confirmation.value
  confirmation.value = null
  if (action === 'logout') void signOut()
  else if (action === 'overwrite') void account.overwriteCloud()
}
</script>

<template>
  <div class="mt-4 text-center">
    <p v-if="syncLabel" role="status" class="mb-2">{{ syncLabel }}</p>
    <div v-if="account.unsynced" class="d-flex flex-wrap justify-center ga-2">
      <v-btn
        v-if="account.syncStatus === 'dirty'"
        variant="tonal"
        :disabled="account.loggingOut"
        @click="account.retrySave()"
      >重试同步</v-btn>
      <template v-else-if="account.syncStatus === 'conflict'">
        <v-btn
          :disabled="account.loadingCloud || account.loggingOut"
          @click="applyRemote"
        >使用云端版本</v-btn>
        <v-btn
          v-if="account.conflictReadable"
          :disabled="account.loadingCloud || account.loggingOut"
          @click="confirmation = 'overwrite'"
        >用本机版本覆盖</v-btn>
        <v-btn
          v-else
          variant="tonal"
          :loading="account.loadingCloud"
          :disabled="account.loadingCloud || account.loggingOut"
          @click="account.fetchConflict()"
        >重试读取云端版本</v-btn>
      </template>
    </div>
    <AppBanner v-if="errorMessage" type="error" class="mb-3" role="status">{{ errorMessage }}</AppBanner>
    <AppBanner v-if="account.importCandidate && !account.unsynced" class="mb-3 text-start" :icon="false">
      <p>云端还没有设置。导入不会删除本机游客偏好。</p>
      <div class="d-flex flex-wrap ga-2 mt-2">
        <v-btn variant="tonal" :disabled="account.loadingCloud || account.loggingOut" @click="importLocal">导入本机偏好</v-btn>
        <v-btn variant="text" @click="account.dismissImport()">不导入</v-btn>
      </div>
    </AppBanner>
    <v-btn
      :class="{ 'mt-3': account.unsynced }"
      block
      color="error"
      rounded="lg"
      height="48"
      variant="flat"
      :loading="account.loggingOut"
      :disabled="account.loggingOut"
      @click="account.unsynced ? (confirmation = 'logout') : signOut()"
    >退出登录</v-btn>
  </div>

  <v-dialog
    :model-value="confirmation !== null"
    max-width="430"
    aria-labelledby="account-confirmation-title"
    @update:model-value="(open) => { if (!open) confirmation = null }"
  >
    <v-card>
      <v-card-title id="account-confirmation-title">
        {{ confirmation === 'logout' ? '退出登录？' : '覆盖云端设置？' }}
      </v-card-title>
      <v-card-text>
        {{ confirmation === 'logout'
          ? '尚未保存的修改可能丢失。'
          : '此操作会用当前本机偏好替换已读取的云端版本。' }}
      </v-card-text>
      <v-card-actions class="justify-end">
        <v-btn @click="confirmation = null">取消</v-btn>
        <v-btn color="error" variant="tonal" @click="confirm">
          {{ confirmation === 'logout' ? '确认退出' : '确认覆盖' }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
