package fr.cinema.accueil;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.content.Intent;
import android.graphics.PixelFormat;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;
import android.util.Log;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityEvent;
import android.widget.FrameLayout;

/**
 * Garde Cinéma à l'écran.
 * Après un appui sur Accueil, Android bloque pendant ~5 s l'ouverture d'une autre appli
 * (protection « app switch ») : l'accueil Amazon gagnait donc la course. Désormais :
 *  - dès que l'accueil Amazon apparaît, un voile aux couleurs du thème le recouvre instantanément ;
 *  - Cinéma est relancé en boucle jusqu'à ce qu'il soit vraiment au premier plan, puis le voile disparaît.
 */
public class HomeGuardService extends AccessibilityService {
    private static final String AMAZON_HOME = "com.amazon.tv.launcher";
    private static final String[] LET_THROUGH = {"Settings", "Quick", "Dialog", "Notification", "Profile"};
    private static final long[] RETRY = {0, 150, 400, 800, 1300, 2000, 2800, 3600, 4400, 5100, 5600, 6300, 7500};

    private final Handler h = new Handler(Looper.getMainLooper());
    private long downAt;
    private boolean cinemaOnTop, amazonOnTop;
    private int attempt;
    private View cover;
    private ThemeView coverBg;
    private final Runnable hideRun = this::hideCover;

    @Override protected void onServiceConnected() {
        Guard.serviceAlive = true;
        Guard.startKeeper(this);
        AccessibilityServiceInfo info = getServiceInfo();
        if (info != null) {
            info.flags |= AccessibilityServiceInfo.FLAG_REQUEST_FILTER_KEY_EVENTS;
            setServiceInfo(info);
        }
        Log.i(Guard.TAG, "service Accueil prêt");
    }

    @Override protected boolean onKeyEvent(KeyEvent e) {
        int code = e.getKeyCode();
        if (code == KeyEvent.KEYCODE_HOME || code == KeyEvent.KEYCODE_MENU)
            Log.i(Guard.TAG, "touche " + KeyEvent.keyCodeToString(code) + " action=" + e.getAction());
        if (code != KeyEvent.KEYCODE_HOME) return false;
        Prefs prefs = new Prefs(this); // relu à chaque fois : les réglages changent dans l'autre processus
        if (prefs.amazonAllowed() || !prefs.interceptHome()) return false;
        if (e.getAction() == KeyEvent.ACTION_DOWN) {
            if (e.getRepeatCount() == 0) downAt = e.getEventTime();
            return true;
        }
        if (e.getAction() == KeyEvent.ACTION_UP) {
            if (e.getEventTime() - downAt > 700) openFireSettings();
            else bringCinema(false);
        }
        return true;
    }

    @Override public void onAccessibilityEvent(AccessibilityEvent e) {
        if (e == null || e.getEventType() != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return;
        String pkg = e.getPackageName() == null ? "" : e.getPackageName().toString();
        String cls = e.getClassName() == null ? "" : e.getClassName().toString();
        if (pkg.equals(getPackageName())) {
            if (cls.contains("Activity")) {           // MainActivity ou Personnaliser (pas notre voile)
                cinemaOnTop = true;
                amazonOnTop = false;
                Log.i(Guard.TAG, "Cinéma au premier plan");
                h.postDelayed(this::hideCover, 250);
            }
            return;
        }
        if (!pkg.equals(AMAZON_HOME)) return;
        cinemaOnTop = false;
        Log.i(Guard.TAG, "accueil Amazon détecté : " + cls);
        if (new Prefs(this).amazonAllowed()) return;
        for (String k : LET_THROUGH) if (cls.contains(k)) { amazonOnTop = false; return; }
        amazonOnTop = true;
        bringCinema(true);
    }

    /** Relance Cinéma jusqu'à ce qu'il soit au premier plan. */
    private void bringCinema(boolean withCover) {
        if (withCover) showCover();
        h.removeCallbacks(retry);
        attempt = 0;
        cinemaOnTop = false;
        h.post(retry);
    }

    private final Runnable retry = new Runnable() {
        @Override public void run() {
            if (cinemaOnTop && attempt > 0) { hideCover(); return; }
            launch();
            attempt++;
            if (attempt < RETRY.length) h.postDelayed(this, RETRY[attempt] - RETRY[attempt - 1]);
            else { Log.w(Guard.TAG, "Cinéma n'a pas pu reprendre la main"); hideCover(); }
        }
    };

    private void launch() {
        Intent i = new Intent(this, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        try { startActivity(i); } catch (Throwable t) { Log.w(Guard.TAG, "lancement refusé", t); }
    }

    /** Voile plein écran (fenêtre d'accessibilité, au-dessus de tout) pour ne jamais voir Amazon. */
    private void showCover() {
        if (cover != null) return;
        try {
            WindowManager wm = (WindowManager) getSystemService(WINDOW_SERVICE);
            FrameLayout f = new FrameLayout(this) {
                @Override public boolean dispatchKeyEvent(KeyEvent ev) {
                    if (ev.getKeyCode() == KeyEvent.KEYCODE_BACK && ev.getAction() == KeyEvent.ACTION_UP) hideCover();
                    return true; // les touches ne partent pas vers l'accueil Amazon caché dessous
                }
            };
            coverBg = new ThemeView(this);
            coverBg.setTheme(Themes.get(new Prefs(this).theme()), true);
            coverBg.resume();
            f.addView(coverBg, new FrameLayout.LayoutParams(-1, -1));
            WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                    WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT,
                    WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                    WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN | WindowManager.LayoutParams.FLAG_FULLSCREEN,
                    PixelFormat.OPAQUE);
            lp.windowAnimations = 0;
            wm.addView(f, lp);
            cover = f;
            h.removeCallbacks(hideRun);
            h.postDelayed(hideRun, 9000); // sécurité : jamais bloqué plus de 9 s
        } catch (Throwable t) {
            Log.w(Guard.TAG, "voile impossible", t);
            cover = null;
        }
    }

    private void hideCover() {
        if (cover == null) return;
        try {
            if (coverBg != null) coverBg.pause();
            ((WindowManager) getSystemService(WINDOW_SERVICE)).removeView(cover);
        } catch (Throwable ignored) { }
        cover = null;
        coverBg = null;
    }

    private void openFireSettings() {
        try { startActivity(new Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); }
        catch (Throwable ignored) { bringCinema(false); }
    }

    @Override public void onInterrupt() { }

    @Override public boolean onUnbind(Intent i) {
        Guard.serviceAlive = false;
        hideCover();
        return super.onUnbind(i);
    }

    @Override public void onDestroy() {
        Guard.serviceAlive = false;
        hideCover();
        super.onDestroy();
    }
}
