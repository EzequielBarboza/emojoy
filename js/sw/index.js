self.addEventListener('fetch', event => {
  event.respondWith(
    fetch(event.request).then(response => {
      if (response.status === 404) {
        return fetch('/static/imgs/404.svg');
      }

      return response;
    })
  );
});