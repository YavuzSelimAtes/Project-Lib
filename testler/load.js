// Yuk testi: 500 kitap kaydi + ~5000 log; feed/liderlik/stats suresi. Kullanim: node testler/load.js
const {Client,daysAgo}=require('./lib/client');
(async()=>{
const a=new Client();await a.login('admin','test-admin-123');
const u=new Client();await u.login('dede','Deneme123!');
let t=Date.now();const ids=[];
for(let i=0;i<500;i++){const c=await a.post('/api/admin/catalog',{type:'book',title:'Yuk '+i+' '+Math.random(),pages:300});ids.push(c.json.item.id);}
console.log('katalog 500:',Date.now()-t,'ms');t=Date.now();
let logs=0;
for(const id of ids){const e=(await u.post('/api/entries',{catalog_id:id,start_date:daysAgo(60),total_pages:300})).json.entry;
 for(let d=0;d<10;d++){await u.post(`/api/entries/${e.id}/progress`,{current_page:(d+1)*25,date:daysAgo(60-d*5)});logs++;}}
console.log('500 kayit +',logs,'log:',Date.now()-t,'ms');
const time=async(p)=>{const s=Date.now();const r=await u.get(p);console.log(p.padEnd(40),r.status,Date.now()-s,'ms',(r.text.length/1024|0)+'KB');};
for(const p of ['/api/feed','/api/leaderboards/record','/api/leaderboards/average','/api/leaderboards/finished','/api/users/'+(await u.get('/api/auth/me')).json.user.id+'/stats','/api/entries?limit=100','/api/entries?limit=500','/api/entries'])await time(p);
})()
