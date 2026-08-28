from pathlib import Path


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f"missing expected source pattern: {label}")
    return text.replace(old, new, 1)


# APK version.
p = Path("android-app/app/build.gradle.kts")
s = p.read_text()
s = replace_once(s, "versionCode = 38", "versionCode = 39", "versionCode")
s = replace_once(s, 'versionName = "38.0-physical-phone-safe"', 'versionName = "39.0-ep6-split-network-live"', "versionName")
p.write_text(s)

# Permission used for selecting/binding the validated Internet network.
p = Path("android-app/app/src/main/AndroidManifest.xml")
s = p.read_text()
if "android.permission.CHANGE_NETWORK_STATE" not in s:
    s = replace_once(
        s,
        '    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />\n',
        '    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />\n'
        '    <uses-permission android:name="android.permission.CHANGE_NETWORK_STATE" />\n',
        "CHANGE_NETWORK_STATE",
    )
p.write_text(s)

# Main activity: preserve v38's known-good startup, but route cloud traffic to a
# validated Internet network (Ethernet first, then cellular, then Internet Wi-Fi).
p = Path("android-app/app/src/main/java/com/eara/ai/MainActivity.java")
s = p.read_text()
s = replace_once(s, "import android.app.Activity;\n", "import android.app.Activity;\nimport android.content.Context;\n", "Context import")
s = replace_once(
    s,
    "import android.graphics.Color;\nimport android.net.Uri;\n",
    "import android.graphics.Color;\n"
    "import android.net.ConnectivityManager;\n"
    "import android.net.Network;\n"
    "import android.net.NetworkCapabilities;\n"
    "import android.net.NetworkRequest;\n"
    "import android.net.Uri;\n",
    "network imports",
)
s = s.replace("?apk=38", "?apk=39").replace("Agent-1.0-Android/38", "Agent-1.0-Android/39")
s = replace_once(
    s,
    "    private OrdroCameraBridge ordroCamera;\n",
    "    private OrdroCameraBridge ordroCamera;\n"
    "    private ConnectivityManager connectivity;\n"
    "    private ConnectivityManager.NetworkCallback internetCallback;\n"
    "    private Network internetNetwork;\n"
    "    private String internetTransport = \"none\";\n"
    "    private boolean internetBound;\n",
    "internet fields",
)
s = replace_once(
    s,
    "            wearableSurface.setVisibility(View.INVISIBLE);\n",
    "            wearableSurface.setVisibility(View.VISIBLE);\n"
    "            // Keep the TextureView alive behind the WebView. A truly INVISIBLE\n"
    "            // surface may never receive decoded frames on some physical devices.\n"
    "            wearableSurface.setAlpha(0.01f);\n"
    "            wearableSurface.setClickable(false);\n",
    "TextureView visibility",
)
s = replace_once(
    s,
    "            configureWebView();\n            webView.loadUrl(APP_URL);\n",
    "            configureWebView();\n"
    "            startInternetRouting();\n"
    "            // Give Ethernet/cellular a moment to win over EP6's no-internet Wi-Fi.\n"
    "            mainHandler.postDelayed(() -> { if (webView != null) webView.loadUrl(APP_URL); }, 1200);\n",
    "startup Internet routing",
)
# Debug APK only: needed for deterministic UI verification in CI.
s = replace_once(s, "        WebView.setWebContentsDebuggingEnabled(false);", "        WebView.setWebContentsDebuggingEnabled(true);", "WebView debugging")

