package fr.cinema.accueil;

import android.app.Activity;
import android.app.ActivityOptions;
import android.app.AlertDialog;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.Uri;
import android.os.Bundle;
import android.os.SystemClock;
import android.provider.Settings;
import android.widget.Toast;
import java.util.ArrayList;
import java.util.List;

/** L'accueil Cinéma : l'écran est dans HomeScreen, ici le cycle de vie, les menus et les lancements. */
public class MainActivity extends Activity implements HomeScreen.Host {
    static final String EXTRA_GUARD = "garde";
    static final String EXTRA_AMBIENT = "fond";
    static final String EXTRA_MENU = "menu";
    /** Demande au service de reposer l'accueil-voile par-dessus (après un menu de tuile). */
    static final String ACTION_OVERLAY = "fr.cinema.accueil.VOILE";

    private Prefs p;
    private AppRepo repo;
    private HomeScreen home;
    private boolean resumed;
    private long pausedAt;
    private BroadcastReceiver pkgReceiver;

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        p = new Prefs(this);
        repo = new AppRepo(this);
        home = new HomeScreen(this, p, repo, this);
        home.allowMusic = true;
        setContentView(home);

        pkgReceiver = new BroadcastReceiver() {
            @Override public void onReceive(Context c, Intent i) {
                repo.dirty = true;
                if (resumed) home.rebuild();
            }
        };
        IntentFilter f = new IntentFilter();
        f.addAction(Intent.ACTION_PACKAGE_ADDED);
        f.addAction(Intent.ACTION_PACKAGE_REMOVED);
        f.addAction(Intent.ACTION_PACKAGE_CHANGED);
        f.addDataScheme("package");
        registerReceiver(pkgReceiver, f);
        if (!p.amazonAllowed()) Guard.ensure(this, false);
        Guard.startKeeper(this);
        applyIntent(getIntent());
    }

    @Override protected void onResume() {
        super.onResume();
        resumed = true;
        maybeRandomTheme();
        if (home.built != p.version() || repo.dirty) home.rebuild();
        home.resume();
    }

    @Override protected void onPause() {
        resumed = false;
        pausedAt = SystemClock.elapsedRealtime();
        home.pause();
        super.onPause();
    }

    @Override protected void onDestroy() {
        try { unregisterReceiver(pkgReceiver); } catch (Throwable ignored) { }
        home.release();
        super.onDestroy();
    }

    @Override protected void onNewIntent(Intent i) {
        super.onNewIntent(i);
        setIntent(i);
        if (i != null && i.getBooleanExtra(EXTRA_GUARD, false)) applyIntent(i);
        else if (resumed) home.setAmbient(!home.ambient, true); // Accueil alors qu'on y est déjà
    }

    /** Le service Accueil indique s'il faut revenir en mode fond d'écran seul ou avec les tuiles. */
    private void applyIntent(Intent i) {
        boolean amb = i != null && i.getBooleanExtra(EXTRA_AMBIENT, false);
        home.setAmbient(amb, false);
        String key = i == null ? null : i.getStringExtra(EXTRA_MENU);
        if (key != null) {
            i.removeExtra(EXTRA_MENU);
            home.post(() -> { Tile t = home.findTile(key); if (t != null) menu(t); });
        }
    }

    /**
     * Quand le voile du service est posé au-dessus, l'activité perd le focus : on coupe
     * vidéo, animations et musique ici pour ne pas les faire tourner en double.
     */
    @Override public void onWindowFocusChanged(boolean has) {
        super.onWindowFocusChanged(has);
        if (!resumed) return;
        if (has) home.resume(); else home.pause();
    }

    @Override public void onBackPressed() { /* l'accueil reste l'accueil */ }

    // ---------- HomeScreen.Host ----------

    @Override public void launch(Tile t) {
        if (HomeScreen.ACTION_RANDOM.equals(t.app.intent.getAction())) {
            p.setTheme(Themes.random(this, p.theme()));
            home.rebuild();
            Toast.makeText(this, "Thème : " + Themes.get(p.theme()).name, Toast.LENGTH_SHORT).show();
            return;
        }
        try {
            Bundle anim = ActivityOptions.makeScaleUpAnimation(t.card, 0, 0, t.card.getWidth(), t.card.getHeight()).toBundle();
            startActivity(t.app.intent, anim);
        } catch (Throwable e) {
            if (t.app.system) {
                try { startActivity(new Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); return; }
                catch (Throwable ignored) { }
            }
            Toast.makeText(this, "Impossible d'ouvrir " + t.app.label, Toast.LENGTH_SHORT).show();
        }
    }

    @Override public void menu(Tile t) {
        if (t.app.system) return;
        final String pkg = t.app.pkg;
        final int row = t.row;
        List<String> labels = new ArrayList<>();
        List<Runnable> acts = new ArrayList<>();
        labels.add("Ouvrir");
        acts.add(() -> launch(t));
        if (row < Prefs.ROW_TITLES.length) {
            List<String> cur = p.row(row);
            int idx = cur.indexOf(pkg);
            if (idx > 0) { labels.add("◀  Déplacer à gauche"); acts.add(() -> move(row, idx, -1)); }
            if (idx >= 0 && idx < cur.size() - 1) { labels.add("Déplacer à droite  ▶"); acts.add(() -> move(row, idx, 1)); }
            for (int r = 0; r < Prefs.ROW_TITLES.length; r++) {
                if (r == row) continue;
                final int dest = r;
                labels.add("Mettre dans « " + Prefs.ROW_TITLES[r] + " »");
                acts.add(() -> transfer(pkg, row, dest));
            }
            labels.add("Retirer de « " + Prefs.ROW_TITLES[row] + " »");
            acts.add(() -> transfer(pkg, row, -1));
        } else {
            for (int r = 0; r < Prefs.ROW_TITLES.length; r++) {
                final int dest = r;
                labels.add("Ajouter à « " + Prefs.ROW_TITLES[r] + " »");
                acts.add(() -> transfer(pkg, -1, dest));
            }
            labels.add("Masquer cette appli");
            acts.add(() -> { p.hide(pkg); home.rebuild(); });
        }
        labels.add("Infos de l'application");
        acts.add(() -> {
            try {
                startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + pkg))
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            } catch (Throwable ignored) { }
        });
        new AlertDialog.Builder(this, R.style.CinemaDialog)
                .setTitle(t.app.label)
                .setItems(labels.toArray(new String[0]), (d, w) -> acts.get(w).run())
                .setOnDismissListener(d -> home.postDelayed(
                        () -> sendBroadcast(new Intent(ACTION_OVERLAY).setPackage(getPackageName())), 300))
                .show();
    }

    private void move(int row, int idx, int delta) {
        List<String> cur = p.row(row);
        String pkg = cur.remove(idx);
        cur.add(idx + delta, pkg);
        p.setRow(row, cur);
        p.setLastFocus(row + ":" + pkg);
        home.rebuild();
    }

    private void transfer(String pkg, int from, int to) {
        if (from >= 0) { List<String> a = p.row(from); a.remove(pkg); p.setRow(from, a); }
        if (to >= 0) { List<String> b = p.row(to); b.remove(pkg); b.add(pkg); p.setRow(to, b); }
        p.setLastFocus((to >= 0 ? to : 3) + ":" + pkg);
        home.rebuild();
    }

    /** Thème au hasard : à chaque allumage (accueil revu après 20 min) ou chaque jour. */
    private void maybeRandomTheme() {
        int mode = p.randomMode();
        if (mode == 0) return;
        boolean change = false;
        if (mode == 1) change = pausedAt == 0 || SystemClock.elapsedRealtime() - pausedAt > 20 * 60 * 1000L;
        if (mode == 2) {
            long day = System.currentTimeMillis() / 86400000L;
            if (p.lng("rndDay") != day) { p.setLng("rndDay", day); change = true; }
        }
        if (change) p.setTheme(Themes.random(this, p.theme()));
    }
}
