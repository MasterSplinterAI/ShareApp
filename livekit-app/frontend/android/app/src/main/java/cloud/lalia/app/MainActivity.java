package cloud.lalia.app;

import android.Manifest;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebSettings;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import java.util.ArrayList;
import java.util.List;

public class MainActivity extends BridgeActivity {
    private static final int PERMISSION_REQUEST_CODE = 5001;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestEssentialRuntimePermissions();
        startCallWatcherServiceIfAuthenticated();

        if (this.bridge != null && this.bridge.getWebView() != null) {
            WebSettings settings = this.bridge.getWebView().getSettings();
            settings.setMediaPlaybackRequiresUserGesture(false);
            settings.setJavaScriptCanOpenWindowsAutomatically(true);
            this.bridge.getWebView().addJavascriptInterface(new LaliaNativeBridge(), "LaliaAndroid");

            this.bridge.getWebView().setWebChromeClient(new BridgeWebChromeClient(this.bridge) {
                @Override
                public void onPermissionRequest(final PermissionRequest request) {
                    runOnUiThread(() -> {
                        try {
                            request.grant(request.getResources());
                        } catch (Exception ignored) {}
                    });
                }
            });
        }
    }

    @Override
    public void onPause() {
        super.onPause();
        // Keep WebView timers alive while backgrounded so active calls/streams are not throttled
        if (this.bridge != null && this.bridge.getWebView() != null) {
            this.bridge.getWebView().resumeTimers();
        }
    }

    private void startCallWatcherServiceIfAuthenticated() {
        SharedPreferences prefs = getSharedPreferences(CallPollingService.PREFS_NAME, MODE_PRIVATE);
        String token = prefs.getString(CallPollingService.KEY_AUTH_TOKEN, null);
        if (token != null && !token.isEmpty()) {
            startCallWatcherService();
        }
    }

    private void startCallWatcherService() {
        try {
            Intent svc = new Intent(this, CallPollingService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(svc);
            } else {
                startService(svc);
            }
        } catch (Exception ignored) {}
    }

    private void stopCallWatcherRing(String callId) {
        try {
            Intent svc = new Intent(this, CallPollingService.class);
            svc.setAction(CallPollingService.ACTION_STOP_RING);
            if (callId != null) {
                svc.putExtra("callId", callId);
            }
            startService(svc);
        } catch (Exception ignored) {}
    }

    private void requestEssentialRuntimePermissions() {
        List<String> needed = new ArrayList<>();
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            needed.add(Manifest.permission.RECORD_AUDIO);
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            needed.add(Manifest.permission.CAMERA);
        }
        if (Build.VERSION.SDK_INT >= 33) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                needed.add(Manifest.permission.POST_NOTIFICATIONS);
            }
        }
        if (!needed.isEmpty()) {
            ActivityCompat.requestPermissions(this, needed.toArray(new String[0]), PERMISSION_REQUEST_CODE);
        }
    }

    public class LaliaNativeBridge {
        @JavascriptInterface
        public void setAuthToken(final String token) {
            SharedPreferences prefs = getSharedPreferences(CallPollingService.PREFS_NAME, MODE_PRIVATE);
            prefs.edit().putString(CallPollingService.KEY_AUTH_TOKEN, token != null ? token : "").apply();
            if (token != null && !token.isEmpty()) {
                runOnUiThread(() -> startCallWatcherService());
            }
        }

        @JavascriptInterface
        public void ringIncomingCall(final String callerName, final String joinUrl) {
            runOnUiThread(() -> startCallWatcherService());
        }

        @JavascriptInterface
        public void stopIncomingCallRing() {
            runOnUiThread(() -> stopCallWatcherRing(null));
        }
    }
}
