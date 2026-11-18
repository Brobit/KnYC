<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";
import { useNotesStore } from "../stores/notes";

const props = defineProps<{ id: string }>();
const store = useNotesStore();
const note = computed(() => store.byId(Number(props.id)));
</script>

<template>
  <article v-if="note">
    <h2>{{ note.title }}</h2>
    <p>{{ note.body || "No details." }}</p>
    <p v-if="note.pinned">Pinned</p>
  </article>
  <p v-else role="alert">No such note.</p>
  <RouterLink to="/">All notes</RouterLink>
</template>
