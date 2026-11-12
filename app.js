"use strict";

const $=id=>document.getElementById(id);

/* SUPABASE CONFIGURATION */

const SUPABASE_URL="https://battrqecbyydvqbzrsxi.supabase.co";

const SUPABASE_KEY="sb_publishable_USOxmbW2mxSpQF_3mzxAGw_pt4OuISG";

/* FUNCTION NAMES */

const CHECK_FUNCTION="check-username";
const REGISTER_FUNCTION="register-username";
const SEARCH_FUNCTION="quick-worker";

/* NOSTR RELAYS */

const RELAYS=[
"wss://relay.damus.io",
"wss://nos.lol",
"wss://relay.primal.net",
"wss://relay.nostr.band"
];

const KEY="whisper-v4";

const db={
read(){
try{return JSON.parse(localStorage.getItem(KEY))||{}}
catch{return{}}
},
write(){
try{
localStorage.setItem(KEY,JSON.stringify(data));
return true
}catch(e){
toast("Storage is full or unavailable.");
return false
}
}
};

let data=db.read();
let NT=null;
let sk=null;
let me=null;
let npub=null;
let pool=null;
let sub=null;
let current=null;
let seen=new Set();
let started=false;
let connecting=false;
let usernameAvailable=false;
let checkedUsername="";
let registrationBusy=false;

if(!Object.keys(data.contacts||{}).length){
try{
data.contacts=JSON.parse(localStorage.getItem("w-contacts")||"{}");
}catch{}
}

if(!Object.keys(data.messages||{}).length){
try{
data.messages=JSON.parse(localStorage.getItem("w-msgs")||"{}");
}catch{}
}

data.contacts=data.contacts||{};
data.messages=data.messages||{};
data.unread=data.unread||{};
data.profiles=data.profiles||{};

const hex=b=>Array.from(b,x=>x.toString(16).padStart(2,"0")).join("");

const unhex=h=>new Uint8Array(
h.match(/.{2}/g).map(x=>parseInt(x,16))
);

function toast(t){
$("toast").textContent=t;
clearTimeout(toast.timer);
toast.timer=setTimeout(()=>$("toast").textContent="",3500);
}

function status(t){
$("status").textContent=t;
$("status").parentNode.classList.toggle("ok",/^Connected/.test(t));
}

function show(id){
$(id).classList.remove("hidden");
}

function hide(id){
$(id).classList.add("hidden");
}

function save(){
db.write();
renderMe();
}

/* SUPABASE REQUEST */

async function supabaseRequest(functionName,body){

const endpoint=SUPABASE_URL+"/functions/v1/"+functionName;
let response;

try{
response=await fetch(endpoint,{
method:"POST",
mode:"cors",
headers:{
"Content-Type":"application/json",
"apikey":SUPABASE_KEY,
"Authorization":"Bearer "+SUPABASE_KEY
},
body:JSON.stringify(body),
cache:"no-store"
});
}catch(error){
console.error("RUSTLE Supabase network/CORS error:",error);
throw new Error(
"Could not reach Supabase. Check your internet connection, project URL, and that the Edge Function is deployed with the exact name: "+functionName+". If these are correct, check the function's CORS response."
);
}

const raw=await response.text();
let result={};

try{
result=raw?JSON.parse(raw):{};
}catch{
result={message:raw||"Supabase returned an empty response."};
}

if(!response.ok){
console.error("RUSTLE Supabase response:",response.status,result);
throw new Error(
result.error||result.message||("Supabase returned HTTP "+response.status)
);
}

return result;
}

/* USERNAME VALIDATION */

function cleanUsername(value){
return String(value||"")
.trim()
.replace(/^@/,"")
.toLowerCase();
}

function validUsername(value){
return /^[a-z0-9_]{3,20}$/.test(value);
}

let checkTimer=null;

function updateRegisterButton(){

const u=cleanUsername($("usernameInput").value);

const own=!!data.username&&u===data.username;

const ok=own||(usernameAvailable&&checkedUsername===u);

$("registerUsername").disabled=registrationBusy||!ok;

$("registerUsername").textContent=own?"Save changes":"Register username";

}

function setUsernameStatus(cls,text){

$("usernameStatus").className=cls;

$("usernameStatus").textContent=text;

}

function onUsernameInput(){

const username=cleanUsername($("usernameInput").value);

usernameAvailable=false;
checkedUsername="";

clearTimeout(checkTimer);

$("registrationStatus").textContent="";

if(!username){

setUsernameStatus("hint","3–20 characters. Letters, numbers and underscores.");

}else if(data.username&&username===data.username){

setUsernameStatus("success","✓ This is your current username.");

}else if(!/^[a-z0-9_]+$/.test(username)){

setUsernameStatus("error","Only letters, numbers and underscores.");

}else if(username.length<3){

setUsernameStatus("hint","Keep typing — at least 3 characters.");

}else{

setUsernameStatus("hint","Checking…");

checkTimer=setTimeout(()=>checkUsername(username),500);

}

updateRegisterButton();

}

/* CHECK USERNAME (runs automatically while typing) */

async function checkUsername(username){

try{

const result=await supabaseRequest(CHECK_FUNCTION,{username});

if(cleanUsername($("usernameInput").value)!==username)return;

if(typeof result.available!=="boolean"){
throw new Error("Unexpected response from the server.");
}

if(result.available){

usernameAvailable=true;
checkedUsername=username;

setUsernameStatus("success","✓ @"+username+" is available!");

}else{

setUsernameStatus("error","✗ @"+username+" is already taken.");

}

}catch(e){

if(cleanUsername($("usernameInput").value)!==username)return;

setUsernameStatus("error","Couldn't check right now. Check your connection and keep typing to retry.");

}

updateRegisterButton();

}

/* SIGN NOSTR CHALLENGE */

function signRegistrationChallenge(challenge){

const event={
kind:30078,
created_at:Math.floor(Date.now()/1000),
tags:[
["d","rustle-username-registration"]
],
content:challenge
};

return NT.finalizeEvent(event,sk);

}

/* REGISTER USERNAME */

