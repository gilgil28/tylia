// Optional enhancement: put the visitor's OS first in the download list and point the hero
// button at its main package. Runs only in the browser; sends nothing anywhere. The page
// works fully without it.
/* global window, document */
(function () {
  var nav = window.navigator;
  var hints = nav.userAgentData;
  if (hints && hints.mobile) return;
  var platform = (hints && hints.platform) || nav.platform || "";
  var ua = nav.userAgent || "";
  if (/Android|iPhone|iPad|iPod/i.test(ua) || (/Mac/i.test(platform) && nav.maxTouchPoints > 1)) {
    return;
  }

  var os = null;
  if (/Win/i.test(platform) || /Windows/i.test(ua)) os = "windows";
  else if (/Mac/i.test(platform) || /Macintosh/i.test(ua)) os = "macos";
  else if (/Linux|X11/i.test(platform) || /Linux|X11/i.test(ua)) os = "linux";
  if (!os) return;

  function apply() {
    var card = document.querySelector('.platform[data-os="' + os + '"]');
    if (!card) return;
    card.classList.add("is-detected");
    var badge = card.querySelector(".badge");
    if (badge) badge.hidden = false;
    card.parentNode.insertBefore(card, card.parentNode.firstElementChild);

    var primary = card.querySelector("a[data-primary]");
    var hero = document.getElementById("hero-download");
    if (primary && hero) {
      hero.href = primary.href;
      var label = hero.querySelector("span");
      if (label) label.textContent = card.getAttribute("data-label");
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", apply);
  else apply();
})();
