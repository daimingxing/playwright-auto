import { createRouter, createWebHistory } from 'vue-router';
import ProjectList from '../pages/ProjectList.vue';
import ProjectDetail from '../pages/ProjectDetail.vue';
import CaseEditor from '../pages/CaseEditor.vue';
import RunCenter from '../pages/RunCenter.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: ProjectList },
    { path: '/projects/:projectKey', component: ProjectDetail },
    { path: '/projects/:projectKey/cases/:caseKey', component: CaseEditor },
    { path: '/projects/:projectKey/runs', component: RunCenter }
  ]
});
