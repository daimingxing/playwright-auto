<template>
  <main class="app-shell">
    <header class="app-header">
      <h1>Playwright 自动化测试平台</h1>
    </header>
    <router-view />
  </main>
</template>

<style scoped>
.app-shell {
  min-height: 100vh;
  background: #f6f7fb;
  color: #1f2937;
}

.app-header {
  padding: 20px 28px;
  background: #ffffff;
  border-bottom: 1px solid #e5e7eb;
}

.app-header h1 {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
}
</style>
