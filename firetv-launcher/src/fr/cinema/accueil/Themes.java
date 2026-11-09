package fr.cinema.accueil;

import android.content.Context;
import android.graphics.Typeface;
import java.io.File;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Random;

/** Catalogue des thèmes : ambiance du fond (dessinée par ThemeView), couleur d'accent, police du titre. */
final class Themes {
    static final class Def {
        final String id, name, font;
        final int accent, style;
        final boolean caps;
        final float spacing;
        Def(String id, String name, int accent, String font, int style, boolean caps, float spacing) {
            this.id = id; this.name = name; this.accent = accent; this.font = font;
            this.style = style; this.caps = caps; this.spacing = spacing;
        }
        Typeface typeface() { return Typeface.create(font, style); }
    }

    static final Def[] ALL = {
        new Def("snowfall", "Snowfall", 0xFFF4A259, "sans-serif-condensed", Typeface.BOLD, true, 0.12f),
        new Def("cinema", "Rouge cinéma", 0xFFE50914, "sans-serif-condensed", Typeface.BOLD, false, 0f),
        new Def("console", "Console", 0xFFFFFFFF, "sans-serif-light", Typeface.NORMAL, false, 0.01f),
        new Def("etoiles", "Nuit étoilée", 0xFFB9D4FF, "sans-serif-light", Typeface.NORMAL, false, 0.02f),
        new Def("hyper", "Hyperespace", 0xFF7FE7FF, "sans-serif-medium", Typeface.NORMAL, true, 0.2f),
        new Def("neon", "Néon 2077", 0xFFFCEE0A, "sans-serif-condensed", Typeface.BOLD, true, 0.08f),
        new Def("aurore", "Aurore boréale", 0xFF8CFFD0, "sans-serif-light", Typeface.NORMAL, false, 0.02f),
        new Def("foret", "Forêt enchantée", 0xFFFFD86B, "serif", Typeface.NORMAL, false, 0.02f),
        new Def("dune", "Dune", 0xFFF2B36B, "sans-serif-light", Typeface.NORMAL, true, 0.3f),
        new Def("miami", "Miami Nights", 0xFFFF4FA3, "sans-serif-condensed", Typeface.BOLD, true, 0.06f),
        new Def("abysses", "Abysses", 0xFF4FE3FF, "sans-serif-light", Typeface.NORMAL, false, 0.02f),
        new Def("epure", "Épuré", 0xFFFFFFFF, "sans-serif-light", Typeface.NORMAL, false, 0f),
        new Def("photos", "Mes images", 0xFFFFFFFF, "sans-serif-light", Typeface.NORMAL, false, 0.02f),
    };

    static Def get(String id) {
        if ("perso".equals(id)) id = "photos";
        for (Def d : ALL) if (d.id.equals(id)) return d;
        return ALL[1];
    }

    static int index(String id) {
        Def d = get(id);
        for (int i = 0; i < ALL.length; i++) if (ALL[i] == d) return i;
        return 0;
    }

    static int accent(String id) { return get(id).accent; }

    /** Un thème au hasard, différent de l'actuel (« Mes images » seulement s'il y a des images). */
    static String random(Context c, String current) {
        boolean photos = !userImages(c).isEmpty();
        List<Def> pool = new ArrayList<>();
        for (Def d : ALL) {
            if (d.id.equals(current)) continue;
            if (d.id.equals("photos") && !photos) continue;
            pool.add(d);
        }
        return pool.get(new Random().nextInt(pool.size())).id;
    }

    /** Dossier des images perso : /sdcard/Android/data/fr.cinema.accueil/files/fonds */
    static File imagesDir(Context c) {
        File d = c.getExternalFilesDir("fonds");
        if (d != null && !d.exists()) d.mkdirs();
        return d;
    }

    static List<File> userImages(Context c) {
        List<File> out = new ArrayList<>();
        File base = c.getExternalFilesDir(null);
        for (File dir : new File[]{imagesDir(c), base}) {
            if (dir == null) continue;
            File[] fs = dir.listFiles();
            if (fs == null) continue;
            Arrays.sort(fs);
            for (File f : fs) {
                String n = f.getName().toLowerCase(Locale.ROOT);
                if (f.isFile() && (n.endsWith(".jpg") || n.endsWith(".jpeg") || n.endsWith(".png") || n.endsWith(".webp")))
                    out.add(f);
            }
        }
        return out;
    }
}
