// ==UserScript==
// @name         Streamix AutoPlay
// @namespace    https://streamix-indol.vercel.app
// @version      2.0
// @description  Auto-clique sur Play/Reprendre et passe en plein écran sur Prime Video et Crunchyroll.
// @author       Streamix
// @match        https://www.primevideo.com/*
// @match        https://www.amazon.fr/gp/video/*
// @match        https://www.amazon.com/gp/video/*
// @match        https://www.crunchyroll.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  // ─── SÉLECTEURS PAR PRIORITÉ ─────────────────────────────────────────────────

  const PRIME_SELECTORS = [
    // Lecteur vidéo — bouton pause/play dans le player
    ".atvwebplayersdk-playpause-button",
    "[class*='playpause']",
    "[class*='PlayPause']",
    // Bouton "Reprendre" sur la fiche
    "[data-testid='resume-button']",
    "[data-ref='resume_button']",
    // Bouton play générique
    "[data-testid='play-button']",
    "button[aria-label*='Play']",
    "button[aria-label*='play']",
    "button[aria-label*='Lecture']",
    "button[aria-label*='Reprendre']",
    "button[aria-label*='Resume']",
    "[class*='ResumeButton']",
    "[class*='resumeButton']",
    "[class*='PlayButton']",
  ];

  const CRUNCHY_SELECTORS = [
    // Lecteur Vilos
    ".vjs-play-control",
    ".vjs-big-play-button",
    "[class*='playButton']",
    "[class*='play-button']",
    "[data-testid='vilos-play-button']",
    "button[aria-label='Play']",
    "button[aria-label='Lecture']",
    "button[aria-label*='lay']",
    // Fiche épisode
    "a[href*='/watch/'] button",
    "[class*='EpisodeCard'] button",
    "[class*='WatchButton']",
  ];

  // ─── UTILITAIRES ──────────────────────────────────────────────────────────────

  let done = false;

  function shouldForceStartAtZero() {
    const params = new URLSearchParams(window.location.search);
    return params.get("plugd_start") === "0";
  }

  function forceStartAtZero() {
    if (!shouldForceStartAtZero()) return;

    const start = Date.now();
    const maxDurationMs = 15000;

    const tryReset = () => {
      const video = document.querySelector("video");
      if (!video) return false;

      // Re-apply while the platform restores its own resume point.
      if (video.currentTime > 0.2) {
        video.currentTime = 0;
      }
      return true;
    };

    tryReset();

    const interval = setInterval(() => {
      tryReset();
      if (Date.now() - start >= maxDurationMs) {
        clearInterval(interval);
      }
    }, 300);

    const observer = new MutationObserver(() => {
      tryReset();
      if (Date.now() - start >= maxDurationMs) {
        observer.disconnect();
      }
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });

    setTimeout(() => {
      clearInterval(interval);
      observer.disconnect();
    }, maxDurationMs + 500);
  }

  function tryClick(selectors) {
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el && el.offsetParent !== null) {
          // Simuler un vrai clic utilisateur
          el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
          el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
          el.click();
          console.log("[Streamix AutoPlay] Cliqué :", sel);
          return true;
        }
      } catch (_) {}
    }
    return false;
  }

  function tryForcedVideoPlay() {
    const video = document.querySelector("video");
    if (video && video.paused) {
      video.play().then(() => {
        console.log("[Streamix AutoPlay] video.play() forcé ✓");
      }).catch(() => {});
      return true;
    }
    return false;
  }

  function tryFullscreen() {
    const video = document.querySelector("video");
    if (video && !document.fullscreenElement) {
      video.requestFullscreen && video.requestFullscreen();
    }
  }

  function attempt(selectors, label) {
    if (done) return;

    // 1. Essai boutons UI
    if (tryClick(selectors)) {
      done = true;
      setTimeout(tryFullscreen, 2500);
      return;
    }

    // 2. Forçage direct sur l'élément <video>
    if (tryForcedVideoPlay()) {
      done = true;
      setTimeout(tryFullscreen, 2500);
    }
  }

  // ─── OBSERVATEUR — ATTEND LES ÉLÉMENTS CHARGÉS EN SPA ────────────────────────

  function startObserver(selectors, label) {
    let ticks = 0;
    const maxTicks = 40; // 20 secondes max

    // Essai immédiat
    attempt(selectors, label);
    if (done) return;

    const observer = new MutationObserver(() => {
      if (done) { observer.disconnect(); return; }
      attempt(selectors, label);
      if (done) observer.disconnect();
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Garde-fou: arrêt après 20s même si pas trouvé
    const watchdog = setInterval(() => {
      ticks++;
      attempt(selectors, label); // tentative toutes les 500ms aussi
      if (done || ticks >= maxTicks) {
        clearInterval(watchdog);
        observer.disconnect();
        if (!done) console.warn("[Streamix AutoPlay] Bouton introuvable après 20s.");
      }
    }, 500);
  }

  // ─── DÉTECTION PLATEFORME ────────────────────────────────────────────────────

  const host = location.hostname;

  if (host.includes("primevideo.com") || (host.includes("amazon.") && location.pathname.includes("video"))) {
    console.log("[Streamix AutoPlay] Prime Video détecté");
    forceStartAtZero();
    startObserver(PRIME_SELECTORS, "Prime Video");
  } else if (host.includes("crunchyroll.com")) {
    console.log("[Streamix AutoPlay] Crunchyroll détecté");
    forceStartAtZero();
    startObserver(CRUNCHY_SELECTORS, "Crunchyroll");
  }
})();
