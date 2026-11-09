package fr.cinema.accueil;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.drawable.Drawable;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/** Liste des applis lançables, gardée en mémoire tant que rien n'est installé ou supprimé. */
final class AppRepo {
    /** Lignes par défaut : chaque créneau = mots-clés cherchés dans le nom ou le paquet. */
    private static final String[][][] DEFAULT_ROWS = {
        {{"tvmate", "tv mate"}, {"youtube"}, {"disney"}, {"canal"}, {"netflix"}},
        {{"m6", "6play"}, {"france.tv", "francetv", "pluzz", "france tv"}, {"tf1"}},
        {{"spotify"}, {"twitch"}},
    };
    /** Applis Amazon qu'on laisse visibles même quand les autres sont masquées. */
    private static final String[] AMAZON_KEEP = {"com.amazon.avod", "com.amazon.venezia", "com.amazon.cloud9"};

    private final Context ctx;
    private final PackageManager pm;
    private Map<String, AppEntry> apps;
    boolean dirty = true;

    AppRepo(Context c) { ctx = c.getApplicationContext(); pm = ctx.getPackageManager(); }

    Map<String, AppEntry> apps() {
        if (apps == null || dirty) load();
        return apps;
    }

    private void load() {
        Map<String, AppEntry> m = new LinkedHashMap<>();
        collect(m, Intent.CATEGORY_LEANBACK_LAUNCHER);
        collect(m, Intent.CATEGORY_LAUNCHER);
        m.remove(ctx.getPackageName());
        apps = m;
        dirty = false;
    }

    private void collect(Map<String, AppEntry> m, String cat) {
        Intent q = new Intent(Intent.ACTION_MAIN).addCategory(cat);
        List<ResolveInfo> list;
        try { list = pm.queryIntentActivities(q, 0); } catch (Throwable t) { return; }
        for (ResolveInfo ri : list) {
            String pkg = ri.activityInfo.packageName;
            if (m.containsKey(pkg)) continue;
            AppEntry e = new AppEntry();
            e.pkg = pkg;
            e.label = String.valueOf(ri.loadLabel(pm));
            try {
                Drawable b = ri.activityInfo.loadBanner(pm);
                if (b == null) b = ri.activityInfo.applicationInfo.loadBanner(pm);
                e.banner = b;
            } catch (Throwable ignored) { }
            try { e.icon = ri.loadIcon(pm); } catch (Throwable ignored) { }
            e.color = Brand.color(pkg, e.label, e.icon);
            e.intent = new Intent(Intent.ACTION_MAIN).addCategory(cat)
                    .setClassName(pkg, ri.activityInfo.name)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
            m.put(pkg, e);
        }
    }

    /** Premier lancement : place automatiquement les applis connues dans leurs lignes. */
    void ensureRows(Prefs p) {
        if (p.rowsReady()) return;
        Map<String, AppEntry> all = apps();
        List<String> used = new ArrayList<>();
        for (int r = 0; r < DEFAULT_ROWS.length; r++) {
            List<String> row = new ArrayList<>();
            for (String[] slot : DEFAULT_ROWS[r]) {
                AppEntry best = null;
                for (AppEntry e : all.values()) {
                    if (used.contains(e.pkg) || !matches(e, slot)) continue;
                    if (best == null || e.label.length() < best.label.length()) best = e; // « YouTube » avant « YouTube Kids »
                }
                if (best != null) { row.add(best.pkg); used.add(best.pkg); }
            }
            p.setRow(r, row);
        }
    }

    private static boolean matches(AppEntry e, String[] keys) {
        String label = e.label.toLowerCase(Locale.ROOT);
        String pkg = e.pkg.toLowerCase(Locale.ROOT);
        for (String k : keys) {
            if (label.contains(k)) return true;
            if (k.length() > 2 && pkg.contains(k.replace(" ", ""))) return true;
            if (k.equals("m6") && pkg.contains(".m6")) return true;
        }
        return false;
    }

    List<AppEntry> resolve(List<String> pkgs) {
        List<AppEntry> out = new ArrayList<>();
        Map<String, AppEntry> all = apps();
        for (String p : pkgs) { AppEntry e = all.get(p); if (e != null) out.add(e); }
        return out;
    }

    /** Toutes les applis qui ne sont ni dans une ligne, ni masquées. */
    List<AppEntry> others(Prefs p) {
        List<String> placed = new ArrayList<>();
        for (int i = 0; i < Prefs.ROW_TITLES.length; i++) placed.addAll(p.row(i));
        java.util.Set<String> hidden = p.hidden();
        List<AppEntry> out = new ArrayList<>();
        for (AppEntry e : apps().values()) {
            if (placed.contains(e.pkg) || hidden.contains(e.pkg)) continue;
            if (p.hideAmazon() && isHiddenAmazon(e.pkg)) continue;
            out.add(e);
        }
        Collections.sort(out, (a, b) -> a.label.compareToIgnoreCase(b.label));
        return out;
    }

    private static boolean isHiddenAmazon(String pkg) {
        if (!pkg.startsWith("com.amazon.") && !pkg.startsWith("com.amazonaws")) return false;
        for (String k : AMAZON_KEEP) if (pkg.startsWith(k)) return false;
        return true;
    }
}