network_methods = r'''
    private void startInternetRouting() {
        if (internetCallback != null) return;
        connectivity = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        if (connectivity == null) return;

        internetCallback = new ConnectivityManager.NetworkCallback() {
            @Override public void onAvailable(Network network) { chooseBestInternetNetwork(); }
            @Override public void onCapabilitiesChanged(Network network, NetworkCapabilities caps) { chooseBestInternetNetwork(); }
            @Override public void onLost(Network network) {
                if (network.equals(internetNetwork)) {
                    internetNetwork = null;
                    internetTransport = "none";
                    internetBound = false;
                    try { connectivity.bindProcessToNetwork(null); } catch (Throwable ignored) {}
                }
                chooseBestInternetNetwork();
            }
        };
        try {
            NetworkRequest request = new NetworkRequest.Builder()
                    .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                    .build();
            connectivity.registerNetworkCallback(request, internetCallback);
        } catch (Throwable t) {
            Log.w(TAG, "Could not watch Internet networks", t);
        }
        chooseBestInternetNetwork();
    }

    private int internetPriority(NetworkCapabilities caps) {
        if (caps == null || !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                || !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)) return 0;
        if (caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) return 30;
        if (caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) return 20;
        if (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) return 10;
        return 5;
    }

    private String transportName(NetworkCapabilities caps) {
        if (caps == null) return "none";
        if (caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) return "ethernet";
        if (caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) return "cellular";
        if (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) return "wifi";
        return "other";
    }

    private void chooseBestInternetNetwork() {
        if (connectivity == null) return;
        Network best = null;
        NetworkCapabilities bestCaps = null;
        int bestPriority = 0;
        try {
            for (Network network : connectivity.getAllNetworks()) {
                NetworkCapabilities caps = connectivity.getNetworkCapabilities(network);
                int priority = internetPriority(caps);
                if (priority > bestPriority) {
                    best = network;
                    bestCaps = caps;
                    bestPriority = priority;
                }
            }
            if (best != null) {
                internetNetwork = best;
                internetTransport = transportName(bestCaps);
                internetBound = connectivity.bindProcessToNetwork(best);
            } else {
                internetNetwork = null;
                internetTransport = "none";
                internetBound = false;
                connectivity.bindProcessToNetwork(null);
            }
        } catch (Throwable t) {
            Log.w(TAG, "Could not select validated Internet network", t);
        }
        dispatchNetworkEvent();
    }

    private String networkStatusJson() {
        JSONObject o = new JSONObject();
        try {
            boolean ethernet = false, cellular = false, wifiInternet = false;
            if (connectivity != null) {
                for (Network network : connectivity.getAllNetworks()) {
                    NetworkCapabilities caps = connectivity.getNetworkCapabilities(network);
                    if (internetPriority(caps) <= 0) continue;
                    ethernet |= caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET);
                    cellular |= caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR);
                    wifiInternet |= caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI);
                }
            }
            o.put("ethernetAvailable", ethernet);
            o.put("cellularAvailable", cellular);
            o.put("wifiInternetAvailable", wifiInternet);
            o.put("internetBound", internetBound);
            o.put("internetTransport", internetTransport);
            o.put("mode", internetBound ? "validated-internet-plus-local-camera-wifi" : "default-network");
        } catch (Exception ignored) {}
        return o.toString();
    }

    private void dispatchNetworkEvent() {
        String json = networkStatusJson();
        evaluateJs("window.dispatchEvent(new CustomEvent('eara-native-network',{detail:" + json + "}));");
    }

'''
s = replace_once(s, "    @Override\n    protected void onActivityResult", network_methods + "    @Override\n    protected void onActivityResult", "network methods")

