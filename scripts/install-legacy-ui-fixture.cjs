'use strict';
// Historical component tests only. Explicit injected LEGACY coordinator, never
// included in index.html and never an authority override in the application.
module.exports = async function installLegacyUIFixture(page) {
  await page.evaluate(() => {
    ProductionSession = ProductionSession.createCoordinator({ mode: 'LEGACY', legacy: {
      start() { requireAppIdentity(); subscribeRealtime(); loadMovies().catch(() => {}); },
      stop() { unsubscribeRealtime(); leaveMatch(true); },
      async refresh() { subscribeRealtime(); await resyncQuiet(); }
    }});
  });
};
