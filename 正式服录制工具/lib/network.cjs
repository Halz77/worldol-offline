const DNS_SERVERS = ['https://dns.alidns.com/dns-query'];

async function configureGameNetwork(app, gameSession) {
  // Scope is this standalone recorder process/session. Windows and other browsers are unchanged.
  app.configureHostResolver({ enableBuiltInResolver: true, secureDnsMode: 'secure', secureDnsServers: DNS_SERVERS });
  await gameSession.setProxy({ mode: 'direct' });
  await gameSession.clearHostResolverCache();
  return { mode: 'direct', secureDnsMode: 'secure', secureDnsServers: DNS_SERVERS };
}
module.exports = { configureGameNetwork };
