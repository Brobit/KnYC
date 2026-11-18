<script setup lang="ts">
import { ref } from "vue";

const emit = defineEmits<{ add: [title: string] }>();
const title = ref("");

function submit() {
  if (!title.value.trim()) return;
  emit("add", title.value);
  title.value = "";
}
</script>

<template>
  <form @submit.prevent="submit">
    <label>Title <input v-model="title" /></label>
    <button type="submit" :disabled="!title.trim()">Add</button>
  </form>
</template>
