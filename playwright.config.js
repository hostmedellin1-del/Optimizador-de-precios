/* Bloqueante 8 (revision externa): E2E automatizado en CI — el checklist
   manual (RUNBOOK.md) ya no es suficiente para una regresion financiera/XSS.
   `webServer` levanta el mismo servidor estatico que se documenta para
   desarrollo local (python3 -m http.server) — esto NO es un build step, sigue
   siendo el sitio estatico de siempre, Playwright solo lo sirve para poder
   automatizar un navegador real contra el. */
export default {
  testDir: './e2e',
  timeout: 30000,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'list' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:8791',
    trace: 'retain-on-failure',
    headless: true
  },
  webServer: {
    command: 'python3 -m http.server 8791',
    url: 'http://127.0.0.1:8791/index.html',
    reuseExistingServer: !process.env.CI,
    timeout: 20000
  }
};
