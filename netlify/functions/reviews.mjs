import { getStore } from '@netlify/blobs';
import { createHash, randomUUID, timingSafeEqual, randomBytes } from 'node:crypto';
const store=()=>getStore('heungseon-treasure-reviews');
const spots=new Set(['cat-center','cat-school','cat-youth','cat-study','cat-park','snack-pureumi','snack-school','snack-park','snack-cheongsol','maker-station','maker-gana','maker-hanyang','maker-angol','memory-park','memory-pureumi','memory-cu']);
const json=(obj,status=200)=>new Response(JSON.stringify(obj),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const bad=(message,status=400)=>json({error:message},status);
const hash=(pw,salt)=>createHash('sha256').update(salt+':'+pw).digest('hex');
const equal=(a,b)=>{const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&timingSafeEqual(x,y)};
const admin=(pw)=>Boolean(process.env.ADMIN_REVIEW_PASSWORD)&&equal(pw,process.env.ADMIN_REVIEW_PASSWORD);
const author=(pw,row)=>Boolean(row.salt&&row.passwordHash)&&equal(hash(pw,row.salt),row.passwordHash);
const publicRow=row=>({id:row.id,nickname:row.nickname,comment:row.comment,createdAt:row.createdAt,editable:true,photos:(row.photos||[]).map(key=>`/api/photo?key=${encodeURIComponent(key)}`)});
function getId(id){return typeof id==='string'&&/^[0-9a-f-]{36}$/.test(id)?id:null}
async function bodyJSON(req){try{return await req.json()}catch{return {}}}
export default async function handler(req){
try{
const method=req.method.toUpperCase();const url=new URL(req.url);const st=store();
if(method==='GET') {const spotId=url.searchParams.get('spotId')||'';if(!spots.has(spotId))return bad('잘못된 장소입니다.');const {blobs}=await st.list({prefix:`reviews/${spotId}/`});const raw=await Promise.all(blobs.map(i=>st.get(i.key,{type:'json'})));const rows=raw.filter(Boolean).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,100).map(publicRow);return json({reviews:rows})}
if(method==='POST'){
const f=await req.formData();const spotId=String(f.get('spotId')||'');if(!spots.has(spotId))return bad('장소를 확인해주세요.');const nickname=String(f.get('nickname')||'').trim().slice(0,16),comment=String(f.get('comment')||'').trim().slice(0,140),password=String(f.get('editPassword')||'');const lat=Number(f.get('lat')),lng=Number(f.get('lng'));if(!nickname||!comment||password.length<4||password.length>40||!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180)return bad('별명, 후기, 비밀번호, 위치 확인이 필요해요.');
const files=f.getAll('photos').filter(i=>i instanceof File&&i.size>0);if(files.length>2)return bad('사진은 최대 2장까지 가능합니다.');const supported={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif'};
for(const file of files)if(!supported[file.type]||file.size>3*1024*1024)return bad('JPG·PNG·WEBP·GIF 파일만 장당 3MB 이하로 첨부해주세요.');
const id=randomUUID(),salt=randomBytes(16).toString('hex'),photos=[];
try{for(const file of files){const key=`photos/${randomUUID()}.${supported[file.type]}`;await st.set(key,await file.arrayBuffer(),{metadata:{contentType:file.type}});photos.push(key)}const row={id,spotId,nickname,comment,passwordHash:hash(password,salt),salt,photos,createdAt:new Date().toISOString()};await st.setJSON(`reviews/${spotId}/${id}`,row,{onlyIfNew:true});return json({review:publicRow(row)},201)}catch(error){for(const key of photos)await st.delete(key).catch(()=>{});throw error}
}
if(method==='PUT'||method==='DELETE'){
const b=await bodyJSON(req),id=getId(b.id),password=String(b.password||'');if(!id||!password)return bad('후기 정보와 비밀번호를 확인해주세요.');const {blobs}=await st.list({prefix:'reviews/'});const info=blobs.find(i=>i.key.endsWith('/'+id));if(!info)return bad('후기를 찾지 못했어요.',404);const got=await st.getWithMetadata(info.key,{type:'json'});if(!got||!got.data)return bad('후기를 찾지 못했어요.',404);const row=got.data;if(!author(password,row)&&!admin(password))return bad('작성 비밀번호 또는 관리자 비밀번호가 올바르지 않아요.',403);
if(method==='PUT'){const nickname=String(b.nickname||'').trim().slice(0,16),comment=String(b.comment||'').trim().slice(0,140);if(!nickname||!comment)return bad('내용을 확인해주세요.');row.nickname=nickname;row.comment=comment;const result=await st.setJSON(info.key,row,{onlyIfMatch:got.etag});if(result.modified===false)return bad('다른 사람이 내용을 수정했어요. 새로고침 후 다시 시도해주세요.',409);return json({review:publicRow(row)})}
const current=await st.getMetadata(info.key);if(!current||current.etag!==got.etag)return bad('내용이 변경됐어요. 새로고침 후 다시 시도해주세요.',409);await st.delete(info.key);for(const key of row.photos||[])await st.delete(key).catch(()=>{});return json({ok:true})
}
return bad('지원하지 않는 요청입니다.',405);
}catch(error){console.error('review function error',error);return bad('저장 서버 오류가 발생했어요. Netlify 설정을 확인해주세요.',500)}
}
