#!/usr/bin/env node
// Run the unchanged v62 smoke suite with synthetic metadata and NO network.
// Its five normally-live API assertions exercise fixtures, not external availability.
const assert = require('node:assert/strict');
const reply = data => ({ ok:true, status:200, json:async()=>data });
global.fetch = async input => {
  const u = new URL(String(input));
  if (u.hostname==='api.themoviedb.org') {
    if (u.pathname==='/3/search/movie') {
      const title=u.searchParams.get('query') || '';
      if (title==='The Dark Knight') return reply({results:[{id:155,title:'The Dark Knight',release_date:'2008-07-16'}]});
      if (title==='Interstellar') return reply({results:[{id:157336,title:'Interstellar',release_date:'2014-11-05'}]});
      if (title.includes('ZZZQuestoTitoloNonEsiste')) return reply({results:[]});
    }
    if (u.pathname==='/3/movie/155') return reply({id:155,title:'The Dark Knight',runtime:152,
      belongs_to_collection:{id:263,name:'Batman Collection'},genres:[],credits:{crew:[],cast:[]}});
    if (u.pathname==='/3/collection/263') return reply({id:263,name:'Batman Collection',parts:[
      {id:272,title:'Batman Begins',release_date:'2005-06-10'},
      {id:155,title:'The Dark Knight',release_date:'2008-07-16'},
      {id:49026,title:'The Dark Knight Rises',release_date:'2012-07-16'}]});
  }
  if (['www.omdbapi.com','omdbapi.com'].includes(u.hostname)) return reply({Response:'False'});
  // Never delegate to native fetch or print credential-bearing query strings.
  assert.fail('Unexpected network request blocked by local smoke fixture');
};
console.log('LOCAL SYNTHETIC SMOKE: no Supabase/TMDb/OMDb requests; API availability is not tested.');
require('./smoke.js');
