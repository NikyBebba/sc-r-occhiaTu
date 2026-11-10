// Public TMDb fields checked read-only; overviews below are short synthetic paraphrases.
// No account, taste, private catalogue, credential or full response is retained.
const overview='Una restauratrice torna nella città natale e scopre un segreto custodito dalla sua famiglia.';
const phantom={id:76115,title:'The Phantom of the Opera at the Royal Albert Hall',release_date:'2011-09-27',genre_ids:[10402,18,10749],vote_average:8.353,vote_count:204,runtime:160,popularity:10,poster_path:'/fixture.jpg',overview:'A lavish performance of the musical celebrating its twenty-fifth anniversary.',keywords:{keywords:['musical','based on play or musical','ballet performance','filmed play','live theatre','filmed theater'].map(name=>({name}))},credits:{crew:[{job:'Director',name:'Laurence Connor'},{job:'Director',name:'Nick Morris'}],cast:[]}};
const stop={id:292073,title:'Stop-and-Cop Interactive',release_date:'2009-12-31',genre_ids:[28],vote_average:8.5,vote_count:28,runtime:13,popularity:1,poster_path:'/fixture.jpg',overview,keywords:{keywords:[{name:'short film'}]},credits:{crew:[{job:'Director',name:'J.K. Arsyn'}],cast:[]}};
const discover=r=>{const {runtime,keywords,credits,...row}=r;return row;};
module.exports={phantom,stop,discover,overview};
