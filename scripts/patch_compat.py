# Compatibilite maximale : abaisse la version minimale d'Android au plancher de Capacitor 6 (API 22,
# Android 5.1) pour que l'appli s'installe sur les vieux telephones.
import re, os
F = "android/variables.gradle"
if not os.path.exists(F):
    print("variables.gradle introuvable, rien a faire.")
else:
    src = open(F, encoding="utf-8").read()
    def bas(m):
        return m.group(1) + str(min(int(m.group(2)), 22))
    neuf = re.sub(r"(minSdkVersion\s*=\s*)(\d+)", bas, src)
    open(F, "w", encoding="utf-8").write(neuf)
    print("minSdkVersion :", re.findall(r"minSdkVersion\s*=\s*\d+", neuf))
