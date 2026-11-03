import { resolveBrowserViewportSize, syncHandheldDocumentViewport } from "../GameCli_framework/src/uiSkin/runtimeViewportMath.mjs";
const elements = [
  { style: { setProperty(name, value, priority) { this[name] = { value, priority }; } } },
  { style: { setProperty(name, value, priority) { this[name] = { value, priority }; } } },
  { style: { setProperty(name, value, priority) { this[name] = { value, priority }; } } },
];

Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: { userAgent: "Mozilla/5.0 (Linux; Android 15; AgentVN QA)" },
});
globalThis.document = {
  documentElement: elements[0],
  body: elements[1],
  getElementById() { return elements[2]; },
};
globalThis.window = {
  innerWidth: 1280,
  innerHeight: 380,
  visualViewport: { width: 1280, height: 720 },
  matchMedia() { return { matches: true }; },
};

function assert(condition, message, details) {
  if (!condition) {
    throw new Error(`${message}\n${details ? JSON.stringify(details, null, 2) : ""}`);
  }
}

const viewportCases = [
  { label: "reported-android-1280x720", width: 1280, height: 720, staleHeight: 380 },
  { label: "desktop-1440x900", width: 1440, height: 900, staleHeight: 420 },
  { label: "narrow-android-812x375", width: 812, height: 375, staleHeight: 240 },
  { label: "oversized-root-android-1280x576", width: 1280, height: 576, staleHeight: 976 },
];
for (const item of viewportCases) {
  const androidSize = resolveBrowserViewportSize(
    "android",
    { width: item.width, height: item.staleHeight },
    { width: item.width, height: item.height },
    { width: item.width, height: item.staleHeight },
  );
  assert(
    androidSize.width === item.width && androidSize.height === item.height,
    `${item.label}: Android must ignore stale root height`,
    androidSize,
  );
}
const androidSize = { width: 1280, height: 720 };

const desktopSize = resolveBrowserViewportSize(
  "desktop",
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
  { width: 1280, height: 720 },
);
assert(desktopSize.width === 1440 && desktopSize.height === 900, "Desktop must keep measured container size", desktopSize);

const previousDesktopSize = { width: 1440, height: 900 };
const recoveredDesktopSize = resolveBrowserViewportSize(
  "desktop",
  { width: 160, height: 90 },
  { width: 160, height: 90 },
  { width: 160, height: 90 },
  previousDesktopSize,
);
assert(
  recoveredDesktopSize.width === previousDesktopSize.width && recoveredDesktopSize.height === previousDesktopSize.height,
  "Desktop must reject a transient tiny resume measurement",
  recoveredDesktopSize,
);

const previousAndroidSize = { width: 1280, height: 720 };
const recoveredAndroidSize = resolveBrowserViewportSize(
  "android",
  { width: 128, height: 72 },
  { width: 128, height: 72 },
  { width: 128, height: 72 },
  previousAndroidSize,
);
assert(
  recoveredAndroidSize.width === previousAndroidSize.width && recoveredAndroidSize.height === previousAndroidSize.height,
  "Android must reject a transient tiny resume viewport",
  recoveredAndroidSize,
);

const transientPortraitAndroidSize = resolveBrowserViewportSize(
  "android",
  { width: 720, height: 1280 },
  { width: 720, height: 1280 },
  { width: 720, height: 1280 },
  previousAndroidSize,
);
assert(
  transientPortraitAndroidSize.width === previousAndroidSize.width
    && transientPortraitAndroidSize.height === previousAndroidSize.height,
  "Android landscape runtime must reject the transient portrait viewport emitted during screen unlock",
  transientPortraitAndroidSize,
);

const legitimateNarrowResize = resolveBrowserViewportSize(
  "desktop",
  { width: 320, height: 568 },
  { width: 320, height: 568 },
  { width: 320, height: 568 },
  previousDesktopSize,
);
assert(
  legitimateNarrowResize.width === 320 && legitimateNarrowResize.height === 568,
  "A legitimate narrow resize must not be mistaken for resume compression",
  legitimateNarrowResize,
);

syncHandheldDocumentViewport("android", androidSize);
for (const element of elements) {
  assert(
    element.style.width?.value === "1280px"
      && element.style.height?.value === "720px"
      && element.style.width?.priority === "important"
      && element.style.height?.priority === "important"
      && element.style["min-width"]?.value === "0px"
      && element.style["min-height"]?.value === "0px"
      && element.style["max-width"]?.value === "1280px"
      && element.style["max-height"]?.value === "720px",
    "Android document dimensions were not synchronized",
    element.style,
  );
}

console.log("android runtime viewport behavior: PASS");
