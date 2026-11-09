package fr.cinema.accueil;

import android.animation.ArgbEvaluator;
import android.animation.ValueAnimator;
import android.app.Activity;
import android.app.ActivityOptions;
import android.app.AlertDialog;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.os.SystemClock;
import android.provider.Settings;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import java.util.ArrayList;
import java.util.List;

/** L'accueil : fond, titre de l'appli sélectionnée, puis les lignes de tuiles. */
public class MainActivity extends Activity {
    private static final float[] SIZES = {1f, 0.86f, 0.72f};
    private static final String ALL_TITLE = "Toutes les applis";
    private static final String SYS_TITLE = "Réglages";

    private Prefs p;
    private AppRepo repo;
    private int built = -1;
    private boolean resumed;

    private ThemeView wall;
    private long pausedAt;
    private GradientDrawable glowGd;
    private int glowColor = 0xFF000000;
    private ValueAnimator glowAnim;
    private TextView heroTitle, heroSub;
    private ScrollView scroll;
    private LinearLayout rows;
    private View content, glowView;
    private boolean ambient;
    static final String EXTRA_GUARD = "garde";
    private BroadcastReceiver pkgReceiver;

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        p = new Prefs(this);
        repo = new AppRepo(this);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xFF000000);
        setContentView(root);

        wall = new ThemeView(this);
        root.addView(wall, new FrameLayout.LayoutParams(-1, -1));

        // halo qui prend la couleur de l'appli sélectionnée
        glowGd = new GradientDrawable();
        glowGd.setGradientType(GradientDrawable.RADIAL_GRADIENT);
        glowGd.setGradientCenter(0.12f, 0f);
        glowGd.setGradientRadius(getResources().getDisplayMetrics().widthPixels * 0.75f);
        glowGd.setColors(new int[]{0, 0});
        View glow = new View(this);
        glow.setBackground(glowGd);
        root.addView(glow, new FrameLayout.LayoutParams(-1, -1));
        glowView = glow;

        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setClipChildren(false);
        col.setPadding(0, Ui.dp(this, 34), 0, 0);
        root.addView(col, new FrameLayout.LayoutParams(-1, -1));
        content = col;

        LinearLayout hero = new LinearLayout(this);
        hero.setOrientation(LinearLayout.VERTICAL);
        hero.setPadding(Ui.dp(this, 64), 0, Ui.dp(this, 64), Ui.dp(this, 6));
        heroSub = new TextView(this);
        heroSub.setTextSize(12);
        heroSub.setLetterSpacing(0.22f);
        heroSub.setAllCaps(true);
        heroSub.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        heroTitle = new TextView(this);
        heroTitle.setTextSize(40);
        heroTitle.setTextColor(0xFFF5F2EC);
        heroTitle.setTypeface(Typeface.create("sans-serif-light", Typeface.NORMAL));
        heroTitle.setSingleLine(true);
        heroTitle.setShadowLayer(Ui.dp(this, 12), 0, Ui.dp(this, 2), 0x99000000);
        hero.addView(heroSub);
        hero.addView(heroTitle);
        col.addView(hero);

        scroll = new ScrollView(this);
        scroll.setVerticalScrollBarEnabled(false);
        scroll.setOverScrollMode(View.OVER_SCROLL_NEVER);
        scroll.setClipChildren(false);
        scroll.setClipToPadding(false);
        scroll.setSmoothScrollingEnabled(true);
        rows = new LinearLayout(this);
        rows.setOrientation(LinearLayout.VERTICAL);
        rows.setClipChildren(false);
        rows.setPadding(0, 0, 0, Ui.dp(this, 200));
        scroll.addView(rows, new ScrollView.LayoutParams(-1, -2));
        col.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1f));

        root.getViewTreeObserver().addOnGlobalFocusChangeListener((oldF, newF) -> {
            if (newF instanceof Tile) onTileFocused((Tile) newF);
        });

        pkgReceiver = new BroadcastReceiver() {
            @Override public void onReceive(Context c, Intent i) {
                repo.dirty = true;
                if (resumed) rebuild();
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
    }

    @Override protected void onResume() {
        super.onResume();
        resumed = true;
        maybeRandomTheme();
        if (built != p.version() || repo.dirty) rebuild();
        wall.resume();
    }

    @Override protected void onPause() {
        resumed = false;
        setAmbient(false, false);
        pausedAt = SystemClock.elapsedRealtime();
        wall.pause();
        super.onPause();
    }

    @Override protected void onDestroy() {
        try { unregisterReceiver(pkgReceiver); } catch (Throwable ignored) { }
        super.onDestroy();
    }

    /**
     * Bouton Accueil alors qu'on est déjà sur l'accueil : mode « fond d'écran seul »,
     * un nouvel appui (ou n'importe quelle touche) fait revenir les applis.
     * Les relances automatiques du gardien (EXTRA_GUARD) ne comptent pas comme un appui.
     */
    @Override protected void onNewIntent(Intent i) {
        super.onNewIntent(i);
        if (i != null && i.getBooleanExtra(EXTRA_GUARD, false)) return;
        if (resumed) setAmbient(!ambient, true);
    }

    private void setAmbient(boolean on, boolean anim) {
        ambient = on;
        float a = on ? 0f : 1f;
        if (anim) {
            content.animate().alpha(a).setDuration(450).start();
            glowView.animate().alpha(a).setDuration(450).start();
        } else {
            content.setAlpha(a);
            glowView.setAlpha(a);
        }
        if (!on && content != null) {
            View f = getCurrentFocus();
            if (!(f instanceof Tile)) { Tile t = findTile(p.lastFocus()); if (t != null) t.requestFocus(); }
        }
    }

    @Override public boolean dispatchKeyEvent(KeyEvent e) {
        if (ambient && e.getKeyCode() != KeyEvent.KEYCODE_HOME) {
            if (e.getAction() == KeyEvent.ACTION_UP) setAmbient(false, true);
            return true; // en mode fond d'écran, la touche sert seulement à faire revenir les applis
        }
        return super.dispatchKeyEvent(e);
    }

    @Override public void onBackPressed() { /* l'accueil reste l'accueil */ }

    @Override public boolean onKeyDown(int code, KeyEvent e) {
        if (code == KeyEvent.KEYCODE_MENU) { setAmbient(true, true); return true; }
        return super.onKeyDown(code, e);
    }

    // ---------- construction ----------

    private void rebuild() {
        repo.ensureRows(p);
        Themes.Def def = Themes.get(p.theme());
        int accent = def.accent;
        wall.setTheme(def, p.animatedBg());
        heroSub.setTextColor(accent);
        heroTitle.setTypeface(def.typeface());
        heroTitle.setAllCaps(def.caps);
        heroTitle.setLetterSpacing(def.spacing);

        String want = p.lastFocus();
        rows.removeAllViews();
        float m = SIZES[Math.max(0, Math.min(2, p.tileSize()))];
        int bigW = Ui.dp(this, 244 * m), midW = Ui.dp(this, 204 * m), smallW = Ui.dp(this, 164 * m);

        for (int r = 0; r < Prefs.ROW_TITLES.length; r++) {
            List<AppEntry> list = repo.resolve(p.row(r));
            if (!list.isEmpty()) addRow(Prefs.ROW_TITLES[r], list, r, r == 0 ? bigW : midW, accent);
        }
        if (p.showAll()) {
            List<AppEntry> others = repo.others(p);
            if (!others.isEmpty()) addRow(ALL_TITLE, others, 3, smallW, accent);
        }
        addRow(SYS_TITLE, systemEntries(), 4, smallW, accent);
        built = p.version();

        rows.post(() -> {
            Tile t = findTile(want);
            if (t == null) t = findTile(null);
            if (t != null) t.requestFocus();
        });
    }

    private void addRow(String title, List<AppEntry> apps, int row, int w, int accent) {
        int h = w * 9 / 16;
        LinearLayout block = new LinearLayout(this);
        block.setOrientation(LinearLayout.VERTICAL);
        block.setClipChildren(false);
        block.setTag(title);

        TextView t = new TextView(this);
        t.setText(title);
        t.setAllCaps(true);
        t.setLetterSpacing(0.18f);
        t.setTextSize(12);
        t.setTextColor(0x99FFFFFF);
        t.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        t.setPadding(Ui.dp(this, 64), Ui.dp(this, 14), 0, 0);
        block.addView(t);

        HorizontalScrollView hs = new HorizontalScrollView(this);
        hs.setHorizontalScrollBarEnabled(false);
        hs.setOverScrollMode(View.OVER_SCROLL_NEVER);
        hs.setClipChildren(false);
        hs.setClipToPadding(false);
        hs.setSmoothScrollingEnabled(true);
        LinearLayout line = new LinearLayout(this);
        line.setOrientation(LinearLayout.HORIZONTAL);
        line.setClipChildren(false);
        line.setClipToPadding(false);
        int pad = Ui.dp(this, 64);
        line.setPadding(pad, Ui.dp(this, 14), pad, Ui.dp(this, 16));
        boolean labels = p.labels();
        int style = p.tileStyle();
        for (AppEntry a : apps) {
            Tile tile = new Tile(this, a, row, w, h, style, accent, labels);
            tile.setOnClickListener(v -> launch((Tile) v));
            tile.setOnLongClickListener(v -> { showMenu((Tile) v); return true; });
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-2, -2);
            lp.rightMargin = Ui.dp(this, 22);
            line.addView(tile, lp);
        }
        hs.addView(line);
        block.addView(hs);
        rows.addView(block);
    }

    private List<AppEntry> systemEntries() {
        List<AppEntry> l = new ArrayList<>();
        l.add(sys("Thème au hasard", R.drawable.ic_dice, 0xFF4A2A1A, new Intent(ACTION_RANDOM)));
        l.add(sys("Personnaliser", R.drawable.ic_palette, 0xFF3A2C4A, new Intent(this, SettingsActivity.class)));
        l.add(sys("Paramètres", R.drawable.ic_gear, 0xFF2A3040, new Intent(Settings.ACTION_SETTINGS)));
        l.add(sys("Gérer les applis", R.drawable.ic_apps, 0xFF203A3A, new Intent(Settings.ACTION_APPLICATION_SETTINGS)));
        return l;
    }

    private AppEntry sys(String label, int icon, int color, Intent i) {
        AppEntry e = new AppEntry();
        e.pkg = "sys:" + label;
        e.label = label;
        e.icon = getDrawable(icon);
        e.color = color;
        e.intent = i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        e.system = true;
        return e;
    }

    private Tile findTile(String key) {
        for (int i = 0; i < rows.getChildCount(); i++) {
            ViewGroup line = (ViewGroup) ((ViewGroup) ((ViewGroup) rows.getChildAt(i)).getChildAt(1)).getChildAt(0);
            for (int j = 0; j < line.getChildCount(); j++) {
                Tile t = (Tile) line.getChildAt(j);
                if (key == null || key.equals(t.key())) return t;
            }
        }
        return null;
    }

    // ---------- focus ----------

    private void onTileFocused(Tile t) {
        View block = (View) t.getParent().getParent().getParent();
        heroSub.setText(String.valueOf(block.getTag()));
        if (!t.app.label.contentEquals(heroTitle.getText())) {
            heroTitle.setText(t.app.label);
            heroTitle.setAlpha(0.3f);
            heroTitle.animate().alpha(1f).setDuration(180).start();
        }
        animateGlow(t.app.color);
        p.setLastFocus(t.key());
        int target = Math.max(0, block.getTop() - Ui.dp(this, 2));
        scroll.post(() -> scroll.smoothScrollTo(0, target));
    }

    private void animateGlow(int to) {
        if (glowAnim != null) glowAnim.cancel();
        glowAnim = ValueAnimator.ofObject(new ArgbEvaluator(), glowColor, to);
        glowAnim.setDuration(420);
        glowAnim.addUpdateListener(a -> {
            glowColor = (Integer) a.getAnimatedValue();
            glowGd.setColors(new int[]{(glowColor & 0x00FFFFFF) | 0x50000000, glowColor & 0x00FFFFFF});
        });
        glowAnim.start();
    }

    // ---------- actions ----------

    private static final String ACTION_RANDOM = "fr.cinema.accueil.HASARD";

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

    private void launch(Tile t) {
        if (ACTION_RANDOM.equals(t.app.intent.getAction())) {
            p.setTheme(Themes.random(this, p.theme()));
            rebuild();
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

    private void showMenu(Tile t) {
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
            acts.add(() -> { p.hide(pkg); rebuild(); });
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
                .show();
    }

    private void move(int row, int idx, int delta) {
        List<String> cur = p.row(row);
        String pkg = cur.remove(idx);
        cur.add(idx + delta, pkg);
        p.setRow(row, cur);
        p.setLastFocus(row + ":" + pkg);
        rebuild();
    }

    private void transfer(String pkg, int from, int to) {
        if (from >= 0) { List<String> a = p.row(from); a.remove(pkg); p.setRow(from, a); }
        if (to >= 0) { List<String> b = p.row(to); b.remove(pkg); b.add(pkg); p.setRow(to, b); }
        p.setLastFocus((to >= 0 ? to : 3) + ":" + pkg);
        rebuild();
    }
}
