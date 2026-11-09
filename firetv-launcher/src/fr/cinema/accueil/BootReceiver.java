package fr.cinema.accueil;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Au démarrage de la Fire TV : on ouvre directement Cinéma. */
public class BootReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context c, Intent i) {
        Guard.startKeeper(c);
        if (new Prefs(c).amazonAllowed()) return;
        Guard.ensure(c, false);
        try {
            c.startActivity(new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra(MainActivity.EXTRA_GUARD, true));
        } catch (Throwable ignored) { }
    }
}
