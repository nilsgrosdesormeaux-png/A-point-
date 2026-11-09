package fr.cinema.accueil;

import android.content.Context;
import android.graphics.Matrix;
import android.graphics.SurfaceTexture;
import android.media.MediaPlayer;
import android.os.Handler;
import android.os.Looper;
import android.view.Surface;
import android.view.TextureView;
import java.io.File;
import java.util.List;

/** Fond animé : tes vidéos en boucle, sans le son, recadrées plein écran. Une nouvelle vidéo par minute. */
final class VideoBg extends TextureView implements TextureView.SurfaceTextureListener {
    private final Handler h = new Handler(Looper.getMainLooper());
    private List<File> files;
    private String asset;          // vidéo intégrée à l'appli (thème Console)
    private int idx;
    private boolean want;
    private MediaPlayer mp;
    private Surface surface;
    private int vw, vh;

    private final Runnable next = () -> {
        if (files != null && files.size() > 1) { idx = (idx + 1) % files.size(); start(); }
    };

    VideoBg(Context c) {
        super(c);
        setSurfaceTextureListener(this);
        setVisibility(GONE);
    }

    void playAsset(String name) {
        boolean same = want && name.equals(asset);
        asset = name;
        files = null;
        want = true;
        setVisibility(VISIBLE);
        if (!same) start();
    }

    void play(List<File> f) {
        boolean same = want && asset == null && files != null && files.equals(f);
        asset = null;
        files = f;
        want = true;
        setVisibility(VISIBLE);
        if (!same) { idx = 0; start(); }
    }

    void stop() {
        want = false;
        releasePlayer();
        setVisibility(GONE);
    }

    void pause() { releasePlayer(); }

    void resume() { if (want && mp == null) start(); }

    private void start() {
        releasePlayer();
        if (!want || surface == null || (asset == null && (files == null || files.isEmpty()))) return;
        try {
            final MediaPlayer m = new MediaPlayer();
            mp = m;
            if (asset != null) {
                android.content.res.AssetFileDescriptor afd = getContext().getAssets().openFd(asset);
                m.setDataSource(afd.getFileDescriptor(), afd.getStartOffset(), afd.getLength());
                afd.close();
            } else m.setDataSource(files.get(idx % files.size()).getAbsolutePath());
            m.setSurface(surface);
            m.setVolume(0f, 0f);
            m.setLooping(true);
            m.setOnVideoSizeChangedListener((x, w, hh) -> { vw = w; vh = hh; fit(); });
            m.setOnPreparedListener(x -> { if (x == mp) { x.start(); fit(); } });
            m.setOnErrorListener((x, a, b) -> { h.postDelayed(next, 500); return true; });
            m.prepareAsync();
            h.removeCallbacks(next);
            h.postDelayed(next, 60000);
        } catch (Throwable t) {
            releasePlayer();
        }
    }

    private void releasePlayer() {
        h.removeCallbacks(next);
        if (mp != null) {
            try { mp.release(); } catch (Throwable ignored) { }
            mp = null;
        }
    }

    /** Recadrage « plein écran » sans déformation. */
    private void fit() {
        int W = getWidth(), H = getHeight();
        if (W == 0 || H == 0 || vw == 0 || vh == 0) return;
        float s = Math.max(W / (float) vw, H / (float) vh);
        Matrix m = new Matrix();
        m.setScale(vw * s / W, vh * s / H, W / 2f, H / 2f);
        setTransform(m);
    }

    @Override public void onSurfaceTextureAvailable(SurfaceTexture st, int w, int hh) {
        surface = new Surface(st);
        if (want) start();
    }

    @Override public void onSurfaceTextureSizeChanged(SurfaceTexture st, int w, int hh) { fit(); }

    @Override public boolean onSurfaceTextureDestroyed(SurfaceTexture st) {
        releasePlayer();
        if (surface != null) { surface.release(); surface = null; }
        return true;
    }

    @Override public void onSurfaceTextureUpdated(SurfaceTexture st) { }
}
