package fr.cinema.accueil;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.content.Intent;
import android.os.SystemClock;
import android.provider.Settings;
import android.view.KeyEvent;
import android.view.accessibility.AccessibilityEvent;

/**
 * Rend le bouton Accueil fiable sur Fire OS :
 * 1) appui court sur Accueil → intercepté avant Amazon, ouvre Cinéma directement ;
 *    appui long (> 0,7 s) → Paramètres Fire TV ;
 * 2) filet de sécurité : si l'accueil Amazon apparaît quand même, on le remplace aussitôt.
 */
public class HomeGuardService extends AccessibilityService {
    private static final String AMAZON_HOME = "com.amazon.tv.launcher";
    private static final String[] LET_THROUGH = {"Settings", "Quick", "Dialog", "Notification", "Profile", "Menu", "Search"};

    private long downAt;
    private long lastLaunch;
    private Prefs prefs;

    @Override protected void onServiceConnected() {
        prefs = new Prefs(this);
        AccessibilityServiceInfo info = getServiceInfo();
        if (info != null) {
            info.flags |= AccessibilityServiceInfo.FLAG_REQUEST_FILTER_KEY_EVENTS;
            setServiceInfo(info);
        }
    }

    @Override protected boolean onKeyEvent(KeyEvent e) {
        if (e.getKeyCode() != KeyEvent.KEYCODE_HOME) return false;
        if (prefs == null) prefs = new Prefs(this);
        if (!prefs.interceptHome()) return false;
        if (e.getAction() == KeyEvent.ACTION_DOWN) {
            if (e.getRepeatCount() == 0) downAt = e.getEventTime();
            return true;
        }
        if (e.getAction() == KeyEvent.ACTION_UP) {
            if (e.getEventTime() - downAt > 700) openFireSettings();
            else goHome();
            return true;
        }
        return true;
    }

    @Override public void onAccessibilityEvent(AccessibilityEvent e) {
        if (e == null || e.getEventType() != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return;
        if (!AMAZON_HOME.contentEquals(e.getPackageName() == null ? "" : e.getPackageName())) return;
        String cls = e.getClassName() == null ? "" : e.getClassName().toString();
        for (String k : LET_THROUGH) if (cls.contains(k)) return;
        goHome();
    }

    private void goHome() {
        long now = SystemClock.uptimeMillis();
        if (now - lastLaunch < 350) return;
        lastLaunch = now;
        Intent i = new Intent(this, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        try { startActivity(i); } catch (Throwable ignored) { }
    }

    private void openFireSettings() {
        try { startActivity(new Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); }
        catch (Throwable ignored) { goHome(); }
    }

    @Override public void onInterrupt() { }
}
