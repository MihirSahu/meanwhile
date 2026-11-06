import { compileEventPlan } from "../../src/lib/server/event-compiler";
import { eventPlanSchema } from "../../src/lib/server/event-plan";
import { storyChecklistSchema } from "../../src/lib/server/story-checklist";
import {
  fixtureEventPlan,
  fixtureChecklist,
  fixturePassage,
} from "../fixtures/live-scene";
import { expect, test } from "@playwright/test";
import { makeDemo } from "../../src/lib/demo";
import {
  batchOutput,
  evidenceUrl,
  resolution,
  fixtureEvidence,
} from "../fixtures/live-scene";

test("a streamed story plays, pauses, seeks and replays after generation ends", async ({
  page,
}) => {
  test.setTimeout(75_000); // Full playback and replacement journey on software WebGL.
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /changed the world/ }),
  ).toBeVisible();
  await expect(page.locator('canvas[data-ready="true"]')).toBeVisible();
  await page.screenshot({ path: "test-results/desktop-home.png" });
  await page.getByRole("button", { name: /Sino-Japanese War/ }).click();
  await expect(
    page.getByRole("heading", {
      name: "The First Sino-Japanese War",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Curated demonstration", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("All chapters ready", { exact: true }),
  ).toBeVisible();
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-camera-ready",
    "The First Sino-Japanese War",
  );
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const slider = page.getByRole("slider", {
    name: "Story position in seconds",
  });
  const before = await slider.inputValue();
  await page.waitForTimeout(400);
  expect(await slider.inputValue()).toBe(before);
  await slider.fill("57");
  await expect(
    page.getByRole("heading", { name: "At the negotiating table" }),
  ).toBeVisible();
  await expect(
    page.getByText("Li Hongzhang", { exact: true }).first(),
  ).toBeVisible();
  await page.getByText("Context, objects & sources", { exact: true }).click();
  await page.getByRole("button", { name: "Li Hongzhang", exact: true }).click();
  await expect(
    page.getByRole("complementary", { name: "Selected object" }),
  ).toContainText("Named historical figure");
  await page.getByRole("button", { name: "Close object details" }).click();
  await page.screenshot({ path: "test-results/desktop-story.png" });
  await slider.fill("76");
  await expect(page.getByRole("status")).toHaveText("Story complete");
  await page.getByRole("button", { name: "Replay from beginning" }).click();
  await expect(
    page.getByRole("heading", { name: "Two powers, one peninsula" }),
  ).toBeVisible();
  expect(Number(await slider.inputValue())).toBeLessThan(5);
  await expect(
    page.getByText("Li Hongzhang", { exact: true }).first(),
  ).toBeHidden();
  await page
    .getByRole("combobox", { name: "Playback speed" })
    .selectOption("4");
  const start = Number(await slider.inputValue());
  await expect
    .poll(async () => Number(await slider.inputValue()))
    .toBeGreaterThan(start + 1);
  await page.getByRole("button", { name: /The Silk Road/ }).click();
  await expect(
    page.getByRole("heading", {
      name: "Trade along the Silk Road",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("All chapters ready", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Qing forces", { exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("invalid prompts explain demo limits and the mobile layout remains usable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "What are you curious about?" })
    .fill("Ancient Egypt");
  await page.getByRole("button", { name: "Explore this story" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "This demo includes",
  );
  await expect(
    page.getByRole("heading", { name: /changed the world/ }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/mobile-home.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: /The Silk Road/ }).click();
  await expect(
    page.getByText("All chapters ready", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page
    .getByRole("slider", { name: "Story position in seconds" })
    .fill("30");
  await expect(
    page.getByRole("heading", { name: "A meeting place of cultures" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/mobile-story.png",
    fullPage: true,
  });
  await page.getByRole("region", { name: /^Globe\. Use/ }).focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("+");
  await page.keyboard.press("Home");
});

test("an incomplete stream stops at the buffer and preserves playable chapters", async ({
  page,
}) => {
  const messages = makeDemo("The First Sino-Japanese War").slice(0, 2);
  await page.route("**/api/scene", (route) =>
    route.fulfill({
      contentType: "application/x-ndjson",
      body: messages.map((message) => JSON.stringify(message)).join("\n"),
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: /Sino-Japanese War/ }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "stream ended early",
  );
  const slider = page.getByRole("slider", {
    name: "Story position in seconds",
  });
  await slider.fill("12");
  await expect(slider).toHaveValue("12");
  await expect(
    page.getByRole("heading", { name: "Two powers, one peninsula" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Replay from beginning" }).click();
  await expect
    .poll(async () => Number(await slider.inputValue()))
    .toBeLessThan(3);
});

test("replacing a pending prompt never mixes scenes", async ({ page }) => {
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/scene", async (route) => {
    const prompt = route.request().postDataJSON().prompt as string;
    if (prompt.includes("Sino")) await pending;
    await route
      .fulfill({
        contentType: "application/x-ndjson",
        body: makeDemo(prompt)
          .map((message) => JSON.stringify(message))
          .join("\n"),
      })
      .catch(() => {});
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Sino-Japanese War/ }).click();
  await expect(page.getByRole("status")).toContainText("Finding your moment");
  await page.getByRole("button", { name: /The Silk Road/ }).click();
  await expect(
    page.getByRole("heading", {
      name: "Trade along the Silk Road",
      exact: true,
    }),
  ).toBeVisible();
  release();
  await expect(
    page.getByText("All chapters ready", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "The First Sino-Japanese War",
      exact: true,
    }),
  ).toHaveCount(0);
});

test("labels follow spawn and despawn visibility through a rewind", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const focus = makeDemo("The First Sino-Japanese War")[0];
  const messages = [
    focus,
    {
      type: "batch",
      seq: 0,
      readyThrough: 10,
      actions: [
        {
          type: "spawn",
          id: "spawn",
          at: 2,
          entityId: "traveler",
          asset: "horse",
          position: { lat: 36, lon: 127 },
          palette: "clay",
          label: "Test traveler",
          scale: 1,
        },
        { type: "despawn", id: "despawn", at: 8, entityId: "traveler" },
      ],
    },
    { type: "done", duration: 10 },
  ];
  await page.route("**/api/scene", (route) =>
    route.fulfill({
      contentType: "application/x-ndjson",
      body: messages.map((message) => JSON.stringify(message)).join("\n"),
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: /Sino-Japanese War/ }).click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const slider = page.getByRole("slider", {
    name: "Story position in seconds",
  });
  const label = page
    .getByRole("region", { name: /^Globe\. Use/ })
    .getByText("Test traveler", { exact: true });
  await slider.fill("0");
  await expect(label).toBeHidden();
  await slider.fill("3");
  await expect(label).toBeVisible();
  await slider.fill("9");
  await expect(label).toBeHidden();
  await slider.fill("3");
  await expect(label).toBeVisible();
});

test("story text and playback remain available without WebGL", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      type: string,
      options?: unknown,
    ) {
      if (type.includes("webgl")) return null;
      return Reflect.apply(original, this, [type, options]);
    } as typeof original;
  });
  await page.goto("/");
  await expect(
    page.getByText(/globe couldn’t load|needs a browser with WebGL/),
  ).toBeVisible();
  await page.getByRole("button", { name: /The Silk Road/ }).click();
  await expect(
    page.getByRole("heading", {
      name: "Trade along the Silk Road",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("All chapters ready", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page
    .getByRole("slider", { name: "Story position in seconds" })
    .fill("30");
  await expect(
    page.getByRole("heading", { name: "A meeting place of cultures" }),
  ).toBeVisible();
});

test("generated stories display clickable citations beside their historical context", async ({
  page,
}) => {
  const { result } = resolution;
  const messages = [
    {
      type: "focus",
      title: result.title,
      period: result.period,
      location: result.location,
      center: result.center,
      distance: result.distance,
      mode: "live",
      evidence: fixtureEvidence,
      sources: [
        { id: "s1", title: "Supporting historical evidence", url: evidenceUrl },
      ],
    },
    ...[0, 1, 2].map((seq) => ({
      type: "batch",
      seq,
      readyThrough: (seq + 1) * 12,
      ...batchOutput(seq),
    })),
    { type: "done", duration: 36 },
  ];
  await page.route("**/api/scene", (route) =>
    route.fulfill({
      contentType: "application/x-ndjson",
      body: messages.map((message) => JSON.stringify(message)).join("\n"),
    }),
  );
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "What are you curious about?" })
    .fill("Trade across Eurasia");
  await page.getByRole("button", { name: "Explore this story" }).click();
  await expect(
    page.getByText("Generated story", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const citation = page
    .locator(".chapter-copy")
    .getByRole("link", { name: "Source 1: Supporting historical evidence" });
  await expect(citation).toBeVisible();
  await expect(citation).toHaveAttribute("href", evidenceUrl);
  await page
    .getByRole("slider", { name: "Story position in seconds" })
    .fill("25");
  await expect(
    page.getByRole("heading", { name: "Goods and ideas" }),
  ).toBeVisible();
  await expect(citation).toBeVisible();
  await page.getByText("Context, objects & sources", { exact: true }).click();
  await page
    .getByRole("button", { name: "A traveling merchant", exact: true })
    .click();
  await expect(
    page
      .getByRole("complementary", { name: "Selected object" })
      .getByRole("link", { name: "Source 1: Supporting historical evidence" })
      .first(),
  ).toHaveAttribute("href", evidenceUrl);
  await page.locator(".story-details .evidence-details summary").click();
  await expect(
    page.locator(".evidence-details blockquote").first(),
  ).toContainText("The Silk Roads linked regional trading networks");
  await expect(
    page.locator(".evidence-details cite a").first(),
  ).toHaveAttribute("href", evidenceUrl);
});

test("Meanwhile retains the current scene during research and Back restores its playback", async ({
  page,
}) => {
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let discoveryRequest: any;
  let requests = 0;
  await page.route("**/api/scene", async (route) => {
    requests++;
    const body = route.request().postDataJSON();
    if (!body.discovery) {
      await route.fulfill({
        contentType: "application/x-ndjson",
        body: makeDemo(body.prompt)
          .map((m) => JSON.stringify(m))
          .join("\n"),
      });
      return;
    }
    discoveryRequest = body.discovery;
    await pending;
    const result = resolution.result;
    const yearRange = { startYear: 1895, endYear: 1895, approximate: false };
    const messages = [
      {
        type: "focus",
        title: "Elsewhere in 1895",
        period: "1895",
        location: "The Americas",
        center: { lat: 20, lon: -75 },
        distance: 5.4,
        mode: "live",
        evidence: fixtureEvidence,
        yearRange,
        discoveryFrom: {
          title: body.discovery.originTitle,
          period: body.discovery.periodLabel,
        },
        sources: [{ id: "s1", title: "Fixture evidence", url: evidenceUrl }],
      },
      ...[0, 1, 2].map((seq) => ({
        type: "batch",
        seq,
        readyThrough: (seq + 1) * 12,
        actions: batchOutput(seq).actions.map((a) =>
          a.type === "chapter"
            ? { ...a, date: "1895", yearRange }
            : a.type === "spawn"
              ? { ...a, position: { lat: 20, lon: -75 } }
              : a.type === "move"
                ? {
                    ...a,
                    path: [
                      { lat: 20, lon: -75 },
                      { lat: 25, lon: -80 },
                    ],
                  }
                : a,
        ),
      })),
      { type: "done", duration: 36 },
    ];
    await route.fulfill({
      contentType: "application/x-ndjson",
      body: messages.map((m) => JSON.stringify(m)).join("\n"),
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Sino-Japanese War/ }).click();
  await expect(
    page.getByText("All chapters ready", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const slider = page.getByRole("slider", {
    name: "Story position in seconds",
  });
  await slider.fill("57");
  await page.getByRole("button", { name: "Meanwhile…" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Looking elsewhere in 1895",
  );
  await expect(
    page.getByRole("heading", {
      name: "The First Sino-Japanese War",
      exact: true,
    }),
  ).toBeVisible();
  await expect(slider).toHaveValue("57");
  await expect(slider).toBeDisabled();
  expect(discoveryRequest.yearRange).toEqual({
    startYear: 1895,
    endYear: 1895,
    approximate: false,
  });
  release();
  await expect(
    page.getByRole("heading", { name: "Elsewhere in 1895", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Back to previous story" }).click();
  await expect(
    page.getByRole("heading", {
      name: "The First Sino-Japanese War",
      exact: true,
    }),
  ).toBeVisible();
  await expect(slider).toHaveValue("57");
  await expect(
    page.getByRole("button", { name: "Play", exact: true }),
  ).toBeVisible();
  expect(requests).toBe(2);
  await page.getByRole("button", { name: "Meanwhile…" }).click();
  await expect
    .poll(() => discoveryRequest.excludedTitles.includes("Elsewhere in 1895"))
    .toBe(true);
});

test("a failed Meanwhile search leaves the original story playable", async ({
  page,
}) => {
  await page.route("**/api/scene", (route) => {
    const body = route.request().postDataJSON();
    return body.discovery
      ? route.fulfill({
          status: 503,
          json: { error: "Meanwhile discovery needs a live provider." },
        })
      : route.fulfill({
          contentType: "application/x-ndjson",
          body: makeDemo(body.prompt)
            .map((m) => JSON.stringify(m))
            .join("\n"),
        });
  });
  await page.goto("/");
  await page.getByRole("button", { name: /The Silk Road/ }).click();
  await expect(
    page.getByText("All chapters ready", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Meanwhile…" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "live provider",
  );
  await expect(
    page.getByRole("heading", {
      name: "Trade along the Silk Road",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("slider", { name: "Story position in seconds" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Back to previous story" }),
  ).toHaveCount(0);
});

test("visible labels stay separated at a dense chapter", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.getByRole("button", { name: /Sino-Japanese War/ }).click();
  await expect(
    page.getByText("All chapters ready", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page
    .getByRole("slider", { name: "Story position in seconds" })
    .fill("57");
  await expect(
    page.locator('[data-scene-label][data-label-shown="true"]').first(),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const rects = [
          ...document.querySelectorAll<HTMLElement>(
            '[data-label-shown="true"]',
          ),
        ]
          .filter((n) => n.checkVisibility())
          .map((n) => n.getBoundingClientRect());
        return rects.every((a, i) =>
          rects
            .slice(i + 1)
            .every(
              (b) =>
                a.right <= b.left ||
                b.right <= a.left ||
                a.bottom <= b.top ||
                b.bottom <= a.top,
            ),
        );
      }),
    )
    .toBe(true);
});

test("stopping a pending Meanwhile search restores the original playback", async ({
  page,
}) => {
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/scene", async (route) => {
    const body = route.request().postDataJSON();
    if (body.discovery) await pending;
    await route
      .fulfill({
        contentType: "application/x-ndjson",
        body: makeDemo(body.discovery ? "Silk Road" : body.prompt)
          .map((m) => JSON.stringify(m))
          .join("\n"),
      })
      .catch(() => {});
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Sino-Japanese War/ }).click();
  await expect(
    page.getByText("All chapters ready", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Meanwhile…" }).click();
  await expect(page.getByRole("status")).toContainText("Looking elsewhere");
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  release();
  await expect(
    page.getByRole("heading", {
      name: "The First Sino-Japanese War",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("slider", { name: "Story position in seconds" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Back to previous story" }),
  ).toHaveCount(0);
});

test("mobile labels fit the stage without overlapping", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.getByRole("button", { name: /The Silk Road/ }).click();
  await expect(
    page.getByText("All chapters ready", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page
    .getByRole("slider", { name: "Story position in seconds" })
    .fill("30");
  await expect(page.locator('[data-label-shown="true"]').first()).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const rects = [
          ...document.querySelectorAll<HTMLElement>(
            '[data-label-shown="true"]',
          ),
        ]
          .filter((n) => n.checkVisibility())
          .map((n) => n.getBoundingClientRect());
        return (
          rects.length > 0 &&
          rects.length <= 4 &&
          rects.every(
            (a, i) =>
              a.left >= 0 &&
              a.right <= innerWidth &&
              rects
                .slice(i + 1)
                .every(
                  (b) =>
                    a.right <= b.left ||
                    b.right <= a.left ||
                    a.bottom <= b.top ||
                    b.bottom <= a.top,
                ),
          )
        );
      }),
    )
    .toBe(true);
  await page.screenshot({
    path: "test-results/mobile-labels.png",
    fullPage: true,
  });
});

test("compiled text-only facts display and seek without a lunar Earth marker", async ({
  page,
}) => {
  const raw = structuredClone(fixtureEventPlan) as any;
  raw.result.title = "Text-only browser test";
  raw.result.events[1].template = "narration";
  raw.result.events[1].location = { name: "Moon", position: null };
  raw.result.events[1].title = "Lunar context";
  raw.result.events[1].statement =
    "Synthetic lunar fact for the playback test.";
  const parsed = eventPlanSchema.parse(raw).result;
  if (parsed.status !== "resolved") throw new Error();
  const story = compileEventPlan(
    parsed,
    storyChecklistSchema.parse(fixtureChecklist),
    {
      text: "Test fixture",
      passages: [fixturePassage],
      sources: [
        { id: "s1", title: "Test fixture", url: "https://example.org/history" },
      ],
    },
  );
  const lunar = story.messages
    .flatMap((m) => (m.type === "batch" ? m.actions : []))
    .find((a) => a.id.endsWith("ev_1_heading"))!;
  await page.route("**/api/scene", (route) =>
    route.fulfill({
      contentType: "application/x-ndjson",
      body: story.messages.map((m) => JSON.stringify(m)).join("\n"),
    }),
  );
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "What are you curious about?" })
    .fill("Text-only browser test");
  await page.getByRole("button", { name: "Explore this story" }).click();
  await expect(
    page.getByText("All chapters ready", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const slider = page.getByRole("slider", {
    name: "Story position in seconds",
  });
  await slider.fill(String(Math.ceil(lunar.at)));
  await expect(
    page.getByRole("heading", { name: "Lunar context", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/Moon\. No Earth marker is shown\./),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Inspect Moon", exact: true }),
  ).toHaveCount(0);
  await slider.fill("1");
  await expect(
    page.getByRole("heading", { name: "Regional networks", exact: true }),
  ).toBeVisible();
});

for (const failure of [
  "http",
  "protocol",
  "focus-error",
  "focus-truncated",
] as const) {
  test(`failed ordinary replacement (${failure}) keeps the paused story and playback position`, async ({
    page,
  }) => {
    await page.route("**/api/scene", async (route) => {
      const body = route.request().postDataJSON();
      if (body.prompt === "Broken replacement") {
        if (failure === "http")
          return route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ error: "Replacement failed" }),
          });
        const focus = makeDemo("Silk Road")[0];
        const lines =
          failure === "protocol"
            ? [{ type: "error", message: "Replacement failed" }]
            : failure === "focus-error"
              ? [focus, { type: "error", message: "Replacement failed" }]
              : [focus];
        return route.fulfill({
          contentType: "application/x-ndjson",
          body: lines.map((m) => JSON.stringify(m)).join("\n"),
        });
      }
      await route.fulfill({
        contentType: "application/x-ndjson",
        body: makeDemo(body.prompt)
          .map((m) => JSON.stringify(m))
          .join("\n"),
      });
    });
    await page.goto("/");
    await page.getByRole("button", { name: /Sino-Japanese War/ }).click();
    await expect(
      page.getByText("All chapters ready", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    const slider = page.getByRole("slider", {
      name: "Story position in seconds",
    });
    await slider.fill("20");
    await page
      .getByRole("textbox", { name: "What are you curious about?" })
      .fill("Broken replacement");
    await page.getByRole("button", { name: "Explore this story" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: "The First Sino-Japanese War",
        exact: true,
      }),
    ).toBeVisible();
    await expect(slider).toHaveValue("20");
    await expect(
      page.getByRole("button", { name: "Play", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: "Trade along the Silk Road",
        exact: true,
      }),
    ).toHaveCount(0);
  });
}

test("ordinary replacement keeps the current scene until a playable batch and Stop keeps it replayable", async ({
  page,
}) => {
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/scene", async (route) => {
    const body = route.request().postDataJSON();
    if (body.prompt === "Pending replacement") await pending;
    await route
      .fulfill({
        contentType: "application/x-ndjson",
        body: makeDemo(
          body.prompt === "Pending replacement" ? "Silk Road" : body.prompt,
        )
          .map((m) => JSON.stringify(m))
          .join("\n"),
      })
      .catch(() => {});
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Sino-Japanese War/ }).click();
  await expect(
    page.getByText("All chapters ready", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const slider = page.getByRole("slider", {
    name: "Story position in seconds",
  });
  await slider.fill("20");
  await page
    .getByRole("textbox", { name: "What are you curious about?" })
    .fill("Pending replacement");
  await page.getByRole("button", { name: "Explore this story" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Preparing a replacement story",
  );
  await expect(
    page.getByRole("heading", {
      name: "The First Sino-Japanese War",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  release();
  await expect(slider).toHaveValue("20");
  await expect(
    page.getByRole("heading", {
      name: "The First Sino-Japanese War",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: /The Silk Road/ }).click();
  await expect(
    page.getByRole("heading", {
      name: "Trade along the Silk Road",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "The First Sino-Japanese War",
      exact: true,
    }),
  ).toHaveCount(0);
});

test("superseding a pending discovery releases its pause even when the replacement fails", async ({
  page,
}) => {
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/scene", async (route) => {
    const body = route.request().postDataJSON();
    if (body.discovery) await pending;
    if (body.prompt === "Broken replacement")
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Replacement failed" }),
      });
    await route
      .fulfill({
        contentType: "application/x-ndjson",
        body: makeDemo(body.discovery ? "Silk Road" : body.prompt)
          .map((m) => JSON.stringify(m))
          .join("\n"),
      })
      .catch(() => {});
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Sino-Japanese War/ }).click();
  await expect(
    page.getByText("All chapters ready", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Meanwhile…" }).click();
  await expect(page.getByRole("status")).toContainText("Looking elsewhere");
  await page
    .getByRole("textbox", { name: "What are you curious about?" })
    .fill("Broken replacement");
  await page.getByRole("button", { name: "Explore this story" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Replacement failed",
  );
  await expect(
    page.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  release();
  await expect(
    page.getByRole("heading", {
      name: "The First Sino-Japanese War",
      exact: true,
    }),
  ).toBeVisible();
});

test("a failed ordinary replacement preserves discovery Back history", async ({
  page,
}) => {
  await page.route("**/api/scene", async (route) => {
    const body = route.request().postDataJSON();
    if (body.prompt === "Broken replacement")
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Replacement failed" }),
      });
    await route.fulfill({
      contentType: "application/x-ndjson",
      body: makeDemo(body.discovery ? "Silk Road" : body.prompt)
        .map((m) => JSON.stringify(m))
        .join("\n"),
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Sino-Japanese War/ }).click();
  await expect(
    page.getByText("All chapters ready", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const slider = page.getByRole("slider", {
    name: "Story position in seconds",
  });
  await slider.fill("20");
  await page.getByRole("button", { name: "Meanwhile…" }).click();
  await expect(
    page.getByRole("heading", {
      name: "Trade along the Silk Road",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "What are you curious about?" })
    .fill("Broken replacement");
  await page.getByRole("button", { name: "Explore this story" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Replacement failed",
  );
  await page.getByRole("button", { name: "Back to previous story" }).click();
  await expect(
    page.getByRole("heading", {
      name: "The First Sino-Japanese War",
      exact: true,
    }),
  ).toBeVisible();
  await expect(slider).toHaveValue("20");
});
