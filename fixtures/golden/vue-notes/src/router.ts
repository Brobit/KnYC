import { createRouter, createWebHistory } from "vue-router";
import NotePage from "./pages/NotePage.vue";
import NotesPage from "./pages/NotesPage.vue";

/** "/": every note; "/notes/:id": one note (its id comes in as a prop). */
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", component: NotesPage },
    { path: "/notes/:id", component: NotePage, props: true },
  ],
});
