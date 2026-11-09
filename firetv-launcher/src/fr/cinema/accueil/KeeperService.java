package fr.cinema.accueil;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.database.ContentObserver;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.provider.Settings;

/**
 * Petit gardien (processus séparé, ~10 Mo) : surveille que le service Accueil reste actif
 * et le relance aussitôt s'il est coupé. Redémarré automatiquement par Android s'il est tué.
 */
public class KeeperService extends Service {
    private final Handler h = new Handler(Looper.getMainLooper());
    private int deadChecks;
    private ContentObserver obs;

    private final Runnable check = new Runnable() {
        @Override public void run() {
            Prefs p = new Prefs(KeeperService.this);
            if (!p.amazonAllowed()) {
                if (!Guard.listed(KeeperService.this)) { Guard.ensure(KeeperService.this, false); deadChecks = 0; }
                else if (!Guard.serviceAlive) {
                    // listé mais pas lancé : deux contrôles de suite → on force le redémarrage
                    if (++deadChecks >= 2) { Guard.ensure(KeeperService.this, true); deadChecks = 0; }
                } else deadChecks = 0;
            }
            h.postDelayed(this, 15000);
        }
    };

    @Override public void onCreate() {
        super.onCreate();
        String ch = "garde";
        Notification.Builder b;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel nc = new NotificationChannel(ch, "Accueil Cinéma", NotificationManager.IMPORTANCE_MIN);
            nc.setShowBadge(false);
            ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).createNotificationChannel(nc);
            b = new Notification.Builder(this, ch);
        } else b = new Notification.Builder(this);
        Notification n = b.setSmallIcon(R.drawable.icon).setContentTitle("Accueil Cinéma actif")
                .setPriority(Notification.PRIORITY_MIN).setOngoing(true).build();
        startForeground(7, n);

        obs = new ContentObserver(h) {
            @Override public void onChange(boolean self) {
                h.removeCallbacks(check);
                h.postDelayed(check, 400);
            }
        };
        getContentResolver().registerContentObserver(Settings.Secure.getUriFor(Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES), false, obs);
        getContentResolver().registerContentObserver(Settings.Secure.getUriFor(Settings.Secure.ACCESSIBILITY_ENABLED), false, obs);
        h.postDelayed(check, 1000);
    }

    @Override public int onStartCommand(Intent i, int f, int id) { return START_STICKY; }

    @Override public void onDestroy() {
        h.removeCallbacksAndMessages(null);
        if (obs != null) getContentResolver().unregisterContentObserver(obs);
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent i) { return null; }
}
