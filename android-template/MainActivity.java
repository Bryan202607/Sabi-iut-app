package com.sabi.app;

import android.os.Bundle;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

// Version protegee : les captures d'ecran et l'enregistrement de l'ecran sont bloques (FLAG_SECURE).
// Les plugins natifs (SabiVoix, IconSwitcher) sont ajoutes avant super.onCreate par scripts/patch_icones.py.
public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);
    super.onCreate(savedInstanceState);
  }
}