async function registerUsername(){

if(registrationBusy)return;

const username=cleanUsername($("usernameInput").value);

if(!validUsername(username)){
$("registrationStatus").textContent=
"Enter a valid username first.";
return;
}

const own=!!data.username&&username===data.username;

if(!own&&(!usernameAvailable||checkedUsername!==username)){

$("registrationStatus").textContent=
"Wait for the availability check to finish.";

return;
}

if(!sk||!me||!NT){
$("registrationStatus").textContent=
"Your RUSTLE identity is not ready.";

return;
}

registrationBusy=true;

$("registerUsername").disabled=true;

$("registrationStatus").className="toast";
$("registrationStatus").textContent=
"Creating secure registration challenge…";

try{

/* STEP 1: REQUEST CHALLENGE */

const challengeResult=await supabaseRequest(
REGISTER_FUNCTION,
{
action:"challenge",
public_key:me
}
);

if(!challengeResult.success||!challengeResult.challenge){
throw new Error("Could not create registration challenge.");
}

const challenge=challengeResult.challenge;

/* STEP 2: SIGN CHALLENGE WITH USER'S NOSTR KEY */

$("registrationStatus").textContent=
"Signing registration request…";

const signedEvent=signRegistrationChallenge(challenge);

/* STEP 3: REGISTER USERNAME */

$("registrationStatus").textContent=
"Registering your username…";

const result=await supabaseRequest(
REGISTER_FUNCTION,
{
action:"register",
username,
public_key:me,
challenge,
signed_event:signedEvent,
display_name:$("displayNameInput").value.trim()||null,
bio:$("bioInput").value.trim()||null
}
);

if(!result.success){
throw new Error(result.error||"Registration failed.");
}

/* SUCCESS */

$("registrationStatus").className="success";

$("registrationStatus").textContent=
"✓ Username @"+username+" registered successfully!";

data.username=username;
data.displayName=$("displayNameInput").value.trim();
data.bio=$("bioInput").value.trim();

save();

usernameAvailable=false;
checkedUsername="";

setUsernameStatus("success","✓ @"+username+" is your username.");

}catch(e){

$("registrationStatus").className="error";

$("registrationStatus").textContent=
"Registration failed: "+e.message;

}finally{

registrationBusy=false;
updateRegisterButton();

}

}

/* PUBLIC KEY PARSING */

