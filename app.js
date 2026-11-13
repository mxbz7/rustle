"use strict";

const $=id=>document.getElementById(id);

/* SUPABASE CONFIGURATION */

const SUPABASE_URL="https://battrqecbyydvqbzrsxi.supabase.co";

const SUPABASE_KEY="sb_publishable_USOxmbW2mxSpQF_3mzxAGw_pt4OuISG";

/* FUNCTION NAMES */

const CHECK_FUNCTION="check-username";
const REGISTER_FUNCTION="register-username";
const SEARCH_FUNCTION="quick-worker";
const TURN_FUNCTION="turn-credentials";

/* NOSTR RELAYS */

const RELAYS=[
"wss://relay.damus.io",
"wss://nos.lol",
"wss://relay.primal.net",
"wss://relay.nostr.band"
];

const KEY="whisper-v4";

/* Rustle-issued verification registry. Entries are matched against the
   canonical Nostr public key, never a username, display name, or device. */
const RUSTLE_VERIFIED_USERS=[
 {npub:"npub1y9xz5m4c5w8qvtjs7fcyr7rjjma83rzm6zh2fyjpq6x4fcklxwdq4t2psc",role:"team"}
];
const VERIFIED_BADGE_TITLE="Verified Rustle Team Member";
const VERIFIED_BADGE_MESSAGE="This account is verified and is a part of Rustle development.";
const VERIFIED_SEAL_SVG='<svg viewBox="0 0 32 32" aria-hidden="true"><path class="verified-seal" d="M16.0 1.3L16.9 1.5L17.8 2.2L18.6 3.1L19.2 4.0L19.8 4.7L20.5 5.2L21.3 5.3L22.2 5.2L23.3 5.0L24.5 4.9L25.6 5.1L26.4 5.6L26.9 6.4L27.1 7.5L27.0 8.7L26.8 9.8L26.7 10.7L26.8 11.5L27.3 12.2L28.0 12.8L28.9 13.4L29.8 14.2L30.5 15.1L30.7 16.0L30.5 16.9L29.8 17.8L28.9 18.6L28.0 19.2L27.3 19.8L26.8 20.5L26.7 21.3L26.8 22.2L27.0 23.3L27.1 24.5L26.9 25.6L26.4 26.4L25.6 26.9L24.5 27.1L23.3 27.0L22.2 26.8L21.3 26.7L20.5 26.8L19.8 27.3L19.2 28.0L18.6 28.9L17.8 29.8L16.9 30.5L16.0 30.7L15.1 30.5L14.2 29.8L13.4 28.9L12.8 28.0L12.2 27.3L11.5 26.8L10.7 26.7L9.8 26.8L8.7 27.0L7.5 27.1L6.4 26.9L5.6 26.4L5.1 25.6L4.9 24.5L5.0 23.3L5.2 22.2L5.3 21.3L5.2 20.5L4.7 19.8L4.0 19.2L3.1 18.6L2.2 17.8L1.5 16.9L1.3 16.0L1.5 15.1L2.2 14.2L3.1 13.4L4.0 12.8L4.7 12.2L5.2 11.5L5.3 10.7L5.2 9.8L5.0 8.7L4.9 7.5L5.1 6.4L5.6 5.6L6.4 5.1L7.5 4.9L8.7 5.0L9.8 5.2L10.7 5.3L11.5 5.2L12.2 4.7L12.8 4.0L13.4 3.1L14.2 2.2L15.1 1.5Z"/><path class="verified-check" d="m10.6 16.4 3.9 3.9 7-8"/></svg>';

/* Ephemeral Nostr event used only to exchange (encrypted) connection offers. */
const SIGNAL_KIND=25050;

/* Ephemeral (never stored by relays) encrypted presence heartbeat, sent only to my contacts. */
const PRESENCE_KIND=25051;
const PRESENCE_INTERVAL=25000;
const PRESENCE_TTL=65000;
const PRESENCE_MAX_PEERS=60;
const presence={seen:new Map(),ids:new Set(),repliedAt:new Map(),timer:null,sweep:null};

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
let relayHealthTimer=null;
let relayRetryTimer=null;
let relayRetryAttempt=0;
const RELAY_HEALTH_INTERVAL=5000;
const RELAY_RETRY_BASE=2000;
const RELAY_RETRY_MAX=60000;
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
data.pendingReadReceipts=data.pendingReadReceipts||{};

/* An image that was mid-transfer when the app was closed cannot still be sending. */

Object.values(data.messages).forEach(list=>{
 if(Array.isArray(list))list.forEach(m=>{if(m&&m.image&&m.me&&m.st==="sending")m.st="failed";});
});

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
const rel=/^Connected · (\d+)\/(\d+) relays$/.exec(t);
$("status").textContent=rel?"Connected":t;
if($("statusSub"))$("statusSub").textContent=rel?"via "+rel[1]+" relay"+(rel[1]==="1"?"":"s"):"";
$("status").closest(".statusrow").classList.toggle("ok",/^Connected/.test(t));
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

setUsernameStatus("hint","3–20 letters, numbers or _");

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
data.bio="";
$("sheetName").textContent=data.displayName||(data.username?"@"+data.username:"Your profile");

save();
broadcastProfileChanged();

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
queueProfileSync(pk);

}

/* CONTACT PROFILE SYNCHRONIZATION
   Public profile data is fetched in batches from quick-worker. A local cache
   prevents repeated requests. Contact names always follow the person's own public profile. */

const PROFILE_CACHE_TTL=2*60*1000;
const PROFILE_BATCH_SIZE=50;
let profileSyncTimer=null;
let profileSyncRunning=false;
const profileSyncPending=new Set();

/* Contacts can no longer be renamed locally; drop any leftover lock flags from old builds. */
delete data.contactNameOverrides;

function profileNeedsRefresh(pk){
const profile=data.profiles[pk];
return !profile||!profile.checkedAt||Date.now()-profile.checkedAt>PROFILE_CACHE_TTL;
}

function queueProfileSync(pk){
if(!pk||pk===me||!data.contacts[pk]||!navigator.onLine||!profileNeedsRefresh(pk))return;
profileSyncPending.add(pk);
clearTimeout(profileSyncTimer);
profileSyncTimer=setTimeout(()=>syncContactProfiles(),350);
}

function applyContactProfile(pk,profile){
if(!pk||pk===me||!profile||typeof profile.username!=="string")return false;
const username=profile.username.trim().toLowerCase();
if(!/^[a-z0-9_]{2,20}$/.test(username))return false;
const previous=data.profiles[pk]||{};
const displayName=typeof profile.display_name==="string"?profile.display_name.trim().slice(0,50):"";
const bio=typeof profile.bio==="string"?profile.bio.slice(0,300):"";
data.profiles[pk]={...previous,u:username,d:displayName,b:bio,checkedAt:Date.now(),missing:false};

/* The contact's name is always their own public profile name. */
if(data.contacts[pk])data.contacts[pk]=displayName||("@"+username);
return true;
}

async function syncContactProfiles(){
if(!navigator.onLine||profileSyncRunning)return;
for(const pk of Object.keys(data.contacts)){
if(pk!==me&&profileNeedsRefresh(pk))profileSyncPending.add(pk);
}
if(!profileSyncPending.size)return;
profileSyncRunning=true;
let changed=false;
let currentNameChanged=false;
try{
while(profileSyncPending.size&&navigator.onLine){
const batch=Array.from(profileSyncPending).slice(0,PROFILE_BATCH_SIZE);
batch.forEach(pk=>profileSyncPending.delete(pk));
try{
const result=await supabaseRequest(SEARCH_FUNCTION,{public_keys:batch});
const rows=Array.isArray(result.results)?result.results:[];
syncInfo.fetch=Date.now();renderBuildInfo();
const found=new Set();
for(const row of rows){
if(!row||typeof row.public_key!=="string")continue;
const pk=row.public_key.toLowerCase();
if(!batch.includes(pk)||pk===me||!data.contacts[pk])continue;
const previousContactName=data.contacts[pk];
if(applyContactProfile(pk,row)){
found.add(pk);
changed=true;
if(pk===current&&data.contacts[pk]!==previousContactName)currentNameChanged=true;
}
}
/* Cache negative lookups too, so unregistered contacts don't cause request loops. */
for(const pk of batch){
if(pk===me||!data.contacts[pk])continue;
if(!found.has(pk)){
const old=data.profiles[pk]||{};
data.profiles[pk]={...old,checkedAt:Date.now(),missing:true};
changed=true;
}
}
}catch(error){
console.warn("RUSTLE profile sync failed:",error);
}
}
}catch(error){
console.warn("RUSTLE profile sync error:",error);
}finally{
profileSyncRunning=false;
if(profileSyncPending.size&&navigator.onLine){
clearTimeout(profileSyncTimer);
profileSyncTimer=setTimeout(()=>syncContactProfiles(),500);
}
if(changed){
save();
renderList();
if(current&&data.contacts[current]){
setThreadTitle(current);
$("peer").textContent=peerLine(current);
paintAvatar($("tavatar"),current,data.contacts[current]);
if(currentNameChanged||!getMessages(current).length)renderThread();
}
if(!$("csheet").classList.contains("hidden")&&current){
$("csName").textContent=data.contacts[current];
appendVerifiedBadge($("csName"),current);
$("csSub").textContent=subtitleFor(current)||NT.nip19.npubEncode(current).slice(0,16)+"…";
paintAvatar($("csAvatar"),current,data.contacts[current]);
}
}
}
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
refreshAllProfilesNow();

if(data.hideNotice)$("notice").classList.add("hidden");

connect();

if(data.username){

$("usernameInput").value=data.username;

}

if(data.displayName){
$("displayNameInput").value=data.displayName;
}

if(data.bio){
$("bioInput").value=data.bio;
}

onUsernameInput();

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
if(!document.hidden){
connect();
flushReadReceipts();
syncContactProfiles();
if(current)renderThread();
}
});
window.addEventListener("online",()=>{
relayRetryAttempt=0;
if(relayRetryTimer){clearTimeout(relayRetryTimer);relayRetryTimer=null}
connect();
flushReadReceipts();
syncContactProfiles();
});
window.addEventListener("offline",()=>{
status("Offline · messages saved on this device");
});
setInterval(()=>{if(!document.hidden)syncContactProfiles()},PROFILE_CACHE_TTL);

}

