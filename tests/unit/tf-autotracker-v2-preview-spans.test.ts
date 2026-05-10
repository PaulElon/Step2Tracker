import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAutoTrackerV2PreviewSpans,
  type TfAutotrackerV2ClassificationSettings,
} from "../../src/lib/tf-autotracker-v2-preview-spans.js";
import type { AutoTrackerV2NativeEvent } from "../../src/lib/tf-autotracker-v2-native-events.js";

function makeEvent(
  overrides: Partial<AutoTrackerV2NativeEvent> &
    Pick<AutoTrackerV2NativeEvent, "kind" | "timestampMs">,
): AutoTrackerV2NativeEvent {
  return {
    id: overrides.id ?? `ev-${overrides.timestampMs}`,
    platform: "macos",
    ...overrides,
  };
}

test("Anki event produces one open app span", () => {
  const events = [
    makeEvent({
      id: "ev-1",
      kind: "targetFocused",
      timestampMs: 1000,
      appName: "Anki",
      bundleId: "net.ankiweb.dtop",
    }),
  ];
  const spans = buildAutoTrackerV2PreviewSpans(events);
  assert.equal(spans.length, 1);
  const span = spans[0];
  assert.equal(span.kind, "app");
  assert.equal(span.label, "Anki");
  assert.equal(span.appName, "Anki");
  assert.equal(span.bundleId, "net.ankiweb.dtop");
  assert.equal(span.startedAtMs, 1000);
  assert.equal(span.endedAtMs, null);
  assert.equal(span.durationMs, null);
  assert.deepEqual(span.sourceEventIds, ["ev-1"]);
});

test("Chrome UWorld URL event produces one open website span", () => {
  const events = [
    makeEvent({
      id: "ev-1",
      kind: "untrackedFocused",
      timestampMs: 1000,
      appName: "Google Chrome",
      bundleId: "com.google.Chrome",
      browserTitle: "UWorld USMLE Step 2 CK",
      browserUrl: "https://www.uworld.com/qbank/test",
    }),
  ];
  const spans = buildAutoTrackerV2PreviewSpans(events);
  assert.equal(spans.length, 1);
  const span = spans[0];
  assert.equal(span.kind, "website");
  assert.equal(span.label, "www.uworld.com");
  assert.equal(span.browserUrl, "https://www.uworld.com/qbank/test");
  assert.equal(span.startedAtMs, 1000);
  assert.equal(span.endedAtMs, null);
  assert.equal(span.durationMs, null);
  assert.deepEqual(span.sourceEventIds, ["ev-1"]);
});

test("Chrome UWorld URL event matches the UWorld website rule", () => {
  const events = [
    makeEvent({
      id: "ev-1",
      kind: "untrackedFocused",
      timestampMs: 1000,
      appName: "Google Chrome",
      bundleId: "com.google.Chrome",
      browserTitle: "UWorld Step 2 CK",
      browserUrl: "https://apps.uworld.com/courseapp/step2",
    }),
  ];
  const spans = buildAutoTrackerV2PreviewSpans(events, {
    autoApps: [],
    autoWebsites: [
      {
        id: "rule-uworld",
        name: "UWorld",
        target: "https://apps.uworld.com",
        kind: "website",
      },
    ],
    distractionApps: [],
    distractionWebsites: [],
  });
  assert.equal(spans.length, 1);
  const span = spans[0];
  assert.equal(span.kind, "website");
  assert.equal(span.label, "apps.uworld.com");
  assert.equal(span.classification, "tracked");
  assert.equal(span.matchedRuleName, "UWorld");
  assert.equal(span.matchedRuleTarget, "https://apps.uworld.com");
});

