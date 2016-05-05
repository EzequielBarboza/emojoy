import "regenerator/runtime";
import "serviceworker-cache-polyfill";
import "../arrayFind";
import * as chatStore from "../chatStore";
import toMessageObj from "../toMessageObj";

const staticVersion = '30';
const cachesToKeep = ['chat-static-v' + staticVersion, 'chat-avatars'];

self.addEventListener("install", event => {
  self.skipWaiting();

  event.waitUntil(
    fetch('/messages.json', {credentials: 'include'}).then(r => r.json()).then(data => {
      if (data.loginUrl) {
        // needs login
        registration.unregister();
        throw Error("Needs login");
      }
      return caches.open('chat-static-v' + staticVersion);
    }).then(cache => {
      return Promise.all([
        '/',
        '/static/css/app.css',
        '/static/fonts/roboto.woff',
        '/static/js/page.js',
        '/static/imgs/hangouts.png'
      ].map(url => {
        let request = new Request(url, {credentials: 'include'});
        return fetch(request).then(response => {
          if (!response.ok) throw Error("NOT OK");
          return cache.put(request, response);
        });
      }));
    })
  );
});


self.addEventListener('activate', event => {
  clients.claim();
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(n => cachesToKeep.indexOf(n) === -1)
          .map(name => caches.delete(name))
      );
    })
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(response => {
      if (response) return response;
      
      if (event.request.url.includes('gravatar')) {
        return new Promise(r => setTimeout(r, 1000)).then(() => fetch(event.request));
      }
      return new Promise(r => setTimeout(r, 500)).then(() => fetch(event.request));
    })
  );
});

self.addEventListener('push', event => {
  event.waitUntil(
    fetch("/messages.json", {
      credentials: "include"
    }).then(async response => {
      if (response.loginUrl) {
        return self.registration.showNotification("New Chat!", {
          body: 'Requires login to view…',
          tag: 'chat',
          icon: `/static/imgs/hangouts.png`
        });
        return;
      }

      const messages = (await response.json()).messages.map(m => toMessageObj(m));
      await chatStore.setChatMessages(messages);
      broadcast('updateMessages');

      for (var client of (await clients.matchAll())) {
        if (client.visibilityState == 'visible' && new URL(client.url).pathname == '/') {
          return;
        }
      }

      const notificationMessage = messages[messages.length - 1];

      return self.registration.showNotification("New Chat!", {
        body: notificationMessage.text,
        tag: 'chat',
        icon: `https://www.gravatar.com/avatar/${notificationMessage.userId}?d=retro&s=192`
      });
    })
  );
});

function broadcast(message) {
  return clients.matchAll().then(function(clients) {
    for (var client of clients) {
      client.postMessage(message);
    }
  });
}

self.addEventListener('notificationclick', event => {
    const rootUrl = new URL('/', location).href;
    event.notification.close();
    // Enumerate windows, and call window.focus(), or open a new one.
    event.waitUntil(
      clients.matchAll().then(matchedClients => {
        for (let client of matchedClients) {
          if (client.url === rootUrl) {
            return client.focus();
          }
        }
        return clients.openWindow("/");
      })
    );
});

async function postOutbox() {
  let message;
  while (message = await chatStore.getFirstOutboxItem()) {
    let data = new FormData();
    data.append('message', message.text);
    const pushSub = await self.registration.pushManager.getSubscription();

    if (pushSub) {
      let endpoint = pushSub.endpoint;
      if ('subscriptionId' in pushSub && !endpoint.includes(pushSub.subscriptionId)) {
        endpoint += "/" + pushSub.subscriptionId;
      }
      data.append('push_endpoint', endpoint);
    }

    let response = await fetch('/send', {
      method: 'POST',
      body: data,
      credentials: 'include'
    });

    if (!response.ok) {
      // remove the bad message
      // (assuming the message is bad isn't a great assumption)
      chatStore.removeFromOutbox(message.id);
      let errReason = "Unknown error";

      try {
        errReason = (await response.json()).err;
      } catch(e) {}

      broadcast({
        sendFailed: {
          id: message.id,
          reason: errReason
        }
      });
      continue;
    }

    let responseJson = await response.json();

    if (responseJson.loginUrl) {
      broadcast(responseJson);
      return;
    }

    await chatStore.removeFromOutbox(message.id);
    let sentMessage = toMessageObj(responseJson);
    chatStore.addChatMessage(sentMessage);

    broadcast({
      messageSent: message.id,
      message: sentMessage
    });
  }
}

self.addEventListener('message', event => {
  if (event.data == 'postOutbox') {
    postOutbox();
  }
});

self.addEventListener('sync', event => {
  if (event.tag == 'postOutbox') {
    event.waitUntil(postOutbox());
  }
});
