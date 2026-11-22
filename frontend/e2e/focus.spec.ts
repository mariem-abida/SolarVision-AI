import { test, expect } from "@playwright/test";

test("keyboard focus remains visible on the preferred-mode select in both themes", async ({
  page,
}) => {
  for (const theme of ["Dark", "Light"]) {
    await page.goto("/settings");
    await page.getByRole("button", { name: theme, exact: true }).click();
    const input = page.getByRole("textbox", { name: "API Base URL" });
    const select = page.getByRole("combobox", { name: "Preferred analysis mode" });
    await input.focus();
    for (
      let step = 0;
      step < 10 && !(await select.evaluate((element) => element === document.activeElement));
      step += 1
    ) {
      await page.keyboard.press("Tab");
    }
    await expect(select).toBeFocused();
    const focus = await select.evaluate((element) => ({
      style: getComputedStyle(element).outlineStyle,
      width: parseFloat(getComputedStyle(element).outlineWidth),
    }));
    expect(focus.style).not.toBe("none");
    expect(focus.width).toBeGreaterThanOrEqual(2);
  }
});