test("Chrome UWorld then AMBOSS closes first span and opens second", () => {
  const events = [
    makeEvent({
      id: "ev-1",
      kind: "untrackedFocused",
      timestampMs: 1000,
      appName: "Google Chrome",
      browserUrl: "https://www.uworld.com/qbank/test",
    }),
    makeEvent({
      id: "ev-2",
      kind: "untrackedFocused",
      timestampMs: 5000,
      appName: "Google Chrome",
      browserUrl: "https://www.amboss.com/us/learn",
    }),
  ];
  const spans = buildAutoTrackerV2PreviewSpans(events);
  assert.equal(spans.length, 2);

  const uworld = spans[0];
  assert.equal(uworld.kind, "website");
  assert.equal(uworld.label, "www.uworld.com");
  assert.equal(uworld.endedAtMs, 5000);
  assert.equal(uworld.durationMs, 4000);

  const amboss = spans[1];
  assert.equal(amboss.kind, "website");
  assert.equal(amboss.label, "www.amboss.com");
  assert.equal(amboss.startedAtMs, 5000);
  assert.equal(amboss.endedAtMs, null);
  assert.equal(amboss.durationMs, null);
});

test("Repeated same URL samples merge into one span and accumulate source event IDs", () => {
  const events = [
    makeEvent({
      id: "ev-1",
      kind: "untrackedFocused",
      timestampMs: 1000,
      browserUrl: "https://www.uworld.com/qbank/test",
    }),
    makeEvent({
      id: "ev-2",
      kind: "untrackedFocused",
      timestampMs: 2000,
      browserUrl: "https://www.uworld.com/qbank/test",
    }),
    makeEvent({
      id: "ev-3",
      kind: "untrackedFocused",
      timestampMs: 3000,
      browserUrl: "https://www.uworld.com/qbank/test",
    }),
  ];
  const spans = buildAutoTrackerV2PreviewSpans(events);
  assert.equal(spans.length, 1);
  const span = spans[0];
  assert.deepEqual(span.sourceEventIds, ["ev-1", "ev-2", "ev-3"]);
  assert.equal(span.startedAtMs, 1000);
  assert.equal(span.endedAtMs, null);
  assert.equal(span.durationMs, null);
});

test("App then website then app creates three spans with correct boundaries", () => {
  const events = [
    makeEvent({
      id: "ev-1",
      kind: "targetFocused",
      timestampMs: 0,
      appName: "Anki",
      bundleId: "net.ankiweb.dtop",
    }),
    makeEvent({
      id: "ev-2",
      kind: "untrackedFocused",
      timestampMs: 5000,
      appName: "Google Chrome",
      browserUrl: "https://uworld.com/qbank",
    }),
    makeEvent({
      id: "ev-3",
      kind: "targetFocused",
      timestampMs: 10000,
      appName: "Anki",
      bundleId: "net.ankiweb.dtop",
    }),
  ];
  const spans = buildAutoTrackerV2PreviewSpans(events);
  assert.equal(spans.length, 3);

  assert.equal(spans[0].kind, "app");
  assert.equal(spans[0].label, "Anki");
  assert.equal(spans[0].startedAtMs, 0);
  assert.equal(spans[0].endedAtMs, 5000);
  assert.equal(spans[0].durationMs, 5000);

  assert.equal(spans[1].kind, "website");
  assert.equal(spans[1].startedAtMs, 5000);
  assert.equal(spans[1].endedAtMs, 10000);
  assert.equal(spans[1].durationMs, 5000);

  assert.equal(spans[2].kind, "app");
  assert.equal(spans[2].label, "Anki");
  assert.equal(spans[2].startedAtMs, 10000);
  assert.equal(spans[2].endedAtMs, null);
  assert.equal(spans[2].durationMs, null);
});

test("Error and idle events are ignored", () => {
  const events = [
    makeEvent({ id: "ev-1", kind: "error", timestampMs: 0, error: "some error" }),
    makeEvent({ id: "ev-2", kind: "idleChanged", timestampMs: 1000, isIdle: true }),
    makeEvent({ id: "ev-3", kind: "targetFocused", timestampMs: 2000, appName: "Anki" }),
  ];
  const spans = buildAutoTrackerV2PreviewSpans(events);
  assert.equal(spans.length, 1);
  assert.equal(spans[0].appName, "Anki");
  assert.equal(spans[0].startedAtMs, 2000);
});

