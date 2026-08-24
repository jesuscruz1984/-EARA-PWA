package com.eara.ai;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Locale;

public class MainActivity extends Activity {
    private static final String APP_URL = "https://jesuscruz1984.github.io/-EARA-PWA/";
    private static final String APP_HOST = "jesuscruz1984.github.io";
    private static final int PERMISSION_REQUEST = 4201;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private WebView webView;
    private SpeechRecognizer speechRecognizer;
    private Intent speechIntent;
    private PermissionRequest pendingWebPermission;
    private boolean nativeListening;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.rgb(3, 9, 20));
        getWindow().setNavigationBarColor(Color.rgb(3, 9, 20));

        webView = new WebView(this);
        setContentView(webView);
        configureWebView();
        configureNativeSpeech();
        requestRequiredPermissions();
        webView.loadUrl(APP_URL);
    }

    private void configureWebView() {
        WebView.setWebContentsDebuggingEnabled(false);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setUserAgentString(settings.getUserAgentString() + " EARA-Android/26");

        webView.addJavascriptInterface(new EaraNativeBridge(), "EARANative");
        webView.setWebViewClient(new WebViewClient() {
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
        });
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
            Toast.makeText(this, "Microphone permission is needed for the Eara wake word.", Toast.LENGTH_LONG).show();
            dispatchNativeEvent("error", "", false, "not-allowed");
        }
    }

    private void configureNativeSpeech() {
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
        runOnUiThread(() -> webView.evaluateJavascript(script, null));
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
        public void openAppSettings() {
            runOnUiThread(() -> {
                Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                intent.setData(Uri.parse("package:" + getPackageName()));
                startActivity(intent);
            });
        }
    }

    @Override
    protected void onPause() {
        stopNativeListening();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (speechRecognizer != null) {
            speechRecognizer.destroy();
            speechRecognizer = null;
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
