import { test, expect, type Page } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { localE2EEnvironment } from "./support/environment";

const config = localE2EEnvironment();
const evidence = resolve(config.artifacts, "browser");
const { api, otherApi, legacyApi } = config;

const images = [
  {
    mode: "panels",
    index: 0,
    file: config.panelImage,
  },
  {
    mode: "defects",
    index: 1,
    file: config.defectImage,
  },
  {
    mode: "classify",
    index: 2,
    file: config.classifyImage,
  },
];
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
const browserEvents = new Map<
  Page,
  { console: unknown[]; pageErrors: string[]; responses: unknown[]; failedRequests: unknown[] }
>();

test.beforeEach(async ({ page }) => {
  const events = {
    console: [] as unknown[],
    pageErrors: [] as string[],
    responses: [] as unknown[],
    failedRequests: [] as unknown[],
  };
  browserEvents.set(page, events);
  page.on("console", (entry) => {
    if (["error", "warning"].includes(entry.type()))
      events.console.push({ level: entry.type(), message: entry.text() });
  });
  page.on("pageerror", (error) => events.pageErrors.push(error.message));
  page.on("response", (response) => {
    if ([api, otherApi].some((base) => response.url().startsWith(base)))
      events.responses.push({
        url: response.url(),
        method: response.request().method(),
        status: response.status(),
      });
  });
  page.on("requestfailed", (request) =>
    events.failedRequests.push({ url: request.url(), failure: request.failure() }),
  );
});

test.afterEach(async ({ page }, info) => {
  await mkdir(evidence, { recursive: true });
  const events = browserEvents.get(page)!;
  await writeFile(
    resolve(evidence, `events-${info.title.replace(/[^a-z0-9]+/gi, "-").slice(0, 110)}.json`),
    JSON.stringify(events, null, 2),
  );
  expect(events.pageErrors, "No unhandled browser JavaScript errors").toEqual([]);
  browserEvents.delete(page);
});

async function chooseApi(page: Page, value: string) {
  await page.goto("/settings");
  await page.getByRole("textbox", { name: "API Base URL" }).fill(value);
  await page.getByRole("button", { name: "Save connection", exact: true }).click();
  await expect(
    page.getByText(`Saved workspace connection: ${value}`, { exact: false }),
  ).toBeVisible();
}

test.beforeAll(async ({ request }) => {
  await mkdir(evidence, { recursive: true });
  const ready = await request.get(`${api}/ready`);
  expect(ready.status()).toBe(200);
  const other = await request.get(`${otherApi}/ready`);
  expect(other.status()).toBe(503);
});