test("Unsorted input is sorted by timestampMs before mapping", () => {
  const events = [
    makeEvent({
      id: "ev-3",
      kind: "untrackedFocused",
      timestampMs: 3000,
      browserUrl: "https://amboss.com/learn",
    }),
    makeEvent({ id: "ev-1", kind: "targetFocused", timestampMs: 1000, appName: "Anki" }),
    makeEvent({
      id: "ev-2",
      kind: "untrackedFocused",
      timestampMs: 2000,
      browserUrl: "https://uworld.com/qbank",
    }),
  ];
  const spans = buildAutoTrackerV2PreviewSpans(events);
  assert.equal(spans.length, 3);

  assert.equal(spans[0].kind, "app");
  assert.equal(spans[0].startedAtMs, 1000);
  assert.equal(spans[0].endedAtMs, 2000);

  assert.equal(spans[1].kind, "website");
  assert.equal(spans[1].startedAtMs, 2000);
  assert.equal(spans[1].endedAtMs, 3000);

  assert.equal(spans[2].kind, "website");
  assert.equal(spans[2].startedAtMs, 3000);
  assert.equal(spans[2].endedAtMs, null);
});

test("Malformed URL does not crash and creates a website span", () => {
  const events = [
    makeEvent({
      id: "ev-1",
      kind: "untrackedFocused",
      timestampMs: 1000,
      browserUrl: "not-a-valid-url",
      browserTitle: "Some Page",
    }),
  ];
  const spans = buildAutoTrackerV2PreviewSpans(events);
  assert.equal(spans.length, 1);
  assert.equal(spans[0].kind, "website");
  assert.ok(spans[0].label.length > 0);
  assert.equal(spans[0].startedAtMs, 1000);
  assert.equal(spans[0].endedAtMs, null);
});

test("Missing appName and bundleId falls back to Unknown app label", () => {
  const events = [
    makeEvent({
      id: "ev-1",
      kind: "targetFocused",
      timestampMs: 1000,
    }),
  ];
  const spans = buildAutoTrackerV2PreviewSpans(events);
  assert.equal(spans.length, 1);
  assert.equal(spans[0].kind, "app");
  assert.equal(spans[0].label, "Unknown app");
});

// --- Classification tests ---

function makeSettings(
  overrides: Partial<TfAutotrackerV2ClassificationSettings> = {},
): TfAutotrackerV2ClassificationSettings {
  return {
    autoApps: [],
    autoWebsites: [],
    distractionApps: [],
    distractionWebsites: [],
    ...overrides,
  };
}

test("UWorld URL classified tracked when website rule is uworld.com", () => {
  const events = [
    makeEvent({
      id: "ev-1",
      kind: "untrackedFocused",
      timestampMs: 1000,
      browserUrl: "https://uworld.com/qbank/test",
    }),
  ];
  const settings = makeSettings({ autoWebsites: ["uworld.com"] });
  const spans = buildAutoTrackerV2PreviewSpans(events, settings);
  assert.equal(spans[0].classification, "tracked");
  assert.ok(spans[0].classificationReason.includes("uworld.com"));
});

test("website rule https://apps.uworld.com matches https://apps.uworld.com/courseapp/...", () => {
  const events = [
    makeEvent({
      id: "ev-1",
      kind: "untrackedFocused",
      timestampMs: 1000,
      browserUrl: "https://apps.uworld.com/courseapp/step2",
    }),
  ];
  const settings = makeSettings({ autoWebsites: ["https://apps.uworld.com"] });
  const spans = buildAutoTrackerV2PreviewSpans(events, settings);
  assert.equal(spans[0].classification, "tracked");
  assert.equal(
    spans[0].classificationReason,
    'matched website rule "UWorld" (https://apps.uworld.com) by host apps.uworld.com',
  );
  assert.equal(spans[0].matchedRuleName, "UWorld");
  assert.equal(spans[0].matchedRuleTarget, "https://apps.uworld.com");
});

