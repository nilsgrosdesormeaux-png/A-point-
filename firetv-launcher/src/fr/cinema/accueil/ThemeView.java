package fr.cinema.accueil;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.BitmapShader;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Matrix;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.PorterDuff;
import android.graphics.PorterDuffColorFilter;
import android.graphics.PorterDuffXfermode;
import android.graphics.RadialGradient;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.Shader;
import android.graphics.Typeface;
import android.os.SystemClock;
import android.view.View;
import java.io.File;
import java.util.List;
import java.util.Random;

/**
 * Fond d'écran vivant. Une image fixe (dégradés, silhouettes) est peinte une fois,
 * puis seules les particules sont redessinées (étoiles, neige, vagues, pluie de code…).
 * S'arrête dès que l'accueil n'est plus visible : zéro coût pendant que tu regardes une appli.
 */
final class ThemeView extends View {
    private Themes.Def def = Themes.ALL[1];
    private boolean animate = true, running;
    private Bitmap base;
    private final Rect full = new Rect();
    private final Paint bmp = new Paint(Paint.FILTER_BITMAP_FLAG | Paint.DITHER_FLAG);
    private final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint sprite = new Paint(Paint.FILTER_BITMAP_FLAG);
    private final Random rnd = new Random();
    private Bitmap glow;
    private int spriteCol;
    private final RectF r = new RectF();
    private final Path path = new Path();
    private Path front, front2;
    private Shader[] bandShaders;
    private Shader scan;
    private final long t0 = SystemClock.uptimeMillis();
    private float lastT;
    private float u; // échelle : 1 en 1080p

    private int n;
    private float[] px, py, pz, ps, pph;
    // pluie de code
    private char[][] chars;
    private float font;
    private static final String GLYPHS = "0123456789ABCDEFXZ$#%&*+=<>";
    // photos
    private List<File> photos;
    private int photoIdx;
    private Bitmap photoCur, photoPrev;
    private volatile Bitmap photoNext;
    private volatile boolean loading;
    private float photoStart, fadeStart = -10;
    private final Matrix m = new Matrix();
    private Shader photoShade;

    ThemeView(Context c) {
        super(c);
        glow = Bitmap.createBitmap(64, 64, Bitmap.Config.ARGB_8888);
        Paint g = new Paint(Paint.ANTI_ALIAS_FLAG);
        g.setShader(new RadialGradient(32, 32, 32, new int[]{0xFFFFFFFF, 0x66FFFFFF, 0x00FFFFFF}, new float[]{0, 0.35f, 1}, Shader.TileMode.CLAMP));
        new Canvas(glow).drawCircle(32, 32, 32, g);
    }

    void setTheme(Themes.Def d, boolean anim) {
        boolean same = d == def && anim == animate && base != null;
        def = d;
        animate = anim;
        if (!same) { recycleBase(); photos = null; }
        invalidate();
    }

    void resume() { running = true; invalidate(); }

    private boolean videoMode;
    private Shader videoShade;

    /** Mode vidéo : la vidéo est dessous, on ne dessine que le voile sombre pour la lisibilité. */
    void setVideoMode(boolean on) {
        if (on != videoMode) { videoMode = on; videoShade = null; invalidate(); }
    }

    void pause() { running = false; }

    private int fps() {
        switch (def.id) {
            case "cinema": case "epure": case "aurore": case "miami": case "console": return 0;
            default: return 30;
        }
    }

    @Override protected void onSizeChanged(int w, int h, int ow, int oh) {
        recycleBase();
    }

    private void recycleBase() {
        if (base != null) { base.recycle(); base = null; }
    }

    @Override protected void onDraw(Canvas c) {
        int W = getWidth(), H = getHeight();
        if (W == 0 || H == 0) return;
        if (videoMode) {
            if (videoShade == null) videoShade = new LinearGradient(0, 0, 0, H, new int[]{0x99000000, 0x11000000, 0x44000000, 0xD0000000}, new float[]{0f, 0.3f, 0.5f, 1f}, Shader.TileMode.CLAMP);
            p.setShader(videoShade);
            c.drawRect(0, 0, W, H, p);
            p.setShader(null);
            return;
        }
        if (base == null) { u = H / 1080f; buildBase(W, H); initFx(W, H); }
        float t = (SystemClock.uptimeMillis() - t0) / 1000f;
        if (!animate) t = 14f;
        float dt = Math.max(0f, Math.min(0.1f, t - lastT));
        lastT = t;
        full.set(0, 0, W, H);
        c.drawBitmap(base, null, full, bmp);
        drawFx(c, W, H, t, dt);
        if (animate && running && fps() > 0) postInvalidateDelayed(1000 / fps());
    }

    // ------------------------------------------------------------------ image fixe

