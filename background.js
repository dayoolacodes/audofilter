// background.js — service worker for extension lifecycle events
self.addEventListener('install', () => {});
self.addEventListener('activate', () => {});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  sendResponse({ok:true});
});
