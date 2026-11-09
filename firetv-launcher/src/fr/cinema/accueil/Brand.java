package fr.cinema.accueil;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.drawable.Drawable;
import java.util.Locale;

/** Couleurs de marque (le « pack d'icônes ») et couleur moyenne d'une icône en secours. */
final class Brand {
    private static final Object[][] KNOWN = {
        {"netflix", 0xFFB20710}, {"youtube", 0xFFD9001C}, {"disney", 0xFF0B2A8C},
        {"canal", 0xFF1A1A1A}, {"tf1", 0xFF0F4CD6}, {"m6", 0xFF6A2BD0}, {"6play", 0xFF6A2BD0},
        {"france", 0xFF1B2FD1}, {"pluzz", 0xFF1B2FD1}, {"spotify", 0xFF138A3E},
        {"twitch", 0xFF7D3CE6}, {"tvmate", 0xFFE0661B}, {"tv mate", 0xFFE0661B},
        {"surfshark", 0xFF138585}, {"downloader", 0xFFE07B00}, {"prime", 0xFF0A7FB5},
        {"avod", 0xFF0A7FB5}, {"silk", 0xFF2C5DA8}, {"arte", 0xFFE5512B},
    };

    static int color(String pkg, String label, Drawable icon) {
        String hay = (pkg + " " + label).toLowerCase(Locale.ROOT);
        for (Object[] k : KNOWN) if (hay.contains((String) k[0])) return (Integer) k[1];
        return average(icon);
    }

    private static int average(Drawable d) {
        if (d == null) return 0xFF2A2A30;
        try {
            Bitmap b = Bitmap.createBitmap(12, 12, Bitmap.Config.ARGB_8888);
            Canvas c = new Canvas(b);
            d.setBounds(0, 0, 12, 12);
            d.draw(c);
            long r = 0, g = 0, bl = 0, n = 0;
            float[] hsv = new float[3];
            for (int x = 0; x < 12; x++) for (int y = 0; y < 12; y++) {
                int p = b.getPixel(x, y);
                if (Color.alpha(p) < 128) continue;
                Color.colorToHSV(p, hsv);
                int w = hsv[1] > 0.25f && hsv[2] > 0.2f ? 4 : 1; // privilégie les pixels colorés
                r += Color.red(p) * w; g += Color.green(p) * w; bl += Color.blue(p) * w; n += w;
            }
            b.recycle();
            if (n == 0) return 0xFF2A2A30;
            int c0 = Color.rgb((int) (r / n), (int) (g / n), (int) (bl / n));
            Color.colorToHSV(c0, hsv);
            hsv[2] = Math.min(hsv[2], 0.62f); // assez sombre pour l'ambiance cinéma
            return Color.HSVToColor(hsv);
        } catch (Throwable t) {
            return 0xFF2A2A30;
        }
    }

    static int darker(int c, float f) {
        return Color.rgb((int) (Color.red(c) * f), (int) (Color.green(c) * f), (int) (Color.blue(c) * f));
    }
}
