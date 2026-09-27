const { defineConfig } = require("@playwright/test");
module.exports = defineConfig({
  testDir: "./tests",
  testMatch: "browser.spec.js",
  workers: 1,
  timeout: 90000,
  use: { baseURL: "http://localhost:4182", headless: true },
  webServer: {
    command: "node server.js",
    url: "http://localhost:4182",
    reuseExistingServer: false,
    env: {
      PORT: "4182",
      DATA_DIR: require("path").join(__dirname, ".browser-test-data"),
      ALLOW_SETUP: "true",
      NODE_ENV: "test",
      DATABASE_URL: "",
      SUPABASE_URL: "",
      SUPABASE_SERVICE_KEY: "",
      RENDER: "",
      INITIAL_ADMIN_EMAIL: "",
      INITIAL_ADMIN_PASSWORD: "",
      SITE_ADMIN_EMAIL: "browser@example.test",
    },
  },
  reporter: "list",
});