test("website rule uworld.com matches apps.uworld.com", () => {
  const events = [
    makeEvent({
      id: "ev-1",
      kind: "untrackedFocused",
      timestampMs: 1000,
      browserUrl: "https://apps.uworld.com/courseapp/step2",
    }),
  ];
  const settings = makeSettings({ autoWebsites: ["uworld.com"] });
  const spans = buildAutoTrackerV2PreviewSpans(events, settings);
  assert.equal(spans[0].classification, "tracked");
});

test("www.uworld.com matches website rule uworld.com (subdomain)", () => {
  const events = [
    makeEvent({
      id: "ev-1",
      kind: "untrackedFocused",
      timestampMs: 1000,
      browserUrl: "https://www.uworld.com/qbank/test",
    }),
  ];
  const settings = makeSettings({ autoWebsites: ["uworld.com"] });
  const spans = buildAutoTrackerV2PreviewSpans(events, settings);
  assert.equal(spans[0].classification, "tracked");
});

test("website rule https://www.reddit.com matches https://www.reddit.com/r/Step2...", () => {
  const events = [
    makeEvent({
      id: "ev-1",
      kind: "untrackedFocused",
      timestampMs: 1000,
      browserUrl: "https://www.reddit.com/r/Step2/comments/abc123",
    }),
  ];
  const settings = makeSettings({ distractionWebsites: ["https://www.reddit.com"] });
  const spans = buildAutoTrackerV2PreviewSpans(events, settings);
  assert.equal(spans[0].classification, "distraction");
  assert.equal(
    spans[0].classificationReason,
    'matched distraction website rule "Reddit" (https://www.reddit.com) by host reddit.com',
  );
  assert.equal(spans[0].matchedRuleName, "Reddit");
  assert.equal(spans[0].matchedRuleTarget, "https://www.reddit.com");
});

test("website rule https://www.reddit.com/?feed=home matches https://www.reddit.com/?feed=home", () => {
  const events = [
    makeEvent({
      id: "ev-1",
      kind: "untrackedFocused",
      timestampMs: 1000,
      browserUrl: "https://www.reddit.com/?feed=home",
    }),
  ];
  const settings = makeSettings({ distractionWebsites: ["https://www.reddit.com/?feed=home"] });
  const spans = buildAutoTrackerV2PreviewSpans(events, settings);
  assert.equal(spans[0].classification, "distraction");
});

test("apps.uworld.com matches website rule uworld.com (subdomain)", () => {
  const events = [
    makeEvent({
      id: "ev-1",
      kind: "untrackedFocused",
      timestampMs: 1000,
      browserUrl: "https://apps.uworld.com/test",
    }),
  ];
  const settings = makeSettings({ autoWebsites: ["uworld.com"] });
  const spans = buildAutoTrackerV2PreviewSpans(events, settings);
  assert.equal(spans[0].classification, "tracked");
});

test("notuworld.com does NOT match website rule uworld.com", () => {
  const events = [
    makeEvent({
      id: "ev-1",
      kind: "untrackedFocused",
      timestampMs: 1000,
      browserUrl: "https://notuworld.com/test",
    }),
  ];
  const settings = makeSettings({ autoWebsites: ["uworld.com"] });
  const spans = buildAutoTrackerV2PreviewSpans(events, settings);
  assert.equal(spans[0].classification, "unclassified");
});

test("notreddit.com does NOT match website rule reddit.com", () => {
  const events = [
    makeEvent({
      id: "ev-1",
      kind: "untrackedFocused",
      timestampMs: 1000,
      browserUrl: "https://notreddit.com/r/medicine",
    }),
  ];
  const settings = makeSettings({ distractionWebsites: ["reddit.com"] });
  const spans = buildAutoTrackerV2PreviewSpans(events, settings);
  assert.equal(spans[0].classification, "unclassified");
});

