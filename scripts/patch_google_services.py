# Notifications push natives (Firebase Cloud Messaging) : copie google-services.json dans l'app.
# Le fichier se telecharge dans Firebase > Parametres du projet > Tes applications > Android
# (identifiant du paquet : com.sabi.app), puis se depose a la racine du depot.
import os, shutil, sys
src = next((c for c in ["google-services.json", "www/google-services.json"] if os.path.exists(c)), None)
if not src:
    print("::warning::google-services.json absent du depot : l'APK se construit, mais les notifications push natives ne marcheront pas.")
    sys.exit(0)
dest = "android/app/google-services.json"
os.makedirs(os.path.dirname(dest), exist_ok=True)
shutil.copyfile(src, dest)
print("google-services.json copie. (Le modele Capacitor active le plugin Google Services quand ce fichier existe.)")
