// background.js — service worker for extension lifecycle events
self.addEventListener('install', (e) => { console.log('CleanMute: background installed'); });
self.addEventListener('activate', (e) => { console.log('CleanMute: background activated'); });

// simple message handler for debugging
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  console.log('CleanMute background received message', msg, sender);
  sendResponse({ok:true});
});