function parsePub(raw){

raw=raw.trim();

let m=raw.match(/(?:add=|\/)([0-9a-f]{64})(?:$|[&#?])/i);

if(m)return m[1].toLowerCase();

if(/^npub1/i.test(raw)){

try{
let d=NT.nip19.decode(raw);

return d.type==="npub"&&typeof d.data==="string"
?d.data:null;

}catch{
return null;
}

}

if(/^[0-9a-f]{64}$/i.test(raw)){
return raw.toLowerCase();
}

return null;

}

function parseSecret(raw){

raw=raw.trim();

if(/^nsec1/i.test(raw)){

const d=NT.nip19.decode(raw);

if(d.type!=="nsec"){
throw Error("That is not an nsec private key.");
}

return d.data;

}

if(/^[0-9a-f]{64}$/i.test(raw)){
return unhex(raw);
}

throw Error("Enter a valid nsec or 64-character hexadecimal secret key.");

}

/* IDENTITY */

function setIdentity(secret){

sk=secret;

me=NT.getPublicKey(sk);

npub=NT.nip19.npubEncode(me);

localStorage.setItem("whisper-secret",hex(sk));

$("npub").textContent=npub;

renderMe();

hide("nsec");
hide("copyNsec");

$("revealKey").textContent="Show private key";

}

/* CONTACTS */

function getMessages(pk){

return data.messages[pk]||(data.messages[pk]=[]);

}

function addContact(pk,name){

if(!data.contacts[pk]){
data.contacts[pk]=name||("Friend "+pk.slice(0,6));
}

save();
renderList();

}

/* START APPLICATION */

async function boot(){

if(started)return;

started=true;

show("home");

NT=window.NostrTools;

if(!NT){

status("Encryption library failed to load.");

$("search").disabled=true;
$("send").disabled=true;

return;

}

try{

const stored=localStorage.getItem("whisper-secret");

if(stored){

sk=unhex(stored);

if(sk.length!==32){
throw Error("Invalid saved key");
}

}else{

sk=NT.generateSecretKey();

}

setIdentity(sk);

}catch(e){

status("Could not load identity: "+e.message);

return;

}

pool=new NT.SimplePool();

seen=new Set(
Object.values(data.messages).flat().map(m=>m.id)
);

renderList();

if(data.hideNotice)$("notice").classList.add("hidden");

connect();

if(data.username){

$("usernameInput").value=data.username;

$("registrationStatus").textContent=
"Registered username: @"+data.username;

}

if(data.displayName){
$("displayNameInput").value=data.displayName;
}

if(data.bio){
$("bioInput").value=data.bio;
}

onUsernameInput();

if(data.username){
$("registrationStatus").textContent="Registered username: @"+data.username;
}

let inviteVal=(location.hash.match(/(?:add=)([^&]+)/)||[])[1]||null;

if(!inviteVal){try{inviteVal=localStorage.getItem("rustle-pending-invite")}catch{}}

try{localStorage.removeItem("rustle-pending-invite")}catch{}

if(inviteVal){

let inviteText=inviteVal;

try{inviteText=decodeURIComponent(inviteVal)}catch{}

$("search").value=inviteText;

onSearch();

status("Invite detected — tap Message.");

}

document.addEventListener("visibilitychange",()=>{
if(!document.hidden)connect();
});

}

/* RELAY CONNECTION */

function connect(){

if(!pool||connecting)return;

connecting=true;

try{
if(sub)sub.close();
}catch{}

status("Connecting to relays…");

sub=pool.subscribeMany(
RELAYS,
[
{kinds:[1059],"#p":[me],limit:500},
{kinds:[SIGNAL_KIND],"#p":[me],since:Math.floor(Date.now()/1000)-300,limit:100},
{kinds:[4],"#p":[me],limit:500},
{kinds:[4],authors:[me],limit:500}
],
{
onevent:onRelayEvent,

oneose(){
status("Connected · listening on relays");
}
}
);

watchRelayAuth();

setTimeout(()=>{

connecting=false;

if($("status").textContent==="Connecting to relays…"){
status("Trying relays…");
}

},2500);

}

/* PRIVATE MESSAGES (NIP-17: rumor -> seal -> gift wrap) */

const MAX_MESSAGE=4000;
const wrapSeen=new Set();
let reauthTimer=null;

/* Image bytes travel over a direct WebRTC data channel. Relays carry encrypted
   connection signaling only; image content is never published to a relay. */
const IMAGE_MAX_BYTES=50*1024*1024, IMAGE_CHUNK=16*1024, SIGNAL_KIND=25050;
const rtcPeers=new Map();
const imageDbPromise=new Promise((resolve,reject)=>{
 const req=indexedDB.open("rustle-local-files-v1",1);
 req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains("images"))req.result.createObjectStore("images")};
 req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
});
async function putLocalImage(id,blob){
 const db=await imageDbPromise;
 return new Promise((resolve,reject)=>{
  const tx=db.transaction("images","readwrite");tx.objectStore("images").put(blob,id);
  tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
 });
}
async function getLocalImage(id){
 const db=await imageDbPromise;
 return new Promise((resolve,reject)=>{
  const req=db.transaction("images","readonly").objectStore("images").get(id);
  req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>reject(req.error);
 });
}
function b64(bytes){
 let s="";for(let i=0;i<bytes.length;i+=0x8000)s+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
 return btoa(s);
}
function unb64(s){
 const raw=atob(s),out=new Uint8Array(raw.length);
 for(let i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i);
 return out;
}
async function sendSignal(peer,payload){
 const content=NT.nip44.encrypt(JSON.stringify(payload),convKey(sk,peer));
 const event=NT.finalizeEvent({kind:SIGNAL_KIND,created_at:Math.floor(Date.now()/1000),tags:[["p",peer]],content},sk);
 const results=await Promise.allSettled(pool.publish(RELAYS,event));
 if(!results.some(x=>x.status==="fulfilled"))throw Error("Could not deliver encrypted connection signal through relays.");
}
async function receiveSignal(ev){
 if(!ev||ev.kind!==SIGNAL_KIND||!NT||!sk||ev.pubkey===me)return;
 if(!(ev.tags||[]).some(t=>t[0]==="p"&&t[1]===me))return;
 try{
  const payload=JSON.parse(NT.nip44.decrypt(ev.content,convKey(sk,ev.pubkey)));
  if(!payload||payload.v!==1||!["offer","answer"].includes(payload.type))return;
  if(payload.type==="offer")await answerImagePeer(ev.pubkey,payload.sdp);
  else{
   const pc=rtcPeers.get(ev.pubkey)?.pc;
   if(pc&&pc.signalingState==="have-local-offer")await pc.setRemoteDescription(payload.sdp);
  }
 }catch(e){console.warn("RUSTLE image signaling:",e);}
}
function waitIceComplete(pc){
 if(pc.iceGatheringState==="complete")return Promise.resolve();
 return new Promise(resolve=>{
  let done=false;
  const finish=()=>{if(done)return;done=true;clearTimeout(timer);pc.removeEventListener("icegatheringstatechange",check);resolve();};
  const check=()=>{if(pc.iceGatheringState==="complete")finish();};
  const timer=setTimeout(finish,10000);pc.addEventListener("icegatheringstatechange",check);
 });
}
function makeRtc(peer){
 const pc=new RTCPeerConnection({iceServers:[{urls:"stun:stun.l.google.com:19302"}]});
 const state={pc,channel:null,receiving:null};rtcPeers.set(peer,state);
 pc.onconnectionstatechange=()=>{if(["failed","closed"].includes(pc.connectionState)&&rtcPeers.get(peer)===state)rtcPeers.delete(peer);};
 pc.ondatachannel=e=>attachImageChannel(peer,state,e.channel);
 return state;
}
function attachImageChannel(peer,state,channel){
 state.channel=channel;channel.binaryType="arraybuffer";
 channel.onmessage=async e=>{
  try{
   if(typeof e.data==="string"){
    const m=JSON.parse(e.data);
    if(m.type==="image-start"){
     if(!Number.isInteger(m.size)||m.size<17||m.size>IMAGE_MAX_BYTES+16||!["image/jpeg","image/png"].includes(m.mime))throw Error("Invalid image transfer.");
     state.receiving={id:m.id,name:String(m.name||"image").slice(0,120),mime:m.mime,size:m.size,key:unb64(m.key),iv:unb64(m.iv),chunks:[],received:0};
     return;
    }
    if(m.type==="image-end"&&state.receiving){
     const r=state.receiving;state.receiving=null;
     if(r.received!==r.size)throw Error("Image transfer was incomplete.");
     const encrypted=new Uint8Array(r.size);let offset=0;
     for(const chunk of r.chunks){const bytes=new Uint8Array(chunk);encrypted.set(bytes,offset);offset+=bytes.length;}
     const cryptoKey=await crypto.subtle.importKey("raw",r.key,{name:"AES-GCM"},false,["decrypt"]);
     const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv:r.iv},cryptoKey,encrypted);
     const blob=new Blob([plain],{type:r.mime});await putLocalImage(r.id,blob);
     insertMessage(peer,{id:r.id,me:false,text:"",t:Math.floor(Date.now()/1000),st:"ok",image:{id:r.id,name:r.name,type:r.mime,size:blob.size}});
     toast("Image received and saved on this device.");
    }
    return;
   }
   const r=state.receiving;if(!r)return;
   r.chunks.push(e.data);r.received+=e.data.byteLength;
   if(r.received>r.size){state.receiving=null;throw Error("Image exceeds expected size.");}
  }catch(err){console.error("RUSTLE image receive:",err);toast(err.message||"Image receive failed.");}
 };
 channel.onopen=()=>toast("Secure direct connection ready.");
 channel.onclose=()=>{if(rtcPeers.get(peer)===state)rtcPeers.delete(peer);};
}
async function answerImagePeer(peer,offer){
 let state=rtcPeers.get(peer);if(state&&state.pc.signalingState!=="stable")return;
 state=makeRtc(peer);await state.pc.setRemoteDescription(offer);
 const answer=await state.pc.createAnswer();await state.pc.setLocalDescription(answer);
 await waitIceComplete(state.pc);await sendSignal(peer,{v:1,type:"answer",sdp:state.pc.localDescription});
}
async function openImageChannel(peer){
 let state=rtcPeers.get(peer);
 if(state?.channel?.readyState==="open")return state.channel;
 if(state){try{state.pc.close()}catch{}rtcPeers.delete(peer);}
 state=makeRtc(peer);
 const channel=state.pc.createDataChannel("rustle-images",{ordered:true});attachImageChannel(peer,state,channel);
 const offer=await state.pc.createOffer();await state.pc.setLocalDescription(offer);
 await waitIceComplete(state.pc);await sendSignal(peer,{v:1,type:"offer",sdp:state.pc.localDescription});
 await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error("Direct connection timed out. Both users must be online and reachable.")),30000);
  channel.addEventListener("open",()=>{clearTimeout(timer);resolve();},{once:true});
  channel.addEventListener("error",()=>{clearTimeout(timer);reject(Error("Direct connection failed."));},{once:true});
 });
 return channel;
}
async function sendImage(file){
 if(!current||!NT||!pool)return;
 if(!["image/jpeg","image/png"].includes(file.type)){toast("Choose a JPG or PNG image.");return;}
 if(file.size<1||file.size>IMAGE_MAX_BYTES){toast("Image must be 50 MB or smaller.");return;}
 const peer=current,id=hex(crypto.getRandomValues(new Uint8Array(16))),t=Math.floor(Date.now()/1000);
 insertMessage(peer,{id,me:true,text:"",t,st:"sending",image:{id,name:file.name,type:file.type,size:file.size}});
 try{
  const channel=await openImageChannel(peer),raw=await file.arrayBuffer();
  const keyBytes=crypto.getRandomValues(new Uint8Array(32)),iv=crypto.getRandomValues(new Uint8Array(12));
  const key=await crypto.subtle.importKey("raw",keyBytes,{name:"AES-GCM"},false,["encrypt"]);
  const encrypted=new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv},key,raw));
  channel.send(JSON.stringify({type:"image-start",id,name:file.name,mime:file.type,size:encrypted.length,key:b64(keyBytes),iv:b64(iv)}));
  for(let offset=0;offset<encrypted.length;offset+=IMAGE_CHUNK){
   while(channel.bufferedAmount>512*1024)await new Promise(r=>setTimeout(r,30));
   channel.send(encrypted.slice(offset,Math.min(offset+IMAGE_CHUNK,encrypted.length)));
  }
  channel.send(JSON.stringify({type:"image-end"}));await putLocalImage(id,file);
  const m=getMessages(peer).find(x=>x.id===id);if(m)m.st="ok";
  save();renderThread();toast("Original image sent directly.");
 }catch(e){
  const m=getMessages(peer).find(x=>x.id===id);if(m)m.st="failed";
  save();renderThread();toast(e.message||"Image transfer failed.");
 }
}

