<script setup lang="ts">
import { ref, computed } from 'vue'
import { USER_FOLDER_LIMIT, useUserSettingsStore } from '../stores/userSettings'
import type { NoticeItem } from '../types/notice'

const props = defineProps<{
  notice?: NoticeItem
  mode: 'select' | 'manage'
}>()

const emit = defineEmits<{
  close: []
  select: [folderId: string]
  remove: []
}>()

const store = useUserSettingsStore()
const showNewFolder = ref(false)
const newFolderName = ref('')
const editingFolder = ref<string | null>(null)
const editName = ref('')
const folderError = ref('')

const currentFolder = computed(() => {
  if (props.notice) {
    return Object.hasOwn(store.starredFolderMap, props.notice.id)
      ? store.starredFolderMap[props.notice.id]
      : 'default'
  }
  return 'default'
})

const isNoticeStarred = computed(
  () => props.notice !== undefined && store.isStarred(props.notice.id),
)

function selectFolder(folderId: string) {
  if (props.mode === 'select' && props.notice) {
    store.moveToFolder(props.notice.id, folderId)
    emit('select', folderId)
    emit('close')
  }
}

function removeFavorite() {
  if (props.mode !== 'select' || !isNoticeStarred.value) return
  emit('close')
  emit('remove')
}

function createFolder() {
  const name = newFolderName.value.trim()
  if (!name) return

  const folder = store.addFolder(name, '$folder')
  if (!folder) {
    folderError.value = store.persistenceError || `最多只能创建 ${USER_FOLDER_LIMIT} 个收藏夹`
    return
  }

  folderError.value = ''
  newFolderName.value = ''
  showNewFolder.value = false
}

function openNewFolder() {
  folderError.value = ''
  showNewFolder.value = true
}

function startEdit(folderId: string, name: string) {
  editingFolder.value = folderId
  editName.value = name
}

function saveEdit() {
  if (editingFolder.value && editName.value.trim()) {
    store.renameFolder(editingFolder.value, editName.value.trim())
    editingFolder.value = null
  }
}

function deleteFolder(folderId: string) {
  store.removeFolder(folderId)
}
</script>

<template>
  <v-dialog :model-value="true" @update:model-value="emit('close')" max-width="400">
    <v-card>
      <v-card-title class="d-flex align-center justify-space-between">
        <span>{{ mode === 'select' ? '选择收藏夹' : '管理收藏夹' }}</span>
        <v-btn
          icon
          variant="text"
          size="small"
          aria-label="关闭收藏夹对话框"
          @click="emit('close')"
        >
          <v-icon>$close</v-icon>
        </v-btn>
      </v-card-title>
      <v-divider />

      <v-card-text>
        <v-list>
          <v-list-item
            v-for="folder in store.folders"
            :key="folder.id"
            :prepend-icon="folder.icon"
            :active="currentFolder === folder.id"
            @click="mode === 'select' ? selectFolder(folder.id) : null"
          >
            <template v-if="editingFolder === folder.id" #default>
              <v-text-field
                v-model="editName"
                density="compact"
                hide-details
                autofocus
                @keyup.enter="saveEdit"
                @blur="saveEdit"
              />
            </template>
            <template v-else #default>
              <v-list-item-title>{{ folder.name }}</v-list-item-title>
              <v-list-item-subtitle>
                {{ store.getStarredInFolder(folder.id).length }} 条收藏
              </v-list-item-subtitle>
            </template>
            <template #append>
              <div v-if="mode === 'manage' && folder.id !== 'default'" class="d-flex">
                <v-btn
                  icon
                  variant="text"
                  size="small"
                  :aria-label="`重命名收藏夹 ${folder.name}`"
                  @click.stop="startEdit(folder.id, folder.name)"
                >
                  <v-icon size="small">$pencil</v-icon>
                </v-btn>
                <v-btn
                  icon
                  variant="text"
                  size="small"
                  color="error"
                  :aria-label="`删除收藏夹 ${folder.name}`"
                  @click.stop="deleteFolder(folder.id)"
                >
                  <v-icon size="small">$delete</v-icon>
                </v-btn>
              </div>
              <v-icon v-else-if="mode === 'select' && currentFolder === folder.id" color="primary">
                $check
              </v-icon>
            </template>
          </v-list-item>
        </v-list>

        <!-- 新建收藏夹 -->
        <div v-if="showNewFolder" class="mt-4">
          <v-alert
            v-if="folderError"
            type="error"
            variant="tonal"
            density="compact"
            class="mb-3"
            role="alert"
          >
            {{ folderError }}
          </v-alert>
          <v-text-field
            v-model="newFolderName"
            label="收藏夹名称"
            density="compact"
            hide-details
            @keyup.enter="createFolder"
          />
          <v-row justify="end" dense class="mt-2">
            <v-col cols="auto">
              <v-btn size="small" color="primary" @click="createFolder">创建</v-btn>
            </v-col>
          </v-row>
        </div>
      </v-card-text>

      <v-card-actions v-if="mode === 'manage' || isNoticeStarred">
        <v-btn
          v-if="mode === 'select' && isNoticeStarred"
          color="error"
          variant="text"
          prepend-icon="$starOutline"
          @click="removeFavorite"
        >
          取消收藏
        </v-btn>
        <span
          v-if="mode === 'manage' && store.folders.length >= USER_FOLDER_LIMIT"
          class="text-caption text-error px-2"
          role="status"
        >
          已达到 {{ USER_FOLDER_LIMIT }} 个收藏夹上限
        </span>
        <v-spacer />
        <v-btn
          v-if="mode === 'manage'"
          prepend-icon="$plus"
          :disabled="store.folders.length >= USER_FOLDER_LIMIT"
          @click="openNewFolder"
        >
          新建收藏夹
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
