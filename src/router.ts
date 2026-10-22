import { createRouter, createWebHashHistory } from "vue-router";
import BoardEditorView from "@/views/BoardEditorView.vue";

export default createRouter({
    history: createWebHashHistory(),
    routes: [{ path: "/", name: "board", component: BoardEditorView }],
});
