package com.eara.ai;

import android.Manifest;
import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.provider.Settings;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.util.Base64;
import android.util.Log;
import android.view.Gravity;
import android.view.TextureView;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Locale;

public class MainActivity extends Activity {
    private static final String TAG = "Agent10";
    private static final String APP_URL = "https://jesuscruz1984.github.io/-EARA-PWA/agent-1.0/?apk=36";
    private static final String APP_HOST = "jesuscruz1984.github.io";
    private static final int PERMISSION_REQUEST = 4201;
    private static final int FILE_CHOOSER_REQUEST = 4202;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private FrameLayout root;
    private TextView bootStatus;
    private TextureView wearableSurface;
    private WebView webView;
    private SpeechRecognizer speechRecognizer;
    private Intent speechIntent;
    private PermissionRequest pendingWebPermission;
    private ValueCallback<Uri[]> pendingFileChooser;
    private boolean nativeListening;
    private boolean appInitialized;
    private OrdroCameraBridge ordroCamera;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.rgb(250, 250, 250));
        getWindow().setNavigationBarColor(Color.WHITE);

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.WHITE);

        bootStatus = new TextView(this);
        bootStatus.setText("Agent 1.0\nStarting…");
        bootStatus.setTextColor(Color.rgb(25, 25, 25));
        bootStatus.setTextSize(22f);
        bootStatus.setGravity(Gravity.CENTER);
        bootStatus.setPadding(48, 48, 48, 48);
        root.addView(bootStatus, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));

        setContentView(root);
        root.post(() -> mainHandler.postDelayed(this::initializeApp, 120));
    }

    private void initializeApp() {
        if (appInitialized || isFinishing() || (Build.VERSION.SDK_INT >= 17 && isDestroyed())) return;
        appInitialized = true;
        setBootStatus("Agent 1.0\nOpening…");

        try {
            wearableSurface = new TextureView(this);
            wearableSurface.setVisibility(View.INVISIBLE);
            FrameLayout.LayoutParams wearableParams = new FrameLayout.LayoutParams(720, 400);
            root.addView(wearableSurface, 0, wearableParams);

            webView = new WebView(this);
            webView.setBackgroundColor(Color.WHITE);
            webView.setVisibility(View.INVISIBLE);
            root.addView(webView, 1, new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT));

            configureWebView();
            webView.clearCache(true);
            webView.loadUrl(APP_URL);
            mainHandler.postDelayed(this::initializeOptionalServices, 500);
        } catch (Throwable t) {
            Log.e(TAG, "Startup failed", t);
            showStartupFailure(t);
        }
    }

    private void initializeOptionalServices() {
        if (isFinishing() || (Build.VERSION.SDK_INT >= 17 && isDestroyed())) return;
        try {
            if (wearableSurface != null && ordroCamera == null) {
                ordroCamera = new OrdroCameraBridge(this, wearableSurface, this::dispatchWearableEvent);
            }
        } catch (Throwable t) {
            Log.e(TAG, "Wearable bridge initialization failed", t);
        }

        try {
            configureNativeSpeech();
        } catch (Throwable t) {
            Log.e(TAG, "Speech initialization failed", t);
        }

        try {
            requestRequiredPermissions();
        } catch (Throwable t) {
            Log.e(TAG, "Permission request failed", t);
        }
    }

    private void setBootStatus(String message) {
        if (bootStatus != null) bootStatus.setText(message);
    }

    private void revealWebView() {
        if (webView != null) webView.setVisibility(View.VISIBLE);
        if (bootStatus != null) bootStatus.setVisibility(View.GONE);
    }

    private void showStartupFailure(Throwable t) {
        if (webView != null) webView.setVisibility(View.GONE);
        if (bootStatus != null) {
            bootStatus.setVisibility(View.VISIBLE);
            String type = t == null ? "unknown error" : t.getClass().getSimpleName();
            bootStatus.setText("Agent 1.0 could not start.\n\n" + type +
                    "\n\nUpdate Android System WebView/Chrome and reopen Agent 1.0.");
        }
    }

    private void configureWebView() {
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setUserAgentString(settings.getUserAgentString() + " Agent-1.0-Android/36 ORDRO-EP6");

        webView.addJavascriptInterface(new EaraNativeBridge(), "EARANative");
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageCommitVisible(WebView view, String url) {
                revealWebView();
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                revealWebView();
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request != null && request.isForMainFrame()) {
                    String detail = error == null || error.getDescription() == null
                            ? "Check your internet connection."
                            : error.getDescription().toString();
                    setBootStatus("Agent 1.0\nCould not load\n\n" + detail);
                    if (bootStatus != null) bootStatus.setVisibility(View.VISIBLE);
                    if (webView != null) webView.setVisibility(View.GONE);
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("https".equalsIgnoreCase(uri.getScheme()) && APP_HOST.equalsIgnoreCase(uri.getHost())) {
                    return false;
                }
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (Exception ignored) {
                    Toast.makeText(MainActivity.this, "No app can open this link.", Toast.LENGTH_SHORT).show();
                }
                return true;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> handleWebPermission(request));
            }

            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> filePathCallback,
                                             FileChooserParams fileChooserParams) {
                if (pendingFileChooser != null) pendingFileChooser.onReceiveValue(null);
                pendingFileChooser = filePathCallback;
                try {
                    Intent chooser = fileChooserParams.createIntent();
                    chooser.addCategory(Intent.CATEGORY_OPENABLE);
                    startActivityForResult(chooser, FILE_CHOOSER_REQUEST);
                    return true;
                } catch (Exception e) {
                    Log.e(TAG, "Could not open Android file picker", e);
                    pendingFileChooser.onReceiveValue(null);
                    pendingFileChooser = null;
                    Toast.makeText(MainActivity.this, "Could not open file picker.", Toast.LENGTH_SHORT).show();
                    return false;
                }
            }
        });
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER_REQUEST) {
            Uri[] result = null;
            if (resultCode == RESULT_OK && data != null) {
                if (data.getClipData() != null) {
                    int count = data.getClipData().getItemCount();
                    result = new Uri[count];
                    for (int i = 0; i < count; i++) result[i] = data.getClipData().getItemAt(i).getUri();
                } else if (data.getData() != null) {
                    result = new Uri[]{data.getData()};
                }
            }
            if (pendingFileChooser != null) {
                pendingFileChooser.onReceiveValue(result);
                pendingFileChooser = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    private void handleWebPermission(PermissionRequest request) {
        Uri origin = request.getOrigin();
        if (origin == null || !"https".equalsIgnoreCase(origin.getScheme()) || !APP_HOST.equalsIgnoreCase(origin.getHost())) {
            request.deny();
            return;
        }

        boolean needsCamera = Arrays.asList(request.getResources()).contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE);
        boolean needsMic = Arrays.asList(request.getResources()).contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE);
        if ((needsCamera && !hasPermission(Manifest.permission.CAMERA)) ||
                (needsMic && !hasPermission(Manifest.permission.RECORD_AUDIO))) {
            pendingWebPermission = request;
            requestRequiredPermissions();
            return;
        }

        ArrayList<String> allowed = new ArrayList<>();
        for (String resource : request.getResources()) {
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource) && hasPermission(Manifest.permission.CAMERA)) {
                allowed.add(resource);
            } else if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource) && hasPermission(Manifest.permission.RECORD_AUDIO)) {
                allowed.add(resource);
            }
        }
        if (allowed.isEmpty()) request.deny();
        else request.grant(allowed.toArray(new String[0]));
    }

    private void requestRequiredPermissions() {
        ArrayList<String> missing = new ArrayList<>();
        if (!hasPermission(Manifest.permission.CAMERA)) missing.add(Manifest.permission.CAMERA);
        if (!hasPermission(Manifest.permission.RECORD_AUDIO)) missing.add(Manifest.permission.RECORD_AUDIO);
        if (Build.VERSION.SDK_INT >= 33) {
            if (!hasPermission(Manifest.permission.NEARBY_WIFI_DEVICES)) missing.add(Manifest.permission.NEARBY_WIFI_DEVICES);
        } else {
            if (!hasPermission(Manifest.permission.ACCESS_FINE_LOCATION)) missing.add(Manifest.permission.ACCESS_FINE_LOCATION);
        }
        if (!missing.isEmpty()) requestPermissions(missing.toArray(new String[0]), PERMISSION_REQUEST);
    }

    private boolean hasPermission(String permission) {
        return checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED;
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(code, permissions, results);
        if (code != PERMISSION_REQUEST) return;

        if (pendingWebPermission != null) {
            PermissionRequest request = pendingWebPermission;
            pendingWebPermission = null;
            handleWebPermission(request);
        }

        if (hasPermission(Manifest.permission.RECORD_AUDIO)) {
            dispatchNativeEvent("ready", "", false, "");
        } else {
            Toast.makeText(this, "Microphone permission is needed for voice input.", Toast.LENGTH_LONG).show();
            dispatchNativeEvent("error", "", false, "not-allowed");
        }
        if (ordroCamera != null) ordroCamera.refreshExistingWifi();
    }

    private void configureNativeSpeech() {
        if (speechRecognizer != null) return;
        if (!SpeechRecognizer.isRecognitionAvailable(this)) return;
        speechRecognizer = SpeechRecognizer.createSpeechRecognizer(this);
        speechIntent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        speechIntent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        speechIntent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.US.toLanguageTag());
        speechIntent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        speechIntent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3);

        speechRecognizer.setRecognitionListener(new RecognitionListener() {
            @Override public void onReadyForSpeech(Bundle params) { nativeListening = true; }
            @Override public void onBeginningOfSpeech() {}
            @Override public void onRmsChanged(float rmsdB) {}
            @Override public void onBufferReceived(byte[] buffer) {}
            @Override public void onEndOfSpeech() {}

            @Override
            public void onError(int error) {
                nativeListening = false;
                dispatchNativeEvent("error", "", false, mapSpeechError(error));
                dispatchNativeEvent("end", "", true, "");
            }

            @Override
            public void onResults(Bundle results) {
                nativeListening = false;
                String text = firstResult(results);
                if (!text.isEmpty()) dispatchNativeEvent("result", text, true, "");
                dispatchNativeEvent("end", "", true, "");
            }

            @Override
            public void onPartialResults(Bundle results) {
                String text = firstResult(results);
                if (!text.isEmpty()) dispatchNativeEvent("result", text, false, "");
            }

            @Override public void onEvent(int eventType, Bundle params) {}
        });
    }

    private String firstResult(Bundle bundle) {
        if (bundle == null) return "";
        ArrayList<String> values = bundle.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        return values == null || values.isEmpty() ? "" : values.get(0);
    }

    private String mapSpeechError(int error) {
        if (error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) return "not-allowed";
        if (error == SpeechRecognizer.ERROR_AUDIO) return "audio-capture";
        if (error == SpeechRecognizer.ERROR_NETWORK || error == SpeechRecognizer.ERROR_NETWORK_TIMEOUT) return "network";
        if (error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY) return "aborted";
        return "no-speech";
    }

    private void startNativeListening() {
        runOnUiThread(() -> {
            if (!hasPermission(Manifest.permission.RECORD_AUDIO)) {
                requestRequiredPermissions();
                dispatchNativeEvent("error", "", false, "not-allowed");
                dispatchNativeEvent("end", "", true, "");
                return;
            }
            if (speechRecognizer == null || speechIntent == null) {
                dispatchNativeEvent("error", "", false, "service-not-allowed");
                dispatchNativeEvent("end", "", true, "");
                return;
            }
            try {
                if (nativeListening) speechRecognizer.cancel();
                nativeListening = true;
                mainHandler.postDelayed(() -> {
                    try {
                        speechRecognizer.startListening(speechIntent);
                    } catch (Exception ex) {
                        nativeListening = false;
                        dispatchNativeEvent("error", "", false, "audio-capture");
                        dispatchNativeEvent("end", "", true, "");
                    }
                }, 80);
            } catch (Exception ex) {
                nativeListening = false;
                dispatchNativeEvent("error", "", false, "audio-capture");
                dispatchNativeEvent("end", "", true, "");
            }
        });
    }

    private void stopNativeListening() {
        runOnUiThread(() -> {
            nativeListening = false;
            if (speechRecognizer != null) {
                try { speechRecognizer.cancel(); } catch (Exception ignored) {}
            }
        });
    }

    private void dispatchNativeEvent(String type, String text, boolean isFinal, String error) {
        if (webView == null) return;
        String script = "window.dispatchEvent(new CustomEvent('eara-native-speech',{detail:{" +
                "type:" + JSONObject.quote(type) + "," +
                "text:" + JSONObject.quote(text == null ? "" : text) + "," +
                "final:" + isFinal + "," +
                "error:" + JSONObject.quote(error == null ? "" : error) +
                "}}));";
        runOnUiThread(() -> {
            if (webView != null) webView.evaluateJavascript(script, null);
        });
    }

    private void dispatchWearableEvent(String statusJson) {
        if (webView == null || statusJson == null || statusJson.isEmpty()) return;
        String script = "window.dispatchEvent(new CustomEvent('eara-native-wearable',{detail:" + statusJson + "}));";
        runOnUiThread(() -> {
            if (webView != null) webView.evaluateJavascript(script, null);
        });
    }

    private void saveGeneratedFile(String filename, String mime, String base64Data) {
        runOnUiThread(() -> {
            String safe = (filename == null || filename.trim().isEmpty()) ? "Agent-Document" : filename.replaceAll("[\\\\/:*?\"<>|]", "-");
            String type = (mime == null || mime.isEmpty()) ? "application/octet-stream" : mime;
            Uri savedUri = null;
            try {
                byte[] bytes = Base64.decode(base64Data, Base64.DEFAULT);
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.Downloads.DISPLAY_NAME, safe);
                    values.put(MediaStore.Downloads.MIME_TYPE, type);
                    values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Agent1");
                    values.put(MediaStore.Downloads.IS_PENDING, 1);
                    savedUri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                    if (savedUri == null) throw new IllegalStateException("Downloads insert failed");
                    try (OutputStream out = getContentResolver().openOutputStream(savedUri)) {
                        if (out == null) throw new IllegalStateException("Downloads output stream failed");
                        out.write(bytes);
                    }
                    ContentValues ready = new ContentValues();
                    ready.put(MediaStore.Downloads.IS_PENDING, 0);
                    getContentResolver().update(savedUri, ready, null, null);
                } else {
                    File dir = new File(getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "Agent1");
                    if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("Could not create download folder");
                    File file = new File(dir, safe);
                    try (FileOutputStream out = new FileOutputStream(file)) { out.write(bytes); }
                }
                Toast.makeText(this, "Saved to Downloads/Agent1: " + safe, Toast.LENGTH_LONG).show();
                if (savedUri != null) {
                    try {
                        Intent view = new Intent(Intent.ACTION_VIEW);
                        view.setDataAndType(savedUri, type);
                        view.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        startActivity(view);
                    } catch (Exception ignored) {
                        // The file is saved even when no PDF/Word viewer is installed.
                    }
                }
            } catch (Throwable t) {
                Log.e(TAG, "Could not save generated file", t);
                Toast.makeText(this, "Could not save " + safe, Toast.LENGTH_LONG).show();
            }
        });
    }

    public class EaraNativeBridge {
        @JavascriptInterface
        public boolean isAvailable() {
            return speechRecognizer != null;
        }

        @JavascriptInterface
        public void startListening() {
            startNativeListening();
        }

        @JavascriptInterface
        public void stopListening() {
            stopNativeListening();
        }

        @JavascriptInterface
        public String getWearableCameraStatus() {
            return ordroCamera == null ? "{\"supported\":false}" : ordroCamera.statusJson();
        }

        @JavascriptInterface
        public String connectWearableCamera() {
            if (ordroCamera != null) ordroCamera.connect();
            return getWearableCameraStatus();
        }

        @JavascriptInterface
        public String captureWearableFrame() {
            return ordroCamera == null ? "" : ordroCamera.captureFrameDataUrl();
        }

        @JavascriptInterface
        public void disconnectWearableCamera() {
            if (ordroCamera != null) ordroCamera.disconnect();
        }

        @JavascriptInterface
        public void openWifiSettings() {
            if (ordroCamera != null) ordroCamera.openWifiPanel();
            else runOnUiThread(() -> startActivity(new Intent(Settings.ACTION_WIFI_SETTINGS)));
        }

        @JavascriptInterface
        public void openAppSettings() {
            runOnUiThread(() -> {
                Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                intent.setData(Uri.parse("package:" + getPackageName()));
                startActivity(intent);
            });
        }

        @JavascriptInterface
        public void saveBase64File(String filename, String mime, String base64Data) {
            saveGeneratedFile(filename, mime, base64Data);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (ordroCamera != null) mainHandler.postDelayed(ordroCamera::refreshExistingWifi, 700);
    }

    @Override
    protected void onPause() {
        stopNativeListening();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        mainHandler.removeCallbacksAndMessages(null);
        if (pendingFileChooser != null) {
            pendingFileChooser.onReceiveValue(null);
            pendingFileChooser = null;
        }
        if (speechRecognizer != null) {
            speechRecognizer.destroy();
            speechRecognizer = null;
        }
        if (ordroCamera != null) {
            ordroCamera.release();
            ordroCamera = null;
        }
        if (webView != null) {
            webView.removeJavascriptInterface("EARANative");
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }
}
