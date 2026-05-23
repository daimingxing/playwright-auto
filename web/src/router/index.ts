import { createRouter, createWebHistory } from 'vue-router';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: () => import('../pages/ProjectList.vue') },
    { path: '/projects/:projectKey', component: () => import('../pages/ProjectDetail.vue') },
    { path: '/projects/:projectKey/cases/:caseKey', component: () => import('../pages/CaseEditor.vue') },
    { path: '/projects/:projectKey/runs', component: () => import('../pages/RunCenter.vue') }
  ]
});
