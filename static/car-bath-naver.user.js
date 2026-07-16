// ==UserScript==
// @name         카바스 예약 자동 다음
// @namespace    https://car-bath.pages.dev
// @version      1.0.0
// @description  카바스 예약 앱에서 네이버 예약 '다음' 버튼을 자동으로 눌러줍니다.
// @match        https://car-bath.pages.dev/*
// @match        https://*.car-bath.pages.dev/*
// @match        https://m.booking.naver.com/booking/10/bizes/193155/items/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  if (location.hostname.includes("car-bath.pages.dev")) {
    try {
      localStorage.setItem("carbath-autoclick", "1");
    } catch {
      // ignore
    }
    return;
  }

  if (!/[?&]carbathAuto=1(?:&|$)/.test(location.search)) {
    return;
  }

  if (location.pathname.includes("/request")) {
    return;
  }

  var attempts = 0;

  function clickNext() {
    if (attempts++ > 80) {
      return;
    }

    var button = document.querySelector(
      'button.btn_next[data-click-code="nextbuttonview.request"]',
    );

    if (button && !button.disabled) {
      button.click();
      return;
    }

    setTimeout(clickNext, 250);
  }

  setTimeout(clickNext, 900);
})();
