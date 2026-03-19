// ==UserScript==
// @name         Streamix AutoPlay
// @namespace    https://streamix-indol.vercel.app
// @version      1.0
// @description  Auto-clique sur "Reprendre l'épisode" et passe en plein écran dès que la page Prime Video ou Crunchyroll se charge.
// @author       Streamix
// @match        https://www.primevideo.com/*
// @match        https://www.amazon.fr/gp/video/*
// @match        https://www.amazon.com/gp/video/*
// @match        https://www.crunchyroll.com/*
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  // ─── SÉLECTEURS ─────────────────────────────────────────────────────────────

  const PRIME_PLAY_SELECTORS = [
    "[data-testid='resume-button']",
    "[data-ref='resume_button']",
    "button[class*='ResumeButton']",
    "button[class*='resumeButton']",
    "[data-testid='play-button']",
    "a[class*='ResumeButton']",
    ".atvwebplayersdk-playpause-button",
    "[data-automation-id='play-button']",
  ];

  const CRUNCHY_PLAY_SELECTORS = [
    "[data-testid='vilos-play-button']",
    "button[class*='playBtn']",
    "button[class*='play-btn']",
    ".play-button",
    "[aria-label='Play']",
    "[aria-label='Lecture']",
    "button[aria-label*='lay']",
  ];

  // ─── LOGIQUE ─────────────────────────────────────────────────────────────────

  function tryClick(selectors) {
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el) {
          el.click();
          return true;
        }
      } catch (_) {}
    }
    return false;
  }

  function tryFullscreen() {
    const video = document.querySelector("video");
    if (video && document.fullscreenElement !== video) {
      video.requestFullscreen && video.requestFullscreen();
    }
  }

  function autoPlay(selectors, label) {
    let attempts = 0;
    const max = 20; // jusqu'à 10 secondes

    const iv = setInterval(() => {
      attempts++;
      const clicked = tryClick(selectors);

      if (clicked) {
        console.log(`[Streamix AutoPlay] ${label}: bouton cliqué ✓`);
        clearInterval(iv);
        // Plein écran 2s après le clic pour laisser le lecteur démarrer
        setTimeout(tryFullscreen, 2000);
        return;
      }

      if (attempts >= max) {
        console.warn(`[Streamix AutoPlay] ${label}: bouton introuvable après ${max} tentatives.`);
        clearInterval(iv);
      }
    }, 500);
  }

  // ─── DÉTECTION PLATEFORME ────────────────────────────────────────────────────

  const host = location.hostname;

  if (host.includes("primevideo.com") || host.includes("amazon.")) {
    autoPlay(PRIME_PLAY_SELECTORS, "Prime Video");
  } else if (host.includes("crunchyroll.com")) {
    autoPlay(CRUNCHY_PLAY_SELECTORS, "Crunchyroll");
  }
})();
