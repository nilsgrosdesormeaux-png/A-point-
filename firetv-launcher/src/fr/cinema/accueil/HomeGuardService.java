package fr.cinema.accueil;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.PixelFormat;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.KeyEvent;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityEvent;

/**
 * L'accueil Cinéma « au-dessus de tout ».
 * Fire OS traite le bouton Accueil avant n'importe quelle appli et ouvre son propre accueil.
 * Solution : dès que tu es sur l'accueil, l'écran Cinéma est affiché dans une couche
 * d'accessibilité qui reste par-dessus tout. Quand tu appuies sur Accueil, l'accueil Amazon
 * s'ouvre DESSOUS, invisible ; on bascule simplement en mode « fond d'écran seul ».
 * La couche s'efface dès qu'une appli passe au premier plan, et revient quand tu reviens.
 */
public class HomeGuardService extends AccessibilityService implements HomeScreen.Host {
    private static final String AMAZON_HOME = "com.amazon.tv.launcher";
    private static final String[] LET_THROUGH = {"Settings", "Quick", "Dialog", "Notification", "Profile"};
    private static final long[] RETRY = {0, 150, 400, 800, 1300, 2000, 2800, 3600, 4400, 5100, 5600, 6300, 7200, 8500, 10000, 12000};

    private final Handler h = new Handler(Looper.getMainLooper());
    private HomeScreen home;          // gardé en mémoire : réafficher la couche est instantané
    private boolean shown;
    private boolean cinemaUnder;      // l'activité Cinéma est sous la couche
    private int attempt;
    private AppRepo repo;
    private String target;            // appli lancée depuis la couche, en attente
    private BroadcastReceiver receiver;
    private final Runnable giveUp = () -> { if (target != null) { target = null; hide(); } };

    @Override protected void onServiceConnected() {
        Guard.serviceAlive = true;
        Guard.startKeeper(this);
        AccessibilityServiceInfo info = getServiceInfo();
        if (info != null) {
            info.flags |= AccessibilityServiceInfo.FLAG_REQUEST_FILTER_KEY_EVENTS;
            setServiceInfo(info);
        }
        receiver = new BroadcastReceiver() {
            @Override public void onReceive(Context c, Intent i) {
                if (MainActivity.ACTION_OVERLAY.equals(i.getAction())) { target = null; if (cinemaUnder) show(false); }
                else if (repo != null) repo.dirty = true;
            }
        };
        IntentFilter f = new IntentFilter();
        f.addAction(Intent.ACTION_PACKAGE_ADDED);
        f.addAction(Intent.ACTION_PACKAGE_REMOVED);
        f.addAction(Intent.ACTION_PACKAGE_CHANGED);
        f.addDataScheme("package");
        registerReceiver(receiver, f);
        registerReceiver(receiver, new IntentFilter(MainActivity.ACTION_OVERLAY));
        Log.i(Guard.TAG, "service Accueil prêt");
    }

    @Override protected boolean onKeyEvent(KeyEvent e) { return false; }

