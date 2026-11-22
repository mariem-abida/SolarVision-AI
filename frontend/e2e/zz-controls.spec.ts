import { test, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { localE2EEnvironment } from "./support/environment";

const config = localE2EEnvironment();
const evidence = resolve(config.artifacts, "browser");
const { api, panelImage: panelFile } = config;
const routes = [
  ["/", "Overview"],
  ["/inspection", "AI Inspection"],
  ["/history", "Inspection History"],
  ["/models", "Model Performance"],
  ["/datasets", "Dataset Explorer"],
  ["/mlops", "MLOps Center"],
  ["/monitoring", "System Monitoring"],
  ["/settings", "Settings"],
] as const;

test("existing overview, settings, upload and monitoring controls use real data", async ({
  page,
  request,
}) => {
  test.setTimeout(120000);
  await mkdir(evidence, { recursive: true });
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  expect((await request.get(`${api}/ready`)).status()).toBe(200);
  let history = await (await request.get(`${api}/inspections?limit=500`)).json();
  if (!history.total) {
    const seeded = await request.post(`${api}/predict/panels`, {
      multipart: {
        file: {
          name: "controls-seed.jpg",
          mimeType: "image/jpeg",
          buffer: await readFile(panelFile),
        },
      },
    });
    expect(seeded.status()).toBe(200);
    history = await (await request.get(`${api}/inspections?limit=500`)).json();
  }
  const { records, total } = history;
  await page.goto("/");
  const metric = (title: string) =>
    page
      .locator(".metric-card")
      .filter({ has: page.getByText(title, { exact: true }) })
      .locator("strong");
  await expect(metric("Total Inspections")).toHaveText(String(total));
  for (const [title, mode] of [
    ["Panels Detected", "panels"],
    ["Defects Detected", "defects"],
  ]) {
    const expected = records
      .filter((record: { mode: string }) => record.mode === mode)
      .reduce((sum: number, record: { result: { count: number } }) => sum + record.result.count, 0);
    expect(Number((await metric(title!).innerText()).replace(/[^0-9]/g, ""))).toBe(expected);
  }
  const times = records.map(
    (record: { result: { inference_ms: number } }) => record.result.inference_ms,
  );
  expect(Number((await metric("Avg. Inference Time").innerText()).replace(/[^0-9.]/g, ""))).toBe(
    Number((times.reduce((a: number, b: number) => a + b, 0) / times.length).toFixed(1)),
  );
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
  await page.getByRole("button", { name: "Expand sidebar" }).click();
  for (const [, title] of routes) {
    await page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: title, exact: true })
      .click();
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  }
  await page.getByRole("link", { name: "SolarVision AI home", exact: true }).click();
  await page.getByRole("link", { name: "Model evaluation", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Model Performance", exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: `View ${records[0].filename}`, exact: true })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toContainText(records[0].id);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("link", { name: "View all", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Inspection History", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  await page.getByRole("link", { name: "Model performance", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Model Performance", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  await page.getByRole("link", { name: "Start New Inspection", exact: true }).click();
  const upload = page.getByLabel("Upload inspection image", { exact: true });
  await upload.setInputFiles({
    name: "real-panel.jpeg",
    mimeType: "image/jpeg",
    buffer: await readFile(panelFile),
  });
  await expect(
    page.getByRole("img", { name: "Original inspection image", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Analyze another image", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Choose inspection image", exact: true }),
  ).toBeVisible();
  await upload.setInputFiles(config.tiffImage);
  await expect(
    page.getByRole("heading", { name: "TIFF preview unavailable", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Run Analysis", exact: true }).nth(0),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Remove image", exact: true }).click();
  await upload.setInputFiles({
    name: "unsupported.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("not an image"),
  });
  await expect(page.getByRole("alert")).toContainText("Choose a JPG");
  await upload.setInputFiles(config.oversizedImage);
  await expect(page.getByRole("alert")).toContainText("20 MB limit");
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  for (const [mode, title] of [
    ["defects", "Defect Detection"],
    ["classify", "Thermal Classification"],
    ["panels", "Solar Panel Detection"],
  ]) {
    await page.getByRole("combobox", { name: "Preferred analysis mode" }).selectOption(mode!);
    await page.getByRole("link", { name: "AI Inspection", exact: true }).click();
    await expect(page.locator(".mode-card.preferred").getByRole("heading")).toHaveText(title!);
    await page.getByRole("link", { name: "Settings", exact: true }).click();
  }
  await page.getByRole("slider").press("ArrowRight");
  await page.reload();
  await expect(page.getByRole("slider")).toHaveValue("0.51");
  await page.getByRole("slider").press("ArrowLeft");
  await page.getByRole("button", { name: "Clear browser cache", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Confirm clear cache", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export history", exact: true }).click();
  const path = resolve(evidence, "settings-history-export.json");
  await (await download).saveAs(path);
  expect(
    JSON.parse(await readFile(path, "utf8"))
      .map((record: { id: string }) => record.id)
      .sort(),
  ).toEqual(records.map((record: { id: string }) => record.id).sort());
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  await page.getByRole("link", { name: "View monitoring", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Request telemetry", exact: true })).toBeVisible();
  const first = Number(await metric("Total Requests").innerText());
  await page.getByRole("button", { name: "Refresh monitoring", exact: true }).click();
  await expect
    .poll(async () => Number(await metric("Total Requests").innerText()))
    .toBeGreaterThan(first);
  const refreshed = Number(await metric("Total Requests").innerText());
  await expect
    .poll(async () => Number(await metric("Total Requests").innerText()), { timeout: 25000 })
    .toBeGreaterThan(refreshed);
  await page.screenshot({ path: resolve(evidence, "monitoring-refreshed.png"), fullPage: true });
  await writeFile(
    resolve(evidence, "overview-settings-monitoring.json"),
    JSON.stringify(
      {
        total,
        times,
        manualRequests: [first, refreshed],
        automaticPolling: true,
        destructiveConfirmationNotExecuted: true,
        pageErrors,
      },
      null,
      2,
    ),
  );
  expect(pageErrors).toEqual([]);
});
