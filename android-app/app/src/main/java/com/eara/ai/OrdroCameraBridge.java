package com.eara.ai;

import android.app.Activity;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.net.ConnectivityManager;
import android.net.LinkProperties;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.net.RouteInfo;
import android.net.wifi.WifiManager;
import android.net.wifi.WifiNetworkSpecifier;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PatternMatcher;
import android.provider.Settings;
import android.content.Intent;
import android.view.TextureView;

import androidx.annotation.OptIn;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.rtsp.RtspMediaSource;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * Native bridge for the ORDRO EP6 Plus / OD Cam wearable camera.
 *
 * The camera runs its own Wi-Fi access point. We deliberately do NOT bind the
 * whole Android process to that Wi-Fi because the camera AP has no internet.
 * Instead Media3 gets the Wi-Fi Network's SocketFactory for RTSP only. This
 * lets Agent 1.0 keep using cellular/default internet for the AI backend.
 */
@OptIn(markerClass = UnstableApi.class)
public final class OrdroCameraBridge {
    public interface Listener { void onStatus(String json); }

    private static final String DEFAULT_HOST = "192.168.1.1";
    private static final String DEFAULT_PASSWORD = "12345678";
    private static final long RTSP_TIMEOUT_MS = 3500L;

    private final Activity activity;
    private final TextureView textureView;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ConnectivityManager connectivity;
    private final Listener listener;

    private ExoPlayer player;
    private Network cameraNetwork;
    private ConnectivityManager.NetworkCallback requestedCallback;
    private final List<String> candidates = new ArrayList<>();
    private int candidateIndex;
    private String state = "disconnected";
    private String host = DEFAULT_HOST;
    private String activeUrl = "";
    private String lastError = "";
    private boolean frameReady;

    public OrdroCameraBridge(Activity activity, TextureView textureView, Listener listener) {
        this.activity = activity;
        this.textureView = textureView;
        this.listener = listener;
        this.connectivity = (ConnectivityManager) activity.getSystemService(Context.CONNECTIVITY_SERVICE);
        textureView.setOpaque(true);
        textureView.setBackground(new ColorDrawable(Color.BLACK));
    }

    public synchronized String statusJson() {
        JSONObject o = new JSONObject();
        try {
            o.put("supported", true);
            o.put("device", "ORDRO EP6 Plus");
            o.put("state", state);
            o.put("ready", frameReady);
            o.put("host", host);
            o.put("rtspUrl", activeUrl);
            o.put("wifiPassword", DEFAULT_PASSWORD);
            o.put("error", lastError);
        } catch (Exception ignored) {}
        return o.toString();
    }

    public void refreshExistingWifi() {
        main.post(() -> {
            Network wifi = findWifiNetwork();
            if (wifi != null && isLikelyCameraNetwork(wifi)) {
                if (wifi.equals(cameraNetwork) && frameReady) return;
                cameraNetwork = wifi;
                host = gatewayFor(wifi);
                startRtsp(wifi);
            } else if (cameraNetwork == null) {
                update("disconnected", false, "Connect to the EP6 Wi-Fi hotspot to use the wearable camera.");
            }
        });
    }