/* RELAY CONNECTION */

function relayConnectionSummary(){
if(!pool||typeof pool.listConnectionStatus!=="function")return {connected:0,total:RELAYS.length};
const states=pool.listConnectionStatus();
let connected=0;
RELAYS.forEach(url=>{
let key=url;
try{key=new URL(url).toString()}catch{}
if(states.get(key)===true||states.get(url)===true)connected++;
});
return {connected,total:RELAYS.length};
}

function updateRelayStatus(){
try{refreshPresenceDots()}catch{}
if(!navigator.onLine){
status("Offline · messages saved on this device");
return;
}
const state=relayConnectionSummary();
if(state.connected===state.total){
status("Connected · "+state.connected+"/"+state.total+" relays");
relayRetryAttempt=0;
}else if(state.connected>0){
status("Connected · "+state.connected+"/"+state.total+" relays");
}else if(connecting){
status("Connecting to relays…");
}else{
status("Reconnecting to relays…");
}
}

function scheduleRelayRetry(){
if(!navigator.onLine||relayRetryTimer||connecting)return;
const delay=Math.min(RELAY_RETRY_BASE*Math.pow(2,relayRetryAttempt),RELAY_RETRY_MAX);
relayRetryAttempt=Math.min(relayRetryAttempt+1,8);
relayRetryTimer=setTimeout(()=>{
relayRetryTimer=null;
connect();
},delay);
}

function startRelayHealthMonitor(){
if(relayHealthTimer)clearInterval(relayHealthTimer);
relayHealthTimer=setInterval(()=>{
if(!navigator.onLine)return;
const state=relayConnectionSummary();
updateRelayStatus();
if(state.connected<state.total&&!connecting)scheduleRelayRetry();
},RELAY_HEALTH_INTERVAL);
}

async function connect(){
if(!pool||connecting||!navigator.onLine)return;
if(sub&&(busyImages.size>0||answering.size>0)){
clearTimeout(connect.defer);
connect.defer=setTimeout(()=>connect(),4000);
return;
}
connecting=true;
if(relayRetryTimer){clearTimeout(relayRetryTimer);relayRetryTimer=null}
status("Connecting to relays…");
try{
if(sub){
const previous=sub;
sub=null;
try{await previous.close()}catch{}
}
sub=pool.subscribeMany(
RELAYS,
[
{kinds:[1059],"#p":[me],limit:500},
{kinds:[SIGNAL_KIND],"#p":[me],since:Math.floor(Date.now()/1000)-120,limit:100},
{kinds:[PRESENCE_KIND],"#p":[me],since:Math.floor(Date.now()/1000)-90,limit:100},
{kinds:[4],"#p":[me],limit:500},
{kinds:[4],authors:[me],limit:500}
],
{
onevent:onRelayEvent,
oneose(){
updateRelayStatus();
flushReadReceipts();
},
onclose(){
if(!connecting){
updateRelayStatus();
scheduleRelayRetry();
}
}
}
);
watchRelayAuth();
startRelayHealthMonitor();
startPresence();
}catch(error){
console.warn("RUSTLE relay connection attempt failed:",error);
scheduleRelayRetry();
}finally{
connecting=false;
updateRelayStatus();
}
}

/* PRIVATE MESSAGES (NIP-17: rumor -> seal -> gift wrap) */

const MAX_MESSAGE=4000;
const wrapSeen=new Set();
let reauthTimer=null;

/* ------------------------------------------------------------------
   IMAGES - direct device-to-device transfer
   The photo is encrypted on your phone with a random AES-256-GCM key and
   sent over a WebRTC data channel straight to your friend's phone. Nothing
   is uploaded to any server. A TURN relay (credentials come from your
   Supabase function) only forwards already-encrypted packets so the
   connection also works between two mobile-data (4G/5G) networks.
   Nostr relays carry only the encrypted connection offer/answer.
   Both people must have RUSTLE open on screen during the transfer.
------------------------------------------------------------------- */

const IMAGE_MAX_BYTES=30*1024*1024;
const IMAGE_CHUNK=16*1024;
const IMAGE_TYPES=["image/jpeg","image/png"];
const busyImages=new Set();
const imgState=new Map();
const urlCache=new Map();
const rtcPeers=new Map();
const acks=new Map();
const signalSeen=new Set();
const answering=new Set();
let iceCache=null;

const imageDbPromise=new Promise((resolve,reject)=>{
 const req=indexedDB.open("rustle-local-files-v1",1);
 req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains("images"))req.result.createObjectStore("images")};
 req.onsuccess=()=>resolve(req.result);
 req.onerror=()=>reject(req.error);
});
imageDbPromise.catch(()=>{});

async function putLocalImage(id,blob){
 const idb=await imageDbPromise;
 return new Promise((resolve,reject)=>{
  const tx=idb.transaction("images","readwrite");
  tx.objectStore("images").put(blob,id);
  tx.oncomplete=()=>resolve();
  tx.onerror=()=>reject(tx.error);
  tx.onabort=()=>reject(tx.error||Error("Storage write was aborted."));
 });
}

async function getLocalImage(id){
 const idb=await imageDbPromise;
 return new Promise((resolve,reject)=>{
  const req=idb.transaction("images","readonly").objectStore("images").get(id);
  req.onsuccess=()=>resolve(req.result||null);
  req.onerror=()=>reject(req.error);
 });
}

async function deleteLocalImage(id){
 const idb=await imageDbPromise;
 return new Promise((resolve,reject)=>{
  const tx=idb.transaction("images","readwrite");
  tx.objectStore("images").delete(id);
  tx.oncomplete=()=>resolve();
  tx.onerror=()=>reject(tx.error);
 });
}

function b64(bytes){
 let s="";
 for(let i=0;i<bytes.length;i+=0x8000)s+=String.fromCharCode.apply(null,bytes.subarray(i,i+0x8000));
 return btoa(s);
}

function unb64(s){
 const raw=atob(s),out=new Uint8Array(raw.length);
 for(let i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i);
 return out;
}

function sniffType(b){
 if(b.length>=3&&b[0]===0xFF&&b[1]===0xD8&&b[2]===0xFF)return"image/jpeg";
 if(b.length>=8&&b[0]===0x89&&b[1]===0x50&&b[2]===0x4E&&b[3]===0x47&&b[4]===0x0D&&b[5]===0x0A&&b[6]===0x1A&&b[7]===0x0A)return"image/png";
 return null;
}

function cleanName(n){
 return String(n||"image").replace(/[\u0000-\u001f<>:"\/\\|?*]/g,"_").slice(0,120)||"image";
}

function objectUrl(rid,blob){
 let u=urlCache.get(rid);
 if(!u){u=URL.createObjectURL(blob);urlCache.set(rid,u);}
 return u;
}

function setProg(rid,text){
 if(text)imgState.set(rid,text);else imgState.delete(rid);
 document.querySelectorAll('.image-caption[data-rid="'+rid+'"]').forEach(n=>{n.textContent=text||n.dataset.base;});
}

function refresh(peer){
 renderList();
 if(current===peer)renderThread();
}

async function aesEncrypt(blob,keyB64,ivB64){
 const key=await crypto.subtle.importKey("raw",unb64(keyB64),{name:"AES-GCM"},false,["encrypt"]);
 const plain=await blob.arrayBuffer();
 return new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv:unb64(ivB64)},key,plain));
}

async function aesDecrypt(bytes,keyB64,ivB64){
 const key=await crypto.subtle.importKey("raw",unb64(keyB64),{name:"AES-GCM"},false,["decrypt"]);
 return new Uint8Array(await crypto.subtle.decrypt({name:"AES-GCM",iv:unb64(ivB64)},key,bytes));
}