function randomPast(){
const r=crypto.getRandomValues(new Uint32Array(1))[0]/4294967296;
return Math.floor(Date.now()/1000)-Math.floor(r*172800);
}

function convKey(priv,pub){
return NT.nip44.getConversationKey(priv,pub);
}

/* Builds the message once: an unsigned "rumor", sealed with my key,
   then wrapped with a throw-away key. One wrap for the person, one for me. */

function wrapFor(rumor,recipient){

const seal=NT.finalizeEvent({
kind:13,
created_at:randomPast(),
tags:[],
content:NT.nip44.encrypt(JSON.stringify(rumor),convKey(sk,recipient))
},sk);

const once=NT.generateSecretKey();

return NT.finalizeEvent({
kind:1059,
created_at:randomPast(),
tags:[["p",recipient]],
content:NT.nip44.encrypt(JSON.stringify(seal),convKey(once,recipient))
},once);

}

function buildMessage(peer,text,createdAt){

const rumor={
kind:14,
created_at:createdAt,
tags:[["p",peer]],
content:text,
pubkey:me
};

rumor.id=NT.getEventHash(rumor);

return{
rumor,
toPeer:wrapFor(rumor,peer),
toSelf:wrapFor(rumor,me)
};

}

async function receiveWrap(ev){

if(!ev||ev.kind!==1059||wrapSeen.has(ev.id)||!NT||!sk)return;

try{

const seal=JSON.parse(NT.nip44.decrypt(ev.content,convKey(sk,ev.pubkey)));

if(!seal||seal.kind!==13||typeof seal.content!=="string"||!NT.verifyEvent(seal))return;

const rumor=JSON.parse(NT.nip44.decrypt(seal.content,convKey(sk,seal.pubkey)));

if(!rumor||rumor.kind!==14)return;

/* the sender named inside must be the one who signed the seal */

if(rumor.pubkey!==seal.pubkey)return;

if(typeof rumor.content!=="string"||!Array.isArray(rumor.tags)||typeof rumor.created_at!=="number")return;

if(NT.getEventHash(rumor)!==rumor.id)return;

wrapSeen.add(ev.id);

const mine=rumor.pubkey===me;

const ptag=rumor.tags.find(t=>t[0]==="p"&&/^[0-9a-f]{64}$/.test(t[1]||""));

let peer;

if(mine){

if(!ptag)return;

peer=ptag[1];

}else{

if(!rumor.tags.some(t=>t[0]==="p"&&t[1]===me))return;

peer=rumor.pubkey;

}

if(!/^[0-9a-f]{64}$/.test(peer)||peer===me)return;

/* already have it (retry, or the copy I sent to myself) */

if(getMessages(peer).some(x=>x.id===rumor.id))return;

addContact(peer);

insertMessage(peer,{
id:rumor.id,
me:mine,
text:rumor.content,
t:Math.min(rumor.created_at,Math.floor(Date.now()/1000)+300),
st:"ok"
});

if(!mine&&peer!==current){

data.unread[peer]=(data.unread[peer]||0)+1;

save();
renderList();

}

}catch(e){

/* Ignore anything that is not a valid message for me. */

}

}

function onRelayEvent(ev){

if(ev&&ev.kind===1059)receiveWrap(ev);
else if(ev&&ev.kind===SIGNAL_KIND)receiveSignal(ev);
else receive(ev);

}

/* Some relays only hand over private messages after the client proves its identity (NIP-42). */

function watchRelayAuth(){

if(!pool||!NT||!sk||typeof pool.ensureRelay!=="function")return;

RELAYS.forEach(url=>{

Promise.resolve(pool.ensureRelay(url)).then(r=>{

if(!r||typeof r.auth!=="function")return;

const doAuth=async()=>{

if(r.__authed)return;

r.__authed=true;

try{

await r.auth(async e=>NT.finalizeEvent(e,sk));

clearTimeout(reauthTimer);

reauthTimer=setTimeout(()=>{connecting=false;connect()},600);

}catch{

r.__authed=false;

}

};

r._onauth=doAuth;

if(r.challenge)doAuth();

}).catch(()=>{});

});

}

/* RECEIVE MESSAGES */

