<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'

const props = defineProps<{
  images: string[]
  initialIndex?: number
}>()

const emit = defineEmits<{
  close: []
}>()

const currentIndex = ref(props.initialIndex || 0)
const scale = ref(1)
const position = ref({ x: 0, y: 0 })
const isDragging = ref(false)
const dragStart = ref({ x: 0, y: 0 })

const currentImage = computed(() => props.images[currentIndex.value])

function close() {
  emit('close')
}

function prev() {
  if (currentIndex.value > 0) {
    currentIndex.value--
    resetTransform()
  }
}

function next() {
  if (currentIndex.value < props.images.length - 1) {
    currentIndex.value++
    resetTransform()
  }
}

function resetTransform() {
  scale.value = 1
  position.value = { x: 0, y: 0 }
}

function zoomIn() {
  scale.value = Math.min(scale.value * 1.5, 5)
}

function zoomOut() {
  scale.value = Math.max(scale.value / 1.5, 0.5)
}

function handleWheel(e: WheelEvent) {
  e.preventDefault()
  if (e.deltaY < 0) {
    zoomIn()
  } else {
    zoomOut()
  }
}

function handleKeydown(e: KeyboardEvent) {
  switch (e.key) {
    case 'Escape':
      close()
      break
    case 'ArrowLeft':
      prev()
      break
    case 'ArrowRight':
      next()
      break
    case '+':
      zoomIn()
      break
    case '-':
      zoomOut()
      break
    case '0':
      resetTransform()
      break
  }
}

function handleMouseDown(e: MouseEvent) {
  if (scale.value > 1) {
    isDragging.value = true
    dragStart.value = {
      x: e.clientX - position.value.x,
      y: e.clientY - position.value.y,
    }
  }
}

function handleMouseMove(e: MouseEvent) {
  if (isDragging.value) {
    position.value = {
      x: e.clientX - dragStart.value.x,
      y: e.clientY - dragStart.value.y,
    }
  }
}

function handleMouseUp() {
  isDragging.value = false
}

function handleTouchStart(e: TouchEvent) {
  if (e.touches.length === 1 && scale.value > 1) {
    isDragging.value = true
    dragStart.value = {
      x: e.touches[0].clientX - position.value.x,
      y: e.touches[0].clientY - position.value.y,
    }
  }
}

function handleTouchMove(e: TouchEvent) {
  if (isDragging.value && e.touches.length === 1) {
    position.value = {
      x: e.touches[0].clientX - dragStart.value.x,
      y: e.touches[0].clientY - dragStart.value.y,
    }
  }
}

function handleTouchEnd() {
  isDragging.value = false
}

function handleDoubleClick() {
  if (scale.value > 1) {
    resetTransform()
  } else {
    scale.value = 2
  }
}

onMounted(() => {
  document.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <v-dialog
    :model-value="true"
    fullscreen
    class="image-preview-overlay"
    persistent
    :no-click-animation="true"
    @update:model-value="close"
  >
    <div class="preview-content" aria-label="图片预览">
      <h2 class="sr-only">通知原文图片预览</h2>
      <!-- 关闭按钮 -->
      <v-btn
        icon
        variant="text"
        color="white"
        class="preview-close"
        aria-label="关闭图片预览"
        @click="close"
      >
        <v-icon>$close</v-icon>
      </v-btn>

      <!-- 计数器 -->
      <v-chip
        v-if="images.length > 1"
        color="white"
        variant="tonal"
        size="small"
        class="preview-counter"
      >
        {{ currentIndex + 1 }} / {{ images.length }}
      </v-chip>

      <!-- 图片容器 -->
      <div
        class="preview-container"
        @wheel="handleWheel"
        @mousedown="handleMouseDown"
        @mousemove="handleMouseMove"
        @mouseup="handleMouseUp"
        @mouseleave="handleMouseUp"
        @touchstart="handleTouchStart"
        @touchmove="handleTouchMove"
        @touchend="handleTouchEnd"
        @dblclick="handleDoubleClick"
      >
        <img
          :src="currentImage"
          :alt="`通知原文图片 ${currentIndex + 1}`"
          :style="{
            transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
            cursor: scale > 1 ? (isDragging ? 'grabbing' : 'grab') : 'zoom-in',
          }"
          class="preview-image"
          draggable="false"
        />
      </div>

      <!-- 导航按钮 -->
      <v-btn
        v-if="currentIndex > 0"
        icon
        size="large"
        color="white"
        variant="tonal"
        class="preview-nav preview-nav--prev"
        aria-label="上一张图片"
        @click="prev"
      >
        <v-icon size="28">$chevronLeft</v-icon>
      </v-btn>
      <v-btn
        v-if="currentIndex < images.length - 1"
        icon
        size="large"
        color="white"
        variant="tonal"
        class="preview-nav preview-nav--next"
        aria-label="下一张图片"
        @click="next"
      >
        <v-icon size="28">$chevronRight</v-icon>
      </v-btn>

      <!-- 工具栏 -->
      <v-btn-toggle divided variant="tonal" color="white" class="preview-toolbar">
        <v-btn icon size="small" aria-label="缩小图片" :disabled="scale <= 0.5" @click="zoomOut">
          <v-icon>$magnifyMinus</v-icon>
        </v-btn>
        <v-btn icon size="small" aria-label="重置图片缩放" @click="resetTransform">
          <v-icon>$magnifyScan</v-icon>
        </v-btn>
        <v-btn icon size="small" aria-label="放大图片" :disabled="scale >= 5" @click="zoomIn">
          <v-icon>$magnifyPlus</v-icon>
        </v-btn>
      </v-btn-toggle>
    </div>
  </v-dialog>
</template>

<style scoped>
.image-preview-overlay :deep(.v-overlay__content) {
  width: 100%;
  height: 100%;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.preview-content {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.preview-close {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 10;
}

.preview-counter {
  position: absolute;
  top: 16px;
  left: 16px;
  z-index: 10;
}

.preview-container {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.preview-image {
  max-width: 90vw;
  max-height: 90vh;
  object-fit: contain;
  transition: transform 0.1s ease;
  user-select: none;
}

.preview-nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  z-index: 10;
}

.preview-nav--prev {
  left: 16px;
}

.preview-nav--next {
  right: 16px;
}

.preview-toolbar {
  position: absolute;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 10;
}
</style>
