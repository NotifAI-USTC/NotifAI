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
    icon?: string
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
