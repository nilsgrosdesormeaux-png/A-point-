package fr.cinema.accueil;

import android.content.ComponentName;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;

/**
 * Garde le service Accueil branché. Fire OS peut le couper (manque de mémoire, raccourci
 * d'accessibilité Amazon…) : on le remet tout seul grâce à la permission accordée par le script.
 */
final class Guard {
    static final String TAG = "CinemaGuard";
    private static final String KEY = Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES;
    /** Vrai tant que le service Accueil tourne (même processus « :garde » que KeeperService). */
    static volatile boolean serviceAlive;

    static String me(Context c) { return new ComponentName(c, HomeGuardService.class).flattenToString(); }

    static boolean listed(Context c) {
        String cur = Settings.Secure.getString(c.getContentResolver(), KEY);
        if (cur == null) return false;
        String me = me(c), shortMe = c.getPackageName() + "/.HomeGuardService";
        for (String s : cur.split(":")) if (s.equalsIgnoreCase(me) || s.equalsIgnoreCase(shortMe)) return true;
        return false;
    }

    /** Remet le service dans la liste. rebind = le retirer puis le remettre pour forcer le système à le relancer. */
    static boolean ensure(Context c, boolean rebind) {
        ContentResolver cr = c.getContentResolver();
        try {
            boolean on = Settings.Secure.getInt(cr, Settings.Secure.ACCESSIBILITY_ENABLED, 0) == 1;
            if (listed(c) && on && !rebind) return true;
            String cur = Settings.Secure.getString(cr, KEY);
            StringBuilder others = new StringBuilder();
            if (cur != null) for (String s : cur.split(":")) {
                if (s.isEmpty() || s.toLowerCase().startsWith(c.getPackageName() + "/")) continue;
                if (others.length() > 0) others.append(':');
                others.append(s);
            }
            if (rebind) Settings.Secure.putString(cr, KEY, others.toString());
            String val = others.length() == 0 ? me(c) : others + ":" + me(c);
            Settings.Secure.putString(cr, KEY, val);
            Settings.Secure.putInt(cr, Settings.Secure.ACCESSIBILITY_ENABLED, 1);
            Log.i(TAG, "service Accueil remis (rebind=" + rebind + ")");
            return true;
        } catch (SecurityException e) {
            Log.w(TAG, "permission WRITE_SECURE_SETTINGS manquante : relancer ./installer.sh");
            return false;
        }
    }

    static void startKeeper(Context c) {
        Intent i = new Intent(c, KeeperService.class);
        try {
            if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i); else c.startService(i);
        } catch (Throwable t) {
            Log.w(TAG, "keeper", t);
        }
    }
}