function withTimeout(p,ms,message){
 return new Promise((resolve,reject)=>{
  const t=setTimeout(()=>reject(Error(message)),ms);
  p.then(v=>{clearTimeout(t);resolve(v);},e=>{clearTimeout(t);reject(e);});
 });
}

/* Waits for whichever finishes first, without leaving an unhandled rejection behind. */

function raceOf(a,b){
 a.catch(()=>{});
 b.catch(()=>{});
 return Promise.race([a,b]);
}

async function drain(channel){
 let waited=0;
 while(channel.bufferedAmount>1024*1024){
  if(channel.readyState!=="open")throw Error("Connection closed during the transfer.");
  await new Promise(r=>setTimeout(r,40));
  waited+=40;
  if(waited>60000)throw Error("The transfer stalled.");
 }
 if(channel.readyState!=="open")throw Error("Connection closed during the transfer.");
}

/* TURN credentials come from the Supabase function so the real key never reaches the browser. */

async function getIceServers(){

 if(iceCache&&Date.now()<iceCache.until)return iceCache.list;

 let list=[{urls:"stun:stun.l.google.com:19302"}];
 let ttl=60*1000;

 try{
  const r=await withTimeout(supabaseRequest(TURN_FUNCTION,{}),8000,"TURN lookup timed out.");
  const extra=(Array.isArray(r.iceServers)?r.iceServers:[]).filter(s=>
   s&&typeof s==="object"&&(typeof s.urls==="string"||Array.isArray(s.urls))
  );
  if(extra.length){
   list=list.concat(extra);
   ttl=10*60*1000;
  }
 }catch(e){
  console.warn("RUSTLE TURN credentials unavailable:",e);
 }

 iceCache={list,until:Date.now()+ttl};

 return list;

}

function waitIceComplete(pc){
 if(pc.iceGatheringState==="complete")return Promise.resolve();
 return new Promise(resolve=>{
  let done=false;
  const finish=()=>{
   if(done)return;
   done=true;
   clearTimeout(timer);
   pc.removeEventListener("icegatheringstatechange",check);
   resolve();
  };
  const check=()=>{if(pc.iceGatheringState==="complete")finish();};
  const timer=setTimeout(finish,10000);
  pc.addEventListener("icegatheringstatechange",check);
 });
}

function closePeer(peer){
 const st=rtcPeers.get(peer);
 rtcPeers.delete(peer);
 if(!st)return;
 try{if(st.channel)st.channel.close();}catch{}
 try{st.pc.close();}catch{}
}

/* Called when a connection ends by itself. */

function closePeerIf(peer,st,message){
 if(rtcPeers.get(peer)!==st)return;
 rtcPeers.delete(peer);
 try{st.pc.close();}catch{}
 for(const [id,w] of acks){
  if(w.peer===peer){
   acks.delete(id);
   w.reject(Error(message||"The connection closed before your friend confirmed the image."));
  }
 }
}

function makeRtc(peer,iceServers){
 const pc=new RTCPeerConnection({iceServers});
 const st={pc,channel:null,receiving:null,role:"",sid:"",relay:false,onAnswer:null,onOpen:null,onFail:null};
 rtcPeers.set(peer,st);
 pc.onconnectionstatechange=()=>{
  if(pc.connectionState==="failed"){
   if(st.onFail)st.onFail(Error("The direct connection failed."+(st.relay?"":" The relay server was unavailable, so some mobile networks cannot connect.")));
   closePeerIf(peer,st,"The direct connection failed.");
  }else if(pc.connectionState==="closed"){
   closePeerIf(peer,st);
  }
 };
 pc.ondatachannel=e=>attachImageChannel(peer,st,e.channel);
 return st;
}

async function sendSignal(peer,payload){
 const content=NT.nip44.encrypt(JSON.stringify(payload),convKey(sk,peer));
 const event=NT.finalizeEvent({kind:SIGNAL_KIND,created_at:Math.floor(Date.now()/1000),tags:[["p",peer]],content},sk);
 const sends=pool.publish(RELAYS,event);
 sends.forEach(p=>Promise.resolve(p).catch(()=>{}));
 try{
  await withTimeout(Promise.any(sends),12000,"timeout");
 }catch{
  throw Error("Could not reach any relay to start the connection. Check your internet.");
 }
}

async function receiveSignal(ev){

 if(!ev||ev.kind!==SIGNAL_KIND||!NT||!sk||ev.pubkey===me)return;

 if(signalSeen.has(ev.id))return;
 signalSeen.add(ev.id);

 if(Math.abs(Date.now()/1000-ev.created_at)>120)return;

 if(!(ev.tags||[]).some(t=>t[0]==="p"&&t[1]===me))return;

 /* only people already in my chat list may open a connection to this phone */

 if(!data.contacts[ev.pubkey])return;

 try{

  if(!NT.verifyEvent(ev))return;

  const payload=JSON.parse(NT.nip44.decrypt(ev.content,convKey(sk,ev.pubkey)));

  if(!payload||payload.v!==1||typeof payload.sid!=="string"||!/^[0-9a-f]{16}$/.test(payload.sid))return;

  if(payload.type==="offer"){
   await answerImagePeer(ev.pubkey,payload.sid,payload.sdp);
  }else if(payload.type==="answer"){
   const st=rtcPeers.get(ev.pubkey);
   if(st&&st.role==="offerer"&&st.sid===payload.sid&&st.pc.signalingState==="have-local-offer"){
    await st.pc.setRemoteDescription(payload.sdp);
    if(st.onAnswer)st.onAnswer();
   }
  }

 }catch(e){
  console.warn("RUSTLE image signaling:",e);
 }

}

async function answerImagePeer(peer,sid,offer){

 const old=rtcPeers.get(peer);

 if(old&&old.sid===sid)return;

 if(answering.has(sid))return;

 /* both sides offered at the same moment: the lower key keeps its own offer */

 if(old&&old.role==="offerer"&&old.pc.signalingState==="have-local-offer"&&me<peer)return;

 answering.add(sid);

 try{

  closePeer(peer);

  const iceServers=await getIceServers();

  const st=makeRtc(peer,iceServers);
  st.role="answerer";
  st.sid=sid;

  await st.pc.setRemoteDescription(offer);

  const answer=await st.pc.createAnswer();
  await st.pc.setLocalDescription(answer);

  await waitIceComplete(st.pc);

  st.relay=/ typ relay/.test(st.pc.localDescription.sdp);

  await sendSignal(peer,{v:1,type:"answer",sid,sdp:st.pc.localDescription});

 }finally{

  setTimeout(()=>answering.delete(sid),30000);

 }

}

function attachImageChannel(peer,st,channel){

 st.channel=channel;
 channel.binaryType="arraybuffer";

 channel.onopen=()=>{if(st.onOpen)st.onOpen();};

 channel.onclose=()=>closePeerIf(peer,st);

 channel.onmessage=e=>{
  handleChannelMessage(peer,st,e).catch(err=>{
   console.error("RUSTLE image receive:",err);
   st.receiving=null;
  });
 };

}

async function handleChannelMessage(peer,st,e){

 if(typeof e.data==="string"){

  const m=JSON.parse(e.data);

  if(m.type==="image-ok"){
   const w=acks.get(m.id);
   if(w){acks.delete(m.id);w.resolve();}
   return;
  }

  if(m.type==="image-err"){
   const w=acks.get(m.id);
   if(w){acks.delete(m.id);w.reject(Error(String(m.message||"Your friend could not receive the image.").slice(0,160)));}
   return;
  }

  if(m.type==="image-start"){

   if(!data.contacts[peer])throw Error("Unknown sender.");

   if(!/^[0-9a-f]{32}$/.test(m.id||""))throw Error("Invalid image transfer.");

   if(!Number.isInteger(m.size)||m.size<17||m.size>IMAGE_MAX_BYTES+16)throw Error("Invalid image size.");

   if(typeof m.key!=="string"||typeof m.iv!=="string"||unb64(m.key).length!==32||unb64(m.iv).length!==12)throw Error("Invalid image key.");

   st.receiving={id:m.id,name:cleanName(m.name),size:m.size,key:m.key,iv:m.iv,chunks:[],received:0};

   return;

  }

  if(m.type==="image-end"){

   const r=st.receiving;

   if(!r||r.id!==m.id)return;

   st.receiving=null;

   try{

    if(r.received!==r.size)throw Error("The image arrived incomplete.");

    if(!(await getLocalImage(r.id))){

     const enc=new Uint8Array(r.size);
     let off=0;
     for(const c of r.chunks){const b=new Uint8Array(c);enc.set(b,off);off+=b.length;}
     r.chunks=null;

     let plain;

     try{
      plain=await aesDecrypt(enc,r.key,r.iv);
     }catch{
      throw Error("The image could not be decrypted.");
     }

     const type=sniffType(plain);

     if(!type)throw Error("The file is not a JPG or PNG image.");

     await putLocalImage(r.id,new Blob([plain],{type}));

     insertMessage(peer,{
      id:r.id,
      me:false,
      text:"📷 Photo",
      t:Math.floor(Date.now()/1000),
      st:"ok",
      image:{rid:r.id,name:r.name,type,size:plain.length}
     });

     if(peer!==current){
      data.unread[peer]=(data.unread[peer]||0)+1;
      save();
      renderList();
     }

    }

    st.channel.send(JSON.stringify({type:"image-ok",id:r.id}));

   }catch(err){

    try{st.channel.send(JSON.stringify({type:"image-err",id:r.id,message:err.message||"Could not receive the image."}));}catch{}

    throw err;

   }

   return;

  }

  return;

 }

 const r=st.receiving;

 if(!r)return;

 r.chunks.push(e.data);
 r.received+=e.data.byteLength;

 if(r.received>r.size){
  st.receiving=null;
  throw Error("Image exceeds the expected size.");
 }

}

