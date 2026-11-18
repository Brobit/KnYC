<script setup lang="ts">
import { computed, ref } from "vue";
import NoteForm from "../components/NoteForm.vue";
import NoteList from "../components/NoteList.vue";
import SearchBox from "../components/SearchBox.vue";
import { countLabel, visibleNotes } from "../lib/notes";
import { useNotesStore } from "../stores/notes";

const store = useNotesStore();
const query = ref("");
const shown = computed(() => visibleNotes(store.notes, query.value));
</script>

<template>
  <NoteForm @add="store.add" />
  <SearchBox v-model="query" />
  <NoteList :notes="shown" @toggle-pin="store.togglePin" @remove="store.remove" />
  <footer>{{ countLabel(store.notes.length) }}</footer>
</template>
