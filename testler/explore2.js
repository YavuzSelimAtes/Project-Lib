const {Client,daysAgo}=require('./lib/client');
const {DatabaseSync}=require('node:sqlite');
(async()=>{
const a=new Client();await a.login('admin','test-admin-123');
const m=new Client();await m.login('mehmet','Deneme123!');
const show=(n,r)=>console.log(n.padEnd(44),r.status,(r.text||'').slice(0,150));
const cat=async(t='book',p=100)=>(await a.post('/api/admin/catalog',{type:t,title:'F'+Math.random(),pages:p})).json.item.id;
// bitti with end<start
show('bitti end<start',await m.post('/api/entries',{catalog_id:await cat(),status:'bitti',start_date:daysAgo(1),end_date:daysAgo(9),total_pages:100}));
const e=(await m.post('/api/entries',{catalog_id:await cat(),start_date:daysAgo(3),total_pages:100})).json.entry;
show('PATCH end<start',await m.patch('/api/entries/'+e.id,{end_date:daysAgo(10),status:'bitti'}));
show('PATCH start>end',await m.patch('/api/entries/'+e.id,{start_date:daysAgo(0)}));
show('PATCH current_page 500',await m.patch('/api/entries/'+e.id,{current_page:500}));
show('PATCH current_page -3',await m.patch('/api/entries/'+e.id,{current_page:-3}));
show('PATCH total_pages 0',await m.patch('/api/entries/'+e.id,{total_pages:0}));
show('PATCH total_pages 1e12',await m.patch('/api/entries/'+e.id,{total_pages:1e12}));
show('PATCH planlandi w/ progress',await m.patch('/api/entries/'+e.id,{status:'planlandi'}));
// film
const mv=(await m.post('/api/entries',{catalog_id:await cat('movie',null),start_date:daysAgo(0)})).json;
show('movie create',{status:201,text:JSON.stringify(mv.entry||mv)});
show('movie progress',await m.post(`/api/entries/${mv.entry?.id}/progress`,{current_page:5}));
show('movie rating',await m.patch(`/api/entries/${mv.entry?.id}`,{rating:5}));
// dizi
const se=(await m.post('/api/entries',{catalog_id:await cat('series',null)})).json.entry;
show('series progress',await m.post(`/api/entries/${se.id}/series-progress`,{season:2,episode:5}));
show('series progress neg',await m.post(`/api/entries/${se.id}/series-progress`,{season:-1,episode:0}));
show('series progress str',await m.post(`/api/entries/${se.id}/series-progress`,{season:'a',episode:1.5}));
show('series-progress on book',await m.post(`/api/entries/${e.id}/series-progress`,{season:1,episode:1}));
// body limits
show('1MB body comment',await m.post(`/api/entries/${e.id}/comments`,{body:'x'.repeat(1.5e6)}));
show('20MB body',await m.raw('POST','/api/auth/login',{rawBody:'{"username":"'+'a'.repeat(2e7)+'"}',headers:{'content-type':'application/json'}}));
show('login username array',await new Client().post('/api/auth/login',{username:['a'],password:{}}));
show('login no body',await new Client().raw('POST','/api/auth/login',{}));
show('prototype pollution',await a.raw('POST','/api/admin/users',{rawBody:'{"__proto__":{"role":"admin"},"username":"pp1","display_name":"p","password":"abcdef"}',headers:{'content-type':'application/json'}}));
show('display_name 5000',await a.post('/api/admin/users',{username:'dn1',display_name:'ş'.repeat(5000),password:'abcdef'}));
show('display_name html',await a.post('/api/admin/users',{username:'dn2',display_name:'<img src=x onerror=alert(1)>',password:'abcdef'}));
show('avatar long',await a.post('/api/admin/users',{username:'dn3',display_name:'x',password:'abcdef',avatar:'x'.repeat(500)}));
show('color invalid',await a.post('/api/admin/users',{username:'dn4',display_name:'x',password:'abcdef',color:'red;}</style><script>'}));
show('catalog title 100k',await a.post('/api/admin/catalog',{type:'book',title:'T'.repeat(100000)}));
show('catalog cover_url file://',await a.post('/api/admin/catalog',{type:'book',title:'ssrf1',cover_url:'file:///c:/windows/win.ini'}));
show('catalog cover_url localhost',await a.post('/api/admin/catalog',{type:'book',title:'ssrf2',cover_url:'http://127.0.0.1:4100/api/health'}));
show('catalog bad cover',await a.post('/api/admin/catalog',{type:'book',title:'badcover',cover_url:'http://nonexistent.invalid/x.jpg'}));
show('catalog pages -5',await a.post('/api/admin/catalog',{type:'book',title:'neg',pages:-5}));
show('catalog year abc',await a.post('/api/admin/catalog',{type:'book',title:'yr',year:'abc'}));
show('delete catalog with entries',await a.del('/api/admin/catalog/'+e.catalog_id));
show('import offline-ish',await a.post('/api/admin/catalog/import',{type:'book',query:'zzzxqjw nonexistentbook'}));
// request flow
const rq=(await m.post('/api/requests',{type:'book',title:'<b>Talep</b> 😀',note:'n'})).json.request;
show('member patch request',await m.patch('/api/admin/requests/'+rq.id,{status:'tamamlandi'}));
show('admin resolve w/ catalog',await a.patch('/api/admin/requests/'+rq.id,{resolved_catalog_id:e.catalog_id}));
show('admin resolve bogus catalog',await a.patch('/api/admin/requests/'+rq.id,{resolved_catalog_id:99999}));
show('admin status bogus',await a.patch('/api/admin/requests/'+rq.id,{status:'foo'}));
show('notifications',await m.get('/api/notifications'));
// db hash
const db=new DatabaseSync('testler/data/test.db',{readOnly:true});
console.log(db.prepare('select username,substr(password_hash,1,30) h from users limit 3').all());
console.log('sessions table:',db.prepare("select name from sqlite_master where type='table'").all().map(x=>x.name).join());
// cascade delete
const tmp=(await a.post('/api/admin/users',{username:'casc1',display_name:'c',password:'abcdef'})).json.user;
const tc=new Client();await tc.login('casc1','abcdef');
const te=(await tc.post('/api/entries',{catalog_id:e.catalog_id,total_pages:100})).json.entry;
await m.post(`/api/entries/${te.id}/comments`,{body:'hi'});
show('delete user',await a.del('/api/admin/users/'+tmp.id));
show('entry after user delete',await a.get('/api/entries/'+te.id));
show('delete last admin / admin id1',await a.del('/api/admin/users/1'));
show('reset pw & login',await a.post('/api/admin/users/'+tmp.id+'/reset-password',{password:'abcdef'}));
})()