test("keyboard file chooser, drag-and-drop and invalid uploads", async ({ page }) => {
  await page.goto("/inspection");
  const fileChooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose inspection image", exact: true }).press("Enter");
  await (await fileChooser).setFiles(images[0]!.file);
  await expect(
    page.getByRole("img", { name: "Original inspection image", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Remove image", exact: true }).click();
  const bytes = await readFile(images[0]!.file);
  const transfer = await page.evaluateHandle(
    ({ data }) => {
      const result = new DataTransfer();
      result.items.add(
        new File([new Uint8Array(data)], "audit-dropped.jpg", { type: "image/jpeg" }),
      );
      return result;
    },
    { data: [...bytes] },
  );
  await page
    .getByRole("button", { name: "Choose inspection image", exact: true })
    .dispatchEvent("drop", { dataTransfer: transfer });
  await expect(page.getByText("audit-dropped.jpg", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Remove image", exact: true }).click();
  await page
    .getByLabel("Upload inspection image", { exact: true })
    .setInputFiles({ name: "empty.png", mimeType: "image/png", buffer: Buffer.alloc(0) });
  await expect(page.getByRole("alert")).toContainText("This image is empty");
  await page.getByLabel("Upload inspection image", { exact: true }).setInputFiles({
    name: "broken.png",
    mimeType: "image/png",
    buffer: Buffer.from("not an image"),
  });
  await expect(page.getByRole("alert")).toContainText(/could not|cannot|invalid|decode/i);
});

test("runtime defaults, connection testing and saved preferences survive reload", async ({
  page,
}) => {
  await page.goto("/settings");
  const url = page.getByRole("textbox", { name: "API Base URL" });
  await expect(url).toHaveValue(api);
  await page.getByRole("button", { name: "Test connection", exact: true }).click();
  await expect(page.getByText(/Connected\. API healthy; models loaded/)).toBeVisible();
  await url.fill("not-a-url");
  await page.getByRole("button", { name: "Save connection", exact: true }).click();
  await expect(page.getByText(/Enter a valid HTTP or HTTPS/)).toBeVisible();
  await expect(
    page.getByText(`Saved workspace connection: ${api}`, { exact: false }),
  ).toBeVisible();
  await url.fill(otherApi);
  await page.getByRole("button", { name: "Test connection", exact: true }).click();
  await expect(page.getByText(`Tested URL: ${otherApi}`, { exact: false })).toBeVisible();
  await expect(
    page.getByText(`Saved workspace connection: ${api}`, { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save connection", exact: true }).click();
  await page.reload();
  await expect(url).toHaveValue(otherApi);
  await url.fill(api);
  await page.getByRole("button", { name: "Save connection", exact: true }).click();
  await page.reload();
  await expect(url).toHaveValue(api);
  await page.screenshot({ path: resolve(evidence, "settings-runtime.png"), fullPage: true });
});

test("unavailable inference reports HTTP503 and Retry without saving an inspection", async ({
  page,
  request,
}) => {
  await chooseApi(page, otherApi);
  await page.getByRole("link", { name: "AI Inspection", exact: true }).click();
  await page.getByLabel("Upload inspection image", { exact: true }).setInputFiles(images[0]!.file);
  let response = page.waitForResponse(
    (entry) => entry.url() === `${otherApi}/predict/panels` && entry.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Run Analysis", exact: true }).nth(0).click();
  expect((await response).status()).toBe(503);
  await expect(page.getByRole("alert")).toContainText("Models unavailable");
  response = page.waitForResponse(
    (entry) => entry.url() === `${otherApi}/predict/panels` && entry.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  expect((await response).status()).toBe(503);
  await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
  expect((await (await request.get(`${otherApi}/inspections?limit=500`)).json()).total).toBe(0);
});

for (const image of images) {
  test(`real ${image.mode} inference, persistence and JSON${image.mode === "classify" ? " truth label" : "/PNG/toggle"}`, async ({
    page,
    request,
  }) => {
    await page.goto("/inspection");
    await expect(page.getByText("Backend online", { exact: true })).toBeVisible();
    const buttons = page.getByRole("button", { name: "Run Analysis", exact: true });
    await expect(buttons.nth(image.index)).toBeDisabled();
    await page.getByLabel("Upload inspection image", { exact: true }).setInputFiles(image.file);
    if (image.mode === "classify") {
      await expect(buttons.nth(2)).toBeDisabled();
      await page.getByRole("checkbox").check();
    }
    const predictionResponse = page.waitForResponse(
      (r) => r.url() === `${api}/predict/${image.mode}` && r.request().method() === "POST",
      { timeout: 60000 },
    );
    let submissions = 0;
    page.on("request", (request) => {
      if (request.url() === `${api}/predict/${image.mode}` && request.method() === "POST")
        submissions += 1;
    });
    await buttons.nth(image.index).dblclick();
    const response = await predictionResponse;
    expect(response.status()).toBe(200);
    const prediction = await response.json();
    expect(submissions).toBe(1);
    await expect(page.getByRole("heading", { name: "Inspection results Completed" })).toBeVisible();
    const jsonDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "JSON report", exact: true }).click();
    const jsonPath = resolve(evidence, `${image.mode}-report.json`);
    await (await jsonDownload).saveAs(jsonPath);
    const record = JSON.parse(await readFile(jsonPath, "utf8"));
    expect(record.id).toBe(prediction.inspection_id);
    expect(record.duration).toBe(prediction.inference_ms);
    expect(record.request_duration_ms).toBe(prediction.request_duration_ms);
    expect(record.client_duration_ms).toBeGreaterThanOrEqual(prediction.request_duration_ms - 5);
    const history = await (await request.get(`${api}/inspections?limit=500`)).json();
    const stored = history.records.find((entry: { id: string }) => entry.id === record.id);
    expect(stored.result).toEqual(prediction);
    expect(stored.duration).toBe(record.duration);
    expect(stored.request_duration_ms).toBe(record.request_duration_ms);
    if (image.mode === "classify") {
      expect(prediction.predicted_class).toBe("0");
      await expect(page.getByRole("heading", { name: "Bottom Dirt", exact: true })).toBeVisible();
      for (const bar of await page.getByRole("progressbar").all())
        await expect(bar).toHaveAccessibleName(/\S/);
    } else {
      expect(prediction.count).toBeGreaterThan(0);
      const canvas = page.getByLabel("Annotated inspection image", { exact: true });
      await expect(canvas).toBeVisible();
      await expect
        .poll(() => canvas.evaluate((element) => (element as HTMLCanvasElement).width))
        .toBe(prediction.image_width);
      await page.getByRole("button", { name: "Original", exact: true }).click();
      await expect(canvas).toBeHidden();
      await expect(
        page.getByRole("img", { name: "Original result image", exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Annotated", exact: true }).click();
      await expect(canvas).toBeVisible();
      await expect(
        page.getByRole("img", { name: "Original result image", exact: true }),
      ).toHaveCount(0);
      const pngDownload = page.waitForEvent("download");
      await page.getByRole("button", { name: "Download image", exact: true }).click();
      await (await pngDownload).saveAs(resolve(evidence, `${image.mode}-annotated.png`));
      const threshold = page.getByRole("slider");
      await threshold.press("End");
      await expect(page.getByText("0 visible at current threshold", { exact: true })).toBeVisible();
      await threshold.press("Home");
    }
    await page.screenshot({ path: resolve(evidence, `${image.mode}-result.png`), fullPage: true });
    await page.getByRole("link", { name: "Inspection History", exact: true }).click();
    await page.getByRole("textbox", { name: "Search inspections" }).fill(record.id);
    await expect(page.getByText("1 of", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: `View ${record.filename}`, exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText(record.id);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.reload();
    await page.getByRole("textbox", { name: "Search inspections" }).fill(record.id);
    await expect(
      page.getByRole("button", { name: `View ${record.filename}`, exact: true }),
    ).toBeVisible();
  });
}

test("source image above1600px stays original and export preserves its size", async ({
  page,
  request,
}) => {
  await page.goto("/inspection");
  await page
    .getByLabel("Upload inspection image", { exact: true })
    .setInputFiles(config.highresImage);
  await expect(page.getByText(/3000 × 2400 px/)).toBeVisible();
  const responsePromise = page.waitForResponse(
    (r) => r.url() === `${api}/predict/panels` && r.request().method() === "POST",
    { timeout: 60000 },
  );
  await page.getByRole("button", { name: "Run Analysis", exact: true }).nth(0).click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  const prediction = await response.json();
  await expect(page.getByRole("heading", { name: "Inspection results Completed" })).toBeVisible();
  await expect(page.getByText(/3000 × 2400 px/)).toBeVisible();
  const canvas = page.getByLabel("Annotated inspection image", { exact: true });
  await expect
    .poll(() => canvas.evaluate((element) => (element as HTMLCanvasElement).width))
    .toBe(3000);
  expect(await canvas.evaluate((element) => (element as HTMLCanvasElement).height)).toBe(2400);
  await page.getByRole("button", { name: "Original", exact: true }).click();
  const original = page.getByRole("img", { name: "Original result image", exact: true });
  await expect(original).toHaveAttribute("src", /^blob:/);
  expect(await original.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBe(
    3000,
  );
  await expect(canvas).toBeHidden();
  await page.getByRole("button", { name: "Annotated", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download image", exact: true }).click();
  await (await download).saveAs(resolve(evidence, "highres-annotated.png"));
  const preview = await request.get(`${api}/inspections/${prediction.inspection_id}/image`);
  await writeFile(resolve(evidence, "highres-server-preview.png"), await preview.body());
  await writeFile(
    resolve(evidence, "highres-prediction.json"),
    JSON.stringify(prediction, null, 2),
  );
  await page.screenshot({
    path: resolve(evidence, "highres-original-preserved.png"),
    fullPage: true,
  });
});

test("switching two disposable SQLite APIs does not copy histories implicitly", async ({
  page,
  request,
}) => {
  await chooseApi(page, api);
  const beforeA = await (await request.get(`${api}/inspections?limit=500`)).json();
  const beforeB = await (await request.get(`${otherApi}/inspections?limit=500`)).json();
  expect(beforeA.total).toBeGreaterThan(0);
  expect(beforeB.total).toBe(0);
  await page.getByRole("link", { name: "Inspection History", exact: true }).click();
  await expect(
    page.getByText(`${beforeA.total} of ${beforeA.total} inspections`, { exact: true }),
  ).toBeVisible();
  for (const mode of ["panels", "defects", "classify"]) {
    await page.getByRole("combobox", { name: "Filter analysis type" }).selectOption(mode);
    const count = beforeA.records.filter((entry: { mode: string }) => entry.mode === mode).length;
    await expect(
      page.getByText(`${count} of ${beforeA.total} inspections`, { exact: true }),
    ).toBeVisible();
    if (mode === "classify") {
      const filteredDownload = page.waitForEvent("download");
      await page.getByRole("button", { name: "Export filtered results", exact: true }).click();
      const filteredPath = resolve(evidence, "history-filtered-export.json");
      await (await filteredDownload).saveAs(filteredPath);
      const filtered = JSON.parse(await readFile(filteredPath, "utf8"));
      expect(filtered).toHaveLength(count);
      expect(filtered.every((entry: { mode: string }) => entry.mode === mode)).toBe(true);
    }
  }
  await page.getByRole("combobox", { name: "Filter analysis type" }).selectOption("all");
  for (const order of ["oldest", "name", "newest"]) {
    await page.getByRole("combobox", { name: "Sort inspections" }).selectOption(order);
    const sorted = [...beforeA.records].sort(
      (a: { filename: string; date: string }, b: { filename: string; date: string }) =>
        order === "name"
          ? a.filename.localeCompare(b.filename)
          : order === "oldest"
            ? a.date.localeCompare(b.date)
            : b.date.localeCompare(a.date),
    );
    await expect(page.locator("main table tbody tr").first().locator("td").first()).toHaveText(
      sorted[0].filename,
    );
  }
  const exportDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export history", exact: true }).click();
  const exportPath = resolve(evidence, "history-export.json");
  await (await exportDownload).saveAs(exportPath);
  const exported = JSON.parse(await readFile(exportPath, "utf8"));
  expect(exported.map((entry: { id: string }) => entry.id).sort()).toEqual(
    beforeA.records.map((entry: { id: string }) => entry.id).sort(),
  );
  await chooseApi(page, otherApi);
  await page.getByRole("link", { name: "Inspection History", exact: true }).click();
  await expect(page.getByText("0 of 0 inspections", { exact: true })).toBeVisible();
  await page.reload();
  const afterB = await (await request.get(`${otherApi}/inspections?limit=500`)).json();
  expect(afterB).toEqual(beforeB);
  await chooseApi(page, api);
  await page.getByRole("link", { name: "Inspection History", exact: true }).click();
  await expect(
    page.getByText(`${beforeA.total} of ${beforeA.total} inspections`, { exact: true }),
  ).toBeVisible();
  expect(await (await request.get(`${api}/inspections?limit=500`)).json()).toEqual(beforeA);
  await writeFile(
    resolve(evidence, "history-isolation.json"),
    JSON.stringify({ beforeA, beforeB, afterB }, null, 2),
  );
});

test("metadata, navigation and layout on all8pages in both themes and3sizes", async ({ page }) => {
  test.setTimeout(180000);
  const measurements = [];
  for (const theme of ["dark", "light"]) {
    await page.goto("/settings");
    await page
      .getByRole("button", { name: theme === "dark" ? "Dark" : "Light", exact: true })
      .click();
    for (const width of [1280, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const [path, title] of routes) {
        await page.goto(path);
        await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
        const nav = page.getByRole("navigation", { name: "Main navigation" });
        for (const [, name] of routes)
          await expect(nav.getByRole("link", { name, exact: true })).toHaveAccessibleName(name);
        await expect(nav.getByRole("link", { name: title, exact: true })).toHaveAttribute(
          "aria-current",
          "page",
        );
        if (path === "/models") {
          await expect(page.getByText("90.70%", { exact: true })).toBeVisible();
          for (const value of [
            "85.02%",
            "86.76%",
            "80.71%",
            "99.47%",
            "87.75%",
            "58.75%",
            "36.99%",
          ]) {
            await expect(page.locator("main")).toContainText(value);
          }
          for (const bar of await page.getByRole("progressbar").all())
            await expect(bar).toHaveAccessibleName(/\S/);
        }
        if (path === "/mlops") {
          await expect(
            page.getByRole("cell", { name: "SolarVision-ResNet18-PVF10", exact: true }),
          ).toBeVisible();
          await expect(page.getByText(/Remote access: not checked/)).toBeVisible();
          await expect(page.getByText("Snapshot provenance", { exact: true })).toBeVisible();
          for (const model of [
            "SolarVision-ResNet18-PVF10",
            "SolarVision-ViT-Tiny-PVF10",
            "SolarVision-YOLO11n-Panel-Detection",
            "SolarVision-YOLO11n-Defect-Detection",
          ]) {
            await expect(page.getByRole("cell", { name: model, exact: true })).toBeVisible();
          }
          for (const name of [
            "panel_detection_full",
            "panel_detection_pilot",
            "defect_detection_full-2",
            "defect_detection_full",
            "defect_detection_pilot",
          ]) {
            await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
          }
        }
        if (path === "/datasets") {
          for (const name of [
            "Panel Detection",
            "Defect Detection",
            "PVF-10",
            "Infrared Solar Modules",
            "External Validation",
            "RGB / Thermal",
            "Thermal JSON Samples",
          ]) {
            await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
          }
        }
        const layout = await page.evaluate(() => ({
          width: innerWidth,
          client: document.documentElement.clientWidth,
          scroll: document.documentElement.scrollWidth,
        }));
        expect(layout.scroll, `${theme} ${width}px ${path}`).toBeLessThanOrEqual(layout.client);
        measurements.push({ theme, path, ...layout });
        if (["/mlops", "/models", "/settings"].includes(path))
          await page.screenshot({
            path: resolve(evidence, `${theme}-${width}-${title.replaceAll(" ", "-")}.png`),
            fullPage: true,
          });
      }
    }
  }
  await writeFile(
    resolve(evidence, "responsive-layouts.json"),
    JSON.stringify(measurements, null, 2),
  );
});

test("legacy cache is preserved and imported only by explicit action", async ({
  page,
  request,
}) => {
  const { records } = await (await request.get(`${api}/inspections?limit=1`)).json();
  const original = records[0];
  expect(original).toBeTruthy();
  const id = `legacy-explicit-${Date.now()}`;
  const legacy = {
    ...original,
    id,
    has_image: false,
    result: { ...original.result, inspection_id: id },
  };
  const serialized = JSON.stringify([legacy]);
  await page.addInitScript(
    ({ value, url }) => {
      localStorage.setItem("solarvision-history", value);
      localStorage.setItem(
        "solarvision-preferences",
        JSON.stringify({ apiUrl: url, theme: "dark", mode: "panels", threshold: 0.5 }),
      );
    },
    { value: serialized, url: legacyApi },
  );
  const before = await (await request.get(`${legacyApi}/inspections?limit=500`)).json();
  await page.goto("/settings");
  await expect(page.getByText(/1 legacy browser records are preserved separately/)).toBeVisible();
  expect((await (await request.get(`${legacyApi}/inspections?limit=500`)).json()).total).toBe(
    before.total,
  );
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export legacy records", exact: true }).click();
  const path = resolve(evidence, "legacy-export.json");
  await (await download).saveAs(path);
  expect(JSON.parse(await readFile(path, "utf8"))).toEqual([legacy]);
  await page
    .getByRole("button", { name: "Import legacy records into this API", exact: true })
    .click();
  await expect(page.getByText(/Legacy records imported into/)).toBeVisible();
  const after = await (await request.get(`${legacyApi}/inspections?limit=500`)).json();
  expect(after.total).toBe(before.total + 1);
  expect(after.records.find((entry: { id: string }) => entry.id === id)).toEqual(legacy);
  expect(await page.evaluate(() => localStorage.getItem("solarvision-history"))).toBe(serialized);
  await writeFile(
    resolve(evidence, "legacy-explicit-import.json"),
    JSON.stringify({ id, before: before.total, after: after.total, cachePreserved: true }, null, 2),
  );
});