async function receive(ev){

if(!ev||seen.has(ev.id)||!NT)return;

const tag=(ev.tags||[]).find(t=>t[0]==="p");

if(!tag||!tag[1])return;

let peer;

if(ev.pubkey===me){
peer=tag[1];
}else if(tag[1]===me){
peer=ev.pubkey;
}else{
return;
}

if(!/^[0-9a-f]{64}$/.test(peer)||peer===me)return;

try{

const message=await NT.nip04.decrypt(
sk,
peer,
ev.content
);

if(typeof message!=="string")return;

seen.add(ev.id);

addContact(peer);

insertMessage(peer,{
id:ev.id,
me:ev.pubkey===me,
text:message,
t:ev.created_at,
st:"ok"
});

if(peer!==current&&ev.pubkey!==me){

data.unread[peer]=(data.unread[peer]||0)+1;

save();
renderList();

}

}catch(e){

/* Ignore undecryptable events. */

}

}

/* INSERT MESSAGE */

function insertMessage(pk,m){

const a=getMessages(pk);

const i=a.findIndex(x=>x.id===m.id);

if(i>=0){
a[i]={...a[i],...m};
}else{
a.push(m);
}

a.sort((x,y)=>x.t-y.t);

save();
renderList();

if(current===pk){
renderThread();
}

}

/* SEND MESSAGE */

async function sendMessage(retryId=null){

const input=$("txt");

const old=retryId?getMessages(current).find(x=>x.id===retryId):null;

const text=retryId?old?.text:input.value.trim();

if(!text||!current||!NT||!pool)return;

if(text.length>MAX_MESSAGE){
status("Message too long (max "+MAX_MESSAGE+" characters).");
return;
}

const peer=current;

if(!retryId){
input.value="";
input.focus();
}

const localId=retryId||
("local-"+Date.now()+"-"+Math.random().toString(36).slice(2));

/* A retry rebuilds the identical message, so the other person never sees a duplicate. */

const createdAt=(retryId&&old)?old.t:Math.floor(Date.now()/1000);

if(!retryId){

insertMessage(peer,{
id:localId,
me:true,
text,
t:createdAt,
st:"sending"
});

}else{

if(old)old.st="sending";

save();
renderThread();

}

try{

const built=buildMessage(peer,text,createdAt);

const rumor=built.rumor;

{

const a=getMessages(peer);

const i=a.findIndex(x=>x.id===localId);

if(i>=0)a.splice(i,1);

}

insertMessage(peer,{
id:rumor.id,
me:true,
text,
t:rumor.created_at,
st:"sending"
});

const ok=await Promise.race([
Promise.any(pool.publish(RELAYS,built.toPeer)).then(()=>true,()=>false),
new Promise(r=>setTimeout(()=>r(false),10000))
]);

insertMessage(peer,{
id:rumor.id,
me:true,
text,
t:rumor.created_at,
st:ok?"ok":"failed"
});

if(!ok){
status("Message not acknowledged. Check connection.");
}

/* copy for my own other devices and for restoring later (best effort) */

Promise.allSettled(pool.publish(RELAYS,built.toSelf));

}catch(e){

const m=getMessages(peer).find(x=>x.id===localId);

if(m){
m.st="failed";
save();
renderThread();
}

status("Could not send: "+(e.message||"unknown error"));

}finally{

$("send").disabled=false;
input.focus();

}

}

/* DISPLAY HELPERS */

function fmt(t){

const d=new Date(t*1000);
const today=new Date();

return d.toDateString()===today.toDateString()
?d.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})
:d.toLocaleDateString([],{day:"numeric",month:"short"});

}

function initials(n){

return (n||"?").trim()
.split(/\s+/)
.slice(0,2)
.map(x=>Array.from(x)[0]||"")
.join("")
.toUpperCase();

}

/* UI HELPERS */

function el(tag,cls,text){
const n=document.createElement(tag);
if(cls)n.className=cls;
if(text!=null)n.textContent=text;
return n;
}

function paintAvatar(n,pk,name){
const h=232+(parseInt((pk||"000000").slice(0,6),16)%62);
n.style.background="hsl("+h+" 40% 42%)";
n.textContent=initials(String(name||"?").replace(/^@/,""));
}

function renderMe(){
const b=$("me");
if(!b)return;
paintAvatar(b,me,data.displayName||data.username||"Me");
b.title=data.username?"@"+data.username:"My profile";
if($("sheetAvatar")){
paintAvatar($("sheetAvatar"),me,data.displayName||data.username||"Me");
$("sheetName").textContent=data.displayName||(data.username?"@"+data.username:"Your profile");
$("sheetUser").textContent=data.username&&data.displayName?"@"+data.username:"";
}
}

function group(t){return el("div","group",t)}

function bigIcon(path){
return '<svg width="68" height="68" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+path+'</svg>';
}

const ICON_CHATS=bigIcon('<path d="M20 11.5a7.5 7.5 0 0 1-10.9 6.7L4 19.5l1.2-4.4A7.5 7.5 0 1 1 20 11.5z"/><path d="M8.5 10h7M8.5 13h4"/>');
const ICON_NOFIND=bigIcon('<circle cx="10.5" cy="10.5" r="6.5"/><path d="m20 20-4.9-4.9M8 10.5h5"/>');
const ICON_WARN=bigIcon('<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4.5M12 17.5v.01"/>');

function stateBlock(icon,title,text,btnText,onclick){
const d=el("div","state");
const i=el("div","ic");
i.innerHTML=icon;
d.append(i,el("strong",null,title),el("div",null,text));
const b=el("button",null,btnText);
b.onclick=onclick;
d.append(b);
return d;
}

function setTab(name){
["Chats","Search"].forEach(t=>$("tab"+t).classList.toggle("active",t.toLowerCase()===name));
}

function personRow(pk,title,sub,btn,onclick){
const row=el("div","row");
const av=el("div","avatar");
paintAvatar(av,pk,title);
const main=el("div","ctmain");
main.append(el("div","n",title),el("div","p",sub));
row.append(av,main);
if(btn){
const b=el("button","pill",btn);
b.onclick=e=>{e.stopPropagation();onclick()};
row.append(b);
}
row.onclick=onclick;
return row;
}

/* PEOPLE SEARCH (username lookup) */

let people={q:"",state:"idle",items:[],pk:null};
let peopleTimer=null;
const peopleCache=new Map();

