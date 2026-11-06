package cloud.lalia.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import androidx.core.app.NotificationCompat;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;

public class CallPollingService extends Service {
    public static final String PREFS_NAME = "lalia_native_prefs";
    public static final String KEY_AUTH_TOKEN = "v2_token";
    public static final String ACTION_STOP_RING = "cloud.lalia.app.STOP_RING";
    public static final String ACTION_DECLINE_CALL = "cloud.lalia.app.DECLINE_CALL";

    public static final String EXTRA_CALL_ID = "lalia_call_id";
    public static final String EXTRA_CALLER_NAME = "lalia_caller_name";
    public static final String EXTRA_JOIN_URL = "lalia_join_url";
    public static final String EXTRA_AUTO_JOIN = "lalia_auto_join";
    public static final String EXTRA_AUTO_ANSWER = "lalia_auto_answer";

    private static final String STANDBY_CHANNEL_ID = "lalia_call_standby";
    private static final String CALL_CHANNEL_ID = "lalia_incoming_calls_v2";
    private static final int STANDBY_NOTIFICATION_ID = 4100;
    private static final int CALL_NOTIFICATION_ID = 4101;

    private ScheduledExecutorService scheduler;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private Ringtone activeRingtone = null;
    private Vibrator activeVibrator = null;
    private String currentlyRingingCallId = null;
    private final Set<String> dismissedCallIds = Collections.synchronizedSet(new HashSet<>());

    public static String appendAutoJoinParam(String rawUrl) {
        String normalized = (rawUrl == null || rawUrl.trim().isEmpty())
            ? "https://lalia.cloud/v2/app"
            : rawUrl.trim();
        if (normalized.startsWith("/")) {
            normalized = "https://lalia.cloud" + normalized;
        }
        if ((normalized.contains("/join/") || normalized.contains("/room/")) && !normalized.contains("autoJoin=1")) {
            normalized += normalized.contains("?") ? "&autoJoin=1" : "?autoJoin=1";
        }
        return normalized;
    }

