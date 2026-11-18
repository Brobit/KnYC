<script setup lang="ts">
const query = defineModel<string>({ required: true });
</script>

<template>
  <input v-model="query" type="search" aria-label="Search notes" placeholder="Search" />
</template>