test("Reddit URL classified distraction when website rule is reddit.com", () => {
  const events = [
    makeEvent({
      id: "ev-1",
      kind: "untrackedFocused",
      timestampMs: 1000,
      browserUrl: "https://www.reddit.com/r/medicine",
    }),
  ];
  const settings = makeSettings({ distractionWebsites: ["reddit.com"] });
  const spans = buildAutoTrackerV2PreviewSpans(events, settings);
  assert.equal(spans[0].classification, "distraction");
  assert.ok(spans[0].classificationReason.includes("reddit.com"));
});

test("/Applications/Anki.app matches appName Anki", () => {
  const events = [
    makeEvent({
      id: "ev-1",
      kind: "targetFocused",
      timestampMs: 1000,
      appName: "Anki",
      bundleId: "net.ankiweb.dtop",
    }),
  ];
  const settings = makeSettings({ autoApps: ["/Applications/Anki.app"] });
  const spans = buildAutoTrackerV2PreviewSpans(events, settings);
  assert.equal(spans[0].classification, "tracked");
  assert.equal(
    spans[0].classificationReason,
    'matched app rule "Anki" (/Applications/Anki.app) by app name Anki',
  );
  assert.equal(spans[0].matchedRuleName, "Anki");
  assert.equal(spans[0].matchedRuleTarget, "/Applications/Anki.app");
});

test("/Applications/ChatGPT.app matches appName ChatGPT", () => {
  const events = [
    makeEvent({
      id: "ev-1",
      kind: "targetFocused",
      timestampMs: 1000,
      appName: "ChatGPT",
      bundleId: "com.openai.chat",
    }),
  ];
  const settings = makeSettings({ distractionApps: ["/Applications/ChatGPT.app"] });
  const spans = buildAutoTrackerV2PreviewSpans(events, settings);
  assert.equal(spans[0].classification, "distraction");
  assert.equal(
    spans[0].classificationReason,
    'matched distraction app rule "ChatGPT" (/Applications/ChatGPT.app) by app name ChatGPT',
  );
});

test("app rules match Goodnotes and Things3 variants symmetrically for allowed and distraction rules", () => {
  const goodnotesRule = {
    id: "rule-goodnotes",
    name: "Goodnotes",
    target: "/Applications/Goodnotes.app",
    kind: "app",
  };
  const ankiRule = {
    id: "rule-anki",
    name: "Anki",
    target: "/Applications/Anki.app",
    kind: "app",
  };
  const thingsRule = {
    id: "rule-things3",
    name: "Things3",
    target: "/Applications/Things3.app",
    kind: "app",
  };
  const codexRule = {
    id: "rule-codex",
    name: "Codex",
    target: "/Applications/Codex.app",
    kind: "app",
  };

  const allowedSettings = makeSettings({
    autoApps: [goodnotesRule, ankiRule, thingsRule, codexRule],
  });
  const distractionSettings = makeSettings({
    distractionApps: [goodnotesRule, ankiRule, thingsRule, codexRule],
  });

  const cases = [
    {
      description: "Goodnotes bundlePath",
      event: makeEvent({
        id: "ev-goodnotes-name",
        kind: "targetFocused",
        timestampMs: 1000,
        appName: "Goodnotes 6",
        bundleId: "com.goodnotesapp.mac",
        bundlePath: "/Applications/Goodnotes.app",
      }),
      expectedRuleName: "Goodnotes",
    },
    {
      description: "Anki bundlePath",
      event: makeEvent({
        id: "ev-anki-name",
        kind: "targetFocused",
        timestampMs: 2000,
        appName: "Anki Desktop",
        bundleId: "net.ankiweb.dtop",
        bundlePath: "/Applications/Anki.app",
      }),
      expectedRuleName: "Anki",
    },
    {
      description: "Things3 bundlePath",
      event: makeEvent({
        id: "ev-things3-name",
        kind: "targetFocused",
        timestampMs: 3000,
        appName: "Things 3",
        bundleId: "com.culturedcode.ThingsMac",
        bundlePath: "/Applications/Things3.app",
      }),
      expectedRuleName: "Things3",
    },
    {
      description: "Codex bundlePath",
      event: makeEvent({
        id: "ev-codex-name",
        kind: "targetFocused",
        timestampMs: 4000,
        appName: "OpenAI Codex",
        bundleId: "com.openai.codex",
        bundlePath: "/Applications/Codex.app",
      }),
      expectedRuleName: "Codex",
    },
  ] as const;

  for (const testCase of cases) {
    const allowedSpans = buildAutoTrackerV2PreviewSpans([testCase.event], allowedSettings);
    assert.equal(
      allowedSpans[0]?.classification,
      "tracked",
      `${testCase.description} should classify as tracked`,
    );
    assert.equal(
      allowedSpans[0]?.matchedRuleName,
      testCase.expectedRuleName,
      `${testCase.description} should match the allowed rule`,
    );

    const distractionSpans = buildAutoTrackerV2PreviewSpans([testCase.event], distractionSettings);
    assert.equal(
      distractionSpans[0]?.classification,
      "distraction",
      `${testCase.description} should classify as distraction`,
    );
    assert.equal(
      distractionSpans[0]?.matchedRuleName,
      testCase.expectedRuleName,
      `${testCase.description} should match the distraction rule`,
    );
  }
});

