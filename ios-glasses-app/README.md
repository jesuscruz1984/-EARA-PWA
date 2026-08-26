# EARA Glasses (iPhone native bridge)

This is a separate iPhone test app for the HeyCyan/W610 glasses. It keeps the existing EARA PWA as the main interface, but wraps it in a native iOS shell so the app can use the HeyCyan QCSDK for Bluetooth camera control.

## Architecture

- Native iPhone app: EARA Glasses
- Embedded EARA PWA: https://jesuscruz1984.github.io/-EARA-PWA/
- Native bridge: QCSDK / CoreBluetooth
- W610 control: connect, battery, take photo
- Web/native bridge: WKScriptMessageHandler named `earaGlasses`
- Next phase: switch the glasses into Wi-Fi transfer mode, download the newest photo, then pass it back into EARA for AI vision.

## Why this exists

iPhone Safari/PWA does not expose Web Bluetooth to the page, so the W610 camera cannot be controlled directly from a pure PWA. A native wrapper can use Bluetooth while still displaying the existing EARA PWA.

## Test goals for v0.1

1. Launch EARA inside the native app.
2. Auto-scan for a W610 device.
3. Connect to the glasses through QCSDK.
4. Read battery status.
5. Trigger a W610 photo from the native bridge.
6. Expose native commands to the embedded PWA.

## SDK

The build workflow pulls the public HeyCyanSmartGlassesSDK repository at build time and copies `ios/QCSDK.framework` into `Vendor/`. The SDK repository states that QCSDK is proprietary; licensing should be confirmed before commercial distribution.

## Install note

An unsigned GitHub Actions build can verify compilation, but installing on a physical iPhone requires Apple code signing. For a test install we will either use an Apple Developer signing identity/TestFlight or sideload a signed development build.
