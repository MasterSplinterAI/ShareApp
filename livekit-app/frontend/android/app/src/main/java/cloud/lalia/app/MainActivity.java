package cloud.lalia.app;

import android.Manifest;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    private static final int PERMISSION_REQUEST_CODE = 5001;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @Override
    public void onCreate(Bundle savedInstanceState) {
        prepareCallIntentBeforeSuper(getIntent());
        super.onCreate(savedInstanceState);
        requestEssentialRuntimePermissions();
        startCallWatcherServiceIfAuthenticated();

        if (this.bridge != null && this.bridge.getWebView() != null) {
            WebView webView = this.bridge.getWebView();
            WebSettings settings = webView.getSettings();
            settings.setMediaPlaybackRequiresUserGesture(false);
            settings.setJavaScriptCanOpenWindowsAutomatically(true);
            webView.addJavascriptInterface(new LaliaNativeBridge(), "LaliaAndroid");

            webView.setWebChromeClient(new BridgeWebChromeClient(this.bridge) {
                @Override
                public void onPermissionRequest(final PermissionRequest request) {
                    runOnUiThread(() -> {
                        try {
                            Uri origin = request.getOrigin();
                            String host = origin != null && origin.getHost() != null
                                ? origin.getHost().toLowerCase()
                                : "";
                            boolean trustedOrigin =
                                host.equals("lalia.cloud") ||
                                host.endsWith(".lalia.cloud") ||
                                host.equals("localhost") ||
                                host.equals("127.0.0.1");
                            if (!trustedOrigin) {
                                request.deny();
                                return;
                            }
                            List<String> allowed = new ArrayList<>();
                            String[] requested = request.getResources();
                            if (requested != null) {
                                for (String res : requested) {
                                    if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(res) ||
                                        PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(res)) {
                                        allowed.add(res);
                                    }
                                }
                            }
                            if (!allowed.isEmpty()) {
                                request.grant(allowed.toArray(new String[0]));
                            } else {
                                request.deny();
                            }
                        } catch (Exception ignored) {}
                    });
                }
            });
        }

        handleIncomingCallIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        prepareCallIntentBeforeSuper(intent);
        super.onNewIntent(intent);
        setIntent(intent);
        handleIncomingCallIntent(intent);
    }

    @Override
    public void onResume() {
        super.onResume();
        syncTokenFromWebView();
    }

    @Override
    public void onPause() {
        super.onPause();
        // Keep WebView timers alive while backgrounded so active calls/streams are not throttled
        if (this.bridge != null && this.bridge.getWebView() != null) {
            this.bridge.getWebView().resumeTimers();
        }
    }

    private void prepareCallIntentBeforeSuper(Intent intent) {
        if (intent == null) return;
        String joinUrl = intent.getStringExtra(CallPollingService.EXTRA_JOIN_URL);
        Uri data = intent.getData();
        if ((joinUrl == null || joinUrl.isEmpty()) && data != null) {
            joinUrl = data.toString();
        }
        if (joinUrl != null && (joinUrl.contains("/join/") || joinUrl.contains("/room/"))) {
            String normalizedUrl = CallPollingService.normalizeJoinUrl(joinUrl);
            intent.setAction(Intent.ACTION_VIEW);
            intent.setData(Uri.parse(normalizedUrl));
        }
    }

    private void handleIncomingCallIntent(Intent intent) {
        if (intent == null) return;
        final String callId = intent.getStringExtra(CallPollingService.EXTRA_CALL_ID);
        String rawJoinUrl = intent.getStringExtra(CallPollingService.EXTRA_JOIN_URL);
        if ((rawJoinUrl == null || rawJoinUrl.isEmpty()) && intent.getData() != null) {
            rawJoinUrl = intent.getData().toString();
        }
        final boolean autoAnswer = intent.getBooleanExtra(CallPollingService.EXTRA_AUTO_ANSWER, false);

        if (callId != null && !callId.isEmpty()) {
            stopCallWatcherRing(callId);
            if (autoAnswer) {
                CallPollingService.respondToCallAsync(getApplicationContext(), callId, "accept");
            }
        }

        if (rawJoinUrl != null && (rawJoinUrl.contains("/join/") || rawJoinUrl.contains("/room/"))) {
            final String targetUrl = CallPollingService.normalizeJoinUrl(rawJoinUrl);
            navigateWebViewToCallUrl(targetUrl, callId != null ? callId : "");
        }
    }

    private void navigateWebViewToCallUrl(final String targetUrl, final String callId) {
        final String jsPayload = buildCallNavigateScript(targetUrl, callId);
        // Dispatch immediately and retry once if the WebView SPA is finishing cold start
        mainHandler.postDelayed(() -> executeJs(jsPayload), 150);
        mainHandler.postDelayed(() -> executeJs(jsPayload), 900);
    }

    private String buildCallNavigateScript(String targetUrl, String callId) {
        String quotedUrl = JSONObject.quote(targetUrl != null ? targetUrl : "");
        String quotedCallId = JSONObject.quote(callId != null ? callId : "");
        return "(function(){" +
            "try{" +
            "var url=" + quotedUrl + ";" +
            "var cid=" + quotedCallId + ";" +
            "window.dispatchEvent(new CustomEvent('lalia:android-call-navigate',{detail:{joinUrl:url,url:url,callId:cid}}));" +
            "var parsed=new URL(url,window.location.origin);" +
            "var targetPath=parsed.pathname+(parsed.search||'')+(parsed.hash||'');" +
            "if(window.location.pathname.indexOf('/join/')!==0 && window.location.pathname.indexOf('/room/')!==0){" +
            "window.location.assign(targetPath);" +
            "}" +
            "}catch(e){}" +
            "})();";
    }

    private void executeJs(String script) {
        if (this.bridge == null || this.bridge.getWebView() == null) return;
        try {
            this.bridge.getWebView().evaluateJavascript(script, null);
        } catch (Exception ignored) {}
    }

    private void syncTokenFromWebView() {
        if (this.bridge == null || this.bridge.getWebView() == null) return;
        try {
            this.bridge.getWebView().evaluateJavascript(
                "(function(){try{return localStorage.getItem('v2_token')||'';}catch(e){return '';}})();",
                value -> {
                    if (value == null) return;
                    String cleaned = value.trim();
                    if (cleaned.startsWith("\"") && cleaned.endsWith("\"") && cleaned.length() >= 2) {
                        cleaned = cleaned.substring(1, cleaned.length() - 1);
                    }
                    if (!cleaned.isEmpty() && !"null".equals(cleaned)) {
                        SharedPreferences prefs = getSharedPreferences(CallPollingService.PREFS_NAME, MODE_PRIVATE);
                        prefs.edit().putString(CallPollingService.KEY_AUTH_TOKEN, cleaned).apply();
                        startCallWatcherService();
                    }
                }
            );
        } catch (Exception ignored) {}
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
            if (callId != null && !callId.isEmpty()) {
                svc.putExtra(CallPollingService.EXTRA_CALL_ID, callId);
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

        @JavascriptInterface
        public void stopIncomingCallRing(final String callId) {
            runOnUiThread(() -> stopCallWatcherRing(callId));
        }
    }
}
