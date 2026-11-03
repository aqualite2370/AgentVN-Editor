// Keep the documented entry point on the isolated, real Tauri/WebView2 test.
// A plain Chromium page cannot invoke the native GameCLI host commands.
require('./preview-window-native-playwright.cjs');
