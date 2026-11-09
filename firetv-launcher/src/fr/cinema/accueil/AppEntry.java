package fr.cinema.accueil;

import android.content.Intent;
import android.graphics.drawable.Drawable;

/** Une tuile : application installée ou raccourci système. */
final class AppEntry {
    String pkg;
    String label;
    Drawable banner;
    Drawable icon;
    int color;
    Intent intent;
    boolean system;
}
