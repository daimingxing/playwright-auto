<template>
  <main class="app-shell">
    <header class="app-header">
      <h1>Playwright 自动化测试平台</h1>
    </header>
    <div class="app-main">
      <router-view />
    </div>
  </main>
</template>

<style scoped>
:global(html),
:global(body),
:global(#app) {
  height: 100%;
  margin: 0;
  overflow: hidden;
}

.app-shell {
  display: flex;
  flex-direction: column;
  height: 100dvh;
  min-height: 100vh;
  background: #f6f7fb;
  color: #1f2937;
  overflow: hidden;
}

.app-header {
  flex: 0 0 auto;
  padding: 20px 28px;
  background: #ffffff;
  border-bottom: 1px solid #e5e7eb;
}

.app-header h1 {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
}

.app-main {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
</style>