function onSearch(){

const raw=$("search").value;
$("clearSearch").classList.toggle("hidden",!raw);

clearTimeout(peopleTimer);

const q=cleanUsername(raw);
const pk=(NT&&raw.trim())?parsePub(raw):null;

if(pk||q.length<2||!/^[a-z0-9_]+$/.test(q)||/^npub1/.test(q)){
people={q:"",state:"idle",items:[],pk};
renderList();
return;
}

if(peopleCache.has(q)){
people={q,state:"done",items:peopleCache.get(q),pk:null};
renderList();
return;
}

people={q,state:"loading",items:[],pk:null};
renderList();

peopleTimer=setTimeout(()=>searchPeople(q),300);

}

async function searchPeople(q){

let next;

try{

const r=await supabaseRequest(SEARCH_FUNCTION,{query:q,limit:10});

const items=(Array.isArray(r.results)?r.results:[])
.filter(x=>x&&typeof x.username==="string"&&/^[0-9a-f]{64}$/i.test(x.public_key||""))
.map(x=>({...x,public_key:x.public_key.toLowerCase()}));

peopleCache.set(q,items);

next={q,state:"done",items,pk:null};

}catch(e){

console.error("RUSTLE search error:",e);

next={
q,
state:"error",
items:[],
pk:null,
error:/not found|404/i.test(e.message)
?"Username search isn't set up on the server yet."
:"Couldn't search right now. Check your connection and try again."
};

}

if(people.q!==q)return;

people=next;
renderList();

}

function firstTarget(){

if(people.pk&&people.pk!==me)return{public_key:people.pk};

return people.items.find(x=>x.public_key!==me)||null;

}

function startChat(p){

const pk=p.public_key;

if(!pk||pk===me)return;

const old=data.contacts[pk];

if(!old||/^Friend [0-9a-f]{6}$/.test(old)){
data.contacts[pk]=p.display_name||(p.username?"@"+p.username:"Friend "+pk.slice(0,6));
}

if(p.username){
data.profiles[pk]={u:p.username,b:p.bio||""};
}

save();

$("search").value="";
people={q:"",state:"idle",items:[],pk:null};
$("clearSearch").classList.add("hidden");

history.replaceState(null,"",location.pathname+location.search);

renderList();
openThread(pk);

}

/* CONTACT LIST */

function chatRow(pk){

const a=getMessages(pk);
const last=a.at(-1);
const pr=data.profiles[pk]||{};

const row=el("div","row"+(data.unread[pk]?" unread":""));

const av=el("div","avatar");
paintAvatar(av,pk,data.contacts[pk]);

const main=el("div","ctmain");

main.append(
el("div","n",data.contacts[pk]),
el("div","p",last?(last.me?"You: ":"")+last.text:(pr.u?"@"+pr.u:"No messages yet"))
);

const meta=el("div","ctmeta");

if(last)meta.append(el("div",null,fmt(last.t)));

if(data.unread[pk]){
meta.append(el("span","badge",data.unread[pk]>99?"99+":String(data.unread[pk])));
}

row.append(av,main,meta);

row.onclick=()=>openThread(pk);

return row;

}

function renderPeople(box,hasChats){

if(people.pk){

if(people.pk===me){
box.append(el("div","hintrow","That's your own public ID."));
return;
}

const pk=people.pk;

box.append(group("Add by public ID"));

box.append(personRow(
pk,
data.contacts[pk]||"New contact",
NT.nip19.npubEncode(pk).slice(0,24)+"…",
"Message",
()=>startChat({public_key:pk})
));

return;

}

if(people.state==="idle")return;

const q0=people.q;

if(people.state==="error"&&!hasChats){

box.append(stateBlock(ICON_WARN,"Something went wrong",people.error,"Try Again",()=>{
peopleCache.delete(q0);
people={q:q0,state:"loading",items:[],pk:null};
renderList();
searchPeople(q0);
}));

return;

}

if(people.state==="done"&&!hasChats&&!people.items.filter(x=>x.public_key!==me).length){

box.append(stateBlock(ICON_NOFIND,"No results found","Try a different username or check for typos.","Search Again",()=>{
$("search").focus();
$("search").select();
}));

return;

}

box.append(group("People"));

if(people.state==="loading"){

for(let i=0;i<3;i++){

const s=el("div","skel");
s.innerHTML='<i class="a"></i><div class="skmain"><i class="b"></i><i class="c"></i></div>';
box.append(s);

}

return;

}

if(people.state==="error"){
box.append(el("div","hintrow error",people.error));
return;
}

const items=people.items.filter(x=>x.public_key!==me);

if(!items.length){
box.append(el("div","hintrow","No one found for @"+people.q+". Check the spelling."));
return;
}

items.forEach(x=>{

const name=x.display_name||("@"+x.username);

const sub=x.display_name?"@"+x.username+(x.bio?" · "+x.bio:""):(x.bio||"On RUSTLE");

box.append(personRow(x.public_key,name,sub,"Message",()=>startChat(x)));

});

}

function renderList(){

const box=$("list");

box.textContent="";

const raw=$("search").value.trim();

const q=raw.toLowerCase().replace(/^@/,"");

$("notice").classList.toggle("hidden",!!raw||!!data.hideNotice);

$("fab").classList.toggle("hidden",!!raw||!Object.keys(data.contacts).length);

const ids=Object.keys(data.contacts)
.filter(pk=>{
if(!q)return true;
const pr=data.profiles[pk]||{};
return (data.contacts[pk]+" "+(pr.u||"")+" "+pk).toLowerCase().includes(q);
})
.sort((a,b)=>(getMessages(b).at(-1)?.t||0)-(getMessages(a).at(-1)?.t||0));

if(!raw&&!ids.length){

const d=stateBlock(ICON_CHATS,"No conversations yet","Find your friends by their unique @username.","Search People",()=>$("search").focus());

const inv=el("button","alt","Invite a Friend");
inv.onclick=()=>$("share").click();

d.append(inv);

box.append(d);

return;

}

if(raw&&ids.length)box.append(group("Chats"));

ids.forEach(pk=>box.append(chatRow(pk)));

if(raw)renderPeople(box,ids.length>0);

if(raw&&!box.childNodes.length){
box.append(el("div","hintrow","Type at least 2 letters of a @username."));
}

}

/* OPEN CHAT */

function openThread(pk){

current=pk;

data.unread[pk]=0;

save();

const pr=data.profiles[pk]||{};

$("title").textContent=data.contacts[pk];

$("peer").textContent=subtitleFor(pk);

paintAvatar($("tavatar"),pk,data.contacts[pk]);

hide("home");
show("thread");

renderThread();

$("txt").focus();

}