    /**
     * Android 10+ asks the user to approve the EP6 local Wi-Fi connection.
     * The request intentionally does not require INTERNET capability.
     */
    public void connect() {
        main.post(() -> {
            Network existing = findWifiNetwork();
            if (existing != null && isLikelyCameraNetwork(existing)) {
                cameraNetwork = existing;
                host = gatewayFor(existing);
                startRtsp(existing);
                return;
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                try {
                    releaseRequestedNetwork();
                    WifiNetworkSpecifier specifier = new WifiNetworkSpecifier.Builder()
                            .setSsidPattern(new PatternMatcher("EP6", PatternMatcher.PATTERN_PREFIX))
                            .setWpa2Passphrase(DEFAULT_PASSWORD)
                            .build();
                    NetworkRequest request = new NetworkRequest.Builder()
                            .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
                            .removeCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                            .setNetworkSpecifier(specifier)
                            .build();
                    requestedCallback = new ConnectivityManager.NetworkCallback() {
                        @Override public void onAvailable(Network network) {
                            cameraNetwork = network;
                            host = gatewayFor(network);
                            main.post(() -> startRtsp(network));
                        }
                        @Override public void onUnavailable() {
                            update("disconnected", false, "EP6 Wi-Fi was not connected. Turn the camera Wi-Fi on and try again.");
                        }
                        @Override public void onLost(Network network) {
                            if (network.equals(cameraNetwork)) {
                                cameraNetwork = null;
                                main.post(() -> stopPlayer("Camera Wi-Fi disconnected."));
                            }
                        }
                    };
                    update("connecting", false, "Select the EP6 camera in the Android Wi-Fi prompt.");
                    connectivity.requestNetwork(request, requestedCallback, 30000);
                    return;
                } catch (Exception ex) {
                    lastError = ex.getMessage() == null ? ex.getClass().getSimpleName() : ex.getMessage();
                }
            }
            openWifiPanel();
            update("needs-wifi", false, "Join the EP6 Wi-Fi network, then return to Agent 1.0.");
        });
    }

