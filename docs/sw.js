self.addEventListener('push', function(event) {
  if (event.data) {
    try {
      const data = event.data.json();
      const title = data.title || 'New Message';
      const options = {
        body: data.body || 'You have received a new message.',
        icon: data.icon || '/favicon.ico',
        badge: '/favicon.ico'
      };

      event.waitUntil(self.registration.showNotification(title, options));
    } catch (e) {
      console.error('Push event data parsing failed', e);
      event.waitUntil(
        self.registration.showNotification('New Message', {
          body: event.data.text()
        })
      );
    }
  }
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  // Focus the window if it's already open, or open a new one
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(function(clientList) {
      for (var i = 0; i < clientList.length; i++) {
        var client = clientList[i];
        if (client.url === '/' && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow('/');
      }
    })
  );
});