/* RENDER CHAT */

function renderThread(){

const box=$("msgs");

box.textContent="";

const list=getMessages(current);

let lastDay="";

if(!list.length){

const d=el("div","intro");

const pr=data.profiles[current]||{};

const av=el("div","avatar lg");
paintAvatar(av,current,data.contacts[current]);

d.append(av,el("div","introname",data.contacts[current]));

if(pr.u&&data.contacts[current]!=="@"+pr.u)d.append(el("div","p","@"+pr.u));

if(pr.b)d.append(el("div","bio",pr.b));

d.append(el("div","hint","Messages are encrypted before being sent to relays."));

const chip=el("button","chip","👋 Say hi");

chip.onclick=()=>{$("txt").value="👋";sendMessage()};

d.append(chip);

box.append(d);

}

for(const m of list){

const day=new Date(m.t*1000).toDateString();

if(day!==lastDay){

const sep=document.createElement("div");

sep.className="day";

sep.textContent=new Date(m.t*1000).toLocaleDateString([],{
weekday:"short",
day:"numeric",
month:"short",
year:"numeric"
});

box.append(sep);

lastDay=day;

}

const d=document.createElement("div");

d.className="m"+(m.me?" me":"")+(m.image?" image-message":"");

if(m.image){
 const img=document.createElement("img");img.className="shared-image";img.alt=m.image.name||"Shared image";img.loading="lazy";d.append(img);
 getLocalImage(m.image.id).then(blob=>{if(blob&&img.isConnected)img.src=URL.createObjectURL(blob);}).catch(()=>{});
 const caption=document.createElement("div");caption.className="image-caption";
 caption.textContent=m.image.name+" · "+(m.image.size/1024/1024).toFixed(2)+" MB";d.append(caption);
 const download=document.createElement("a");download.className="image-download";download.textContent="Save original";download.href="#";
 download.onclick=async e=>{
  e.preventDefault();const blob=await getLocalImage(m.image.id);
  if(!blob){toast("Original image is not available on this device.");return;}
  const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=m.image.name||"rustle-image";a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
 };d.append(download);
}else{d.textContent=m.text;}

const meta=document.createElement("small");

meta.textContent=fmt(m.t)+(m.me?
(m.st==="ok"?" · sent":m.st==="failed"?" · not sent":" · sending…")
:"");

d.append(meta);

if(m.me&&m.st==="failed"){

const b=document.createElement("button");

b.className="retry";
b.textContent="Retry";

b.onclick=()=>sendMessage(m.id);

meta.append(b);

}

box.append(d);

}

$("sc").scrollTop=$("sc").scrollHeight;

}

/* NAVIGATION */

function back(){

current=null;

setTab("chats");

hide("thread");
show("home");

renderList();

}

/* CONTACT OPTIONS */

function subtitleFor(pk){

const pr=data.profiles[pk]||{};

if(pr.u)return data.contacts[pk]==="@"+pr.u?"":"@"+pr.u;

return pk.slice(0,12)+"…";

}

let csCopyTimer=null;

function csView(v){

$("csMenu").classList.toggle("hidden",v!=="menu");

$("csRenameBox").classList.toggle("hidden",v!=="rename");

$("csConfirm").classList.toggle("hidden",v!=="confirm");

$("csClose").classList.toggle("hidden",v!=="menu");

if(v==="rename"){

$("csInput").value=data.contacts[current];

$("csErr").textContent="";

setTimeout(()=>{$("csInput").focus();$("csInput").select()},60);

}

}

function contactOptions(){

const pk=current;

if(!pk)return;

paintAvatar($("csAvatar"),pk,data.contacts[pk]);

$("csName").textContent=data.contacts[pk];

$("csSub").textContent=subtitleFor(pk)||NT.nip19.npubEncode(pk).slice(0,16)+"…";

$("csCopyLabel").textContent="Copy public ID";

csView("menu");

show("csheet");

}

function closeContactSheet(){

hide("csheet");

}

function saveRename(){

const n=$("csInput").value.trim();

if(!n){

$("csErr").textContent="Name cannot be empty.";

return;

}

data.contacts[current]=n.slice(0,50);

save();

$("title").textContent=data.contacts[current];

$("peer").textContent=subtitleFor(current);

paintAvatar($("tavatar"),current,data.contacts[current]);

renderList();

renderThread();

closeContactSheet();

}

function removeContact(){

delete data.contacts[current];
delete data.messages[current];
delete data.unread[current];
delete data.profiles[current];

save();

closeContactSheet();

back();

}

/* CLIPBOARD */

async function copyText(t){

try{

await navigator.clipboard.writeText(t);

toast("Copied to clipboard");

}catch{

toast("Clipboard unavailable.");

}

}

/* INVITE */

function inviteLink(){

return location.origin+location.pathname+"#add="+encodeURIComponent(npub);

}

/* EVENTS */

