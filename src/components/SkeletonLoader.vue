<script setup lang="ts">
defineProps<{
  type?: 'card' | 'detail'
}>()
</script>

<template>
  <div class="skeleton-wrapper">
    <!-- 卡片骨架屏 -->
    <template v-if="type === 'card'">
      <v-card v-for="i in 5" :key="i" class="mb-3" rounded="lg">
        <v-skeleton-loader type="card" :loading="true" />
      </v-card>
    </template>

    <!-- 详情页骨架屏 -->
    <template v-else>
      <v-container>
        <v-row justify="center">
          <v-col cols="12" md="8" lg="6">
            <v-card class="mb-4" rounded="lg">
              <v-skeleton-loader type="image, article" :loading="true" />
            </v-card>
            <v-card rounded="lg">
              <v-skeleton-loader type="article, article" :loading="true" />
            </v-card>
          </v-col>
        </v-row>
      </v-container>
    </template>
  </div>
</template>

<style scoped>
.skeleton-wrapper {
  padding: 16px;
}
</style>
