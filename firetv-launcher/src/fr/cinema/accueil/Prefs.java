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

    private final SharedPreferences sp;

    Prefs(Context c) { sp = c.getSharedPreferences("cinema", Context.MODE_MULTI_PROCESS); } // lu aussi par le service Accueil }

    int version() { return sp.getInt("v", 0); }
    void bump() { sp.edit().putInt("v", version() + 1).apply(); }

    String theme() { return sp.getString("theme", "snowfall"); }
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
    boolean music() { return bool("music", true); }
    boolean animatedBg() { return bool("fx", true); }
    /** Accueil Amazon autorisé (réglage « Revenir à l'accueil Amazon »). */
    boolean amazonAllowed() { return bool("amazonOk", false); }
    /** 0 = jamais, 1 = à chaque allumage, 2 = chaque jour. */
    int randomMode() { return sp.getInt("rnd", 0); }
    void setRandomMode(int m) { sp.edit().putInt("rnd", m).apply(); bump(); }
    boolean ambient() { return sp.getBoolean("ambient", false); }
    void setAmbient(boolean on) { sp.edit().putBoolean("ambient", on).apply(); }
    long lng(String k) { return sp.getLong(k, 0); }
    void setLng(String k, long v) { sp.edit().putLong(k, v).apply(); }
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
