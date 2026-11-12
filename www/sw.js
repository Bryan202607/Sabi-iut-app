// Service worker minimal pour Sabi.
// Objectif unique : mettre en cache la coquille de l'app (HTML, manifest, icônes,
// logos) pour qu'elle s'ouvre même hors-ligne ou en réseau instable, et rester
// "installable" au sens PWA. Tout le reste (Firebase, polices, CDN React/Tailwind,
// EmailJS) passe directement au réseau, sans interception — on ne veut surtout pas
// mettre en cache des données qui changent (notes, cartes, messages, etc.) ni casser
// la connexion temps réel de Firebase.

// ========== Notifications push (Firebase Cloud Messaging) ==========
// Chargé dans ce même service worker (plutôt qu'un fichier firebase-messaging-sw.js séparé)
// pour n'avoir qu'un seul SW à enregistrer/mettre à jour. Sert uniquement à afficher les pushs
// reçus quand l'app est en arrière-plan ou fermée ; le cas "onglet ouvert" est géré côté
// index.html (messaging.onMessage), qui réutilise le système de bulle existant.
try {
  importScripts("https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js");
  importScripts("https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js");
  firebase.initializeApp({
    apiKey: "AIzaSyBCgSKNEcsCNTpzK2Qi11Q9n9xpePJztVc",
    authDomain: "sabi-41823.firebaseapp.com",
    projectId: "sabi-41823",
    storageBucket: "sabi-41823.firebasestorage.app",
    messagingSenderId: "489522682522",
    appId: "1:489522682522:web:7fa9b5749b1be714e05d23",
  });
  const messaging = firebase.messaging();
  messaging.onBackgroundMessage((payload) => {
    const titre = (payload.notification && payload.notification.title) || "Sabi";
    const corps = (payload.notification && payload.notification.body) || "";
    self.registration.showNotification(titre, {
      body: corps,
      icon: "./icons/icon-192.png",
      badge: "./icons/icon-192.png",
      data: payload.data || {},
    });
  });
} catch (err) {
  // Navigateur sans support Push, ou script Firebase inaccessible (hors-ligne à l'installation
  // du SW) : le reste du service worker (cache de la coquille) doit continuer à fonctionner.
}

// Ouvre (ou ramène au premier plan) l'onglet Sabi quand on tape sur une notification push.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clientsArr) => {
      for (const client of clientsArr) {
        if (client.url.includes(self.location.origin) && "focus" in client) return client.focus();
      }
      return self.clients.openWindow("./index.html");
    })
  );
});

// ========== Background Sync ==========
// À prendre avec une réserve : Sabi écrit dans Firebase Realtime Database via le SDK, pas via
// fetch(), et ce SDK a déjà son propre mécanisme de file d'attente hors-ligne intégré (il
// rejoue automatiquement les écritures dès que le réseau revient, même sans cette API). Ce
// gestionnaire ne duplique donc pas une vraie logique de rejeu réseau ; il se contente de
// prévenir les onglets ouverts qu'une connexion vient de revenir, utile si on ajoute plus tard
// un vrai formulaire à remplir hors-ligne (ex. brouillon d'actu écrit sans réseau).
self.addEventListener("sync", (event) => {
  if (event.tag !== "sabi-sync") return;
  event.waitUntil(
    self.clients.matchAll().then((clientsArr) => {
      clientsArr.forEach((client) => client.postMessage({ type: "sabi-sync-reconnexion" }));
    })
  );
});

// ========== Periodic Background Sync ==========
// Même réserve, en plus marquée : cette API n'est déclenchée par Chrome que sur les PWA
// installées avec un score d'engagement élevé, à un intervalle qu'on ne contrôle pas — elle ne
// doit jamais être le SEUL mécanisme de rappel d'épreuve. C'est le rôle du Cron Cloudflare +
// push FCM qu'on prévoit de construire ensuite, fiable même app fermée depuis des semaines.
// Ce gestionnaire reste donc un complément best-effort, pas une dépendance.
self.addEventListener("periodicsync", (event) => {
  if (event.tag !== "sabi-rappels-epreuves") return;
  event.waitUntil(
    self.registration.showNotification("Sabi", {
      body: "Nouveautés possibles — ouvre l'app pour vérifier tes épreuves et actus.",
      icon: "./icons/icon-192.png",
      badge: "./icons/icon-192.png",
    }).catch(() => {})
  );
});

const CACHE_NAME = "sabi-shell-v1";
// Cache séparé (jamais nettoyé par le "activate" ci-dessous, qui ne vise que CACHE_NAME) :
// sert uniquement de boîte aux lettres temporaire entre l'interception du partage (POST)
// et sa lecture par index.html juste après la redirection.
const SHARE_CACHE = "sabi-share-target";
const SHARE_KEY = "/partage-image-en-attente";
const SHELL_FILES = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
  "./logo-icon.png",
  "./logo-wordmark.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME && k !== SHARE_CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Reçoit le POST multipart envoyé par l'OS quand quelqu'un partage "vers" Sabi (texte, lien,
// ou image — voir share_target dans manifest.json). Une page statique (Netlify) ne peut pas
// répondre elle-même à un POST, d'où l'interception ici : on lit le contenu, on range
// l'éventuelle image dans un cache temporaire (impossible de faire transiter un fichier
// binaire par une redirection HTTP classique), puis on redirige vers le formulaire de
// publication d'actualité, qui ira relire cette image au chargement.
async function gererPartageEntrant(event) {
  try {
    const formData = await event.request.formData();
    const titre = formData.get("titre_partage");
    const texte = formData.get("texte_partage");
    const lien = formData.get("lien_partage");
    const fichier = formData.get("fichiers_partages"); // 1er fichier partagé, s'il y en a un

    const params = new URLSearchParams({ tab: "contribuer" });
    if (titre) params.set("titre_partage", titre);
    if (texte) params.set("texte_partage", texte);
    if (lien) params.set("lien_partage", lien);

    if (fichier && typeof fichier === "object" && fichier.size > 0) {
      const cache = await caches.open(SHARE_CACHE);
      await cache.put(SHARE_KEY, new Response(fichier, { headers: { "Content-Type": fichier.type || "image/jpeg" } }));
      params.set("partage_image", "1");
    }

    return Response.redirect("./index.html?" + params.toString(), 303);
  } catch (err) {
    // Partage illisible/vide : on ramène quand même l'utilisateur sur le formulaire plutôt
    // que de le laisser sur une erreur réseau.
    return Response.redirect("./index.html?tab=contribuer", 303);
  }
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (event.request.method === "POST" && url.origin === self.location.origin && url.pathname.endsWith("/index.html")) {
    event.respondWith(gererPartageEntrant(event));
    return;
  }

  // On ne touche qu'aux fichiers de la coquille, servis depuis notre propre origine.
  // Tout le reste (autres domaines, appels Firebase, requêtes non-GET) : réseau direct.
  const isShellFile = url.origin === self.location.origin && event.request.method === "GET";
  if (!isShellFile) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);
      // Sert le cache immédiatement si présent (rapide + fonctionne hors-ligne),
      // tout en rafraîchissant le cache en arrière-plan pour la prochaine visite.
      return cached || network;
    })
  );
});
