import { expect, test } from "@playwright/test";
import { makeDemo } from "../../src/lib/demo";
import { hungarianClarification } from "../fixtures/story-intent";

test("ambiguous prompts offer choices and generate only the selected story", async ({ page }) => {
  const resolutions: unknown[] = [];
  const stories: { prompt: string }[] = [];
  await page.route("**/api/resolve", async (route) => {
    resolutions.push(route.request().postDataJSON());
    await route.fulfill({ json: hungarianClarification });
  });
  await page.route("**/api/scene", async (route) => {
    stories.push(route.request().postDataJSON());
    // Synthetic playback: this verifies request routing, not historical content.
    await route.fulfill({
      contentType: "application/x-ndjson",
      body: makeDemo("Silk Road").map((message) => JSON.stringify(message)).join("\n"),
    });
  });
  await page.goto("/");
  const input = page.getByRole("textbox", { name: "What are you curious about?" });
  await input.fill("The hungarian revolution");
  await page.getByRole("button", { name: "Explore this story" }).click();
  const choices = page.getByRole("region", { name: hungarianClarification.result.question });
  await expect(choices).toBeVisible();
  await expect(choices.getByText("1848–1849", { exact: true })).toBeVisible();
  await expect(choices.getByText("1956", { exact: true })).toBeVisible();
  await expect(choices.getByRole("button").first()).toBeFocused();
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  await page.screenshot({ path: "test-results/desktop-story-choices.png" });
  expect(stories).toHaveLength(0);
  await choices.getByRole("button", { name: /Hungarian Uprising/ }).click();
  await expect(page.getByRole("heading", { name: "Trade along the Silk Road", exact: true })).toBeVisible();
  expect(resolutions).toHaveLength(1);
  expect(stories).toHaveLength(1);
  expect(stories[0].prompt).toBe(hungarianClarification.result.options[1].prompt);
  await expect(input).toHaveCount(0);
  await expect(choices).toHaveCount(0);
});

test("choosing or dismissing ambiguity preserves the current story and playback", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/resolve", (route) => route.fulfill({ json: hungarianClarification }));
  await page.goto("/");
  await page.getByRole("button", { name: /Sino-Japanese War/ }).click();
  await expect(page.getByText("All chapters ready", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const slider = page.getByRole("slider", { name: "Story position in seconds" });
  await slider.fill("20");
  await page.getByRole("button", { name: "New story", exact: true }).click();
  await page.getByRole("textbox", { name: "What are you curious about?" }).fill("The hungarian revolution");
  await page.getByRole("button", { name: "Explore this story" }).click();
  const choices = page.getByRole("region", { name: hungarianClarification.result.question });
  await expect(choices).toBeVisible();
  await expect(page.getByRole("heading", { name: "The First Sino-Japanese War", exact: true })).toBeVisible();
  const bounds = await choices.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await expect(slider).toHaveValue("20");
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/mobile-story-choices.png" });
  await choices.getByRole("button", { name: "Dismiss choices" }).click();
  await expect(choices).toHaveCount(0);
  await expect(slider).toHaveValue("20");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("a cancelled or superseded resolution cannot replace a newer specific request", async ({ page }) => {
  let resolveTrace: string | undefined;
  let sceneTrace: string | undefined;
  let release = () => {};
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/resolve", async (route) => {
    if (route.request().postDataJSON().prompt === "The hungarian revolution") {
      await pending;
      await route.fulfill({ json: hungarianClarification }).catch(() => {});
    } else {
      resolveTrace = route.request().headers()["x-meanwhile-trace-id"];
      await route.fulfill({ json: { result: { status: "resolved" } } });
    }
  });
  const prompts: string[] = [];
  await page.route("**/api/scene", async (route) => {
    sceneTrace = route.request().headers()["x-meanwhile-trace-id"];
    prompts.push(route.request().postDataJSON().prompt);
    await route.fulfill({
      contentType: "application/x-ndjson",
      body: makeDemo("Silk Road").map((message) => JSON.stringify(message)).join("\n"),
    });
  });
  await page.goto("/");
  const input = page.getByRole("textbox", { name: "What are you curious about?" });
  await input.fill("The hungarian revolution");
  await page.getByRole("button", { name: "Explore this story" }).click();
  await expect(page.getByRole("status")).toContainText("Finding possible stories");
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await input.fill("The Silk Road");
  await page.getByRole("button", { name: "Explore this story" }).click();
  await expect(page.getByRole("heading", { name: "Trade along the Silk Road", exact: true })).toBeVisible();
  release();
  await expect(page.getByRole("region", { name: hungarianClarification.result.question })).toHaveCount(0);
  expect(prompts).toEqual(["The Silk Road"]);
  expect(resolveTrace).toBeTruthy();
  expect(sceneTrace).toBe(resolveTrace);
});