async function openImageChannel(peer,rid){

 const cur=rtcPeers.get(peer);

 if(cur&&cur.channel&&cur.channel.readyState==="open"&&cur.pc.connectionState==="connected")return cur.channel;

 closePeer(peer);

 setProg(rid,"Preparing secure connection…");

 const iceServers=await getIceServers();

 const st=makeRtc(peer,iceServers);
 st.role="offerer";
 st.sid=hex(crypto.getRandomValues(new Uint8Array(8)));

 const channel=st.pc.createDataChannel("rustle-images",{ordered:true});

 attachImageChannel(peer,st,channel);

 const answered=new Promise(resolve=>{st.onAnswer=resolve;});
 const opened=new Promise(resolve=>{st.onOpen=resolve;if(channel.readyState==="open")resolve();});
 const failed=new Promise((_,reject)=>{st.onFail=reject;});

 const offer=await st.pc.createOffer();
 await st.pc.setLocalDescription(offer);

 setProg(rid,"Connecting…");

 await waitIceComplete(st.pc);

 st.relay=/ typ relay/.test(st.pc.localDescription.sdp);

 await sendSignal(peer,{v:1,type:"offer",sid:st.sid,sdp:st.pc.localDescription});

 setProg(rid,"Waiting for your friend's app…");

 await raceOf(
  withTimeout(answered,30000,"No answer. Your friend must have RUSTLE open on screen. Ask them to open it, then tap Retry."),
  failed
 );

 setProg(rid,"Connecting directly…");

 await raceOf(
  withTimeout(opened,40000,"Could not connect directly."+(st.relay?" Try again, or switch networks.":" The relay server was unavailable, so some mobile networks cannot connect.")),
  failed
 );

 return channel;

}

async function sendImage(file){

 if(!current||!NT||!pool)return;

 if(file.size<1||file.size>IMAGE_MAX_BYTES){
  status("Image must be 30 MB or smaller.");
  toast("Image must be 30 MB or smaller.");
  return;
 }

 let type=null;

 try{
  type=sniffType(new Uint8Array(await file.slice(0,8).arrayBuffer()));
 }catch{}

 if(!type){
  status("Choose a JPG or PNG image.");
  toast("Choose a JPG or PNG image.");
  return;
 }

 const peer=current;
 const rid=hex(crypto.getRandomValues(new Uint8Array(16)));

 try{
  await putLocalImage(rid,file);
 }catch{
  status("Could not store the image on this device.");
  return;
 }

 insertMessage(peer,{
  id:rid,
  me:true,
  text:"📷 Photo",
  t:Math.floor(Date.now()/1000),
  st:"sending",
  image:{rid,name:cleanName(file.name),type,size:file.size}
 });

 transferImage(peer,rid);

}

/* Connects, encrypts, sends and waits until the other phone confirms it saved the image.
   Safe to call again (Retry) after a failure. */

