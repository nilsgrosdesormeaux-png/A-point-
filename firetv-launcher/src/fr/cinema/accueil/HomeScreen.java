package fr.cinema.accueil;

import android.animation.ArgbEvaluator;
import android.animation.ValueAnimator;
import android.content.Context;
import android.content.Intent;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.provider.Settings;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.util.ArrayList;
import java.util.List;

/**
 * L'écran d'accueil complet (fond, titre, lignes de tuiles). Utilisé par MainActivity
 * et, à l'identique, par le voile du service Accueil pendant que Fire OS bloque les lancements.
 */
final class HomeScreen extends FrameLayout {
    interface Host { void launch(Tile t); void menu(Tile t); }

    static final String ACTION_RANDOM = "fr.cinema.accueil.HASARD";
    private static final float[] SIZES = {1f, 0.86f, 0.72f};
    private static final String ALL_TITLE = "Toutes les applis";
    private static final String SYS_TITLE = "Réglages";

    final ThemeView wall;
    private final VideoBg video;
    private android.media.MediaPlayer music;
    private java.io.File musicFile;
    boolean allowMusic;           // vrai pour l'activité, faux pour le voile du service
    private final Prefs p;
    private final AppRepo repo;
    private final Host host;
    private final GradientDrawable glowGd;
    private final View glowView;
    private final LinearLayout content, rows;
    private final TextView heroTitle, heroSub;
    private final ScrollView scroll;
    private ValueAnimator glowAnim;
    private int glowColor = 0xFF000000;
    int built = -1;
    boolean ambient;