    public static void respondToCallAsync(final Context context, final String callId, final String action) {
        if (context == null || callId == null || callId.isEmpty() || action == null || action.isEmpty()) {
            return;
        }
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        final String token = prefs.getString(KEY_AUTH_TOKEN, null);
        if (token == null || token.isEmpty()) {
            return;
        }
        Executors.newSingleThreadExecutor().execute(() -> {
            HttpURLConnection conn = null;
            try {
                URL url = new URL("https://lalia.cloud/api/v2/calls/" + Uri.encode(callId) + "/respond");
                conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setConnectTimeout(4000);
                conn.setReadTimeout(4000);
                conn.setDoOutput(true);
                conn.setRequestProperty("Authorization", "Bearer " + token);
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setRequestProperty("Accept", "application/json");
                String payload = "{\"action\":\"" + action + "\"}";
                try (OutputStream os = conn.getOutputStream()) {
                    os.write(payload.getBytes(StandardCharsets.UTF_8));
                }
                conn.getResponseCode();
            } catch (Exception ignored) {
            } finally {
                if (conn != null) {
                    conn.disconnect();
                }
            }
        });
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createChannels();
        startForegroundStandby();
        scheduler = Executors.newSingleThreadScheduledExecutor();
        scheduler.scheduleWithFixedDelay(this::pollIncomingCalls, 1, 3, TimeUnit.SECONDS);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null) {
            String action = intent.getAction();
            if (ACTION_STOP_RING.equals(action) || ACTION_DECLINE_CALL.equals(action)) {
                String callId = intent.getStringExtra(EXTRA_CALL_ID);
                if (callId == null || callId.isEmpty()) {
                    callId = intent.getStringExtra("callId");
                }
                if (callId == null || callId.isEmpty()) {
                    callId = currentlyRingingCallId;
                }
                if (callId != null && !callId.isEmpty()) {
                    dismissedCallIds.add(callId);
                    if (ACTION_DECLINE_CALL.equals(action)) {
                        respondToCallAsync(getApplicationContext(), callId, "decline");
                    }
                }
                mainHandler.post(this::stopRinging);
                return START_STICKY;
            }
        }
        startForegroundStandby();
        return START_STICKY;
    }

    private void startForegroundStandby() {
        Intent openIntent = new Intent(this, MainActivity.class);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent pi = PendingIntent.getActivity(this, 0, openIntent, flags);

        Notification standby = new NotificationCompat.Builder(this, STANDBY_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.sym_action_call)
            .setContentTitle("Lalia Call Receiver Active")
            .setContentText("Ready to receive translated calls")
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .setSilent(true)
            .setContentIntent(pi)
            .build();

        try {
            if (Build.VERSION.SDK_INT >= 34) {
                startForeground(
                    STANDBY_NOTIFICATION_ID,
                    standby,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
                );
            } else {
                startForeground(STANDBY_NOTIFICATION_ID, standby);
            }
        } catch (Exception ignored) {}
    }

    private void createChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm == null) return;

            NotificationChannel standbyChannel = new NotificationChannel(
                STANDBY_CHANNEL_ID,
                "Lalia Call Standby",
                NotificationManager.IMPORTANCE_LOW
            );
            standbyChannel.setDescription("Keeps Lalia connected for incoming calls in the background");
            standbyChannel.setShowBadge(false);
            nm.createNotificationChannel(standbyChannel);

            NotificationChannel callChannel = new NotificationChannel(
                CALL_CHANNEL_ID,
                "Incoming Lalia Calls",
                NotificationManager.IMPORTANCE_HIGH
            );
            callChannel.setDescription("Rings and alerts you when someone calls you on Lalia");
            callChannel.enableVibration(true);
            callChannel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            Uri ringUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
            AudioAttributes attrs = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();
            callChannel.setSound(ringUri, attrs);
            nm.createNotificationChannel(callChannel);
        }
    }

    private void pollIncomingCalls() {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        String token = prefs.getString(KEY_AUTH_TOKEN, null);
        if (token == null || token.isEmpty()) {
            if (currentlyRingingCallId != null) {
                mainHandler.post(this::stopRinging);
            }
            return;
        }

        HttpURLConnection conn = null;
        try {
            URL url = new URL("https://lalia.cloud/api/v2/calls/incoming");
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(4000);
            conn.setReadTimeout(4000);
            conn.setRequestProperty("Authorization", "Bearer " + token);
            conn.setRequestProperty("Accept", "application/json");

            int code = conn.getResponseCode();
            if (code != 200) {
                return;
            }

            BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream()));
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                sb.append(line);
            }
            reader.close();

            JSONObject json = new JSONObject(sb.toString());
            JSONArray calls = json.optJSONArray("incomingCalls");
            JSONObject activeCall = null;
            if (calls != null) {
                for (int i = 0; i < calls.length(); i++) {
                    JSONObject c = calls.optJSONObject(i);
                    if (c != null) {
                        String id = c.optString("id", "");
                        if (!id.isEmpty() && !dismissedCallIds.contains(id)) {
                            activeCall = c;
                            break;
                        }
                    }
                }
            }

            if (activeCall != null) {
                final String callId = activeCall.optString("id", "");
                final String callerName = activeCall.optString("callerName", "Someone");
                final String joinUrl = activeCall.optString("joinUrl", "https://lalia.cloud/v2/app");
                if (!callId.equals(currentlyRingingCallId)) {
                    currentlyRingingCallId = callId;
                    mainHandler.post(() -> triggerIncomingRing(callId, callerName, joinUrl));
                }
            } else {
                if (currentlyRingingCallId != null) {
                    currentlyRingingCallId = null;
                    mainHandler.post(this::stopRinging);
                }
            }
        } catch (Exception ignored) {
        } finally {
            if (conn != null) {
                conn.disconnect();
            }
        }
    }

    private void triggerIncomingRing(String callId, String callerName, String joinUrl) {
        stopRingingOnlyMedia();

        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                PowerManager.WakeLock wl = pm.newWakeLock(
                    PowerManager.PARTIAL_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP,
                    "lalia:incoming_call_wake"
                );
                wl.acquire(15000);
            }
        } catch (Exception ignored) {}

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
            final String answerUrl = appendAutoJoinParam(joinUrl);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                flags |= PendingIntent.FLAG_IMMUTABLE;
            }

            Intent fullScreenIntent = new Intent(Intent.ACTION_VIEW, Uri.parse(answerUrl), this, MainActivity.class);
            fullScreenIntent.addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK |
                Intent.FLAG_ACTIVITY_SINGLE_TOP |
                Intent.FLAG_ACTIVITY_CLEAR_TOP
            );
            fullScreenIntent.putExtra(EXTRA_CALL_ID, callId);
            fullScreenIntent.putExtra(EXTRA_CALLER_NAME, callerName);
            fullScreenIntent.putExtra(EXTRA_JOIN_URL, answerUrl);
            fullScreenIntent.putExtra(EXTRA_AUTO_JOIN, true);
            PendingIntent fullScreenPi = PendingIntent.getActivity(this, 101, fullScreenIntent, flags);

            Intent answerIntent = new Intent(Intent.ACTION_VIEW, Uri.parse(answerUrl), this, MainActivity.class);
            answerIntent.addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK |
                Intent.FLAG_ACTIVITY_SINGLE_TOP |
                Intent.FLAG_ACTIVITY_CLEAR_TOP
            );
            answerIntent.putExtra(EXTRA_CALL_ID, callId);
            answerIntent.putExtra(EXTRA_CALLER_NAME, callerName);
            answerIntent.putExtra(EXTRA_JOIN_URL, answerUrl);
            answerIntent.putExtra(EXTRA_AUTO_JOIN, true);
            answerIntent.putExtra(EXTRA_AUTO_ANSWER, true);
            PendingIntent answerPi = PendingIntent.getActivity(this, 103, answerIntent, flags);

            Intent declineIntent = new Intent(this, CallPollingService.class);
            declineIntent.setAction(ACTION_DECLINE_CALL);
            declineIntent.putExtra(EXTRA_CALL_ID, callId);
            declineIntent.putExtra("callId", callId);
            PendingIntent declinePi = PendingIntent.getService(this, 102, declineIntent, flags);

            NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CALL_CHANNEL_ID)
                .setSmallIcon(android.R.drawable.sym_action_call)
                .setContentTitle(callerName + " is calling you on Lalia…")
                .setContentText("Tap Answer to join immediately with live translation")
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOngoing(true)
                .setAutoCancel(true)
                .setFullScreenIntent(fullScreenPi, true)
                .setContentIntent(answerPi)
                .addAction(android.R.drawable.sym_action_call, "Answer", answerPi)
                .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Decline", declinePi);

            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                nm.notify(CALL_NOTIFICATION_ID, builder.build());
            }
        } catch (Exception ignored) {}
    }

    private void stopRingingOnlyMedia() {
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
    }

    private void stopRinging() {
        currentlyRingingCallId = null;
        stopRingingOnlyMedia();
        try {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                nm.cancel(CALL_NOTIFICATION_ID);
            }
        } catch (Exception ignored) {}
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // Keep call receiver alive even if the user swipes the app away from Recent Apps
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        String token = prefs.getString(KEY_AUTH_TOKEN, null);
        if (token != null && !token.isEmpty()) {
            try {
                Intent restart = new Intent(getApplicationContext(), CallPollingService.class);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    getApplicationContext().startForegroundService(restart);
                } else {
                    getApplicationContext().startService(restart);
                }
            } catch (Exception ignored) {}
        }
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        stopRinging();
        if (scheduler != null) {
            scheduler.shutdownNow();
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
