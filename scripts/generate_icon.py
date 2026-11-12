# Genere l'icone de l'app (toutes densites) a partir de l'image fournie dans le depot :
# icon-source.png (racine), sinon www/icons/icon-512.png. Si aucune image : fond sombre + "S" dore.
import os
from PIL import Image, ImageDraw, ImageFont

RES = "android/app/src/main/res"
FOND = (19, 19, 19, 255)  # #131313
LEGACY = {"mipmap-mdpi": 48, "mipmap-hdpi": 72, "mipmap-xhdpi": 96, "mipmap-xxhdpi": 144, "mipmap-xxxhdpi": 192}
ADAPT = {"mipmap-mdpi": 108, "mipmap-hdpi": 162, "mipmap-xhdpi": 216, "mipmap-xxhdpi": 324, "mipmap-xxxhdpi": 432}

def premier(noms):
    for n in noms:
        if os.path.exists(n):
            return n

def lettre_s():
    img = Image.new("RGBA", (1024, 1024), FOND)
    d = ImageDraw.Draw(img)
    try:
        police = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 640)
    except Exception:
        police = ImageFont.load_default()
    d.text((512, 512), "S", fill=(242, 202, 80, 255), font=police, anchor="mm")
    return img

def rond(img):
    m = Image.new("L", img.size, 0)
    ImageDraw.Draw(m).ellipse((0, 0, img.size[0] - 1, img.size[1] - 1), fill=255)
    out = Image.new("RGBA", img.size, (0, 0, 0, 0))
    out.paste(img, (0, 0), m)
    return out

src = premier(["icon-source.png", "www/icons/icon-512.png", "www/icon-512.png"])
maskable = premier(["icon-512-maskable.png", "www/icons/icon-512-maskable.png"]) or src
legacy = Image.open(src).convert("RGBA").resize((1024, 1024)) if src else lettre_s()
adapt = Image.open(maskable).convert("RGBA").resize((1024, 1024)) if maskable else legacy
print("Icone :", src or "lettre S par defaut")

for dossier, t in LEGACY.items():
    d = os.path.join(RES, dossier); os.makedirs(d, exist_ok=True)
    l = legacy.resize((t, t), Image.LANCZOS)
    l.save(os.path.join(d, "ic_launcher.png"))
    rond(l).save(os.path.join(d, "ic_launcher_round.png"))
for dossier, t in ADAPT.items():
    d = os.path.join(RES, dossier); os.makedirs(d, exist_ok=True)
    adapt.resize((t, t), Image.LANCZOS).save(os.path.join(d, "ic_launcher_foreground.png"))

os.makedirs(os.path.join(RES, "values"), exist_ok=True)
with open(os.path.join(RES, "values", "ic_launcher_background.xml"), "w") as f:
    f.write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#131313</color>\n</resources>\n')
print("Icones generees.")
