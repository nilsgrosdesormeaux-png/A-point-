package fr.cinema.accueil;

import android.content.Context;
import android.util.TypedValue;

final class Ui {
    static int dp(Context c, float v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, c.getResources().getDisplayMetrics()));
    }
    static float sp(Context c, float v) {
        return TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, v, c.getResources().getDisplayMetrics());
    }
}
