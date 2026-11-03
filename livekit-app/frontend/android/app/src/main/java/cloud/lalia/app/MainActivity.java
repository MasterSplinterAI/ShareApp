package cloud.lalia.app;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.AudioAttributes;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebSettings;
import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import java.util.ArrayList;
import java.util.List;

public class MainActivity extends BridgeActivity {
    private static final String CALL_CHANNEL_ID = "lalia_incoming_calls";
    private static final int CALL_NOTIFICATION_ID = 4101;
    private static final int PERMISSION_REQUEST_CODE = 5001;
    private Ringtone activeRingtone = null;
    private Vibrator activeVibrator = null;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        createCallNotificationChannel();
        requestEssentialRuntimePermissions();

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

    private void createCallNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CALL_CHANNEL_ID,
                "Incoming Lalia Calls",
                NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription("Rings and alerts you when someone calls you on Lalia");
            channel.enableVibration(true);
            Uri ringUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
            AudioAttributes attrs = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();
            channel.setSound(ringUri, attrs);
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) {
                nm.createNotificationChannel(channel);
            }
        }
    }

    private void startNativeRing(String callerName, String joinUrl) {
        stopNativeRing();
        try {
            Uri ringUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
            activeRingtone = RingtoneManager.getRingtone(getApplicationContext(), ringUri);
            if (activeRingtone != null) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    activeRingtone.setLooping(true);
                }
                activeRingtone.play();
            }
        } catch (Exception ignored) {}

        try {
            activeVibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            if (activeVibrator != null && activeVibrator.hasVibrator()) {
                long[] pattern = new long[]{0, 500, 400, 500, 1000};
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    activeVibrator.vibrate(VibrationEffect.createWaveform(pattern, 0));
                } else {
                    activeVibrator.vibrate(pattern, 0);
                }
            }
        } catch (Exception ignored) {}

        try {
            Intent intent = new Intent(this, MainActivity.class);
            intent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            if (joinUrl != null && !joinUrl.isEmpty()) {
                intent.setData(Uri.parse(joinUrl));
            }
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                flags |= PendingIntent.FLAG_IMMUTABLE;
            }
            PendingIntent pendingIntent = PendingIntent.getActivity(this, 0, intent, flags);

            NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CALL_CHANNEL_ID)
                .setSmallIcon(android.R.drawable.sym_action_call)
                .setContentTitle((callerName != null && !callerName.isEmpty() ? callerName : "Someone") + " is calling…")
                .setContentText("Incoming Lalia call with live translation · Tap to answer")
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setOngoing(true)
                .setAutoCancel(true)
                .setFullScreenIntent(pendingIntent, true)
                .setContentIntent(pendingIntent);

            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                nm.notify(CALL_NOTIFICATION_ID, builder.build());
            }
        } catch (Exception ignored) {}
    }

    private void stopNativeRing() {
        try {
            if (activeRingtone != null && activeRingtone.isPlaying()) {
                activeRingtone.stop();
            }
            activeRingtone = null;
        } catch (Exception ignored) {}

        try {
            if (activeVibrator != null) {
                activeVibrator.cancel();
            }
        } catch (Exception ignored) {}

        try {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                nm.cancel(CALL_NOTIFICATION_ID);
            }
        } catch (Exception ignored) {}
    }

    @Override
    public void onDestroy() {
        stopNativeRing();
        super.onDestroy();
    }

    public class LaliaNativeBridge {
        @JavascriptInterface
        public void ringIncomingCall(final String callerName, final String joinUrl) {
            runOnUiThread(() -> startNativeRing(callerName, joinUrl));
        }

        @JavascriptInterface
        public void stopIncomingCallRing() {
            runOnUiThread(() -> stopNativeRing());
        }
    }
}
