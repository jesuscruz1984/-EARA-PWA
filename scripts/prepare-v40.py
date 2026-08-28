from pathlib import Path

# Start from the already-tested v39 Android source transformation.
# This v40 preparation is also the build trigger after the live backend image fix.
exec(compile(Path("scripts/prepare-v39.py").read_text(), "scripts/prepare-v39.py", "exec"))


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f"missing expected v40 source pattern: {label}")
    return text.replace(old, new, 1)


# v40 APK identity.
p = Path("android-app/app/build.gradle.kts")
s = p.read_text()
s = replace_once(s, "versionCode = 39", "versionCode = 40", "versionCode")
s = replace_once(
    s,
    'versionName = "39.0-ep6-split-network-live"',
    'versionName = "40.0-live-camera-voice-history-ep6"',
    "versionName",
)
p.write_text(s)

# Force the WebView onto the v40 frontend URL / user agent rather than a stale v39 page.
p = Path("android-app/app/src/main/java/com/eara/ai/MainActivity.java")
s = p.read_text()
s = s.replace("?apk=39", "?apk=40").replace("Agent-1.0-Android/39", "Agent-1.0-Android/40")
p.write_text(s)

# Physical EP6 reliability fixes on top of the safe v39 camera bridge:
# - If Android hides the SSID, any non-validated Wi-Fi network is a valid local-camera
#   candidate. This is especially important when USB Ethernet supplies Internet.
# - Let Media3 negotiate UDP/TCP itself rather than forcing RTP/TCP.
# - Keep only /MJPG: no speculative endpoints that can wedge the camera service.
p = Path("android-app/app/src/main/java/com/eara/ai/OrdroCameraBridge.java")
s = p.read_text()
s = replace_once(s, "private static final long RTSP_TIMEOUT_MS = 9000L;", "private static final long RTSP_TIMEOUT_MS = 12000L;", "RTSP timeout")
s = replace_once(
    s,
    "        return !validatedInternet && DEFAULT_HOST.equals(gatewayFor(network));\n",
    "        // With USB Ethernet/cellular carrying Internet, EP6 is intentionally a\n"
    "        // non-validated local Wi-Fi network. Some tablets hide the SSID from\n"
    "        // apps even with permission, so do not require a hard-coded gateway.\n"
    "        return !validatedInternet;\n",
    "local EP6 Wi-Fi fallback",
)
s = replace_once(
    s,
    "                .setSocketFactory(cameraNetwork.getSocketFactory())\n                .setForceUseRtpTcp(true)\n                .setTimeoutMs(RTSP_TIMEOUT_MS)\n",
    "                .setSocketFactory(cameraNetwork.getSocketFactory())\n"
    "                // Default Media3 RTSP transport can start with UDP and fall back\n"
    "                // to TCP. Forcing TCP prevented preview on some iCatch cameras.\n"
    "                .setTimeoutMs(RTSP_TIMEOUT_MS)\n",
    "RTSP transport negotiation",
)
if 'host + "/LIVE' in s or 'host + "/STREAM' in s or 'MJPG?W=' in s:
    raise SystemExit("unsafe/speculative RTSP endpoint remains in v40")
if 'candidates.add("rtsp://" + host + "/MJPG")' not in s:
    raise SystemExit("safe /MJPG endpoint missing in v40")
p.write_text(s)

print("V40_SOURCE_PATCH=PASS")