test("named website rule carries friendly match metadata", () => {
  const events = [
    makeEvent({
      id: "ev-1",
      kind: "untrackedFocused",
      timestampMs: 1000,
      browserTitle: "r/popular",
      browserUrl: "https://apps.uworld.com/courseapp/step2",
    }),
  ];
  const settings = makeSettings({
    autoWebsites: [{ id: "rule-uworld", name: "UWorld", target: "https://apps.uworld.com", kind: "website" }],
  });
  const spans = buildAutoTrackerV2PreviewSpans(events, settings);

  assert.equal(spans[0].classification, "tracked");
  assert.equal(spans[0].matchedRuleName, "UWorld");
  assert.equal(spans[0].matchedRuleTarget, "https://apps.uworld.com");
});

test("named distraction website rule carries friendly match metadata", () => {
  const events = [
    makeEvent({
      id: "ev-1",
      kind: "untrackedFocused",
      timestampMs: 1000,
      browserTitle: "r/popular",
      browserUrl: "https://www.reddit.com/r/popular",
    }),
  ];
  const settings = makeSettings({
    distractionWebsites: [{ id: "rule-reddit", name: "Reddit", target: "https://www.reddit.com", kind: "website" }],
  });
  const spans = buildAutoTrackerV2PreviewSpans(events, settings);

  assert.equal(spans[0].classification, "distraction");
  assert.equal(spans[0].matchedRuleName, "Reddit");
  assert.equal(spans[0].matchedRuleTarget, "https://www.reddit.com");
});

test("named app rule carries friendly match metadata", () => {
  const events = [
    makeEvent({
      id: "ev-1",
      kind: "targetFocused",
      timestampMs: 1000,
      appName: "Anki",
      bundleId: "net.ankiweb.dtop",
    }),
  ];
  const settings = makeSettings({
    autoApps: [{ id: "rule-anki", name: "Anki", target: "/Applications/Anki.app", kind: "app" }],
  });
  const spans = buildAutoTrackerV2PreviewSpans(events, settings);

  assert.equal(spans[0].classification, "tracked");
  assert.equal(spans[0].matchedRuleName, "Anki");
  assert.equal(spans[0].matchedRuleTarget, "/Applications/Anki.app");
});

test("Anki classified tracked when app rule is Anki", () => {
  const events = [
    makeEvent({
      id: "ev-1",
      kind: "targetFocused",
      timestampMs: 1000,
      appName: "Anki",
      bundleId: "net.ankiweb.dtop",
    }),
  ];
  const settings = makeSettings({ autoApps: ["Anki"] });
  const spans = buildAutoTrackerV2PreviewSpans(events, settings);
  assert.equal(spans[0].classification, "tracked");
  assert.ok(spans[0].classificationReason.includes("Anki"));
});

