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
import android.provider.Settings;
import android.util.Log;
import android.view.KeyEvent;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityEvent;

/**
 * Garde Cinéma à l'écran.
 * Fire OS traite le bouton Accueil avant tout le monde, puis bloque ~5 s l'ouverture des autres
 * applis. Dès que l'accueil Amazon apparaît, on pose donc par-dessus le VRAI accueil Cinéma
 * (même écran, tuiles utilisables tout de suite) et on relance l'activité Cinéma en arrière-plan ;
 * quand elle a repris la main, le voile s'efface sans que rien ne bouge à l'écran.
 */
public class HomeGuardService extends AccessibilityService implements HomeScreen.Host {
    private static final String AMAZON_HOME = "com.amazon.tv.launcher";
    private static final String[] LET_THROUGH = {"Settings", "Quick", "Dialog", "Notification", "Profile"};
    private static final long[] RETRY = {0, 150, 400, 800, 1300, 2000, 2800, 3600, 4400, 5100, 5600, 6300, 7200, 8500, 10000, 12000};

    private final Handler h = new Handler(Looper.getMainLooper());
    private boolean cinemaOnTop;
    private int attempt;
    private HomeScreen cover;
    private AppRepo repo;
    private Prefs prefs;
    private String target;            // appli choisie depuis le voile, en attente d'ouverture
    private boolean ambientWanted;
    private BroadcastReceiver pkgReceiver;
    private final Runnable hideRun = this::hideCover;

    @Override protected void onServiceConnected() {
        Guard.serviceAlive = true;
        Guard.startKeeper(this);
        AccessibilityServiceInfo info = getServiceInfo();
        if (info != null) {
            info.flags |= AccessibilityServiceInfo.FLAG_REQUEST_FILTER_KEY_EVENTS;
            setServiceInfo(info);
        }
        pkgReceiver = new BroadcastReceiver() {
            @Override public void onReceive(Context c, Intent i) { if (repo != null) repo.dirty = true; }
        };
        IntentFilter f = new IntentFilter();
        f.addAction(Intent.ACTION_PACKAGE_ADDED);
        f.addAction(Intent.ACTION_PACKAGE_REMOVED);
        f.addAction(Intent.ACTION_PACKAGE_CHANGED);
        f.addDataScheme("package");
        registerReceiver(pkgReceiver, f);
        Log.i(Guard.TAG, "service Accueil prêt");
    }

    @Override protected boolean onKeyEvent(KeyEvent e) {
        int code = e.getKeyCode();
        if (code == KeyEvent.KEYCODE_HOME) Log.i(Guard.TAG, "touche Accueil vue par le service, action=" + e.getAction());
        return false; // Fire OS ne nous laisse de toute façon pas intercepter Accueil
    }

