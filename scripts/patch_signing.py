# Signature de publication (Play Store) : utilisee seulement si les secrets GitHub existent.
import base64, os, re, sys
b64 = os.environ.get("ANDROID_KEYSTORE_BASE64", "").strip()
if not b64:
    print("Pas de cle de publication : signature ignoree (APK de test uniquement).")
    sys.exit(0)
mdp = os.environ.get("ANDROID_KEYSTORE_PASSWORD", "")
alias = os.environ.get("ANDROID_KEY_ALIAS", "")
mdp_cle = os.environ.get("ANDROID_KEY_PASSWORD", "") or mdp
if not mdp or not alias:
    print("::warning::ANDROID_KEYSTORE_PASSWORD ou ANDROID_KEY_ALIAS manquant : signature ignoree.")
    sys.exit(0)
chemin = "android/app/sabi-release.keystore"
open(chemin, "wb").write(base64.b64decode(b64))
F = "android/app/build.gradle"
g = open(F, encoding="utf-8").read()
if "signingConfigs" not in g:
    def q(v):
        return "'" + v.replace("\\", "\\\\").replace("'", "\\'") + "'"
    bloc = ("    signingConfigs {\n        release {\n"
            "            storeFile file('sabi-release.keystore')\n"
            "            storePassword " + q(mdp) + "\n"
            "            keyAlias " + q(alias) + "\n"
            "            keyPassword " + q(mdp_cle) + "\n"
            "        }\n    }\n")
    g = g.replace("    buildTypes {", bloc + "    buildTypes {", 1)
    g = re.sub(r"(buildTypes\s*\{\s*release\s*\{)", r"\1\n            signingConfig signingConfigs.release", g, count=1)
    open(F, "w", encoding="utf-8").write(g)
print("Signature de publication configuree (alias :", alias + ").")
