# Ecran de demarrage : logo Sabi centre, taille naturelle (jamais etire), sur fond sombre #131313.
# - Android 12+ : l'ecran de demarrage systeme (icone animee + fond) est regle dans styles.xml.
# - Android 11 et avant : fond uni + logo centre via un drawable "layer-list" (le bitmap n'est pas etire).
# Les anciennes images splash.png de Capacitor (carrees, etirees sur l'ecran) sont supprimees.
import glob, os, re
from PIL import Image

RES = "android/app/src/main/res"
FOND = "#131313"
logo_chemin = next((c for c in ["www/logo-icon.png", "logo-icon.png", "www/icons/icon-512.png"] if os.path.exists(c)), None)

# Logo sur toile carree transparente : marge autour (l'icone systeme est decoupee en cercle).
toile = Image.new("RGBA", (960, 960), (0, 0, 0, 0))
if logo_chemin:
    logo = Image.open(logo_chemin).convert("RGBA")
    logo.thumbnail((440, 440), Image.LANCZOS)
    toile.paste(logo, ((960 - logo.width) // 2, (960 - logo.height) // 2), logo)
    print("Logo :", logo_chemin)
os.makedirs(os.path.join(RES, "drawable-nodpi"), exist_ok=True)
toile.save(os.path.join(RES, "drawable-nodpi", "splash_logo.png"))

# Supprime les splash.png de Capacitor (sinon conflit avec splash.xml)
for f in glob.glob(os.path.join(RES, "drawable*", "splash.png")):
    os.remove(f)
os.makedirs(os.path.join(RES, "drawable"), exist_ok=True)
with open(os.path.join(RES, "drawable", "splash.xml"), "w", encoding="utf-8") as f:
    f.write('<?xml version="1.0" encoding="utf-8"?>\n'
            '<layer-list xmlns:android="http://schemas.android.com/apk/res/android">\n'
            '    <item android:drawable="@color/sabi_splash_fond"/>\n'
            '    <item>\n'
            '        <bitmap android:src="@drawable/splash_logo" android:gravity="center"/>\n'
            '    </item>\n'
            '</layer-list>\n')
os.makedirs(os.path.join(RES, "values"), exist_ok=True)
with open(os.path.join(RES, "values", "sabi_splash.xml"), "w", encoding="utf-8") as f:
    f.write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="sabi_splash_fond">' + FOND + '</color>\n</resources>\n')

# Theme de lancement : fond sombre + icone animee (Android 12+)
styles = os.path.join(RES, "values", "styles.xml")
if os.path.exists(styles):
    xml = open(styles, encoding="utf-8").read()
    if "windowSplashScreenBackground" not in xml:
        ajout = ('\n        <item name="windowSplashScreenBackground">@color/sabi_splash_fond</item>'
                 '\n        <item name="windowSplashScreenAnimatedIcon">@drawable/splash_logo</item>')
        neuf = re.sub(r'(<style\s+name="AppTheme\.NoActionBarLaunch"[^>]*>)', r'\1' + ajout, xml, count=1)
        if neuf == xml:
            print("::warning::AppTheme.NoActionBarLaunch introuvable dans styles.xml : ecran de demarrage Android 12+ non regle.")
        else:
            open(styles, "w", encoding="utf-8").write(neuf)
            print("styles.xml : fond et icone de demarrage regles.")
else:
    print("::warning::styles.xml introuvable.")
print("Ecran de demarrage genere.")
