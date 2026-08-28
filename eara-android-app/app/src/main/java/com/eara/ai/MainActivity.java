package com.eara.ai;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.media.AudioManager;
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
    private static final String APP_URL = "https://jesuscruz1984.github.io/-EARA-PWA/?apk=43";
    private static final String APP_HOST = "jesuscruz1984.github.io";
    private static final int PERMISSION_REQUEST = 4201;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private WebView webView;
    private SpeechRecognizer speechRecognizer;
    private Intent speechIntent;
    private PermissionRequest pendingWebPermission;
    private boolean nativeListening;
    private boolean nativeStarting;
    private long speechRequestToken;
    private AudioManager audioManager;
    private int savedMusicVolume = -1;
    private int savedSystemVolume = -1;
    private final Runnable restoreRecognizerAudio = this::restoreRecognizerAudio;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.rgb(3, 9, 20));
        getWindow().setNavigationBarColor(Color.rgb(3, 9, 20));

        webView = new WebView(this);
        setContentView(webView);
        configureWebView();
        // v43 holds one WebView microphone stream and performs segmented cloud
        // transcription. Do not create/start Android SpeechRecognizer: vendor
        // implementations can chirp and repeatedly release/reacquire the mic.
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
        settings.setUserAgentString(settings.getUserAgentString() + " EARA-Android/43 Stream-Microphone");

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
        // Ask recognition services for a longer session so quiet rooms do not cause
        // a rapid close/reopen loop. Some vendor services ignore these hints, so the
        // duplicate-start guard below remains the primary protection.
        speechIntent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS, 30000L);
        speechIntent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 6000L);
        speechIntent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 3500L);

        speechRecognizer.setRecognitionListener(new RecognitionListener() {
            @Override public void onReadyForSpeech(Bundle params) {
                nativeStarting = false;
                nativeListening = true;
                mainHandler.postDelayed(restoreRecognizerAudio, 300L);
            }
            @Override public void onBeginningOfSpeech() {}
            @Override public void onRmsChanged(float rmsdB) {}
            @Override public void onBufferReceived(byte[] buffer) {}
            @Override public void onEndOfSpeech() {}

            @Override
            public void onError(int error) {
                nativeStarting = false;
                nativeListening = false;
                mainHandler.postDelayed(restoreRecognizerAudio, 450L);
                dispatchNativeEvent("error", "", false, mapSpeechError(error));
                dispatchNativeEvent("end", "", true, "");
            }

            @Override
            public void onResults(Bundle results) {
                nativeStarting = false;
                nativeListening = false;
                mainHandler.postDelayed(restoreRecognizerAudio, 450L);
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
            // A WebView can request recovery from focus, pointer and recognition-end
            // events at nearly the same time. Never cancel a healthy session just to
            // satisfy a duplicate start; that was the main source of tablet clicking.
            if (nativeListening || nativeStarting) return;
            nativeStarting = true;
            final long requestToken = ++speechRequestToken;
            mainHandler.postDelayed(() -> {
                if (!nativeStarting || requestToken != speechRequestToken || speechRecognizer == null) return;
                suppressRecognizerAudio();
                try {
                    speechRecognizer.startListening(speechIntent);
                    mainHandler.postDelayed(() -> {
                        if (requestToken != speechRequestToken || !nativeStarting) return;
                        nativeStarting = false;
                        nativeListening = false;
                        try { speechRecognizer.cancel(); } catch (Exception ignored) {}
                        restoreRecognizerAudio();
                        dispatchNativeEvent("error", "", false, "audio-capture");
                        dispatchNativeEvent("end", "", true, "");
                    }, 5000L);
                } catch (Exception ex) {
                    nativeStarting = false;
                    nativeListening = false;
                    restoreRecognizerAudio();
                    dispatchNativeEvent("error", "", false, "audio-capture");
                    dispatchNativeEvent("end", "", true, "");
                }
            }, 120L);
        });
    }

    private void stopNativeListening() {
        runOnUiThread(() -> {
            speechRequestToken++;
            nativeStarting = false;
            boolean wasListening = nativeListening;
            nativeListening = false;
            if (speechRecognizer != null && wasListening) {
                suppressRecognizerAudio();
                try { speechRecognizer.cancel(); } catch (Exception ignored) {}
                mainHandler.postDelayed(restoreRecognizerAudio, 450L);
            }
        });
    }

    private void suppressRecognizerAudio() {
        try {
            if (audioManager == null) audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            if (audioManager == null) return;
            if (savedMusicVolume < 0) savedMusicVolume = audioManager.getStreamVolume(AudioManager.STREAM_MUSIC);
            if (savedSystemVolume < 0) savedSystemVolume = audioManager.getStreamVolume(AudioManager.STREAM_SYSTEM);
            audioManager.setStreamVolume(AudioManager.STREAM_MUSIC, 0, AudioManager.FLAG_REMOVE_SOUND_AND_VIBRATE);
            audioManager.setStreamVolume(AudioManager.STREAM_SYSTEM, 0, AudioManager.FLAG_REMOVE_SOUND_AND_VIBRATE);
            mainHandler.removeCallbacks(restoreRecognizerAudio);
            mainHandler.postDelayed(restoreRecognizerAudio, 900L);
        } catch (SecurityException ignored) {
            savedMusicVolume = -1;
            savedSystemVolume = -1;
        }
    }

    private void restoreRecognizerAudio() {
        try {
            if (audioManager != null) {
                if (savedMusicVolume >= 0) audioManager.setStreamVolume(
                    AudioManager.STREAM_MUSIC, savedMusicVolume, AudioManager.FLAG_REMOVE_SOUND_AND_VIBRATE);
                if (savedSystemVolume >= 0) audioManager.setStreamVolume(
                    AudioManager.STREAM_SYSTEM, savedSystemVolume, AudioManager.FLAG_REMOVE_SOUND_AND_VIBRATE);
            }
        } catch (SecurityException ignored) {
        } finally {
            savedMusicVolume = -1;
            savedSystemVolume = -1;
        }
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
        public boolean isListening() {
            return nativeListening || nativeStarting;
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
        mainHandler.removeCallbacksAndMessages(null);
        restoreRecognizerAudio();
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

