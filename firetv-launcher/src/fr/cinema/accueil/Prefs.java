package fr.cinema.accueil;

import android.content.Context;
import android.content.SharedPreferences;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** Réglages du launcher, stockés localement. */
final class Prefs {
    static final String[] ROW_TITLES = {"Favoris", "Replay", "Musique et live"};
    static final String[] THEMES = {"cinema", "minuit", "aurore", "ardoise", "braise", "perso"};
    static final String[] THEME_NAMES = {"Cinéma", "Minuit", "Aurore", "Ardoise", "Braise", "Fond perso"};

    private final SharedPreferences sp;

    Prefs(Context c) { sp = c.getSharedPreferences("cinema", Context.MODE_PRIVATE); }

    int version() { return sp.getInt("v", 0); }
    void bump() { sp.edit().putInt("v", version() + 1).apply(); }

    String theme() { return sp.getString("theme", "cinema"); }
    void setTheme(String t) { sp.edit().putString("theme", t).apply(); bump(); }

    /** 0 = bannières officielles, 1 = couleurs de marque (pack d'icônes). */
    int tileStyle() { return sp.getInt("style", 0); }
    void setTileStyle(int s) { sp.edit().putInt("style", s).apply(); bump(); }

    /** 0 = grande, 1 = moyenne, 2 = compacte. */
    int tileSize() { return sp.getInt("size", 0); }
    void setTileSize(int s) { sp.edit().putInt("size", s).apply(); bump(); }

    boolean bool(String k, boolean def) { return sp.getBoolean(k, def); }
    void setBool(String k, boolean v) { sp.edit().putBoolean(k, v).apply(); bump(); }

    boolean labels() { return bool("labels", false); }
    boolean animatedBg() { return bool("anim", false); }
    boolean showAll() { return bool("all", true); }
    boolean hideAmazon() { return bool("hideAmazon", true); }
    boolean interceptHome() { return bool("intercept", true); }

    boolean rowsReady() { return sp.contains("row0"); }

    List<String> row(int i) {
        String s = sp.getString("row" + i, "");
        List<String> out = new ArrayList<>();
        if (!s.isEmpty()) out.addAll(Arrays.asList(s.split(",")));
        return out;
    }

    void setRow(int i, List<String> pkgs) {
        StringBuilder b = new StringBuilder();
        for (String p : pkgs) { if (b.length() > 0) b.append(','); b.append(p); }
        sp.edit().putString("row" + i, b.toString()).apply();
        bump();
    }

    void resetRows() {
        SharedPreferences.Editor e = sp.edit();
        for (int i = 0; i < ROW_TITLES.length; i++) e.remove("row" + i);
        e.apply();
        bump();
    }

    Set<String> hidden() { return new HashSet<>(sp.getStringSet("hidden", new HashSet<String>())); }
    void hide(String pkg) { Set<String> h = hidden(); h.add(pkg); sp.edit().putStringSet("hidden", h).apply(); bump(); }
    void clearHidden() { sp.edit().remove("hidden").apply(); bump(); }

    String lastFocus() { return sp.getString("focus", null); }
    void setLastFocus(String k) { sp.edit().putString("focus", k).apply(); }
}