async function transferImage(peer,msgId){

 const first=getMessages(peer).find(x=>x.id===msgId);

 if(!first||!first.image||!NT||!pool)return;

 const rid=first.image.rid||first.image.id;

 if(busyImages.has(rid))return;

 busyImages.add(rid);

 let failText="";

 try{

  first.st="sending";
  save();
  refresh(peer);

  const blob=await getLocalImage(rid);

  if(!blob)throw Error("The original image is no longer stored on this device.");

  const channel=await openImageChannel(peer,rid);

  setProg(rid,"Encrypting…");

  const key=b64(crypto.getRandomValues(new Uint8Array(32)));
  const iv=b64(crypto.getRandomValues(new Uint8Array(12)));

  const enc=await aesEncrypt(blob,key,iv);

  const ack=new Promise((resolve,reject)=>acks.set(rid,{resolve,reject,peer}));
  ack.catch(()=>{});

  channel.send(JSON.stringify({
   type:"image-start",
   id:rid,
   name:first.image.name,
   size:enc.length,
   key,
   iv
  }));

  for(let off=0;off<enc.length;off+=IMAGE_CHUNK){
   await drain(channel);
   channel.send(enc.slice(off,Math.min(off+IMAGE_CHUNK,enc.length)));
   if((off/IMAGE_CHUNK)%64===0)setProg(rid,"Sending "+Math.round(off/enc.length*100)+"%");
  }

  channel.send(JSON.stringify({type:"image-end",id:rid}));

  setProg(rid,"Waiting for confirmation…");

  await withTimeout(ack,60000,"Your friend's phone did not confirm the image. Tap Retry.");

  const m=getMessages(peer).find(x=>x.id===msgId);

  if(m){
   m.st="ok";
   save();
  }

 }catch(e){

  failText=e.message||"Image transfer failed.";

  acks.delete(rid);

  closePeer(peer);

  const m=getMessages(peer).find(x=>x.id===msgId);

  if(m){
   m.st="failed";
   save();
  }

 }finally{

  busyImages.delete(rid);

  setProg(rid,failText?"⚠ "+failText:"");

  refresh(peer);

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

/* Read receipts are ordinary NIP-17 gift-wrapped messages. The receipt
   payload is encrypted to the conversation peer and its inner seal is
   signed by the reader's Nostr identity. */
const readReceiptInflight=new Set();

function queueReadReceipt(peer,message){
if(!peer||!message||message.me||message.receiptSent)return;
message.receiptSent=true;
const key=peer+":"+message.id;
data.pendingReadReceipts[key]={peer,messageId:message.id};
save();
flushReadReceipts();
}

async function flushReadReceipts(){
if(!pool||!NT||!sk||!navigator.onLine)return;
for(const [key,item] of Object.entries(data.pendingReadReceipts||{})){
if(readReceiptInflight.has(key))continue;
if(!item||!/^[0-9a-f]{64}$/.test(item.peer||"")||item.peer===me)continue;
readReceiptInflight.add(key);
try{
const rumor={
kind:14,
created_at:Math.floor(Date.now()/1000),
tags:[["p",item.peer]],
content:JSON.stringify({
protocol:"rustle-read-receipt",
version:1,
message_id:item.messageId,
recipient:item.peer
}),
pubkey:me
};
rumor.id=NT.getEventHash(rumor);
const wrapped=wrapFor(rumor,item.peer);
await Promise.any(pool.publish(RELAYS,wrapped));
delete data.pendingReadReceipts[key];
save();
}catch(error){
/* Keep it queued; reconnect/online handling will retry. */
}finally{
readReceiptInflight.delete(key);
}
}
}

function receiveReadReceipt(rumor,peer){
let receipt;
try{receipt=JSON.parse(rumor.content)}catch{return false}
if(!receipt||receipt.protocol!=="rustle-read-receipt"||receipt.version!==1)return false;
if(receipt.recipient!==me||typeof receipt.message_id!=="string")return true;
if(!/^(?:[0-9a-f]{64}|[0-9a-f]{32})$/.test(receipt.message_id))return true;
const original=getMessages(peer).find(m=>m&&m.me&&m.id===receipt.message_id);
if(original&&!original.seen){
original.seen=true;
save();
if(current===peer)renderThread();
}
return true;
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

/* Read receipts are control messages, never visible chat messages.
   The inner rumor is authenticated by the verified NIP-17 seal above. */
if(!mine&&receiveReadReceipt(rumor,peer))return;

/* already have it (retry, or the copy I sent to myself) */

if(getMessages(peer).some(x=>x.id===rumor.id))return;

/* skip messages from before the user cleared this chat */
if(rumor.created_at<=((data.clearedAt&&data.clearedAt[peer])||0))return;

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
else if(ev&&ev.kind===PRESENCE_KIND)receivePresence(ev);
else receive(ev);

}

/* Some relays only hand over private messages after the client proves its identity (NIP-42). */

function watchRelayAuth(){

if(!pool||!NT||!sk||typeof pool.ensureRelay!=="function")return;

RELAYS.forEach(url=>{

Promise.resolve(pool.ensureRelay(url)).then(r=>{

if(!r||typeof r.auth!=="function")return;

r.onclose=()=>{
r.__authed=false;
if(!connecting){
updateRelayStatus();
scheduleRelayRetry();
}
};

const doAuth=async()=>{

if(r.__authed)return;

r.__authed=true;

try{

await r.auth(async e=>NT.finalizeEvent(e,sk));

/* Authentication is handled on the existing socket. Do not rebuild the
   global subscription here; doing so can create subscription churn. */
clearTimeout(reauthTimer);

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

/* skip messages from before the user cleared this chat */
if(ev.created_at<=((data.clearedAt&&data.clearedAt[peer])||0))return;

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

function normalizeRustlePubkey(value){
if(!value||!NT)return null;
try{
const raw=String(value).trim().toLowerCase();
if(/^[0-9a-f]{64}$/.test(raw))return raw;
const decoded=NT.nip19.decode(raw);
if(decoded.type==="npub"&&typeof decoded.data==="string")return decoded.data.toLowerCase();
return null;
}catch{return null;}
}

function isRustleVerified(pk){
const candidate=normalizeRustlePubkey(pk);
if(!candidate)return false;
return RUSTLE_VERIFIED_USERS.some(entry=>
normalizeRustlePubkey(entry.npub)===candidate
);
}

function verifiedBadge(){
const wrap=el("span","verified-badge-wrap");
const button=el("button","verified-badge");
button.type="button";
button.setAttribute("aria-label",VERIFIED_BADGE_TITLE);
button.setAttribute("aria-expanded","false");
button.title=VERIFIED_BADGE_TITLE;
button.innerHTML=VERIFIED_SEAL_SVG;
const tip=el("span","verified-tooltip");
tip.setAttribute("role","tooltip");
const icon=el("span","verified-tooltip-icon");
icon.innerHTML=VERIFIED_SEAL_SVG;
const copy=el("span","verified-tooltip-copy");
copy.append(el("strong",null,VERIFIED_BADGE_TITLE),el("span",null,VERIFIED_BADGE_MESSAGE));
tip.append(icon,copy);
button.addEventListener("click",e=>{
e.stopPropagation();
const open=wrap.classList.toggle("is-open");
button.setAttribute("aria-expanded",String(open));
if(open){
/* keep the info card inside the viewport on narrow screens */
tip.style.removeProperty("--tip-dx");
const r=tip.getBoundingClientRect();
const m=8;
let dx=0;
if(r.left<m)dx=m-r.left;
else if(r.right>window.innerWidth-m)dx=window.innerWidth-m-r.right;
if(dx)tip.style.setProperty("--tip-dx",Math.round(dx)+"px");
}
});
wrap.append(button,tip);
return wrap;
}

function appendVerifiedBadge(node,pk){
if(!node)return;
const verified=isRustleVerified(pk);
if(node.id==="title"){
const existing=node.querySelector(":scope > .verified-badge-wrap");
if(!verified){if(existing)existing.remove();return;}
if(!existing)node.append(verifiedBadge());
return;
}
/* Reused containers (contact sheet) must not keep a previous contact's badge. */
const next=node.nextElementSibling;
const hasBadge=!!(next&&next.classList.contains("verified-badge-wrap"));
if(!verified){if(hasBadge)next.remove();return;}
if(hasBadge)return;
node.after(verifiedBadge());
}

/* Conversation header title: name text (can truncate) + independent verified badge. */
function setThreadTitle(pk){
const t=$("title");
if(!t||!pk)return;
t.textContent="";
const name=el("span","tname",data.contacts[pk]||"");
name.setAttribute("role","button");
name.setAttribute("tabindex","0");
name.setAttribute("aria-label","Open contact profile");
t.append(name);
appendVerifiedBadge(t,pk);
}

document.addEventListener("click",e=>{
document.querySelectorAll(".verified-badge-wrap.is-open").forEach(w=>{
if(w.contains(e.target))return;
w.classList.remove("is-open");
w.querySelector(".verified-badge")?.setAttribute("aria-expanded","false");
});
});

/* UI HELPERS */

function el(tag,cls,text){
const n=document.createElement(tag);
if(cls)n.className=cls;
if(text!=null)n.textContent=text;
return n;
}

function paintAvatar(n,pk,name){
const h=240+(parseInt((pk||"000000").slice(0,6),16)%44);
n.style.background="hsl("+h+" 30% 41%)";
n.textContent=initials(String(name||"?").replace(/^@/,""));
n.dataset.pk=pk||"";
if(pk&&isOnline(pk))n.append(el("i","online-dot"));
}

function renderMe(){
const b=$("me");
if(!b)return;
paintAvatar(b,me,data.displayName||data.username||"Me");
b.title=data.username?"@"+data.username:"My profile";
if($("sheetAvatar")){
paintAvatar($("sheetAvatar"),me,data.displayName||data.username||"Me");
$("sheetName").textContent=data.displayName||(data.username?"@"+data.username:"Your profile");
appendVerifiedBadge($("sheetName"),me);
$("sheetUser").textContent=data.username&&data.displayName?"@"+data.username:"";
}
}

function group(t){return el("div","group",t)}

function bigIcon(path){
return '<svg width="68" height="68" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+path+'</svg>';
}

let homeListScrollTop=0;

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

/* Name line for list rows: truncating name text + non-interactive verified badge
   (taps pass through to the row). */
function nameLine(text,pk){
const n=el("div","n nline");
n.append(el("span","nm",text));
if(isRustleVerified(pk)){
const wrap=verifiedBadge();
const btn=wrap.querySelector("button");
if(btn){btn.tabIndex=-1;btn.setAttribute("aria-hidden","true");}
n.append(wrap);
}
return n;
}

function personRow(pk,title,sub,btn,onclick){
const row=el("div","row");
const av=el("div","avatar");
paintAvatar(av,pk,title);
const main=el("div","ctmain");
main.append(nameLine(title,pk),el("div","p",sub));
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

if(!old){
data.contacts[pk]=p.display_name||(p.username?"@"+p.username:"Friend "+pk.slice(0,6));
}
if(p.username)applyContactProfile(pk,p);

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
nameLine(data.contacts[pk],pk),
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

const d=stateBlock(ICON_CHATS,"No conversations yet","Find your friends by their unique @username.","Search People",()=>$("tabSearch").click());

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
queueProfileSync(pk);

$("searchPanel").classList.add("hidden");
$("home").classList.remove("search-mode");
current=pk;

data.unread[pk]=0;

save();

const pr=data.profiles[pk]||{};

setThreadTitle(pk);
closeChatMenu();

$("peer").textContent=peerLine(pk);

paintAvatar($("tavatar"),pk,data.contacts[pk]);

hide("home");
show("thread");

renderThread();
flushReadReceipts();

// Do not open the Android keyboard just because a conversation was opened.
// It can resize the viewport before the message list has finished laying out.

}

/* Mark an incoming message as read only after at least 60% of its
   bubble is visible in the active conversation while the app is foregrounded. */
let readMessageObserver=null;

function observeIncomingMessage(node,peer,message){
if(message.me||message.receiptSent||typeof IntersectionObserver==="undefined")return;
if(!readMessageObserver){
readMessageObserver=new IntersectionObserver(entries=>{
for(const entry of entries){
if(!entry.isIntersecting||entry.intersectionRatio<0.6||document.hidden)continue;
const target=entry.target;
const msg=target.__rustleMessage;
const targetPeer=target.dataset.peer;
if(current===targetPeer&&msg&&!msg.me){
readMessageObserver.unobserve(target);
queueReadReceipt(targetPeer,msg);
}
}
},{root:$("sc"),threshold:[0.6]});
}
node.dataset.peer=peer;
node.__rustleMessage=message;
readMessageObserver.observe(node);
}

/* RENDER CHAT */

function saveSharedImage(rid,name){
 return getLocalImage(rid).then(blob=>{if(!blob){toast("Original image is not available on this device.");return;}const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name||"rustle-image";document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);toast("Photo saved to your downloads.");}).catch(()=>toast("Could not save this photo."));
}
async function shareSharedImage(rid,name){
 try{const blob=await getLocalImage(rid);if(!blob){toast("Original image is not available on this device.");return;}const file=new File([blob],name||"rustle-image",{type:blob.type||"image/jpeg"});if(navigator.canShare&&navigator.canShare({files:[file]}))await navigator.share({files:[file],title:name||"RUSTLE photo"});else if(navigator.share)await navigator.share({title:name||"RUSTLE photo",url:location.href});else await saveSharedImage(rid,name);}catch(e){if(e.name!=="AbortError")toast("Sharing isn't available here.");}
}
function openImageViewer(src,name,rid){
 let v=document.getElementById("imageViewer");if(!v){v=document.createElement("div");v.id="imageViewer";v.className="image-viewer hidden";v.setAttribute("role","dialog");v.setAttribute("aria-modal","true");v.setAttribute("aria-label","Photo viewer");v.innerHTML='<div class="viewer-top"><span class="viewer-name"></span><button class="viewer-close" type="button" aria-label="Close photo">×</button></div><div class="viewer-stage"><img alt=""></div><div class="viewer-actions"><button class="image-action" type="button" data-viewer-save><svg viewBox="0 0 24 24"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 17v3h14v-3"/></svg><span>Save photo</span></button><button class="image-action" type="button" data-viewer-share><svg viewBox="0 0 24 24"><path d="M12 16V3m0 0L7 8m5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg><span>Share</span></button></div>';document.body.append(v);v.querySelector(".viewer-close").onclick=()=>closeImageViewer(v);v.addEventListener("click",e=>{if(e.target===v)closeImageViewer(v)});v.querySelector("[data-viewer-save]").onclick=()=>saveSharedImage(v.dataset.rid,v.dataset.name);v.querySelector("[data-viewer-share]").onclick=()=>shareSharedImage(v.dataset.rid,v.dataset.name);document.addEventListener("keydown",e=>{if(e.key==="Escape")closeImageViewer(v)});setupPhotoGestures(v);}
 v.dataset.rid=rid;v.dataset.name=name;v.querySelector(".viewer-name").textContent=name;v.querySelector(".viewer-stage img").src=src;v.querySelector(".viewer-stage img").alt=name;resetPhotoZoom(v);v.classList.remove("hidden");
}

function closeImageViewer(v){v.classList.add("hidden");resetPhotoZoom(v)}
function resetPhotoZoom(v){const img=v.querySelector(".viewer-stage img");img.style.transform="translate3d(0,0,0) scale(1)";img.dataset.scale="1";img.dataset.x="0";img.dataset.y="0"}
function setupPhotoGestures(v){
 const stage=v.querySelector(".viewer-stage"),img=stage.querySelector("img");let startDistance=0,startScale=1,baseX=0,baseY=0,lastTap=0,panX=0,panY=0;
 const pointDistance=t=>Math.hypot(t[0].clientX-t[1].clientX,t[0].clientY-t[1].clientY);
 const apply=()=>{img.style.transform=`translate3d(${baseX}px,${baseY}px,0) scale(${startScale})`;img.dataset.scale=String(startScale);img.dataset.x=String(baseX);img.dataset.y=String(baseY)};
 stage.addEventListener("touchstart",e=>{if(e.touches.length===2){startDistance=pointDistance(e.touches);startScale=Number(img.dataset.scale||1);baseX=Number(img.dataset.x||0);baseY=Number(img.dataset.y||0)}else if(e.touches.length===1){panX=e.touches[0].clientX;panY=e.touches[0].clientY;const now=Date.now();if(now-lastTap<280){startScale=Number(img.dataset.scale||1)>1?1:2.5;baseX=0;baseY=0;apply()}lastTap=now;}},{passive:true});
 stage.addEventListener("touchmove",e=>{if(e.touches.length===2&&startDistance){e.preventDefault();startScale=Math.max(1,Math.min(4,startScale*pointDistance(e.touches)/startDistance));startDistance=pointDistance(e.touches);apply()}else if(e.touches.length===1&&Number(img.dataset.scale||1)>1){e.preventDefault();baseX+=e.touches[0].clientX-panX;baseY+=e.touches[0].clientY-panY;panX=e.touches[0].clientX;panY=e.touches[0].clientY;startScale=Number(img.dataset.scale||1);apply()}},{passive:false});
 stage.addEventListener("touchend",()=>{startDistance=0},{passive:true});
}

function scrollThreadToLatest(behavior="auto"){
const sc=$("sc");
if(!sc)return;
const move=()=>{sc.scrollTop=sc.scrollHeight;};
// Wait for layout to settle so the newest message is visible on first open.
requestAnimationFrame(()=>{move();requestAnimationFrame(move);});
}

function renderThread(){

if(!current)return;
if(readMessageObserver){readMessageObserver.disconnect();readMessageObserver=null;}

const box=$("msgs");

box.textContent="";

const list=getMessages(current);

let lastDay="";

if(!list.length){

const d=el("div","intro");

const pr=data.profiles[current]||{};

const av=el("div","avatar lg");
paintAvatar(av,current,data.contacts[current]);

const introName=el("div","introname",data.contacts[current]);
const introRow=el("div","name-row");
introRow.append(introName);
d.append(av,introRow);
appendVerifiedBadge(introName,current);

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

 const im=m.image;
 const rid=im.rid||im.id;

 const img=document.createElement("img");
 img.className="shared-image hidden";
 img.alt=im.name||"Shared image";

 const holder=document.createElement("div");
 holder.className="image-ph";
 holder.textContent="Loading…";

 d.append(img,holder);

 const base=(im.name||"image")+" · "+(im.size/1024/1024).toFixed(2)+" MB";
 const caption=document.createElement("div");
 caption.className="image-caption";
 caption.dataset.rid=rid;
 caption.dataset.base=base;
 caption.textContent=imgState.get(rid)||base;
 d.append(caption);

 const actions=document.createElement("div");
 actions.className="image-actions hidden";
 const saveBtn=document.createElement("button");saveBtn.className="image-action";saveBtn.type="button";
 saveBtn.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 17v3h14v-3"/></svg><span>Save</span>';
 saveBtn.setAttribute("aria-label","Save photo");saveBtn.onclick=()=>saveSharedImage(rid,im.name);
 const shareBtn=document.createElement("button");shareBtn.className="image-action";shareBtn.type="button";
 shareBtn.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V3m0 0L7 8m5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg><span>Share</span>';
 shareBtn.setAttribute("aria-label","Share photo");shareBtn.onclick=()=>shareSharedImage(rid,im.name);
 const viewBtn=document.createElement("button");viewBtn.className="image-action";viewBtn.type="button";
 viewBtn.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9V4h5m8 0h5v5M3 15v5h5m8 0h5v-5"/></svg><span>View</span>';
 viewBtn.setAttribute("aria-label","View photo full screen");viewBtn.onclick=()=>openImageViewer(img.src,im.name||"Shared photo",rid);
 actions.append(saveBtn,shareBtn,viewBtn);d.append(actions);
 img.addEventListener("click",()=>openImageViewer(img.src,im.name||"Shared photo",rid));
 img.setAttribute("role","button");img.setAttribute("tabindex","0");img.setAttribute("aria-label","Open photo: "+(im.name||"Shared image"));
 img.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();openImageViewer(img.src,im.name||"Shared photo",rid);}});

 getLocalImage(rid).then(blob=>{
  if(!d.isConnected)return;
  if(blob){
   img.src=objectUrl(rid,blob);
   img.addEventListener("load",()=>{if(current&&d.isConnected){const sc=$("sc");if(sc&&sc.scrollHeight-sc.scrollTop-sc.clientHeight<120)scrollThreadToLatest();}},{once:true});
   img.classList.remove("hidden");
   actions.classList.remove("hidden");
   holder.remove();
  }else{
   holder.textContent="This image is not stored on this device.";
  }
 }).catch(()=>{
  if(d.isConnected)holder.textContent="Could not read this device's image storage.";
 });

}else{
 const body=el("span","message-text",m.text);
 d.append(body);
 let pressTimer=null, didLongPress=false;
 const cancelPress=()=>{clearTimeout(pressTimer);pressTimer=null;};
 body.addEventListener("pointerdown",()=>{didLongPress=false;pressTimer=setTimeout(async()=>{didLongPress=true;body.classList.add("longpress-copy");try{await navigator.clipboard.writeText(m.text);toast("Message copied");}catch{toast("Copy unavailable");}setTimeout(()=>body.classList.remove("longpress-copy"),250);},550);});
 ["pointerup","pointerleave","pointercancel"].forEach(ev=>body.addEventListener(ev,cancelPress));
 body.addEventListener("contextmenu",e=>{e.preventDefault();cancelPress();didLongPress=true;navigator.clipboard?.writeText(m.text).then(()=>toast("Message copied")).catch(()=>toast("Copy unavailable"));});
}

const meta=document.createElement("small");

meta.textContent=fmt(m.t)+(m.me?
(m.st==="ok"?" · "+(m.seen?"✓✓":"✓"):m.st==="failed"?" · not sent":" · sending…")
:"");
if(m.me&&m.st==="ok")meta.classList.add("message-ticks");

d.append(meta);

if(m.me&&m.st==="failed"){

const b=document.createElement("button");

b.className="retry";
b.textContent="Retry";

b.onclick=()=>{
 if(m.image)transferImage(current,m.id);
 else sendMessage(m.id);
};

meta.append(b);

}

box.append(d);
if(!m.me)observeIncomingMessage(d,current,m);

}

scrollThreadToLatest();

}

/* NAVIGATION */

function back(){

closeChatMenu();
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

$("csConfirm").classList.toggle("hidden",v!=="confirm");

$("csClose").classList.toggle("hidden",v!=="menu");


}

function contactOptions(){

const pk=current;

if(!pk)return;

paintAvatar($("csAvatar"),pk,data.contacts[pk]);

$("csName").textContent=data.contacts[pk];
appendVerifiedBadge($("csName"),pk);

$("csSub").textContent=subtitleFor(pk)||NT.nip19.npubEncode(pk).slice(0,16)+"…";

$("csCopyLabel").textContent="Copy public ID";

csView("menu");

show("csheet");

}

function closeContactSheet(){

hide("csheet");

}

function removeContact(){

(data.messages[current]||[]).forEach(m=>{
 if(m.image)deleteLocalImage(m.image.rid||m.image.id).catch(()=>{});
});

closePeer(current);

delete data.contacts[current];
delete data.messages[current];
delete data.unread[current];
delete data.profiles[current];
profileSyncPending.delete(current);

save();

closeContactSheet();

back();

}

/* CHAT OVERFLOW MENU + CLEAR CHAT */

function chatMenuIsOpen(){
const p=$("chatMenuPop");
return !!p&&p.classList.contains("open");
}

function openChatMenu(viaKeyboard){
if(!current)return;
const pop=$("chatMenuPop"),btn=$("chatMenu"),host=$("thread");
const hr=host.getBoundingClientRect(),br=btn.getBoundingClientRect();
const m=8;
show("chatMenuScrim");
const pw=pop.offsetWidth;
let left=br.right-hr.left-pw;
left=Math.max(m,Math.min(left,hr.width-pw-m));
const top=Math.max(m,br.bottom-hr.top+2);
pop.style.left=left+"px";
pop.style.top=top+"px";
pop.classList.add("open");
pop.setAttribute("aria-hidden","false");
btn.setAttribute("aria-expanded","true");
pop.querySelectorAll(".chat-pop-item").forEach(b=>b.tabIndex=0);
if(viaKeyboard)$("cmClear").focus();
}

function closeChatMenu(){
const pop=$("chatMenuPop");
if(!pop)return;
const wasOpen=pop.classList.contains("open");
pop.classList.remove("open");
pop.setAttribute("aria-hidden","true");
pop.querySelectorAll(".chat-pop-item").forEach(b=>b.tabIndex=-1);
hide("chatMenuScrim");
$("chatMenu").setAttribute("aria-expanded","false");
if(wasOpen&&pop.contains(document.activeElement))$("chatMenu").focus();
}

let clearChatPk=null;

function openClearChatDialog(){
const pk=current;
if(!pk||!data.contacts[pk])return;
clearChatPk=pk;
$("clearChatText").textContent="All messages and photos in your chat with "+data.contacts[pk]+" will be deleted from this device only. The contact stays in your list. Nothing is deleted from their device, and they keep their own copy.";
show("clearChatDialog");
setTimeout(()=>$("clearChatCancel").focus(),30);
}

function closeClearChatDialog(){
clearChatPk=null;
hide("clearChatDialog");
}

function clearChat(){
const pk=clearChatPk;
closeClearChatDialog();
if(!pk||pk!==current||!data.contacts[pk])return;
(data.messages[pk]||[]).forEach(m=>{
if(m&&m.image)deleteLocalImage(m.image.rid||m.image.id).catch(()=>{});
});
/* Relays still hold the older encrypted events and re-send them on reconnect;
   remember when the chat was cleared so those are not re-imported. */
data.clearedAt=data.clearedAt||{};
data.clearedAt[pk]=Math.floor(Date.now()/1000);
data.messages[pk]=[];
data.unread[pk]=0;
save();
renderThread();
renderList();
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

/* ONLINE PRESENCE
   Every ~25s while the app is open and visible, an encrypted ephemeral event is sent to each
   contact. A contact counts as online if one arrived in the last ~65s. Sharing is reciprocal:
   with "Show when I'm online" off, nothing is sent and no one else's status is shown. */

function presenceEnabled(){return data.showOnline!==false}

function ownOnline(){
 return presenceEnabled()&&navigator.onLine&&relayConnectionSummary().connected>0;
}

function isOnline(pk){
 if(!pk||!me)return false;
 if(pk===me)return ownOnline();
 if(!presenceEnabled()||!data.contacts||!data.contacts[pk])return false;
 const t=presence.seen.get(pk);
 return !!t&&Date.now()-t<PRESENCE_TTL;
}

function peerLine(pk){
 return isOnline(pk)&&pk!==me?"Online":subtitleFor(pk);
}

function refreshPresenceDots(){
 document.querySelectorAll(".avatar[data-pk]").forEach(n=>{
  const on=isOnline(n.dataset.pk);
  const dot=n.querySelector(":scope > .online-dot");
  if(on&&!dot)n.append(el("i","online-dot"));
  else if(!on&&dot)dot.remove();
 });
 if(current&&$("peer")&&!$("thread").classList.contains("hidden"))$("peer").textContent=peerLine(current);
}

function sendPeerPing(peer,payload){
 try{
  if(!NT||!sk||!pool)return;
  const content=NT.nip44.encrypt(JSON.stringify(payload),convKey(sk,peer));
  const ev=NT.finalizeEvent({kind:PRESENCE_KIND,created_at:Math.floor(Date.now()/1000),tags:[["p",peer]],content},sk);
  pool.publish(RELAYS,ev).forEach(p=>Promise.resolve(p).catch(()=>{}));
 }catch{}
}

function sendPresence(peer,state,wantReply){
 sendPeerPing(peer,{v:1,type:"presence",s:state,r:wantReply?1:0});
}

/* Instant profile sync: tell contacts "my profile changed". The ping carries no
   profile data; receivers re-fetch from the backend, so it cannot spoof a name. */
function broadcastProfileChanged(){
 if(!pool||!navigator.onLine)return;
 const peers=Object.keys(data.contacts||{}).slice(0,PRESENCE_MAX_PEERS);
 syncInfo.sent=Date.now();syncInfo.sentTo=peers.length;renderBuildInfo();
 peers.forEach((pk,i)=>{
  setTimeout(()=>sendPeerPing(pk,{v:1,type:"profile"}),i*120);
 });
}

const RUSTLE_BUILD=44;
const syncInfo={ping:0,fetch:0,sent:0,sentTo:0};
function renderBuildInfo(){
 const n=$("buildInfo");if(!n)return;
 const t=ms=>ms?new Date(ms).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",second:"2-digit"}):"–";
 n.textContent="Build "+RUSTLE_BUILD+" · contact signal "+t(syncInfo.ping)+" · synced "+t(syncInfo.fetch)+" · sent "+syncInfo.sentTo+" @ "+t(syncInfo.sent);
}
const profilePingAt=new Map();
const profilePingTimer=new Map();
function handleProfilePing(pk){
 syncInfo.ping=Date.now();renderBuildInfo();
 /* Never drop a signal: bursts are coalesced into one trailing refresh. */
 const wait=Math.max(0,3000-(Date.now()-(profilePingAt.get(pk)||0)));
 clearTimeout(profilePingTimer.get(pk));
 profilePingTimer.set(pk,setTimeout(()=>{
  profilePingAt.set(pk,Date.now());
  data.profiles[pk]={...(data.profiles[pk]||{}),checkedAt:0};
  queueProfileSync(pk);
 },wait));
}

/* Force-refresh every contact (ignores the cache), used when the app is opened/foregrounded. */
function refreshAllProfilesNow(){
 Object.keys(data.contacts||{}).forEach(pk=>{
  if(pk!==me)data.profiles[pk]={...(data.profiles[pk]||{}),checkedAt:0};
 });
 syncContactProfiles();
}


function broadcastPresence(state,wantReply){
 if(!presenceEnabled()||!pool||!navigator.onLine)return;
 if(state==="on"&&document.hidden)return;
 Object.keys(data.contacts||{}).slice(0,PRESENCE_MAX_PEERS).forEach((pk,i)=>{
  setTimeout(()=>sendPresence(pk,state,wantReply),i*120);
 });
}

function startPresence(){
 if(presence.timer)clearInterval(presence.timer);
 if(presence.sweep)clearInterval(presence.sweep);
 broadcastPresence("on",true);
 presence.timer=setInterval(()=>broadcastPresence("on",false),PRESENCE_INTERVAL);
 presence.sweep=setInterval(refreshPresenceDots,15000);
 refreshPresenceDots();
}

function receivePresence(ev){
 if(!ev||ev.kind!==PRESENCE_KIND||!NT||!sk||ev.pubkey===me)return;
 if(!data.contacts[ev.pubkey])return;
 if(Math.abs(Date.now()/1000-ev.created_at)>90)return;
 if(!(ev.tags||[]).some(t=>t[0]==="p"&&t[1]===me))return;
 if(presence.ids.has(ev.id))return;
 if(presence.ids.size>500)presence.ids.clear();
 presence.ids.add(ev.id);
 try{
  if(!NT.verifyEvent(ev))return;
  const payload=JSON.parse(NT.nip44.decrypt(ev.content,convKey(sk,ev.pubkey)));
  if(!payload||payload.v!==1)return;
  if(payload.type==="profile"){handleProfilePing(ev.pubkey);return}
  if(payload.type!=="presence"||!presenceEnabled())return;
  if(payload.s==="off")presence.seen.delete(ev.pubkey);
  else if(payload.s==="on")presence.seen.set(ev.pubkey,Date.now());
  else return;
  refreshPresenceDots();
  if(payload.r&&payload.s==="on"&&!document.hidden){
   const last=presence.repliedAt.get(ev.pubkey)||0;
   if(Date.now()-last>10000){
    presence.repliedAt.set(ev.pubkey,Date.now());
    sendPresence(ev.pubkey,"on",false);
   }
  }
 }catch{}
}

document.addEventListener("visibilitychange",()=>{
 if(document.hidden)broadcastPresence("off",false);
 else refreshAllProfilesNow();
});
window.addEventListener("pagehide",()=>broadcastPresence("off",false));

function setShowOnline(on){
 if(!on)broadcastPresence("off",false); /* tell contacts before sharing is switched off */
 data.showOnline=!!on;
 db.write();
 if(on){startPresence()}
 else{
  presence.seen.clear();
  if(presence.timer){clearInterval(presence.timer);presence.timer=null}
 }
 refreshPresenceDots();
}

/* EVENTS */

function wire(){

// Keep the app viewport aligned with the visible Android viewport when the keyboard opens.
const syncVisibleViewport=()=>{
  const height=window.visualViewport?window.visualViewport.height:window.innerHeight;
  document.documentElement.style.setProperty("--app-height",Math.round(height)+"px");
};
syncVisibleViewport();
window.visualViewport?.addEventListener("resize",syncVisibleViewport,{passive:true});
window.visualViewport?.addEventListener("scroll",syncVisibleViewport,{passive:true});
window.addEventListener("orientationchange",()=>setTimeout(syncVisibleViewport,120),{passive:true});


// No native text selection on messages (copy is handled by the custom long-press).
document.addEventListener("selectstart",e=>{const t=e.target&&(e.target.nodeType===1?e.target:e.target.parentElement);if(t&&t.closest&&t.closest(".message-text"))e.preventDefault();});
document.addEventListener("selectionchange",()=>{const sel=window.getSelection&&window.getSelection();if(!sel||sel.isCollapsed)return;const n=sel.anchorNode&&(sel.anchorNode.nodeType===1?sel.anchorNode:sel.anchorNode.parentElement);if(n&&n.closest&&n.closest(".message-text"))sel.removeAllRanges();});
// Prevent accidental selection/copying of interface labels and timestamps.
// Message bodies retain their dedicated long-press copy action.
document.addEventListener("copy",e=>{
 const t=e.target;
 if(t&&t.closest&&t.closest(".message-text"))return;
 if(t&&(t.isContentEditable||/^(INPUT|TEXTAREA)$/.test(t.tagName)))return;
 e.preventDefault();
});
document.addEventListener("contextmenu",e=>{
 const t=e.target;
 if(t&&t.closest&&t.closest(".message-text"))return;
 if(t&&(t.isContentEditable||/^(INPUT|TEXTAREA)$/.test(t.tagName)))return;
 e.preventDefault();
});


$("search").onkeydown=e=>{

if(e.key!=="Enter")return;

const t=firstTarget();

if(t)startChat(t);

};

$("csheet").onclick=e=>{if(e.target===$("csheet"))closeContactSheet()};

$("csClose").onclick=closeContactSheet;

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
  if(e.key!=="Escape")return;
  if(!$("clearChatDialog").classList.contains("hidden")){closeClearChatDialog();return;}
  if(chatMenuIsOpen()){closeChatMenu();return;}
  if(!$("csheet").classList.contains("hidden")){closeContactSheet();return;}
  if($("home").classList.contains("search-mode")){closeSearchView();return;}
  if(!$("sheet").classList.contains("hidden"))hide("sheet");
});

function closeSearchView(){
  $("searchPanel").classList.add("hidden");
  $("home").classList.remove("search-mode");
  $("search").value="";
  onSearch();
  $("search").blur();
  setTab("chats");
  $("homeScroll").scrollTop=homeListScrollTop;
}

$("tabChats").onclick=()=>closeSearchView();

$("tabSearch").onclick=()=>{
  homeListScrollTop=$("homeScroll").scrollTop;
  $("searchPanel").classList.remove("hidden");
  $("home").classList.add("search-mode");
  setTab("search");
  setTimeout(()=>$("search").focus(),80);
};
$("searchBack").onclick=()=>closeSearchView();

$("tabProfile").onclick=()=>$("me").click();
$("tabNew").onclick=()=>$("tabSearch").click();

$("fab").onclick=()=>$("tabSearch").click();

$("clearSearch").onclick=()=>{

$("search").value="";

onSearch();

$("search").focus();

};

if($("showOnline")){$("showOnline").checked=data.showOnline!==false;$("showOnline").onchange=e=>setShowOnline(e.target.checked);}
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

/* Three-dot menu: compact floating menu anchored inside the conversation screen. */
$("chatMenu").onclick=e=>{
e.stopPropagation();
if(chatMenuIsOpen())closeChatMenu();else openChatMenu(e.detail===0);
};
$("chatMenuScrim").onclick=e=>{e.preventDefault();e.stopPropagation();closeChatMenu();};
$("cmProfile").onclick=()=>{closeChatMenu();contactOptions();};
$("cmClear").onclick=()=>{closeChatMenu();openClearChatDialog();};
$("clearChatCancel").onclick=closeClearChatDialog;
$("clearChatConfirm").onclick=clearChat;
$("clearChatDialog").onclick=e=>{if(e.target===$("clearChatDialog"))closeClearChatDialog();};
window.addEventListener("resize",closeChatMenu);

/* Tapping the contact name or avatar opens the contact profile. The verified badge
   keeps its own handler (shows verification info) and never opens the profile. */
const threadHead=document.querySelector(".threadhead");
if(threadHead){
threadHead.addEventListener("click",e=>{
if(e.target.closest(".verified-badge-wrap"))return;
contactOptions();
});
threadHead.addEventListener("keydown",e=>{
if(!e.target.classList||!e.target.classList.contains("tname"))return;
if(e.key==="Enter"||e.key===" "){e.preventDefault();contactOptions();}
});
}
const threadAvatar=$("tavatar");
if(threadAvatar){
threadAvatar.addEventListener("click",contactOptions);
threadAvatar.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();contactOptions();}});
}

/* OPEN IDENTITY SHEET */

$("me").onclick=()=>{
show("sheet");
renderBuildInfo();
$("npub").textContent=npub;
};

/* EDIT DISPLAY NAME FROM THE PROFILE HEADER */
$("editDisplayName").onclick=()=>{
  $("displayNameEditInput").value=data.displayName||"";
  $("displayNameError").textContent=data.username?"":"Register a RUSTLE username before changing your display name.";
  $("displayNameSave").disabled=!data.username;
  show("displayNameDialog");
  setTimeout(()=>$("displayNameEditInput").focus(),60);
};
$("displayNameCancel").onclick=()=>hide("displayNameDialog");
$("displayNameDialog").onclick=e=>{if(e.target.id==="displayNameDialog")hide("displayNameDialog")};
$("displayNameSave").onclick=async()=>{
  const value=$("displayNameEditInput").value.trim().slice(0,50);
  if(!value){$("displayNameError").textContent="Display name cannot be empty.";return;}
  if(!data.username){$("displayNameError").textContent="Register a RUSTLE username first.";return;}
  $("displayNameInput").value=value;
  $("displayNameSave").disabled=true;
  await registerUsername();
  if(data.displayName===value)hide("displayNameDialog");
  else {$("displayNameError").textContent=$("registrationStatus").textContent||"Could not update your display name.";$("displayNameSave").disabled=false;}
};
$("displayNameEditInput").onkeydown=e=>{if(e.key==="Enter")$("displayNameSave").click();if(e.key==="Escape")hide("displayNameDialog")};

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

/* Prevent accidental page zoom across RUSTLE; photo viewer remains zoomable. */
(function lockAppZoom(){
  document.addEventListener("touchmove",function(e){
    if(e.touches && e.touches.length > 1 && !e.target.closest(".image-viewer:not(.hidden)")) e.preventDefault();
  },{passive:false});
  document.addEventListener("gesturestart",function(e){
    if(!e.target.closest(".image-viewer:not(.hidden)")) e.preventDefault();
  },{passive:false});
  document.addEventListener("gesturechange",function(e){
    if(!e.target.closest(".image-viewer:not(.hidden)")) e.preventDefault();
  },{passive:false});
  document.addEventListener("wheel",function(e){
    if(e.ctrlKey && !e.target.closest(".image-viewer:not(.hidden)")) e.preventDefault();
  },{passive:false});
})();

/* APPLICATION START */

const installedApp=
matchMedia("(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui)").matches||
navigator.standalone===true||
document.referrer.startsWith("android-app://");

if(installedApp||new URLSearchParams(location.search).has("app")){

wire();

boot().catch(error=>{
  console.error("RUSTLE startup failed:",error);
  status("RUSTLE could not start. Reload to try again.");
  show("home");
  const list=$("list");
  if(list){list.textContent="";list.append(stateBlock(ICON_WARN,"Could not start RUSTLE","Something went wrong while loading the app. Your locally stored identity and messages have not been intentionally changed.","Reload",()=>location.reload()));}
});

}else{

document.querySelectorAll("#home,#thread,#sheet,#csheet").forEach(n=>n.remove());

show("landing");

initLanding();

}