bridge_methods = r'''        @JavascriptInterface
        public String getNetworkRoutingStatus() {
            return networkStatusJson();
        }

        @JavascriptInterface
        public String refreshWearableCamera() {
            if (ordroCamera != null) ordroCamera.refreshExistingWifi();
            return getWearableCameraStatus();
        }

'''
s = replace_once(s, "        @JavascriptInterface\n        public String getWearableCameraStatus() {", bridge_methods + "        @JavascriptInterface\n        public String getWearableCameraStatus() {", "bridge network methods")
s = replace_once(
    s,
    "        public String connectWearableCamera() {\n            if (ordroCamera != null) ordroCamera.connect();",
    "        public String connectWearableCamera() {\n            startInternetRouting();\n            chooseBestInternetNetwork();\n            if (ordroCamera != null) ordroCamera.connect();",
    "camera split routing",
)
s = replace_once(
    s,
    "        if (speechRecognizer != null) {\n            speechRecognizer.destroy();\n            speechRecognizer = null;\n        }\n",
    "        if (speechRecognizer != null) {\n            speechRecognizer.destroy();\n            speechRecognizer = null;\n        }\n"
    "        try {\n"
    "            if (connectivity != null) {\n"
    "                connectivity.bindProcessToNetwork(null);\n"
    "                if (internetCallback != null) connectivity.unregisterNetworkCallback(internetCallback);\n"
    "            }\n"
    "        } catch (Throwable ignored) {}\n"
    "        internetCallback = null; internetNetwork = null; internetBound = false; internetTransport = \"none\";\n",
    "Internet callback cleanup",
)
p.write_text(s)

# Camera bridge: only use the verified iCatch live-preview path. Unknown RTSP
# paths can wedge this camera family, so there are no speculative fallbacks.
p = Path("android-app/app/src/main/java/com/eara/ai/OrdroCameraBridge.java")
s = p.read_text()
s = s.replace("private static final long RTSP_TIMEOUT_MS = 3500L;", "private static final long RTSP_TIMEOUT_MS = 9000L;")
s = replace_once(
    s,
    "    private Network findWifiNetwork() {\n        if (connectivity == null) return null;\n        for (Network network : connectivity.getAllNetworks()) {\n            NetworkCapabilities caps = connectivity.getNetworkCapabilities(network);\n            if (caps != null && caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) return network;\n        }\n        return null;\n    }\n",
    "    private Network findWifiNetwork() {\n        if (connectivity == null) return null;\n        for (Network network : connectivity.getAllNetworks()) {\n            NetworkCapabilities caps = connectivity.getNetworkCapabilities(network);\n            if (caps != null && caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)\n                    && isLikelyCameraNetwork(network)) return network;\n        }\n        return null;\n    }\n",
    "camera Wi-Fi selection",
)
s = replace_once(
    s,
    "        candidates.add(\"rtsp://\" + host + \"/MJPG\");\n        candidates.add(\"rtsp://\" + host + \"/MJPG?W=720&H=400&Q=50&BR=5000000\");\n        candidates.add(\"rtsp://\" + host + \"/LIVE\");\n        candidates.add(\"rtsp://\" + host + \"/STREAM\");\n",
    "        candidates.add(\"rtsp://\" + host + \"/MJPG\");\n",
    "safe RTSP candidate list",
)
s = replace_once(
    s,
    "            @Override public void onPlaybackStateChanged(int playbackState) {\n                if (playbackState == Player.STATE_READY) {\n                    frameReady = true;\n                    update(\"ready\", true, \"\");\n                    player.play();\n                }\n            }\n            @Override public void onPlayerError(PlaybackException error) {\n                lastError = error.getMessage() == null ? \"RTSP stream error\" : error.getMessage();\n                main.postDelayed(() -> tryCandidate(), 250);\n            }\n",
    "            @Override public void onPlaybackStateChanged(int playbackState) {\n                if (playbackState == Player.STATE_READY && !frameReady) {\n                    update(\"waiting-first-frame\", false, \"EP6 stream opened; waiting for video frame.\");\n                    player.play();\n                }\n            }\n            @Override public void onRenderedFirstFrame() {\n                frameReady = true;\n                update(\"ready\", true, \"\");\n            }\n            @Override public void onPlayerError(PlaybackException error) {\n                lastError = error.getMessage() == null ? \"RTSP stream error\" : error.getMessage();\n                update(\"stream-error\", false, lastError);\n            }\n",
    "first-frame readiness",
)
if 'host + "/LIVE' in s or 'host + "/STREAM' in s:
    raise SystemExit("unsafe RTSP fallback remains")
p.write_text(s)

print("V39_SOURCE_PATCH=PASS")