    private void buildBase(int W, int H) {
        float s = W > 1280 ? 0.75f : 1f;
        base = Bitmap.createBitmap(Math.round(W * s), Math.round(H * s), Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(base);
        c.scale(s, s);
        Random sr = new Random(7);
        Bitmap ph = asset("themes/" + def.id + ".jpg", W, H);
        if (ph != null) {
            // photo réelle + voiles sombres pour que titre et tuiles restent lisibles
            float k = Math.max(W / (float) ph.getWidth(), H / (float) ph.getHeight());
            m.reset();
            m.postScale(k, k);
            m.postTranslate((W - ph.getWidth() * k) / 2f, (H - ph.getHeight() * k) / 2f);
            c.drawBitmap(ph, m, bmp);
            ph.recycle();
            Paint top = new Paint();
            top.setShader(new LinearGradient(0, 0, 0, H * 0.32f, 0x99000000, 0, Shader.TileMode.CLAMP));
            c.drawRect(0, 0, W, H * 0.32f, top);
            if (def.id.equals("snowfall_old")) {
                Paint tp = new Paint(Paint.ANTI_ALIAS_FLAG);
                tp.setTypeface(Typeface.create("sans-serif-condensed", Typeface.BOLD));
                tp.setTextSize(H * 0.15f);
                tp.setLetterSpacing(0.32f);
                tp.setColor(0x26FFFFFF);
                tp.setTextAlign(Paint.Align.RIGHT);
                c.drawText("SNOWFALL", W * 0.97f, H * 0.2f, tp);
            }
            shadeBottom(c, W, H, 0xC8000000);
            vignette(c, W, H);
            p.setShader(null);
            return;
        }
        switch (def.id) {
            case "snowfall": {
                vgrad(c, W, H, new int[]{0xFF07051A, 0xFF1D0F3A, 0xFF6A1F55, 0xFFD2553F, 0xFFF49A4A, 0xFF120A1C, 0xFF05040A},
                        new float[]{0f, 0.33f, 0.53f, 0.68f, 0.755f, 0.79f, 1f});
                float hz = H * 0.775f;
                c.save();
                c.clipRect(0, 0, W, hz);
                glowAt(c, W * 0.3f, hz, H * 0.55f, 0x99FFB070);
                p.setShader(null);
                p.setColor(0xE6FFD08A);
                c.drawCircle(W * 0.3f, hz - H * 0.02f, H * 0.11f, p);
                c.restore();
                // skyline de L.A.
                p.setColor(0xFF0A0610);
                float x = 0;
                while (x < W) {
                    float bw = W * (0.015f + sr.nextFloat() * 0.045f);
                    float bh = H * (0.02f + sr.nextFloat() * sr.nextFloat() * 0.13f);
                    c.drawRect(x, hz - bh, x + bw, hz + 2, p);
                    x += bw + W * 0.002f;
                }
                c.drawRect(0, hz, W, H, p);
                // palmiers
                float[][] palms = {{0.06f, 0.46f}, {0.13f, 0.36f}, {0.83f, 0.5f}, {0.93f, 0.4f}, {0.5f, 0.28f}};
                for (float[] pm : palms) palm(c, W * pm[0], hz, H * pm[1], 0xFF07040C);
                // titre en filigrane
                Paint tp = new Paint(Paint.ANTI_ALIAS_FLAG);
                tp.setTypeface(Typeface.create("sans-serif-condensed", Typeface.BOLD));
                tp.setTextSize(H * 0.15f);
                tp.setLetterSpacing(0.32f);
                tp.setColor(0x1CFFFFFF);
                tp.setTextAlign(Paint.Align.RIGHT);
                c.drawText("SNOWFALL", W * 0.97f, H * 0.2f, tp);
                shadeBottom(c, W, H, 0xAA000000);
                break;
            }
            case "cinema": {
                c.drawColor(0xFF000000);
                glowAt(c, W * 0.5f, H * 1.32f, W * 0.85f, 0x77B20710);
                Paint arc = new Paint(Paint.ANTI_ALIAS_FLAG);
                arc.setStyle(Paint.Style.STROKE);
                arc.setStrokeWidth(4 * u + 1);
                arc.setShader(new LinearGradient(0, 0, W, 0, new int[]{0x00E50914, 0xCCE50914, 0x00E50914}, null, Shader.TileMode.CLAMP));
                r.set(-W * 0.25f, H * 0.62f, W * 1.25f, H * 2.2f);
                c.drawOval(r, arc);
                glowAt(c, 0, 0, W * 0.5f, 0x1AFFFFFF);
                break;
            }
            case "console":
                vgrad(c, W, H, new int[]{0xFF000310, 0xFF021046, 0xFF0636A8}, new float[]{0f, 0.55f, 1f});
                glowAt(c, W * 0.82f, H * 0.18f, W * 0.6f, 0x553A7BFF);
                glowAt(c, W * 0.1f, H * 1.05f, W * 0.7f, 0x44002A8A);
                shadeBottom(c, W, H, 0x66000000);
                break;
            case "etoiles":
                vgrad(c, W, H, new int[]{0xFF000006, 0xFF050A1E, 0xFF0B1030}, null);
                glowAt(c, W * 0.75f, H * 0.3f, W * 0.42f, 0x3340307A);
                glowAt(c, W * 0.2f, H * 0.62f, W * 0.36f, 0x22205A7A);
                glowAt(c, W * 0.55f, H * 0.1f, W * 0.25f, 0x1A7A2060);
                break;
            case "hyper":
                vgrad(c, W, H, new int[]{0xFF000004, 0xFF020818}, null);
                glowAt(c, W * 0.5f, H * 0.45f, W * 0.42f, 0x2233AAFF);
                break;
            case "neon": {
                float hz = H * 0.62f;
                vgrad(c, W, H, new int[]{0xFF0B0220, 0xFF2A0646, 0xFF6B0F6B, 0xFFFF2BD6, 0xFF12001E, 0xFF090012},
                        new float[]{0f, 0.35f, 0.54f, 0.62f, 0.621f, 1f});
                for (int i = 0; i < 90; i++) {
                    p.setShader(null);
                    p.setColor(Color.argb(60 + sr.nextInt(150), 255, 255, 255));
                    c.drawCircle(sr.nextFloat() * W, sr.nextFloat() * H * 0.45f, (0.6f + sr.nextFloat()) * u * 1.6f, p);
                }
                glowAt(c, W * 0.5f, hz, W * 0.6f, 0x66FF2BD6);
                int layer = c.saveLayer(0, 0, W, hz, null);
                float sr2 = H * 0.21f;
                Paint sun = new Paint(Paint.ANTI_ALIAS_FLAG);
                sun.setShader(new LinearGradient(0, hz - sr2, 0, hz, 0xFFFCEE0A, 0xFFFF2BD6, Shader.TileMode.CLAMP));
                c.drawCircle(W * 0.5f, hz, sr2, sun);
                Paint cut = new Paint();
                cut.setXfermode(new PorterDuffXfermode(PorterDuff.Mode.CLEAR));
                for (int i = 0; i < 7; i++) {
                    float y = hz - sr2 * 0.55f + i * sr2 * 0.085f;
                    c.drawRect(0, y, W, y + (1 + i) * 1.6f * u + 1, cut);
                }
                c.restoreToCount(layer);
                // montagnes
                path.reset();
                path.moveTo(0, hz);
                float mx = 0;
                while (mx < W) { mx += W * (0.03f + sr.nextFloat() * 0.05f); path.lineTo(mx, hz - H * (0.02f + sr.nextFloat() * 0.07f)); mx += W * 0.03f; path.lineTo(mx, hz); }
                path.close();
                p.setShader(null);
                p.setColor(0xFF1A0030);
                c.drawPath(path, p);
                break;
            }
            case "matrice":
                c.drawColor(0xFF000000);
                glowAt(c, W * 0.5f, H * 0.4f, W * 0.6f, 0x1500FF66);
                break;
            case "aurore":
                vgrad(c, W, H, new int[]{0xFF01040A, 0xFF031220, 0xFF062A2A}, new float[]{0f, 0.6f, 1f});
                stars(c, W, H * 0.7f, 160, sr);
                break;
            case "foret":
                vgrad(c, W, H, new int[]{0xFF020A0C, 0xFF06241F, 0xFF0B3A2A, 0xFF031210}, new float[]{0f, 0.55f, 0.78f, 1f});
                glowAt(c, W * 0.78f, H * 0.18f, H * 0.4f, 0x55D8F0C0);
                p.setShader(null);
                p.setColor(0xFFE8F2D0);
                c.drawCircle(W * 0.78f, H * 0.18f, H * 0.05f, p);
                pines(c, W, H * 0.74f, H * 0.18f, 0xFF0A2A24, sr, 28);
                break;
            case "dune": {
                vgrad(c, W, H, new int[]{0xFF1A0D10, 0xFF6A2E2A, 0xFFD0784A, 0xFFF2B36B}, new float[]{0f, 0.35f, 0.6f, 0.72f});
                glowAt(c, W * 0.72f, H * 0.32f, H * 0.5f, 0x66FFE0B0);
                p.setShader(null);
                p.setColor(0xD9FFE6C0);
                c.drawCircle(W * 0.72f, H * 0.32f, H * 0.15f, p);
                p.setColor(0x99FFE6C0);
                c.drawCircle(W * 0.42f, H * 0.16f, H * 0.035f, p);
                int[] cols = {0xFFB0583A, 0xFF7A3524, 0xFF3D1A14};
                for (int k = 0; k < 3; k++) {
                    path.reset();
                    float y0 = H * (0.64f + k * 0.1f);
                    path.moveTo(0, H);
                    for (int i = 0; i <= 40; i++) {
                        float xx = W * i / 40f;
                        path.lineTo(xx, y0 + (float) Math.sin(i / 40f * Math.PI * (1.6f + k * 0.7f) + k * 2) * H * 0.04f);
                    }
                    path.lineTo(W, H);
                    path.close();
                    p.setColor(cols[k]);
                    c.drawPath(path, p);
                }
                shadeBottom(c, W, H, 0x88000000);
                break;
            }
            case "arcade":
                vgrad(c, W, H, new int[]{0xFF05001A, 0xFF140A3A, 0xFF2A0A4A}, null);
                break;
            case "abysses": {
                vgrad(c, W, H, new int[]{0xFF05496B, 0xFF022A45, 0xFF011627, 0xFF000810}, new float[]{0f, 0.35f, 0.7f, 1f});
                Paint ray = new Paint(Paint.ANTI_ALIAS_FLAG);
                ray.setShader(new LinearGradient(0, 0, 0, H * 0.8f, 0x22FFFFFF, 0x00FFFFFF, Shader.TileMode.CLAMP));
                for (int i = 0; i < 6; i++) {
                    float x0 = W * (0.15f + i * 0.14f), wdt = W * (0.03f + sr.nextFloat() * 0.04f);
                    path.reset();
                    path.moveTo(x0, 0);
                    path.lineTo(x0 + wdt, 0);
                    path.lineTo(x0 + wdt * 3 + W * 0.08f, H * 0.85f);
                    path.lineTo(x0 + W * 0.06f, H * 0.85f);
                    path.close();
                    c.drawPath(path, ray);
                }
                break;
            }
            case "photos":
                c.drawColor(0xFF000000);
                break;
            default: // épuré
                vgrad(c, W, H, new int[]{0xFF17191D, 0xFF0B0C0E}, null);
                glowAt(c, W * 0.5f, -H * 0.2f, W * 0.7f, 0x22FFFFFF);
        }
        if (!def.id.equals("photos")) vignette(c, W, H);
        p.setShader(null);
    }

    private Bitmap asset(String name, int W, int H) {
        try (java.io.InputStream in = getContext().getAssets().open(name)) {
            BitmapFactory.Options o = new BitmapFactory.Options();
            o.inPreferredConfig = Bitmap.Config.RGB_565;
            o.inSampleSize = W <= 1000 ? 2 : 1;
            return BitmapFactory.decodeStream(in, null, o);
        } catch (Throwable t) {
            return null;
        }
    }

    private void vgrad(Canvas c, int W, int H, int[] cols, float[] pos) {
        Paint g = new Paint();
        g.setDither(true);
        g.setShader(new LinearGradient(0, 0, 0, H, cols, pos, Shader.TileMode.CLAMP));
        c.drawRect(0, 0, W, H, g);
    }

    private void glowAt(Canvas c, float x, float y, float rad, int col) {
        Paint g = new Paint(Paint.ANTI_ALIAS_FLAG);
        g.setDither(true);
        g.setShader(new RadialGradient(x, y, rad, new int[]{col, col & 0x00FFFFFF}, null, Shader.TileMode.CLAMP));
        c.drawCircle(x, y, rad, g);
    }

    private void vignette(Canvas c, int W, int H) {
        Paint g = new Paint();
        g.setDither(true);
        g.setShader(new RadialGradient(W * 0.5f, H * 0.42f, W * 0.78f, new int[]{0, 0, 0x99000000}, new float[]{0, 0.55f, 1f}, Shader.TileMode.CLAMP));
        c.drawRect(0, 0, W, H, g);
    }

    private void shadeBottom(Canvas c, int W, int H, int col) {
        Paint g = new Paint();
        g.setDither(true);
        g.setShader(new LinearGradient(0, H * 0.45f, 0, H, 0, col, Shader.TileMode.CLAMP));
        c.drawRect(0, H * 0.45f, W, H, g);
    }

    private void stars(Canvas c, float W, float H, int count, Random sr) {
        p.setShader(null);
        for (int i = 0; i < count; i++) {
            p.setColor(Color.argb(40 + sr.nextInt(170), 255, 255, 255));
            c.drawCircle(sr.nextFloat() * W, sr.nextFloat() * H, (0.5f + sr.nextFloat() * 1.2f) * u * 1.5f, p);
        }
    }

    private void palm(Canvas c, float x, float ground, float height, int col) {
        Paint s = new Paint(Paint.ANTI_ALIAS_FLAG);
        s.setColor(col);
        s.setStyle(Paint.Style.STROKE);
        s.setStrokeCap(Paint.Cap.ROUND);
        s.setStrokeWidth(height * 0.028f);
        Path tr = new Path();
        float topX = x + height * 0.12f, topY = ground - height;
        tr.moveTo(x, ground);
        tr.quadTo(x + height * 0.02f, ground - height * 0.5f, topX, topY);
        c.drawPath(tr, s);
        s.setStrokeWidth(height * 0.018f);
        for (int k = 0; k < 9; k++) {
            double a = Math.PI * (-0.95 + k * 0.24);
            float len = height * (0.3f + (k % 2) * 0.06f);
            float ex = topX + (float) Math.cos(a) * len;
            float ey = topY + (float) Math.sin(a) * len * 0.45f + len * 0.35f;
            Path f = new Path();
            f.moveTo(topX, topY);
            f.quadTo(topX + (float) Math.cos(a) * len * 0.6f, topY + (float) Math.sin(a) * len * 0.6f - len * 0.12f, ex, ey);
            c.drawPath(f, s);
        }
    }

    private void pines(Canvas c, float W, float ground, float maxH, int col, Random sr, int count) {
        Path pp = pinePath(W, ground, maxH, sr, count, 0f, 1f);
        p.setShader(null);
        p.setColor(col);
        c.drawPath(pp, p);
    }

    private Path pinePath(float W, float ground, float maxH, Random sr, int count, float from, float to) {
        Path pp = new Path();
        for (int i = 0; i < count; i++) {
            float x = W * (from + (to - from) * sr.nextFloat());
            float h = maxH * (0.45f + sr.nextFloat() * 0.55f);
            float w = h * 0.32f;
            for (int k = 0; k < 3; k++) {
                float top = ground - h + k * h * 0.22f;
                float bw = w * (0.55f + k * 0.25f);
                pp.moveTo(x, top);
                pp.lineTo(x + bw, top + h * 0.42f);
                pp.lineTo(x - bw, top + h * 0.42f);
                pp.close();
            }
            pp.addRect(x - w * 0.08f, ground - h * 0.12f, x + w * 0.08f, ground + 4, Path.Direction.CW);
        }
        pp.addRect(0, ground, W, ground + maxH * 3, Path.Direction.CW);
        return pp;
    }

    // ------------------------------------------------------------------ particules

    private void alloc(int count) {
        n = count; px = new float[n]; py = new float[n]; pz = new float[n]; ps = new float[n]; pph = new float[n];
    }

    private void initFx(int W, int H) {
        front = front2 = null;
        bandShaders = null;
        scan = null;
        chars = null;
        Random sr = new Random(11);
        switch (def.id) {
            case "snowfall":
                alloc(150);
                for (int i = 0; i < n; i++) { px[i] = rnd.nextFloat() * W; py[i] = rnd.nextFloat() * H; pz[i] = 0.6f + rnd.nextFloat() * rnd.nextFloat() * 3.6f; ps[i] = (18 + pz[i] * 16) * u; pph[i] = rnd.nextFloat() * 6.28f; }
                break;
            case "barca":
                // projecteurs (positions dans la photo), fumée qui dérive, flashs de téléphones dans les tribunes
                alloc(40);
                float[][] lights = {{0.035f, 0.215f}, {0.075f, 0.218f}, {0.115f, 0.222f}, {0.53f, 0.295f}, {0.6f, 0.298f}, {0.67f, 0.3f}, {0.74f, 0.302f}, {0.81f, 0.302f}, {0.86f, 0.3f}, {0.97f, 0.302f}};
                for (int i = 0; i < n; i++) {
                    if (i < lights.length) { px[i] = lights[i][0] * W; py[i] = lights[i][1] * H; pz[i] = 0; }
                    else if (i < lights.length + 7) { px[i] = W * (0.45f + rnd.nextFloat() * 0.25f); py[i] = H * (0.14f + rnd.nextFloat() * 0.12f); pz[i] = 1; }
                    else { px[i] = W * rnd.nextFloat(); py[i] = H * (0.3f + rnd.nextFloat() * 0.35f); pz[i] = 2; }
                    ps[i] = 0.6f + rnd.nextFloat(); pph[i] = rnd.nextFloat() * 6.28f;
                }
                break;
            case "etoiles":
                alloc(45);
                for (int i = 0; i < n; i++) { px[i] = rnd.nextFloat() * W; py[i] = rnd.nextFloat() * H * 0.5f; pz[i] = 0.25f + rnd.nextFloat() * 0.75f; ps[i] = (0.6f + rnd.nextFloat() * 1.8f) * u * 1.4f; pph[i] = rnd.nextFloat() * 6.28f; }
                break;
            case "console":
            case "abysses":
                alloc(def.id.equals("console") ? 46 : 80);
                for (int i = 0; i < n; i++) { px[i] = rnd.nextFloat() * W; py[i] = rnd.nextFloat() * H; pz[i] = rnd.nextFloat(); ps[i] = (10 + rnd.nextFloat() * 22) * u; pph[i] = rnd.nextFloat() * 6.28f; }
                break;
            case "hyper":
                alloc(170);
                for (int i = 0; i < n; i++) resetWarp(i, true);
                break;
            case "matrice": {
                font = H / 30f;
                int cols = (int) (W / (font * 1.3f)) + 1;
                alloc(cols);
                chars = new char[cols][16];
                for (int i = 0; i < n; i++) {
                    py[i] = rnd.nextFloat() * H * 1.5f - H * 0.5f;
                    ps[i] = H * (0.12f + rnd.nextFloat() * 0.33f);
                    for (int k = 0; k < 16; k++) chars[i][k] = GLYPHS.charAt(rnd.nextInt(GLYPHS.length()));
                }
                break;
            }
            case "neon":
                alloc(170); // pluie
                for (int i = 0; i < n; i++) { px[i] = rnd.nextFloat() * W; py[i] = rnd.nextFloat() * H; pz[i] = 0.4f + rnd.nextFloat() * 0.6f; ps[i] = H * (1.1f + pz[i] * 0.9f); }
                break;
            case "aurore_old": {
                int[] cols = {0x6634FFB0, 0x4430D0FF, 0x33A050FF};
                bandShaders = new Shader[3];
                for (int b = 0; b < 3; b++) bandShaders[b] = new LinearGradient(0, H * 0.05f, 0, H * 0.6f, cols[b], cols[b] & 0x00FFFFFF, Shader.TileMode.CLAMP);
                front = new Path();
                front.moveTo(0, H);
                float x = 0;
                front.lineTo(0, H * 0.7f);
                while (x < W) { x += W * (0.04f + sr.nextFloat() * 0.08f); front.lineTo(x, H * (0.58f + sr.nextFloat() * 0.14f)); }
                front.lineTo(W, H);
                front.close();
                alloc(0);
                break;
            }
            case "foret":
                alloc(46);
                for (int i = 0; i < n; i++) { px[i] = rnd.nextFloat() * W; py[i] = H * (0.35f + rnd.nextFloat() * 0.6f); ps[i] = 0.5f + rnd.nextFloat(); pph[i] = rnd.nextFloat() * 6.28f; }

                break;
            case "dune":
                alloc(70);
                for (int i = 0; i < n; i++) { px[i] = rnd.nextFloat() * W; py[i] = H * (0.3f + rnd.nextFloat() * 0.65f); pz[i] = rnd.nextFloat(); pph[i] = rnd.nextFloat() * 6.28f; }
                break;
            case "arcade": {
                float cell = Math.max(4, Math.round(8 * u));
                alloc(70);
                for (int i = 0; i < n; i++) { px[i] = Math.round(rnd.nextFloat() * W / cell) * cell; py[i] = Math.round(rnd.nextFloat() * H * 0.55f / cell) * cell; pz[i] = rnd.nextInt(3); ps[i] = 0.5f + rnd.nextFloat() * 2; pph[i] = rnd.nextFloat() * 6.28f; }
                front = new Path();
                front2 = new Path();
                pixelHills(front, W, H * 0.62f, H * 0.16f, cell * 3, sr);
                pixelHills(front2, W, H * 0.74f, H * 0.12f, cell * 3, sr);
                // lune pixel
                float cx = W * 0.8f, cy = H * 0.2f, rr = H * 0.07f;
                for (float yy = -rr; yy <= rr; yy += cell) for (float xx = -rr; xx <= rr; xx += cell)
                    if (xx * xx + yy * yy <= rr * rr) front2.addRect(cx + xx, cy + yy, cx + xx + cell, cy + yy + cell, Path.Direction.CW);
                Bitmap sb = Bitmap.createBitmap(1, 4, Bitmap.Config.ARGB_8888);
                sb.setPixel(0, 3, 0x40000000);
                scan = new BitmapShader(sb, Shader.TileMode.REPEAT, Shader.TileMode.REPEAT);
                break;
            }
            case "photos":
                alloc(0);
                photos = Themes.userImages(getContext());
                photoIdx = 0;
                photoCur = photoPrev = null;
                photoNext = null;
                if (!photos.isEmpty()) photoCur = decode(photos.get(0), W, H);
                photoStart = (SystemClock.uptimeMillis() - t0) / 1000f;
                photoShade = new LinearGradient(0, 0, 0, H, new int[]{0x88000000, 0x22000000, 0x55000000, 0xCC000000}, new float[]{0f, 0.3f, 0.55f, 1f}, Shader.TileMode.CLAMP);
                break;
            default:
                alloc(0);
        }
    }

    private void pixelHills(Path out, float W, float ground, float amp, float cell, Random sr) {
        float h = amp * 0.5f;
        for (float x = 0; x < W; x += cell) {
            h += (sr.nextInt(3) - 1) * cell;
            h = Math.max(cell, Math.min(amp, h));
            out.addRect(x, ground - h, x + cell, ground + amp * 4, Path.Direction.CW);
        }
    }

    private void resetWarp(int i, boolean anyZ) {
        px[i] = rnd.nextFloat() * 2 - 1;
        py[i] = rnd.nextFloat() * 2 - 1;
        pz[i] = anyZ ? 0.05f + rnd.nextFloat() * 0.95f : 1f;
    }

    private void sprite(Canvas c, float x, float y, float size, int col, int alpha) {
        if (col != spriteCol) { spriteCol = col; sprite.setColorFilter(new PorterDuffColorFilter(col, PorterDuff.Mode.SRC_IN)); }
        sprite.setAlpha(Math.max(0, Math.min(255, alpha)));
        r.set(x - size, y - size, x + size, y + size);
        c.drawBitmap(glow, null, r, sprite);
    }

    private void drawFx(Canvas c, int W, int H, float t, float dt) {
        p.setShader(null);
        p.setStyle(Paint.Style.FILL);
        switch (def.id) {
            case "snowfall":
                for (int i = 0; i < n; i++) {
                    py[i] += ps[i] * dt;
                    if (py[i] > H + 10) { py[i] = -10; px[i] = rnd.nextFloat() * W; }
                    float x = px[i] + (float) Math.sin(t * 0.5f + pph[i]) * 14 * u * pz[i];
                    int a = (int) (90 + 40 * pz[i]);
                    if (pz[i] > 2.6f) sprite(c, x, py[i], pz[i] * 3.2f * u, 0xFFFFFFFF, a);
                    else { p.setColor(Color.argb(a, 255, 255, 255)); c.drawCircle(x, py[i], pz[i] * 1.6f * u, p); }
                }
                break;
            case "barca":
                for (int i = 0; i < n; i++) {
                    if (pz[i] == 0) {
                        float pulse = 0.75f + 0.25f * (float) Math.sin(t * 2.3f * ps[i] + pph[i]);
                        sprite(c, px[i], py[i], H * 0.045f, 0xFFFFFFFF, (int) (150 * pulse));
                    } else if (pz[i] == 1) {
                        float x = px[i] + ((t * 6 * ps[i] * u) % (W * 0.3f));
                        float y = py[i] - (float) Math.sin(t * 0.2f + pph[i]) * H * 0.02f;
                        sprite(c, x, y, H * (0.09f + 0.04f * ps[i]), 0xFFD8DCE6, 34);
                    } else {
                        float ph = (t * 0.35f * ps[i] + pph[i]) % 6.28f;
                        if (ph < 0.12f) {
                            if (ph < 0.01f) { px[i] = W * rnd.nextFloat(); py[i] = H * (0.3f + rnd.nextFloat() * 0.35f); }
                            sprite(c, px[i], py[i], H * 0.012f, 0xFFFFFFFF, (int) (230 * (1 - ph / 0.12f)));
                        }
                    }
                }
                break;
            case "etoiles": {
                for (int i = 0; i < n; i++) {
                    float x = px[i];
                    float tw = 0.5f + 0.5f * (float) Math.sin(t * (0.7f + pz[i] * 1.6f) + pph[i]);
                    p.setColor(Color.argb((int) (255 * pz[i] * (0.3f + 0.7f * tw)), 225, 235, 255));
                    c.drawCircle(x, py[i], ps[i] * (0.6f + 0.4f * pz[i]), p);
                }
                float per = 11f, ph = t % per;
                if (animate && ph < 1.1f) {
                    int k = (int) (t / per);
                    float sx = W * (0.15f + (k * 0.37f) % 0.6f), sy = H * (0.06f + (k * 0.13f) % 0.2f);
                    float q = ph / 1.1f, dx = W * 0.32f, dy = H * 0.16f;
                    float hx = sx + dx * q, hy = sy + dy * q;
                    p.setStyle(Paint.Style.STROKE);
                    p.setStrokeWidth(2.2f * u + 0.5f);
                    p.setShader(new LinearGradient(hx - dx * 0.22f, hy - dy * 0.22f, hx, hy, 0x00FFFFFF, Color.argb((int) (230 * (1 - q)), 255, 255, 255), Shader.TileMode.CLAMP));
                    c.drawLine(hx - dx * 0.22f, hy - dy * 0.22f, hx, hy, p);
                    p.setShader(null);
                    p.setStyle(Paint.Style.FILL);
                }
                break;
            }
            case "console":
                p.setStyle(Paint.Style.STROKE);
                p.setStrokeCap(Paint.Cap.ROUND);
                for (int k = 0; k < 0; k++) { // vagues désormais dans la photo
                    wave(W, H, t, k);
                    p.setStrokeWidth(H * (0.05f + 0.025f * k));
                    p.setColor(0x14AACCFF);
                    c.drawPath(path, p);
                    p.setStrokeWidth(1.6f * u + 0.5f);
                    p.setColor(0x55CFE2FF);
                    c.drawPath(path, p);
                }
                p.setStyle(Paint.Style.FILL);
                for (int i = 0; i < n; i++) {
                    py[i] -= ps[i] * dt;
                    if (py[i] < -10) { py[i] = H + 10; px[i] = rnd.nextFloat() * W; }
                    float x = px[i] + (float) Math.sin(t * 0.4f + pph[i]) * 20 * u;
                    sprite(c, x, py[i], (3 + pz[i] * 6) * u, 0xFFCFE6FF, (int) (60 + 120 * pz[i] * (0.5f + 0.5f * (float) Math.sin(t + pph[i]))));
                }
                break;
            case "hyper": {
                float cx = W * 0.5f, cy = H * 0.45f, f = W * 0.18f;
                p.setStyle(Paint.Style.STROKE);
                p.setStrokeCap(Paint.Cap.ROUND);
                for (int i = 0; i < n; i++) {

                    pz[i] -= 0.11f * dt;
                    if (pz[i] < 0.03f) { resetWarp(i, false); continue; }
                    float x1 = cx + px[i] / pz[i] * f, y1 = cy + py[i] / pz[i] * f;
                    float zt = Math.min(1f, pz[i] + 0.05f);
                    float x0 = cx + px[i] / zt * f, y0 = cy + py[i] / zt * f;
                    if (x1 < -50 || x1 > W + 50 || y1 < -50 || y1 > H + 50) { resetWarp(i, false); continue; }
                    float a = Math.min(1f, (1 - pz[i]) * 1.4f);
                    p.setStrokeWidth((1f + (1 - pz[i]) * 2.5f) * u);
                    p.setColor(Color.argb((int) (220 * a), 200, 235, 255));
                    c.drawLine(x0, y0, x1, y1, p);
                }
                p.setStyle(Paint.Style.FILL);
                break;
            }
            case "neon":
                p.setStyle(Paint.Style.STROKE);
                p.setStrokeWidth(1.2f * u + 0.3f);
                for (int i = 0; i < n; i++) {
                    py[i] += ps[i] * dt;
                    px[i] -= ps[i] * 0.12f * dt;
                    if (py[i] > H + 40) { py[i] = -40; px[i] = rnd.nextFloat() * W * 1.1f; }
                    float len = 26 * u * pz[i];
                    p.setColor(Color.argb((int) (55 * pz[i]), 210, 225, 255));
                    c.drawLine(px[i], py[i], px[i] - len * 0.12f, py[i] + len, p);
                }
                p.setStyle(Paint.Style.FILL);
                break;
            case "neon_old": {
                float hz = H * 0.62f, vx = W * 0.5f;
                p.setStyle(Paint.Style.STROKE);
                p.setStrokeWidth(1.6f * u + 0.5f);
                c.save();
                c.clipRect(0, hz, W, H);
                for (int i = -14; i <= 14; i++) {
                    p.setColor(0x88FF2BD6);
                    c.drawLine(vx + i * W * 0.012f, hz, vx + i * W * 0.11f, H, p);
                }
                float fr = (t * 0.35f) % 1f;
                for (int j = 0; j < 14; j++) {
                    float d = (j + fr) / 14f;
                    float y = hz + (H - hz) * d * d;
                    p.setColor(Color.argb((int) (40 + 180 * d), 255, 43, 214));
                    c.drawLine(0, y, W, y, p);
                }
                c.restore();
                p.setStyle(Paint.Style.FILL);
                break;
            }
            case "matrice": {
                p.setTypeface(Typeface.MONOSPACE);
                p.setTextSize(font);
                for (int i = 0; i < n; i++) {
                    py[i] += ps[i] * dt;
                    if (py[i] - 16 * font > H) { py[i] = -rnd.nextFloat() * H * 0.4f; ps[i] = H * (0.12f + rnd.nextFloat() * 0.33f); }
                    if (rnd.nextFloat() < 0.08f) chars[i][rnd.nextInt(16)] = GLYPHS.charAt(rnd.nextInt(GLYPHS.length()));
                    float x = i * font * 1.3f;
                    for (int k = 0; k < 16; k++) {
                        float y = py[i] - k * font;
                        if (y < -font || y > H + font) continue;
                        if (k == 0) p.setColor(0xF0DFFFE6);
                        else p.setColor(Color.argb((int) (200 * (1 - k / 16f)), 40, 255, 110));
                        c.drawText(chars[i], k, 1, x, y, p);
                    }
                }
                break;
            }
            case "aurore_old": {
                for (int b = 0; b < 3; b++) {
                    path.reset();
                    int steps = 36;
                    float[] top = new float[steps + 1];
                    for (int i = 0; i <= steps; i++) {
                        float xr = i / (float) steps;
                        top[i] = H * (0.1f + 0.06f * b) + H * 0.06f * (float) Math.sin(xr * 6.28f * 0.9f + t * (0.12f + 0.05f * b) + b * 1.7f)
                                + H * 0.03f * (float) Math.sin(xr * 6.28f * 2.1f - t * 0.2f);
                        if (i == 0) path.moveTo(0, top[0]); else path.lineTo(W * xr, top[i]);
                    }
                    for (int i = steps; i >= 0; i--) {
                        float xr = i / (float) steps;
                        float th = H * (0.22f + 0.07f * (float) Math.sin(xr * 6f + t * 0.3f + b));
                        path.lineTo(W * xr, top[i] + th);
                    }
                    path.close();
                    p.setShader(bandShaders[b]);
                    p.setAlpha((int) (200 + 55 * Math.sin(t * 0.4f + b)));
                    c.drawPath(path, p);
                }
                p.setShader(null);
                p.setAlpha(255);
                p.setColor(0xFF02070C);
                c.drawPath(front, p);
                break;
            }
            case "foret":
                for (int i = 0; i < n; i++) {
                    float x = px[i] + (float) Math.sin(t * 0.3f * ps[i] + pph[i]) * W * 0.03f;
                    float y = py[i] + (float) Math.cos(t * 0.23f * ps[i] + pph[i] * 1.3f) * H * 0.03f;
                    float pulse = 0.5f + 0.5f * (float) Math.sin(t * 1.4f * ps[i] + pph[i]);
                    pulse *= pulse;
                    sprite(c, x, y, H * 0.022f, 0xFFFFE27A, (int) (230 * pulse));
                    p.setColor(Color.argb((int) (255 * pulse), 255, 250, 210));
                    c.drawCircle(x, y, 1.6f * u + 0.5f, p);
                }
                break;
            case "dune":
                for (int i = 0; i < n; i++) {
                    px[i] += (12 + 26 * pz[i]) * u * dt;
                    if (px[i] > W + 5) px[i] = -5;
                    float y = py[i] + (float) Math.sin(t * 0.5f + pph[i]) * 8 * u;
                    p.setColor(Color.argb((int) (40 + 90 * pz[i]), 255, 217, 168));
                    c.drawCircle(px[i], y, (0.8f + pz[i] * 1.8f) * u, p);
                }
                break;
            case "arcade": {
                float cell = Math.max(4, Math.round(8 * u));
                int[] cols = {0xFFFFFFFF, 0xFFFFCC00, 0xFF3CE8FF};
                for (int i = 0; i < n; i++) {
                    if (Math.sin(t * ps[i] + pph[i]) < -0.3) continue;
                    p.setColor(cols[(int) pz[i]]);
                    float sz = pz[i] == 0 ? cell : cell * 0.5f;
                    c.drawRect(px[i], py[i], px[i] + sz, py[i] + sz, p);
                }
                p.setColor(0xFF2A1060);
                c.drawPath(front, p);
                p.setColor(0xFFFFCC00);
                // la lune est dans front2 avec les collines avant : on dessine la lune d'abord en jaune
                c.save();
                c.clipRect(0, 0, W, H * 0.4f);
                c.drawPath(front2, p);
                c.restore();
                c.save();
                c.clipRect(0, H * 0.4f, W, H);
                p.setColor(0xFF12062E);
                c.drawPath(front2, p);
                c.restore();
                p.setShader(scan);
                c.drawRect(0, 0, W, H, p);
                p.setShader(null);
                break;
            }
            case "abysses":
                p.setStyle(Paint.Style.STROKE);
                p.setStrokeWidth(1.4f * u + 0.4f);
                for (int i = 0; i < n; i++) {
                    if (i % 2 == 0) {
                        py[i] -= ps[i] * 2 * dt;
                        if (py[i] < -20) { py[i] = H + 20; px[i] = rnd.nextFloat() * W; }
                        float x = px[i] + (float) Math.sin(t * 1.3f + pph[i]) * 6 * u;
                        p.setColor(0x55FFFFFF);
                        c.drawCircle(x, py[i], (2 + pz[i] * 7) * u, p);
                    } else {
                        float x = px[i] + (float) Math.sin(t * 0.2f + pph[i]) * W * 0.02f;
                        float y = py[i] + (float) Math.cos(t * 0.17f + pph[i]) * H * 0.02f;
                        float pulse = 0.5f + 0.5f * (float) Math.sin(t * 0.9f + pph[i]);
                        sprite(c, x, y, (4 + pz[i] * 7) * u, 0xFF4FE3FF, (int) (200 * pulse));
                    }
                }
                p.setStyle(Paint.Style.FILL);
                break;
            case "photos":
                drawPhotos(c, W, H, t);
                break;
            default:
        }
    }

    private void wave(int W, int H, float t, int k) {
        path.reset();
        for (int x = -60; x <= W + 60; x += 30) {
            float xr = x / (float) W;
            float y = H * (0.4f + 0.085f * k)
                    + H * 0.07f * (float) Math.sin(xr * 6.28f * (0.8f + 0.2f * k) + t * (0.22f + 0.06f * k) + k)
                    + H * 0.025f * (float) Math.sin(xr * 6.28f * 2.3f - t * 0.37f);
            if (x == -60) path.moveTo(x, y); else path.lineTo(x, y);
        }
    }

    // ------------------------------------------------------------------ mes images

    private void drawPhotos(Canvas c, int W, int H, float t) {
        if (photoCur == null) {
            p.setColor(0xCCFFFFFF);
            p.setTextSize(28 * u);
            p.setTypeface(Typeface.create("sans-serif-light", Typeface.NORMAL));
            p.setTextAlign(Paint.Align.CENTER);
            c.drawText("Aucune image : sur le Mac, lance  ./installer.sh fond  puis glisse tes images", W / 2f, H * 0.12f, p);
            p.setTextAlign(Paint.Align.LEFT);
            return;
        }
        float period = 70f;
        float k = (t - photoStart) / period;
        if (photos.size() > 1 && animate) {
            if (k > 0.85f && photoNext == null && !loading) loadNext(W, H);
            if (k >= 1f && photoNext != null) {
                if (photoPrev != null) photoPrev.recycle();
                photoPrev = photoCur;
                photoCur = photoNext;
                photoNext = null;
                photoIdx = (photoIdx + 1) % photos.size();
                photoStart = t;
                fadeStart = t;
                k = 0;
            }
        } else if (k > 1f && animate) { photoStart = t; k = 0; }
        float fade = Math.min(1f, (t - fadeStart) / 2.5f);
        if (photoPrev != null && fade < 1f) kenBurns(c, photoPrev, W, H, 1f, photoIdx + 1, 255);
        else if (photoPrev != null) { photoPrev.recycle(); photoPrev = null; }
        kenBurns(c, photoCur, W, H, Math.min(1f, k), photoIdx, (int) (255 * fade));
        p.setShader(photoShade);
        c.drawRect(0, 0, W, H, p);
        p.setShader(null);
    }

    private void kenBurns(Canvas c, Bitmap b, int W, int H, float k, int idx, int alpha) {
        float s = Math.max(W / (float) b.getWidth(), H / (float) b.getHeight());
        float zoom = 1.04f + 0.1f * k;
        float dir = idx % 2 == 0 ? 1 : -1;
        m.reset();
        m.postScale(s * zoom, s * zoom);
        float bw = b.getWidth() * s * zoom, bh = b.getHeight() * s * zoom;
        m.postTranslate((W - bw) / 2f + dir * (k - 0.5f) * W * 0.03f, (H - bh) / 2f);
        bmp.setAlpha(alpha);
        c.drawBitmap(b, m, bmp);
        bmp.setAlpha(255);
    }

    private void loadNext(int W, int H) {
        loading = true;
        final File f = photos.get((photoIdx + 1) % photos.size());
        new Thread(() -> { photoNext = decode(f, W, H); loading = false; }, "fond").start();
    }

    private static Bitmap decode(File f, int W, int H) {
        try {
            BitmapFactory.Options o = new BitmapFactory.Options();
            o.inJustDecodeBounds = true;
            BitmapFactory.decodeFile(f.getAbsolutePath(), o);
            int sample = 1;
            while (o.outWidth / (sample * 2) >= W && o.outHeight / (sample * 2) >= H) sample *= 2;
            o = new BitmapFactory.Options();
            o.inSampleSize = sample;
            o.inPreferredConfig = Bitmap.Config.RGB_565;
            return BitmapFactory.decodeFile(f.getAbsolutePath(), o);
        } catch (Throwable e) {
            return null;
        }
    }
}
