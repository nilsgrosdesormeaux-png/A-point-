package fr.cinema.accueil;

import android.service.dreams.DreamService;

/** Écran de veille : ton fond d'écran (thème actuel, animé), sans tuiles, à la place de celui d'Amazon. */
public class CinemaDream extends DreamService implements HomeScreen.Host {
    private HomeScreen hs;

    @Override public void onAttachedToWindow() {
        super.onAttachedToWindow();
        setInteractive(false);
        setFullscreen(true);
        hs = new HomeScreen(this, new Prefs(this), new AppRepo(this), this);
        hs.rebuild();
        hs.setAmbient(true, false, false);
        setContentView(hs);
    }

    @Override public void onDreamingStarted() { super.onDreamingStarted(); if (hs != null) hs.resume(); }

    @Override public void onDreamingStopped() { if (hs != null) hs.release(); super.onDreamingStopped(); }

    @Override public void launch(Tile t) { }

    @Override public void menu(Tile t) { }
}
