self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  if (event.request.url.includes('gravatar')) {
    event.respondWith(
      fetch('/static/imgs/cat.jpg')
    );
  }
});