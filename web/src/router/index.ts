import { createRouter, createWebHistory } from 'vue-router';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: () => import('../pages/project-list/ProjectList.vue') },
    { path: '/projects/:projectKey', component: () => import('../pages/project-detail/ProjectDetail.vue') },
    { path: '/projects/:projectKey/imports', component: () => import('../pages/ai-import/AiImportList.vue') },
    { path: '/projects/:projectKey/imports/:importId', component: () => import('../pages/ai-import/AiImportPreview.vue') },
    { path: '/projects/:projectKey/cases/:caseKey', component: () => import('../pages/case-editor/CaseEditor.vue') },
    { path: '/projects/:projectKey/runs', component: () => import('../pages/run-center/RunCenter.vue') }
  ]
});
