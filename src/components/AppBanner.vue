<script setup lang="ts">
import { useAttrs } from 'vue'

defineOptions({ inheritAttrs: false })

type BannerType = 'success' | 'info' | 'warning' | 'error'
type BannerVariant = 'flat' | 'text' | 'elevated' | 'tonal' | 'outlined' | 'plain'
type BannerDensity = 'default' | 'comfortable' | 'compact'

const props = withDefaults(
  defineProps<{
    type?: BannerType
    variant?: BannerVariant
    density?: BannerDensity
    /** false 时隐藏 Vuetify 按 type 自动添加的图标 */
    icon?: string | false
  }>(),
  {
    type: 'info',
    variant: 'tonal',
    density: 'compact',
    icon: undefined,
  },
)

const attrs = useAttrs()
</script>

<template>
  <v-alert
    v-bind="attrs"
    class="app-banner"
    :type="props.type"
    :variant="props.variant"
    :density="props.density"
    :icon="props.icon"
  >
    <template v-if="$slots.prepend" #prepend>
      <slot name="prepend" />
    </template>
    <slot />
    <template v-if="$slots.append" #append>
      <slot name="append" />
    </template>
  </v-alert>
</template>

<style scoped>
@layer notifai-components {
  .app-banner {
    flex: 0 0 auto;
    min-width: 0;
    min-height: 0;
    grid-template-areas: 'prepend content append close';
    grid-template-columns: max-content minmax(0, 1fr) max-content max-content;
    grid-template-rows: auto;
  }

  .app-banner :deep(.v-alert__content) {
    min-width: 0;
    overflow-wrap: anywhere;
  }
}
</style>