    public void openWifiPanel() {
        main.post(() -> {
            try {
                Intent intent;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    intent = new Intent(Settings.Panel.ACTION_WIFI);
                } else {
                    intent = new Intent(Settings.ACTION_WIFI_SETTINGS);
                }
                activity.startActivity(intent);
            } catch (Exception ignored) {
                activity.startActivity(new Intent(Settings.ACTION_WIFI_SETTINGS));
            }
        });
    }

    public String captureFrameDataUrl() {
        final String[] out = {""};
        CountDownLatch latch = new CountDownLatch(1);
        Runnable capture = () -> {
            try {
                if (!frameReady || !textureView.isAvailable()) return;
                Bitmap source = textureView.getBitmap();
                if (source == null || source.getWidth() < 16 || source.getHeight() < 16) return;
                int max = 1280;
                float scale = Math.min(1f, (float) max / Math.max(source.getWidth(), source.getHeight()));
                Bitmap image = source;
                if (scale < 1f) {
                    image = Bitmap.createScaledBitmap(source,
                            Math.max(1, Math.round(source.getWidth() * scale)),
                            Math.max(1, Math.round(source.getHeight() * scale)), true);
                }
                ByteArrayOutputStream bytes = new ByteArrayOutputStream();
                image.compress(Bitmap.CompressFormat.JPEG, 84, bytes);
                String b64 = android.util.Base64.encodeToString(bytes.toByteArray(), android.util.Base64.NO_WRAP);
                out[0] = "data:image/jpeg;base64," + b64;
                if (image != source) image.recycle();
                source.recycle();
            } catch (Exception ex) {
                lastError = ex.getMessage() == null ? "Could not capture wearable frame." : ex.getMessage();
            } finally {
                latch.countDown();
            }
        };
        if (Looper.myLooper() == Looper.getMainLooper()) capture.run();
        else {
            main.post(capture);
            try { latch.await(1800, TimeUnit.MILLISECONDS); } catch (InterruptedException ignored) { Thread.currentThread().interrupt(); }
        }
        return out[0];
    }

    public void disconnect() {
        main.post(() -> {
            stopPlayer("Wearable camera disconnected.");
            cameraNetwork = null;
            releaseRequestedNetwork();
        });
    }

    public void release() {
        main.post(() -> {
            if (player != null) {
                player.release();
                player = null;
            }
            releaseRequestedNetwork();
        });
    }

    private Network findWifiNetwork() {
        if (connectivity == null) return null;
        for (Network network : connectivity.getAllNetworks()) {
            NetworkCapabilities caps = connectivity.getNetworkCapabilities(network);
            if (caps != null && caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) return network;
        }
        return null;
    }

    private boolean isLikelyCameraNetwork(Network network) {
        try {
            WifiManager wm = (WifiManager) activity.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            String ssid = wm != null && wm.getConnectionInfo() != null ? wm.getConnectionInfo().getSSID() : "";
            if (ssid != null && ssid.toUpperCase().contains("EP6")) return true;
        } catch (Exception ignored) {}
        NetworkCapabilities caps = connectivity == null ? null : connectivity.getNetworkCapabilities(network);
        boolean validatedInternet = caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED);
        return !validatedInternet && DEFAULT_HOST.equals(gatewayFor(network));
    }

    private String gatewayFor(Network network) {
        try {
            LinkProperties lp = connectivity.getLinkProperties(network);
            if (lp != null) {
                for (RouteInfo route : lp.getRoutes()) {
                    InetAddress gateway = route.getGateway();
                    if (gateway instanceof Inet4Address) return gateway.getHostAddress();
                }
            }
        } catch (Exception ignored) {}
        return DEFAULT_HOST;
    }

    private void buildCandidates() {
        candidates.clear();
        candidates.add("rtsp://" + host + "/MJPG");
        candidates.add("rtsp://" + host + "/MJPG?W=720&H=400&Q=50&BR=5000000");
        candidates.add("rtsp://" + host + "/LIVE");
        candidates.add("rtsp://" + host + "/STREAM");
    }

    @OptIn(markerClass = UnstableApi.class)
    private void startRtsp(Network network) {
        if (network == null) {
            update("disconnected", false, "No EP6 Wi-Fi network is available.");
            return;
        }
        stopPlayer(null);
        cameraNetwork = network;
        host = gatewayFor(network);
        buildCandidates();
        candidateIndex = 0;
        tryCandidate();
    }

    @OptIn(markerClass = UnstableApi.class)
    private void tryCandidate() {
        if (cameraNetwork == null || candidateIndex >= candidates.size()) {
            update("stream-error", false, "Connected to camera Wi-Fi, but the OD Cam preview stream was not detected. Open OD Cam once, then retry Agent 1.0.");
            return;
        }
        activeUrl = candidates.get(candidateIndex++);
        frameReady = false;
        state = "connecting-stream";
        lastError = "";
        emit();

        if (player != null) player.release();
        RtspMediaSource source = new RtspMediaSource.Factory()
                .setSocketFactory(cameraNetwork.getSocketFactory())
                .setForceUseRtpTcp(true)
                .setTimeoutMs(RTSP_TIMEOUT_MS)
                .createMediaSource(MediaItem.fromUri(activeUrl));
        player = new ExoPlayer.Builder(activity).build();
        player.setVolume(0f);
        player.setVideoTextureView(textureView);
        player.addListener(new Player.Listener() {
            @Override public void onPlaybackStateChanged(int playbackState) {
                if (playbackState == Player.STATE_READY) {
                    frameReady = true;
                    update("ready", true, "");
                    player.play();
                }
            }
            @Override public void onPlayerError(PlaybackException error) {
                lastError = error.getMessage() == null ? "RTSP stream error" : error.getMessage();
                main.postDelayed(() -> tryCandidate(), 250);
            }
        });
        player.setMediaSource(source);
        player.prepare();
        player.play();
    }

    private void stopPlayer(String message) {
        frameReady = false;
        activeUrl = "";
        if (player != null) {
            player.clearVideoTextureView(textureView);
            player.release();
            player = null;
        }
        if (message != null) update("disconnected", false, message);
    }

    private void releaseRequestedNetwork() {
        if (requestedCallback != null && connectivity != null) {
            try { connectivity.unregisterNetworkCallback(requestedCallback); } catch (Exception ignored) {}
            requestedCallback = null;
        }
    }

    private synchronized void update(String newState, boolean ready, String error) {
        state = newState;
        frameReady = ready;
        lastError = error == null ? "" : error;
        emit();
    }

    private void emit() {
        if (listener != null) listener.onStatus(statusJson());
    }
}