function wire(){

$("search").onkeydown=e=>{

if(e.key!=="Enter")return;

const t=firstTarget();

if(t)startChat(t);

};

$("csheet").onclick=e=>{if(e.target===$("csheet"))closeContactSheet()};

$("csClose").onclick=closeContactSheet;

$("csRename").onclick=()=>csView("rename");

$("csRenameCancel").onclick=()=>csView("menu");

$("csRenameSave").onclick=saveRename;

$("csInput").onkeydown=e=>{if(e.key==="Enter")saveRename()};

$("csRemove").onclick=()=>csView("confirm");

$("csConfirmCancel").onclick=()=>csView("menu");

$("csConfirmRemove").onclick=removeContact;

$("csCopy").onclick=async()=>{

const lab=$("csCopyLabel");

try{

await navigator.clipboard.writeText(NT.nip19.npubEncode(current));

lab.textContent="Copied ✓";

}catch{

lab.textContent="Clipboard unavailable";

}

clearTimeout(csCopyTimer);

csCopyTimer=setTimeout(()=>{lab.textContent="Copy public ID"},1800);

};

document.addEventListener("keydown",e=>{

if(e.key==="Escape"&&!$("csheet").classList.contains("hidden"))closeContactSheet();

});

$("tabChats").onclick=()=>{

$("search").value="";

onSearch();

$("search").blur();

setTab("chats");

$("homeScroll").scrollTop=0;

};

$("tabSearch").onclick=()=>{

setTab("search");

$("search").focus();

};

$("tabProfile").onclick=()=>$("me").click();

$("fab").onclick=()=>$("tabSearch").click();

$("search").onfocus=()=>setTab("search");

$("search").onblur=()=>{if(!$("search").value)setTab("chats")};

$("clearSearch").onclick=()=>{

$("search").value="";

onSearch();

$("search").focus();

};

$("closeNotice").onclick=()=>{

data.hideNotice=true;

save();

$("notice").classList.add("hidden");

};

$("send").onclick=()=>sendMessage();

$("attachImage").onclick=()=>$("imageInput").click();
$("imageInput").onchange=async()=>{
 const file=$("imageInput").files?.[0];$("imageInput").value="";
 if(file)await sendImage(file);
};

$("txt").onkeydown=e=>{

if(e.key==="Enter"&&!e.shiftKey){

e.preventDefault();

sendMessage();

}

};

$("search").oninput=onSearch;

$("back").onclick=back;

$("chatMenu").onclick=contactOptions;

/* OPEN IDENTITY SHEET */

$("me").onclick=()=>{

show("sheet");

$("npub").textContent=npub;

};

/* CLOSE */

$("close").onclick=()=>hide("sheet");

$("sheet").onclick=e=>{
if(e.target.id==="sheet")hide("sheet");
};

/* USERNAME BUTTONS */

$("registerUsername").onclick=registerUsername;

$("usernameInput").addEventListener("input",onUsernameInput);

/* COPY PUBLIC ID */

$("copyNpub").onclick=()=>copyText(npub);

/* SHARE */

$("share").onclick=async()=>{

const url=inviteLink();

try{

if(navigator.share){

await navigator.share({
title:"Chat with me on RUSTLE",
text:data.username?"Add me on RUSTLE — @"+data.username:"Add me on RUSTLE:",
url
});

}else{

await copyText(url);

}

}catch{}

};

/* REVEAL PRIVATE KEY */

$("revealKey").onclick=()=>{

if(!$("nsec").classList.contains("hidden")){

hide("nsec");
hide("copyNsec");

$("revealKey").textContent="Show private key";

return;

}

const secret=NT.nip19.nsecEncode(sk);

$("nsec").textContent=secret;

show("nsec");
show("copyNsec");

$("revealKey").textContent="Hide private key";

};

$("copyNsec").onclick=()=>copyText($("nsec").textContent);

/* BACKUP */

$("downloadBackup").onclick=()=>{

const blob=new Blob([

JSON.stringify({

app:"RUSTLE",
format:1,
secretKey:NT.nip19.nsecEncode(sk),
publicKey:npub,
createdAt:new Date().toISOString()

},null,2)

],{type:"application/json"});

const a=document.createElement("a");

a.href=URL.createObjectURL(blob);

a.download="rustle-identity-backup.json";

a.click();

setTimeout(()=>URL.revokeObjectURL(a.href),1000);

toast("Backup downloaded. Store it privately.");

};

/* RESTORE */

$("restore").onclick=()=>{

try{

if(!confirm("Replace current identity? Make sure you have backed up your current key.")){
return;
}

const secret=parseSecret($("restoreKey").value);

setIdentity(secret);

$("restoreKey").value="";

connect();

toast("Identity restored.");

}catch(e){

alert(e.message);

}

};

}

/* SERVICE WORKER */

if("serviceWorker"in navigator){

window.addEventListener("load",()=>{

navigator.serviceWorker.register("./sw.js").catch(()=>{});

});

}

/* INSTALL BUTTON (website mode) */

let deferredInstall=null;

window.addEventListener("beforeinstallprompt",e=>{
e.preventDefault();
deferredInstall=e;
});

function initLanding(){

const big=$("installBtn");
const mini=$("installMini");
const how=$("howto");

try{
const inv=location.hash.match(/(?:add=)([^&]+)/);
if(inv&&inv[1].length<=200){
localStorage.setItem("rustle-pending-invite",inv[1]);
$("inviteNote").classList.remove("hidden");
}
}catch{}

function markInstalled(){
big.classList.add("done");
big.querySelector("b").textContent="RUSTLE is installed";
big.querySelector("small").textContent="Open it from your home screen";
big.disabled=true;
mini.classList.add("hidden");
how.classList.add("hidden");
}

function showHow(){

const ua=navigator.userAgent;

const ios=/iphone|ipad|ipod/i.test(ua)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1);

const inApp=/FBAN|FBAV|Instagram|Telegram|; wv\)/i.test(ua);

const steps=inApp
?["Open this page in <b>Chrome</b> (menu <b>⋮</b> → <b>Open in browser</b>)","Tap <b>Install RUSTLE</b> again"]
:ios
?["Tap the <b>Share</b> button in Safari","Choose <b>Add to Home Screen</b>","Tap <b>Add</b>, then open RUSTLE from your home screen"]
:["Open your browser menu (<b>⋮</b>)","Tap <b>Install app</b> or <b>Add to Home screen</b>","Open RUSTLE from your home screen"];

$("howSteps").innerHTML=steps.map(x=>"<li>"+x+"</li>").join("");

how.classList.remove("hidden");

how.scrollIntoView({behavior:"smooth",block:"nearest"});

}

async function install(){

if(!deferredInstall){
showHow();
return;
}

const p=deferredInstall;

deferredInstall=null;

p.prompt();

const choice=await p.userChoice.catch(()=>null);

if(choice&&choice.outcome==="accepted")markInstalled();

}

big.onclick=install;
mini.onclick=install;

window.addEventListener("appinstalled",markInstalled);

/* small install pill appears once the big button scrolls out of view */

if("IntersectionObserver"in window){

new IntersectionObserver(([en])=>{
mini.classList.toggle("show",!en.isIntersecting);
},{rootMargin:"-64px 0px 0px 0px"}).observe(big);

}else{
mini.classList.add("show");
}

addEventListener("scroll",()=>{
$("sitebar").classList.toggle("scrolled",scrollY>4);
},{passive:true});

}

/* APPLICATION START */

const installedApp=
matchMedia("(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui)").matches||
navigator.standalone===true||
document.referrer.startsWith("android-app://");

if(installedApp||new URLSearchParams(location.search).has("app")){

wire();

boot();

}else{

document.querySelectorAll("#home,#thread,#sheet,#csheet").forEach(n=>n.remove());

show("landing");

initLanding();

}
