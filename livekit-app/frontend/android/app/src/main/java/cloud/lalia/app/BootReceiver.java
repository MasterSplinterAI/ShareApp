package cloud.lalia.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) return;
        String action = intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(action) || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {
            SharedPreferences prefs = context.getSharedPreferences(CallPollingService.PREFS_NAME, Context.MODE_PRIVATE);
            String token = prefs.getString(CallPollingService.KEY_AUTH_TOKEN, null);
            if (token != null && !token.isEmpty()) {
                try {
                    Intent svc = new Intent(context, CallPollingService.class);
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        context.startForegroundService(svc);
                    } else {
                        context.startService(svc);
                    }
                } catch (Exception ignored) {}
            }
        }
    }
}
