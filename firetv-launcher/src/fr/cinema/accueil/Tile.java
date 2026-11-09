package fr.cinema.accueil;

import android.content.Context;
import android.graphics.Outline;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewOutlineProvider;
import android.view.animation.DecelerateInterpolator;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

/** Grande tuile arrondie : bannière officielle ou icône sur la couleur de la marque. */
final class Tile extends LinearLayout {
    final AppEntry app;
    final int row;
    final FrameLayout card;
    private final TextView caption;
    private final int cardH;

    Tile(Context c, AppEntry app, int row, int w, int h, int style, int accent, boolean showLabel) {
        super(c);
        this.app = app;
        this.row = row;
        this.cardH = h;
        setOrientation(VERTICAL);
        setClipChildren(false);
        setClipToPadding(false);
        setFocusable(true);
        setFocusableInTouchMode(true);

        final float radius = Ui.dp(c, 14);
        card = new FrameLayout(c);
        card.setOutlineProvider(new ViewOutlineProvider() {
            @Override public void getOutline(View v, Outline o) {
                o.setRoundRect(0, 0, v.getWidth(), v.getHeight(), radius);
            }
        });
        card.setClipToOutline(true);
        card.setElevation(Ui.dp(c, 3));

        boolean useBanner = style == 0 && app.banner != null && !app.system;
        if (useBanner) {
            card.setBackgroundColor(0xFF111114);
            ImageView iv = new ImageView(c);
            iv.setScaleType(ImageView.ScaleType.CENTER_CROP);
            iv.setImageDrawable(app.banner);
            card.addView(iv, new FrameLayout.LayoutParams(-1, -1));
        } else {
            GradientDrawable bg = new GradientDrawable(GradientDrawable.Orientation.TL_BR,
                    new int[]{app.color, Brand.darker(app.color, 0.45f)});
            card.setBackground(bg);
            // reflet discret en haut de la tuile
            View sheen = new View(c);
            sheen.setBackground(new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
                    new int[]{0x22FFFFFF, 0x00FFFFFF}));
            card.addView(sheen, new FrameLayout.LayoutParams(-1, h / 2));
            ImageView iv = new ImageView(c);
            iv.setScaleType(ImageView.ScaleType.FIT_CENTER);
            iv.setImageDrawable(app.icon);
            int is = (int) (h * (app.system ? 0.34f : 0.46f));
            FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(is, is, Gravity.CENTER);
            if (!app.system) lp.bottomMargin = (int) (h * 0.08f);
            card.addView(iv, lp);
            {
                TextView name = new TextView(c);
                name.setText(app.label);
                name.setTextColor(0xEEFFFFFF);
                name.setTextSize(TypedValue.COMPLEX_UNIT_PX, Math.max(Ui.sp(c, 11), h * 0.11f));
                name.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
                name.setSingleLine(true);
                name.setEllipsize(TextUtils.TruncateAt.END);
                FrameLayout.LayoutParams np = new FrameLayout.LayoutParams(-2, -2, Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
                np.bottomMargin = (int) (h * 0.07f);
                np.leftMargin = np.rightMargin = Ui.dp(c, 8);
                if (app.system) { lp.bottomMargin = (int) (h * 0.12f); }
                card.addView(name, np);
            }
        }

        // contour lumineux visible seulement quand la tuile a le focus
        GradientDrawable ring = new GradientDrawable();
        ring.setCornerRadius(radius);
        ring.setStroke(Ui.dp(c, 3), accent);
        ring.setColor(0x00000000);
        final View ringView = new View(c);
        ringView.setBackground(ring);
        ringView.setAlpha(0f);
        card.addView(ringView, new FrameLayout.LayoutParams(-1, -1));

        addView(card, new LayoutParams(w, h));

        caption = new TextView(c);
        caption.setText(app.label);
        caption.setTextColor(0xB3FFFFFF);
        caption.setTextSize(13);
        caption.setSingleLine(true);
        caption.setEllipsize(TextUtils.TruncateAt.END);
        caption.setGravity(Gravity.CENTER_HORIZONTAL);
        caption.setVisibility(showLabel ? VISIBLE : GONE);
        LayoutParams cp = new LayoutParams(w, -2);
        cp.topMargin = Ui.dp(c, 8);
        addView(caption, cp);

        setOnFocusChangeListener((v, has) -> {
            float s = has ? 1.09f : 1f;
            animate().scaleX(s).scaleY(s).setDuration(160).setInterpolator(new DecelerateInterpolator()).start();
            ringView.animate().alpha(has ? 1f : 0f).setDuration(160).start();
            card.setElevation(Ui.dp(getContext(), has ? 14 : 3));
            caption.setTextColor(has ? 0xFFFFFFFF : 0xB3FFFFFF);
        });
    }

    String key() { return row + ":" + app.pkg; }

    @Override protected void onSizeChanged(int w, int h, int ow, int oh) {
        super.onSizeChanged(w, h, ow, oh);
        setPivotX(w / 2f);
        setPivotY(cardH / 2f);
    }
}
