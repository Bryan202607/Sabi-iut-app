# Ecran de demarrage : logo Sabi centre sur fond sombre (#131313). Remplace toutes les images
# splash.png creees par Capacitor.
import os, glob
from PIL import Image

RES = "android/app/src/main/res"
logo_chemin = next((c for c in ["www/logo-icon.png", "logo-icon.png", "www/icons/icon-512.png"] if os.path.exists(c)), None)
toile = Image.new("RGBA", (2048, 2048), (19, 19, 19, 255))
if logo_chemin:
    logo = Image.open(logo_chemin).convert("RGBA")
    cote = 640
    logo.thumbnail((cote, cote), Image.LANCZOS)
    toile.paste(logo, ((2048 - logo.width) // 2, (2048 - logo.height) // 2), logo)
    print("Logo :", logo_chemin)
cibles = glob.glob(os.path.join(RES, "drawable*", "splash.png"))
if not cibles:
    os.makedirs(os.path.join(RES, "drawable"), exist_ok=True)
    cibles = [os.path.join(RES, "drawable", "splash.png")]
for c in cibles:
    toile.convert("RGB").save(c)
print("Ecran de demarrage genere :", len(cibles), "fichier(s).")
