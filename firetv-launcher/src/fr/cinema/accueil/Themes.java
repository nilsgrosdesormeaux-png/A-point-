package fr.cinema.accueil;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.drawable.BitmapDrawable;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.LayerDrawable;
import android.util.DisplayMetrics;
import java.io.File;

/** Fonds d'écran dessinés en dégradés (aucune image lourde) + fond perso. */
final class Themes {

    static int accent(String theme) {
        switch (theme) {
            case "minuit": return 0xFF8DB8FF;
            case "aurore": return 0xFFC3A8FF;
            case "ardoise": return 0xFFFFFFFF;
            case "braise": return 0xFFFF9A5C;
            case "perso": return 0xFFFFFFFF;
            default: return 0xFFE6B85C;
        }
    }

    static Drawable wallpaper(Context c, String theme) {
        if ("perso".equals(theme)) {
            Drawable d = custom(c);
            if (d != null) return d;
            theme = "cinema";
        }
        switch (theme) {
            case "minuit":
                return layers(c, 0xFF03060E, 0xFF060B18,
                        radial(c, 0xFF153566, 0.85f, 0.05f, 0.9f),
                        radial(c, 0xFF0A1730, 0.1f, 1.0f, 0.8f));
            case "aurore":
                return layers(c, 0xFF07060F, 0xFF0A0814,
                        radial(c, 0xFF3D1E73, 0.08f, 0.0f, 0.95f),
                        radial(c, 0xFF0D4E5B, 0.95f, 1.0f, 0.9f));
            case "ardoise":
                return layers(c, 0xFF15181D, 0xFF0B0D10,
                        radial(c, 0xFF2C323C, 0.5f, 0.0f, 1.1f));
            case "braise":
                return layers(c, 0xFF0A0503, 0xFF0D0605,
                        radial(c, 0xFF5E2108, 0.5f, 1.15f, 1.0f),
                        radial(c, 0xFF2E0B18, 0.95f, 0.0f, 0.7f));
            default: // cinéma : noir profond, halo bordeaux, vignette
                return layers(c, 0xFF060608, 0xFF0B0B0F,
                        radial(c, 0xFF3A0D16, 0.0f, 0.0f, 0.95f),
                        radial(c, 0xFF14141C, 1.0f, 1.0f, 0.8f));
        }
    }

    private static Drawable layers(Context c, int top, int bottom, Drawable... extra) {
        Drawable[] all = new Drawable[extra.length + 2];
        all[0] = new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, new int[]{top, bottom});
        System.arraycopy(extra, 0, all, 1, extra.length);
        all[all.length - 1] = vignette();
        return new LayerDrawable(all);
    }

    private static Drawable radial(Context c, int color, float cx, float cy, float radiusOfWidth) {
        GradientDrawable g = new GradientDrawable();
        g.setGradientType(GradientDrawable.RADIAL_GRADIENT);
        g.setColors(new int[]{color, color & 0x00FFFFFF});
        g.setGradientCenter(cx, cy);
        g.setGradientRadius(c.getResources().getDisplayMetrics().widthPixels * radiusOfWidth);
        return g;
    }

    /** Assombrit le bas de l'écran pour que les tuiles ressortent. */
    private static Drawable vignette() {
        return new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
                new int[]{0x00000000, 0x22000000, 0x88000000});
    }

    static File customFile(Context c) {
        File dir = c.getExternalFilesDir(null);
        if (dir == null) return null;
        for (String n : new String[]{"fond.jpg", "fond.jpeg", "fond.png", "fond.webp"}) {
            File f = new File(dir, n);
            if (f.exists()) return f;
        }
        return new File(dir, "fond.jpg");
    }

    private static Drawable custom(Context c) {
        try {
            File f = customFile(c);
            if (f == null || !f.exists()) return null;
            DisplayMetrics dm = c.getResources().getDisplayMetrics();
            BitmapFactory.Options o = new BitmapFactory.Options();
            o.inJustDecodeBounds = true;
            BitmapFactory.decodeFile(f.getAbsolutePath(), o);
            int sample = 1;
            while (o.outWidth / (sample * 2) >= dm.widthPixels && o.outHeight / (sample * 2) >= dm.heightPixels) sample *= 2;
            o = new BitmapFactory.Options();
            o.inSampleSize = sample;
            o.inPreferredConfig = Bitmap.Config.RGB_565; // moitié moins de mémoire
            Bitmap b = BitmapFactory.decodeFile(f.getAbsolutePath(), o);
            if (b == null) return null;
            BitmapDrawable bd = new BitmapDrawable(c.getResources(), b);
            GradientDrawable shade = new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
                    new int[]{0x99000000, 0x55000000, 0xCC000000});
            return new LayerDrawable(new Drawable[]{bd, shade});
        } catch (Throwable t) {
            return null;
        }
    }
}