    @Override public void onAccessibilityEvent(AccessibilityEvent e) {
        if (e == null || e.getEventType() != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return;
        String pkg = e.getPackageName() == null ? "" : e.getPackageName().toString();
        String cls = e.getClassName() == null ? "" : e.getClassName().toString();

        if (pkg.equals(getPackageName())) {
            if (cls.endsWith("Activity")) {   // MainActivity ou Personnaliser (pas notre voile)
                cinemaOnTop = true;
                target = null;
                h.removeCallbacks(retry);
                Log.i(Guard.TAG, "Cinéma au premier plan");
                h.postDelayed(hideRun, 300);
            }
            return;
        }
        if (pkg.equals(AMAZON_HOME)) {
            Log.i(Guard.TAG, "accueil Amazon détecté : " + cls);
            if (prefs().amazonAllowed()) return;
            for (String k : LET_THROUGH) if (cls.contains(k)) return;
            // Accueil pressé alors qu'on était déjà sur Cinéma (ou sur le voile) : bascule fond d'écran seul
            boolean wasHome = cinemaOnTop || cover != null;
            ambientWanted = wasHome && !(cover != null ? cover.ambient : prefs().ambient());
            cinemaOnTop = false;
            target = null;
            showCover(ambientWanted);
            startRetry();
            return;
        }
        if (pkg.equals("com.android.systemui") || pkg.equals("android") || pkg.isEmpty()) return;
        // une autre appli est passée devant (celle choisie sur le voile, ou une autre) : on s'efface
        cinemaOnTop = false;
        boolean chosen = target != null;
        boolean systemAmazon = pkg.startsWith("com.amazon.");   // panneaux Amazon (Alexa, notifications…)
        if (cover != null && (chosen || !systemAmazon) && !cls.startsWith("android.widget") && !cls.startsWith("android.app.Dialog")) {
            Log.i(Guard.TAG, "appli au premier plan : " + pkg);
            h.removeCallbacks(retry);
            target = null;
            hideCover();
        }
    }

    private Prefs prefs() { prefs = new Prefs(this); return prefs; } // relu : modifié par l'autre processus

    // ---------- relance de l'activité Cinéma ----------

    private void startRetry() {
        h.removeCallbacks(retry);
        attempt = 0;
        h.post(retry);
    }

    private final Runnable retry = new Runnable() {
        @Override public void run() {
            if (target != null) return;              // l'utilisateur a choisi une appli : on ne la lui vole pas
            if (cinemaOnTop && attempt > 0) { hideCover(); return; }
            Intent i = new Intent(HomeGuardService.this, MainActivity.class)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
                    .putExtra(MainActivity.EXTRA_GUARD, true)
                    .putExtra(MainActivity.EXTRA_AMBIENT, cover != null ? cover.ambient : ambientWanted);
            try { startActivity(i); } catch (Throwable t) { Log.w(Guard.TAG, "lancement refusé", t); }
            attempt++;
            if (attempt < RETRY.length) h.postDelayed(this, RETRY[attempt] - RETRY[attempt - 1]);
            else Log.w(Guard.TAG, "Cinéma n'a pas encore repris la main (le voile reste utilisable)");
        }
    };

    // ---------- le voile = l'accueil complet, au-dessus de tout ----------

    private void showCover(boolean ambient) {
        h.removeCallbacks(hideRun);
        if (cover != null) { cover.setAmbient(ambient, true); return; }
        try {
            if (repo == null) repo = new AppRepo(this);
            HomeScreen hs = new HomeScreen(this, prefs(), repo, this);
            hs.rebuild();
            hs.setAmbient(ambient, false);
            hs.resume();
            WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                    WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT,
                    WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                    WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN | WindowManager.LayoutParams.FLAG_FULLSCREEN,
                    PixelFormat.OPAQUE);
            lp.windowAnimations = 0;
            ((WindowManager) getSystemService(WINDOW_SERVICE)).addView(hs, lp);
            cover = hs;
        } catch (Throwable t) {
            Log.w(Guard.TAG, "voile impossible", t);
            cover = null;
        }
    }

    private void hideCover() {
        h.removeCallbacks(hideRun);
        if (cover == null) return;
        HomeScreen c = cover;
        cover = null;
        try {
            c.release();
            ((WindowManager) getSystemService(WINDOW_SERVICE)).removeView(c);
        } catch (Throwable ignored) { }
    }

    // ---------- HomeScreen.Host (tuiles du voile) ----------

    @Override public void launch(Tile t) {
        if (HomeScreen.ACTION_RANDOM.equals(t.app.intent.getAction())) {
            Prefs p = prefs();
            p.setTheme(Themes.random(this, p.theme()));
            cover.rebuild();
            return;
        }
        target = t.app.pkg;
        h.removeCallbacks(retry);
        cover.showHint(t.app.label);
        try { startActivity(t.app.intent); }
        catch (Throwable e) { Log.w(Guard.TAG, "ouverture refusée", e); target = null; startRetry(); return; }
        h.postDelayed(hideRun, 9000); // l'appli s'ouvre au plus tard à la fin du blocage de Fire OS
    }

    @Override public void menu(Tile t) { launch(t); }

    @Override public void onInterrupt() { }

    @Override public boolean onUnbind(Intent i) {
        Guard.serviceAlive = false;
        hideCover();
        return super.onUnbind(i);
    }

    @Override public void onDestroy() {
        Guard.serviceAlive = false;
        hideCover();
        try { unregisterReceiver(pkgReceiver); } catch (Throwable ignored) { }
        super.onDestroy();
    }
}