    @Override public void onAccessibilityEvent(AccessibilityEvent e) {
        if (e == null || e.getEventType() != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return;
        String pkg = e.getPackageName() == null ? "" : e.getPackageName().toString();
        String cls = e.getClassName() == null ? "" : e.getClassName().toString();
        if (prefs().amazonAllowed()) { hide(); return; }

        if (pkg.equals(getPackageName())) {
            if (cls.endsWith("MainActivity")) {             // retour sur l'accueil : on repose la couche
                cinemaUnder = true;
                if ("menu".equals(target)) return;          // menu d'une tuile ouvert dans l'activité
                target = null;
                h.removeCallbacks(retry);
                show(false);
            } else if (cls.endsWith("Activity")) {          // Personnaliser
                cinemaUnder = false;
                target = null;
                hide();
            }
            return;
        }
        if (pkg.equals(AMAZON_HOME)) {
            for (String k : LET_THROUGH) if (cls.contains(k)) return;
            Log.i(Guard.TAG, "accueil Amazon ouvert dessous : " + cls);
            if (shown && target == null) home.setAmbient(!home.ambient, true); // Accueil sur l'accueil
            else show(true);                                                  // Accueil depuis une appli
            cinemaUnder = false;
            target = null;
            startRetry();
            return;
        }
        if (pkg.equals("com.android.systemui") || pkg.equals("android") || pkg.isEmpty()) return;
        if (cls.startsWith("android.widget") || cls.startsWith("android.app.Dialog")) return;
        boolean amazonPanel = pkg.startsWith("com.amazon.");   // Alexa, notifications… : on reste
        if (shown && (target != null || !amazonPanel)) {
            Log.i(Guard.TAG, "appli au premier plan : " + pkg);
            cinemaUnder = false;
            target = null;
            h.removeCallbacks(retry);
            hide();
        }
    }

    private Prefs prefs() { return new Prefs(this); } // relu : modifié par l'autre processus

    // ---------- l'activité Cinéma revient sous la couche (sinon l'accueil Amazon resterait dessous) ----------

    private void startRetry() {
        h.removeCallbacks(retry);
        attempt = 0;
        h.post(retry);
    }

    private final Runnable retry = new Runnable() {
        @Override public void run() {
            if (target != null || cinemaUnder) return;
            Intent i = new Intent(HomeGuardService.this, MainActivity.class)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
                    .putExtra(MainActivity.EXTRA_GUARD, true)
                    .putExtra(MainActivity.EXTRA_AMBIENT, home != null && home.ambient);
            try { startActivity(i); } catch (Throwable t) { Log.w(Guard.TAG, "lancement refusé", t); }
            attempt++;
            if (attempt < RETRY.length) h.postDelayed(this, RETRY[attempt] - RETRY[attempt - 1]);
        }
    };

    // ---------- la couche ----------

    /** fromApp : on arrive d'une appli, donc on montre les tuiles (pas le mode fond seul). */
    private void show(boolean fromApp) {
        h.removeCallbacks(giveUp);
        try {
            Prefs p = prefs();
            if (repo == null) repo = new AppRepo(this);
            if (home == null) {
                home = new HomeScreen(this, p, repo, this);
                home.allowMusic = true;
            }
            if (home.built != p.version() || repo.dirty) home.rebuild();
            if (fromApp) home.setAmbient(false, false);
            if (!shown) {
                WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                        WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT,
                        WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                        WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN | WindowManager.LayoutParams.FLAG_FULLSCREEN,
                        PixelFormat.OPAQUE);
                lp.windowAnimations = 0;
                ((WindowManager) getSystemService(WINDOW_SERVICE)).addView(home, lp);
                shown = true;
                Tile t = home.findTile(p.lastFocus());
                if (t == null) t = home.findTile(null);
                if (t != null) t.requestFocus();
            }
            home.resume();
        } catch (Throwable t) {
            Log.w(Guard.TAG, "couche impossible", t);
            shown = false;
        }
    }

    private void hide() {
        h.removeCallbacks(giveUp);
        if (!shown || home == null) return;
        shown = false;
        try {
            home.pause();
            ((WindowManager) getSystemService(WINDOW_SERVICE)).removeView(home);
        } catch (Throwable ignored) { }
    }

    // ---------- tuiles de la couche ----------

    @Override public void launch(Tile t) {
        if (HomeScreen.ACTION_RANDOM.equals(t.app.intent.getAction())) {
            Prefs p = prefs();
            p.setTheme(Themes.random(this, p.theme()));
            home.rebuild();
            home.resume();
            return;
        }
        target = t.app.pkg;
        h.removeCallbacks(retry);
        home.showHint(t.app.label);
        try { startActivity(t.app.intent); }
        catch (Throwable e) { Log.w(Guard.TAG, "ouverture refusée", e); target = null; return; }
        h.postDelayed(giveUp, 9000);
    }

    /** Appui long : le menu (déplacer, masquer…) s'ouvre dans l'activité, puis la couche revient. */
    @Override public void menu(Tile t) {
        if (t.app.system) return;
        target = "menu";
        hide();
        try {
            startActivity(new Intent(this, MainActivity.class)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
                    .putExtra(MainActivity.EXTRA_GUARD, true)
                    .putExtra(MainActivity.EXTRA_MENU, t.key()));
        } catch (Throwable ignored) { }
    }

    @Override public void onInterrupt() { }

    @Override public boolean onUnbind(Intent i) {
        Guard.serviceAlive = false;
        hide();
        return super.onUnbind(i);
    }

    @Override public void onDestroy() {
        Guard.serviceAlive = false;
        hide();
        if (home != null) home.release();
        try { unregisterReceiver(receiver); } catch (Throwable ignored) { }
        super.onDestroy();
    }
}
