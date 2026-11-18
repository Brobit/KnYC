<script setup lang="ts">
import { RouterLink } from "vue-router";
import type { Note } from "../types";

defineProps<{ note: Note }>();
const emit = defineEmits<{ togglePin: [id: number]; remove: [id: number] }>();
</script>

<template>
  <li :class="{ pinned: note.pinned }">
    <RouterLink :to="`/notes/${note.id}`">{{ note.title }}</RouterLink>
    <span v-if="note.pinned" aria-label="Pinned"> 📌</span>
    <button type="button" @click="emit('togglePin', note.id)">{{ note.pinned ? "Unpin" : "Pin" }}</button>
    <button type="button" :aria-label="`Delete ${note.title}`" @click="emit('remove', note.id)">Delete</button>
  </li>
</template>
