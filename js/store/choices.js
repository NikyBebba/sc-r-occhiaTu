// Veto settimanali: dominio attivo, distinto dal vecchio sistema votes.

// ---- Veto settimanale (1 a testa per settimana) ----
function currentWeekKey(d = new Date()) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function vetoUsedThisWeek(person) {
  const wk = currentWeekKey();
  return vetoes.some(v => v.person === person && v.week_key === wk);
}

function vetoedMovieIdsThisWeek() {
  const wk = currentWeekKey();
  return vetoes.filter(v => v.week_key === wk).map(v => v.movie_id);
}

async function addVeto(person, movieId) {
  const wk = currentWeekKey();
  if (vetoUsedThisWeek(person)) return false;
  if (sb) {
    const { error } = await sb.from('vetoes').insert([{ person, movie_id: movieId, week_key: wk }]);
    if (error) {
      console.error('[sc(r)occhiaTu] addVeto fallito su Supabase:', error.message);
      dbMode = 'local';
      lastSupabaseFailAt = Date.now();
    }
    const { data } = await sb.from('vetoes').select('*');
    if (data) { vetoes = data; saveLocal(); }
  } else {
    vetoes.push({ id: Date.now().toString() + Math.random(), person, movie_id: movieId, week_key: wk });
    saveLocal();
  }
  return true;
}

// Riga veto corrente (settimana in corso) per un film, se c'è: serve a capire
// chi ha messo il veto e a rimuoverlo; un veto di altra settimana non esiste.
function vetoForMovieThisWeek(movieId) {
  const wk = currentWeekKey();
  return vetoes.find(v => v.movie_id === movieId && v.week_key === wk) || null;
}

// Toglie il veto posto da `person` sul film `movieId` (settimana corrente).
// Solo chi ha messo il veto può toglierlo (guardia anche qui, oltre alla UI).
async function removeVeto(person, movieId) {
  const v = vetoForMovieThisWeek(movieId);
  if (!v || v.person !== person) return false;
  if (sb) {
    const { data: deleted, error } = await sb.from('vetoes').delete().eq('id', v.id).select();
    if (error) {
      console.error('[sc(r)occhiaTu] removeVeto fallito su Supabase:', error.message);
      return false;
    }
    // Delete che non ha colpito nessuna riga (es. già rimosso altrove):
    // no-op senza errori né modifiche allo stato locale.
    if (!deleted || deleted.length === 0) return true;
    const { data } = await sb.from('vetoes').select('*');
    if (data) { vetoes = data; saveLocal(); }
  } else {
    vetoes = vetoes.filter(x => x.id !== v.id);
    saveLocal();
  }
  return true;
}
