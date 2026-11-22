import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { localE2EEnvironment } from "./e2e/support/environment";

const { artifacts, baseURL } = localE2EEnvironment();
const edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const executablePath =
  process.env["SOLARVISION_E2E_EXECUTABLE_PATH"] ||
  (process.platform === "win32" && existsSync(edge) ? edge : undefined);

export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  fullyParallel: false,
  maxFailures: 1,
  retries: 0,
  globalSetup: "./e2e/support/preflight.ts",
  timeout: 90000,
  expect: { timeout: 15000 },
  outputDir: resolve(artifacts, "playwright-results"),
  reporter: [["list"], ["json", { outputFile: resolve(artifacts, "playwright.json") }]],
  use: {
    baseURL,
    headless: true,
    launchOptions: executablePath ? { executablePath } : {},
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    actionTimeout: 15000,
  },
});