    HomeScreen(Context c, Prefs p, AppRepo repo, Host host) {
        super(c);
        this.p = p;
        this.repo = repo;
        this.host = host;
        setBackgroundColor(0xFF000000);

        video = new VideoBg(c);
        addView(video, new LayoutParams(-1, -1));
        wall = new ThemeView(c);
        addView(wall, new LayoutParams(-1, -1));

        glowGd = new GradientDrawable();
        glowGd.setGradientType(GradientDrawable.RADIAL_GRADIENT);
        glowGd.setGradientCenter(0.12f, 0f);
        glowGd.setGradientRadius(getResources().getDisplayMetrics().widthPixels * 0.75f);
        glowGd.setColors(new int[]{0, 0});
        glowView = new View(c);
        glowView.setBackground(glowGd);
        addView(glowView, new LayoutParams(-1, -1));

        content = new LinearLayout(c);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setClipChildren(false);
        content.setPadding(0, Ui.dp(c, 34), 0, 0);
        addView(content, new LayoutParams(-1, -1));

        LinearLayout hero = new LinearLayout(c);
        hero.setOrientation(LinearLayout.VERTICAL);
        hero.setPadding(Ui.dp(c, 64), 0, Ui.dp(c, 64), Ui.dp(c, 6));
        heroSub = new TextView(c);
        heroSub.setTextSize(12);
        heroSub.setLetterSpacing(0.22f);
        heroSub.setAllCaps(true);
        heroSub.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        heroTitle = new TextView(c);
        heroTitle.setTextSize(40);
        heroTitle.setTextColor(0xFFF5F2EC);
        heroTitle.setSingleLine(true);
        heroTitle.setShadowLayer(Ui.dp(c, 12), 0, Ui.dp(c, 2), 0x99000000);
        hero.addView(heroSub);
        hero.addView(heroTitle);
        content.addView(hero);

        scroll = new ScrollView(c);
        scroll.setVerticalScrollBarEnabled(false);
        scroll.setOverScrollMode(View.OVER_SCROLL_NEVER);
        scroll.setClipChildren(false);
        scroll.setClipToPadding(false);
        scroll.setSmoothScrollingEnabled(true);
        rows = new LinearLayout(c);
        rows.setOrientation(LinearLayout.VERTICAL);
        rows.setClipChildren(false);
        rows.setPadding(0, 0, 0, Ui.dp(c, 200));
        scroll.addView(rows, new ScrollView.LayoutParams(-1, -2));
        content.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1f));

        getViewTreeObserver().addOnGlobalFocusChangeListener((o, n) -> {
            if (n instanceof Tile && isAttachedToWindow()) onTileFocused((Tile) n);
        });
    }

    private Context c() { return getContext(); }

    /** Repos : sans toucher la télécommande, seules les images restent (au lieu de l'écran de veille Amazon). */
    private static final long IDLE_MS = 2 * 60 * 1000L;
    private final Runnable idle = () -> { if (!ambient) setAmbient(true, true); };

    private void armIdle() { removeCallbacks(idle); postDelayed(idle, IDLE_MS); }

    void resume() { wall.resume(); video.resume(); startMusic(); armIdle(); }

    void pause() { wall.pause(); video.pause(); stopMusic(); removeCallbacks(idle); }

    void release() { pause(); video.stop(); }

    /** Musique du thème en boucle, volume doux, seulement quand l'accueil est affiché. */
    private void startMusic() {
        if (!allowMusic || musicFile == null || music != null) return;
        try {
            android.media.MediaPlayer m = new android.media.MediaPlayer();
            m.setDataSource(musicFile.getAbsolutePath());
            m.setLooping(true);
            m.setVolume(0.55f, 0.55f);
            m.setOnPreparedListener(android.media.MediaPlayer::start);
            m.prepareAsync();
            music = m;
        } catch (Throwable t) {
            music = null;
        }
    }

    private void stopMusic() {
        if (music != null) {
            try { music.release(); } catch (Throwable ignored) { }
            music = null;
        }
    }

    void showHint(String label) {
        heroSub.setText("Ouverture");
        heroTitle.setText(label);
    }

    // ---------- construction ----------

    void rebuild() {
        repo.ensureRows(p);
        Themes.Def def = Themes.get(p.theme());
        int accent = def.accent;
        boolean vids = def.id.equals("videos");
        List<java.io.File> files = vids ? Themes.userVideos(getContext()) : null;
        String builtIn = vids ? null : Themes.assetVideo(c(), def.id);
        wall.setTheme(def, p.animatedBg());
        wall.setVideoMode((vids && !files.isEmpty()) || builtIn != null);
        if (vids && !files.isEmpty()) video.play(files);
        else if (builtIn != null) video.playAsset(builtIn);
        else video.stop();
        java.io.File snd = p.music() ? Themes.sound(c(), def.id) : null;
        if (snd == null ? musicFile != null : !snd.equals(musicFile)) { stopMusic(); musicFile = snd; startMusic(); }
        heroSub.setTextColor(accent);
        heroTitle.setTypeface(def.typeface());
        heroTitle.setAllCaps(def.caps);
        heroTitle.setLetterSpacing(def.spacing);

        String want = p.lastFocus();
        rows.removeAllViews();
        Context c = getContext();
        float m = SIZES[Math.max(0, Math.min(2, p.tileSize()))];
        int bigW = Ui.dp(c, 244 * m), midW = Ui.dp(c, 204 * m), smallW = Ui.dp(c, 164 * m);
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
        Context c = getContext();
        int h = w * 9 / 16;
        LinearLayout block = new LinearLayout(c);
        block.setOrientation(LinearLayout.VERTICAL);
        block.setClipChildren(false);
        block.setTag(title);
        TextView t = new TextView(c);
        t.setText(title);
        t.setAllCaps(true);
        t.setLetterSpacing(0.18f);
        t.setTextSize(12);
        t.setTextColor(0x99FFFFFF);
        t.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        t.setPadding(Ui.dp(c, 64), Ui.dp(c, 14), 0, 0);
        block.addView(t);
        HorizontalScrollView hs = new HorizontalScrollView(c);
        hs.setHorizontalScrollBarEnabled(false);
        hs.setOverScrollMode(View.OVER_SCROLL_NEVER);
        hs.setClipChildren(false);
        hs.setClipToPadding(false);
        hs.setSmoothScrollingEnabled(true);
        LinearLayout line = new LinearLayout(c);
        line.setOrientation(LinearLayout.HORIZONTAL);
        line.setClipChildren(false);
        line.setClipToPadding(false);
        int pad = Ui.dp(c, 64);
        line.setPadding(pad, Ui.dp(c, 14), pad, Ui.dp(c, 16));
        boolean labels = p.labels();
        int style = p.tileStyle();
        for (AppEntry a : apps) {
            Tile tile = new Tile(c, a, row, w, h, style, accent, labels);
            tile.setOnClickListener(v -> host.launch((Tile) v));
            tile.setOnLongClickListener(v -> { host.menu((Tile) v); return true; });
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-2, -2);
            lp.rightMargin = Ui.dp(c, 22);
            line.addView(tile, lp);
        }
        hs.addView(line);
        block.addView(hs);
        rows.addView(block);
    }

    private List<AppEntry> systemEntries() {
        Context c = getContext();
        List<AppEntry> l = new ArrayList<>();
        l.add(sys("Thème au hasard", R.drawable.ic_dice, 0xFF4A2A1A, new Intent(ACTION_RANDOM)));
        l.add(sys("Personnaliser", R.drawable.ic_palette, 0xFF3A2C4A, new Intent(c, SettingsActivity.class)));
        l.add(sys("Paramètres", R.drawable.ic_gear, 0xFF2A3040, new Intent(Settings.ACTION_SETTINGS)));
        l.add(sys("Gérer les applis", R.drawable.ic_apps, 0xFF203A3A, new Intent(Settings.ACTION_APPLICATION_SETTINGS)));
        return l;
    }

    private AppEntry sys(String label, int icon, int color, Intent i) {
        AppEntry e = new AppEntry();
        e.pkg = "sys:" + label;
        e.label = label;
        e.icon = getContext().getDrawable(icon);
        e.color = color;
        e.intent = i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        e.system = true;
        return e;
    }

    /** Remet l'accueil en haut, sur la première tuile des Favoris. */
    void focusTop() {
        scroll.scrollTo(0, 0);
        Tile t = findTile(null);
        if (t != null) {
            if (t.hasFocus()) onTileFocused(t); else t.requestFocus();
        }
    }

    Tile findTile(String key) {
        for (int i = 0; i < rows.getChildCount(); i++) {
            ViewGroup line = (ViewGroup) ((ViewGroup) ((ViewGroup) rows.getChildAt(i)).getChildAt(1)).getChildAt(0);
            for (int j = 0; j < line.getChildCount(); j++) {
                Tile t = (Tile) line.getChildAt(j);
                if (key == null || key.equals(t.key())) return t;
            }
        }
        return null;
    }

    // ---------- focus, halo, mode fond d'écran ----------

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
        int target = Math.max(0, block.getTop() - Ui.dp(getContext(), 2));
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

    /** Fond d'écran seul (tuiles cachées) ou retour des tuiles. Mémorisé pour le service Accueil. */
    void setAmbient(boolean on, boolean anim) { setAmbient(on, anim, true); }

    void setAmbient(boolean on, boolean anim, boolean persist) {
        ambient = on;
        if (persist) p.setAmbient(on);
        float a = on ? 0f : 1f;
        if (anim) {
            content.animate().alpha(a).setDuration(450).start();
            glowView.animate().alpha(a).setDuration(450).start();
        } else {
            content.animate().cancel();
            glowView.animate().cancel();
            content.setAlpha(a);
            glowView.setAlpha(a);
        }
        if (!on) {
            View f = findFocus();
            if (!(f instanceof Tile)) { Tile t = findTile(p.lastFocus()); if (t == null) t = findTile(null); if (t != null) t.requestFocus(); }
        }
    }

    @Override public boolean dispatchKeyEvent(KeyEvent e) {
        int code = e.getKeyCode();
        armIdle();
        if (code == KeyEvent.KEYCODE_HOME) return super.dispatchKeyEvent(e);
        if (ambient) {
            if (e.getAction() == KeyEvent.ACTION_UP) setAmbient(false, true);
            return true; // en mode fond d'écran, la touche sert seulement à faire revenir les tuiles
        }
        if (code == KeyEvent.KEYCODE_MENU) {
            if (e.getAction() == KeyEvent.ACTION_UP) setAmbient(true, true);
            return true;
        }
        if (code == KeyEvent.KEYCODE_BACK) return true; // l'accueil reste l'accueil
        return super.dispatchKeyEvent(e);
    }
}