test("Anki classified tracked when app rule matches bundle id net.ankiweb.launcher", () => {
  const events = [
    makeEvent({
      id: "ev-1",
      kind: "targetFocused",
      timestampMs: 1000,
      appName: "Anki",
      bundleId: "net.ankiweb.launcher",
    }),
  ];
  const settings = makeSettings({ autoApps: ["net.ankiweb.launcher"] });
  const spans = buildAutoTrackerV2PreviewSpans(events, settings);
  assert.equal(spans[0].classification, "tracked");
});

test("Discord app classified distraction", () => {
  const events = [
    makeEvent({
      id: "ev-1",
      kind: "untrackedFocused",
      timestampMs: 1000,
      appName: "Discord",
      bundleId: "com.hnc.Discord",
    }),
  ];
  const settings = makeSettings({ distractionApps: ["Discord"] });
  const spans = buildAutoTrackerV2PreviewSpans(events, settings);
  assert.equal(spans[0].classification, "distraction");
  assert.ok(spans[0].classificationReason.includes("Discord"));
});

test("distraction wins if both tracked and distraction app rules match", () => {
  const events = [
    makeEvent({
      id: "ev-1",
      kind: "targetFocused",
      timestampMs: 1000,
      appName: "Anki",
      bundleId: "net.ankiweb.dtop",
    }),
  ];
  const settings = makeSettings({
    autoApps: ["Anki"],
    distractionApps: ["Anki"],
  });
  const spans = buildAutoTrackerV2PreviewSpans(events, settings);
  assert.equal(spans[0].classification, "distraction");
});

test("distraction wins if both tracked and distraction website rules match", () => {
  const events = [
    makeEvent({
      id: "ev-1",
      kind: "untrackedFocused",
      timestampMs: 1000,
      browserUrl: "https://uworld.com/test",
    }),
  ];
  const settings = makeSettings({
    autoWebsites: ["uworld.com"],
    distractionWebsites: ["uworld.com"],
  });
  const spans = buildAutoTrackerV2PreviewSpans(events, settings);
  assert.equal(spans[0].classification, "distraction");
});

test("unclassified fallback when no rules match", () => {
  const events = [
    makeEvent({
      id: "ev-1",
      kind: "targetFocused",
      timestampMs: 1000,
      appName: "SomeObscureApp",
    }),
  ];
  const settings = makeSettings({ autoApps: ["Anki"], distractionApps: ["Discord"] });
  const spans = buildAutoTrackerV2PreviewSpans(events, settings);
  assert.equal(spans[0].classification, "unclassified");
  assert.equal(spans[0].classificationReason, "no matching rule");
});

test("matching is case-insensitive for app names", () => {
  const events = [
    makeEvent({
      id: "ev-1",
      kind: "targetFocused",
      timestampMs: 1000,
      appName: "ANKI",
    }),
  ];
  const settings = makeSettings({ autoApps: ["anki"] });
  const spans = buildAutoTrackerV2PreviewSpans(events, settings);
  assert.equal(spans[0].classification, "tracked");
});

test("matching is case-insensitive for website rules", () => {
  const events = [
    makeEvent({
      id: "ev-1",
      kind: "untrackedFocused",
      timestampMs: 1000,
      browserUrl: "https://UWorld.COM/test",
    }),
  ];
  const settings = makeSettings({ autoWebsites: ["uworld.com"] });
  const spans = buildAutoTrackerV2PreviewSpans(events, settings);
  assert.equal(spans[0].classification, "tracked");
});

test("no settings produces unclassified spans", () => {
  const events = [
    makeEvent({
      id: "ev-1",
      kind: "targetFocused",
      timestampMs: 1000,
      appName: "Anki",
    }),
  ];
  const spans = buildAutoTrackerV2PreviewSpans(events);
  assert.equal(spans[0].classification, "unclassified");
});
