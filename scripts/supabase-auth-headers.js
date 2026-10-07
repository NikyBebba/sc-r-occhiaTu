// CLI di manutenzione: JWT temporaneo di un membro, mai service-role o publishable come Bearer.
function supabaseAuthHeaders(publishableKey) {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) throw new Error('Serve SUPABASE_ACCESS_TOKEN: JWT temporaneo di un membro N/V autenticato. Nessun fallback anonimo.');
  try {
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    if (claims.role !== 'authenticated' || !claims.sub || claims.exp * 1000 <= Date.now()) throw new Error();
  } catch (_) { throw new Error('SUPABASE_ACCESS_TOKEN deve essere un JWT authenticated non scaduto; la membership è verificata dalla RLS.'); }
  return { apikey: publishableKey, Authorization: 'Bearer ' + token };
}
module.exports = { supabaseAuthHeaders };
