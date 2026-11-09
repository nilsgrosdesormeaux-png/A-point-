package fr.cinema.accueil;

import android.accessibilityservice.AccessibilityServiceInfo;
import android.app.Activity;
import android.content.ComponentName;
import android.content.Intent;
import android.graphics.Typeface;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.StateListDrawable;
import android.os.Bundle;
import android.provider.Settings;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.accessibility.AccessibilityManager;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import java.io.File;

/** Écran « Personnaliser » : thème, style des tuiles, taille, bouton Accueil… */
public class SettingsActivity extends Activity {
    private Prefs p;
    private ImageView wall;
    private LinearLayout list;
    private int focusIndex;

    private interface Opt { String value(); void change(int dir); }

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        p = new Prefs(this);
        FrameLayout root = new FrameLayout(this);
        wall = new ImageView(this);
        wall.setScaleType(ImageView.ScaleType.CENTER_CROP);
        root.addView(wall, new FrameLayout.LayoutParams(-1, -1));
        View shade = new View(this);
        shade.setBackground(new ColorDrawable(0x66000000));
        root.addView(shade, new FrameLayout.LayoutParams(-1, -1));

        ScrollView sv = new ScrollView(this);
        sv.setVerticalScrollBarEnabled(false);
        sv.setClipToPadding(false);
        list = new LinearLayout(this);
        list.setOrientation(LinearLayout.VERTICAL);
        int side = Ui.dp(this, 120);
        list.setPadding(side, Ui.dp(this, 40), side, Ui.dp(this, 60));
        sv.addView(list);
        root.addView(sv, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);
    }

    @Override protected void onResume() {
        super.onResume();
        build();
    }

    private void build() {
        wall.setImageDrawable(Themes.wallpaper(this, p.theme()));
        list.removeAllViews();

        TextView title = new TextView(this);
        title.setText("Personnaliser");
        title.setTextSize(34);
        title.setTextColor(0xFFF5F2EC);
        title.setTypeface(Typeface.create("sans-serif-light", Typeface.NORMAL));
        list.addView(title);
        TextView sub = new TextView(this);
        sub.setText("Gauche / droite ou OK pour changer. Les changements s'appliquent tout de suite.");
        sub.setTextSize(13);
        sub.setTextColor(0x99FFFFFF);
        sub.setPadding(0, Ui.dp(this, 4), 0, Ui.dp(this, 18));
        list.addView(sub);

        section("Apparence");
        option("Thème", new Opt() {
            public String value() { return Prefs.THEME_NAMES[themeIndex()]; }
            public void change(int d) {
                int n = Prefs.THEMES.length;
                p.setTheme(Prefs.THEMES[((themeIndex() + d) % n + n) % n]);
                if ("perso".equals(p.theme())) {
                    File f = Themes.customFile(SettingsActivity.this);
                    if (f == null || !f.exists())
                        Toast.makeText(SettingsActivity.this, "Aucune image trouvée : envoie-la avec le script (option fond).", Toast.LENGTH_LONG).show();
                }
            }
        });
        option("Style des tuiles", new Opt() {
            public String value() { return p.tileStyle() == 0 ? "Bannières officielles" : "Couleurs de marque"; }
            public void change(int d) { p.setTileStyle(1 - p.tileStyle()); }
        });
        option("Taille des tuiles", new Opt() {
            final String[] n = {"Grande", "Moyenne", "Compacte"};
            public String value() { return n[p.tileSize()]; }
            public void change(int d) { p.setTileSize(((p.tileSize() + d) % 3 + 3) % 3); }
        });
        toggle("Noms sous les tuiles", "labels", false);
        toggle("Fond animé (léger mouvement)", "anim", false);

        section("Contenu");
        toggle("Ligne « Toutes les applis »", "all", true);
        toggle("Masquer les applis Amazon", "hideAmazon", true);
        action("Réafficher les applis masquées", () -> { p.clearHidden(); toast("Applis réaffichées"); });
        action("Replacer les applis par défaut", () -> { p.resetRows(); toast("Lignes réinitialisées"); });

        section("Bouton Accueil");
        toggle("Interception directe (aucun passage par Amazon)", "intercept", true);
        option("Service Accueil Cinéma", new Opt() {
            public String value() { return serviceOn() ? "Activé" : "Désactivé – OK pour l'activer"; }
            public void change(int d) {
                try { startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)); }
                catch (Throwable t) { toast("Active-le avec le script d'installation"); }
            }
        });

        TextView help = new TextView(this);
        help.setText("Astuce : sur l'accueil, appui long sur OK (ou touche Menu) sur une tuile pour la déplacer, "
                + "la changer de ligne ou la masquer.\nAppui long sur Accueil : Paramètres Fire TV.\n"
                + "Fond perso : image envoyée dans " + pathHint());
        help.setTextSize(12);
        help.setTextColor(0x80FFFFFF);
        help.setPadding(0, Ui.dp(this, 26), 0, 0);
        list.addView(help);

        View target = null;
        int idx = 0;
        for (int i = 0; i < list.getChildCount(); i++) {
            View c = list.getChildAt(i);
            if (c.isFocusable()) { if (idx == focusIndex) target = c; idx++; }
        }
        if (target != null) target.requestFocus();
    }

    private String pathHint() {
        File f = Themes.customFile(this);
        return f == null ? "(stockage indisponible)" : f.getParent() + "/fond.jpg";
    }

    private int themeIndex() {
        String t = p.theme();
        for (int i = 0; i < Prefs.THEMES.length; i++) if (Prefs.THEMES[i].equals(t)) return i;
        return 0;
    }

    private boolean serviceOn() {
        AccessibilityManager am = (AccessibilityManager) getSystemService(ACCESSIBILITY_SERVICE);
        if (am == null) return false;
        ComponentName me = new ComponentName(this, HomeGuardService.class);
        for (AccessibilityServiceInfo i : am.getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_ALL_MASK)) {
            if (i.getResolveInfo() != null && i.getResolveInfo().serviceInfo != null
                    && me.getClassName().equals(i.getResolveInfo().serviceInfo.name)) return true;
        }
        return false;
    }

    private void toast(String s) { Toast.makeText(this, s, Toast.LENGTH_SHORT).show(); }

    private void section(String s) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setAllCaps(true);
        t.setLetterSpacing(0.18f);
        t.setTextSize(12);
        t.setTextColor(Themes.accent(p.theme()));
        t.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        t.setPadding(Ui.dp(this, 4), Ui.dp(this, 18), 0, Ui.dp(this, 6));
        list.addView(t);
    }

    private void toggle(String label, String key, boolean def) {
        option(label, new Opt() {
            public String value() { return p.bool(key, def) ? "Oui" : "Non"; }
            public void change(int d) { p.setBool(key, !p.bool(key, def)); }
        });
    }

    private void action(String label, Runnable r) {
        option(label, new Opt() {
            public String value() { return "OK"; }
            public void change(int d) { r.run(); }
        });
    }

    private void option(String label, Opt o) {
        final int myIndex = countFocusable();
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setFocusable(true);
        row.setPadding(Ui.dp(this, 18), Ui.dp(this, 12), Ui.dp(this, 18), Ui.dp(this, 12));
        row.setBackground(rowBg());
        TextView l = new TextView(this);
        l.setText(label);
        l.setTextSize(17);
        l.setTextColor(0xFFF0EDE6);
        row.addView(l, new LinearLayout.LayoutParams(0, -2, 1f));
        TextView v = new TextView(this);
        v.setText(o.value());
        v.setTextSize(15);
        v.setTextColor(0xCCFFFFFF);
        v.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        row.addView(v);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
        lp.bottomMargin = Ui.dp(this, 4);
        list.addView(row, lp);

        row.setOnClickListener(x -> { focusIndex = myIndex; o.change(1); after(o, v); });
        row.setOnKeyListener((x, code, e) -> {
            if (e.getAction() != KeyEvent.ACTION_DOWN) return false;
            if (code == KeyEvent.KEYCODE_DPAD_RIGHT || code == KeyEvent.KEYCODE_DPAD_LEFT) {
                focusIndex = myIndex;
                o.change(code == KeyEvent.KEYCODE_DPAD_RIGHT ? 1 : -1);
                after(o, v);
                return true;
            }
            return false;
        });
        row.setOnFocusChangeListener((x, has) -> { if (has) focusIndex = myIndex; });
    }

    /** Après un changement : on reconstruit l'écran pour voir l'effet (thème, couleurs). */
    private void after(Opt o, TextView v) {
        v.setText(o.value());
        list.post(this::build);
    }

    private int countFocusable() {
        int n = 0;
        for (int i = 0; i < list.getChildCount(); i++) if (list.getChildAt(i).isFocusable()) n++;
        return n;
    }

    private StateListDrawable rowBg() {
        int r = Ui.dp(this, 10);
        GradientDrawable on = new GradientDrawable();
        on.setCornerRadius(r);
        on.setColor(0x33FFFFFF);
        on.setStroke(Ui.dp(this, 2), Themes.accent(p.theme()));
        GradientDrawable off = new GradientDrawable();
        off.setCornerRadius(r);
        off.setColor(0x14FFFFFF);
        StateListDrawable s = new StateListDrawable();
        s.addState(new int[]{android.R.attr.state_focused}, on);
        s.addState(new int[]{}, off);
        return s;
    }
}
