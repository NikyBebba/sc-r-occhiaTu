// ============================================
// CONFIGURAZIONE — incolla qui le tue chiavi
// ============================================
const CONFIG = {
  // TheMovieDB (obbligatoria: poster, durata, streaming, trailer)
  TMDB_API_KEY: '5816fb4140059f8f0b865437fec27578',

  // OMDb (opzionale, gratuita su omdbapi.com/apikey.aspx — 1000 richieste/giorno).
  // Usata SOLO come fallback quando TMDb non trova un titolo.
  // Se la lasci così com'è, l'app funziona lo stesso, semplicemente
  // salta il fallback e segna il film come "da verificare".
  OMDB_API_KEY: '93d32670',

  // Supabase (obbligatoria per la sync realtime tra i due telefoni)
  SUPABASE_URL: 'https://teslxpcgrrmqysfkdewe.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_QdAopdSK5kp_OlnDAeb1Jg_4f58DEDx',

  // Account Auth preconfigurati per N/V e relative etichette.
  // L’identità viene verificata online tramite Supabase Auth e app_members.
  AUTH_EMAILS: { N: 'nikybebba@gmail.com', V: 'vale.migliaccio1@gmail.com' }, // Identificativi pubblici degli account Auth precreati; nessuna password.
  PEOPLE: {
    N: { label: 'N', badgeClass: 'badge-n', },
    V: { label: 'V', badgeClass: 'badge-v', }
  }
};
