<script setup lang="ts">
import type { Note } from "../types";
import NoteItem from "./NoteItem.vue";

defineProps<{ notes: Note[] }>();
const emit = defineEmits<{ togglePin: [id: number]; remove: [id: number] }>();
</script>

<template>
  <p v-if="notes.length === 0">No notes yet.</p>
  <ul v-else aria-label="Notes">
    <NoteItem v-for="note in notes" :key="note.id" :note="note" @toggle-pin="emit('togglePin', $event)" @remove="emit('remove', $event)" />
  </ul>
</template>
