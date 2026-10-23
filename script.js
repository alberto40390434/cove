import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, sendEmailVerification }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where, orderBy, limit,
  onSnapshot, addDoc, serverTimestamp, writeBatch, getDocs, FieldPath, arrayUnion, arrayRemove, increment }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { getDatabase, ref as dbRef, set, onValue, onDisconnect, serverTimestamp as rtStamp }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyCkpXVTOwjHuzG0msQPhtDuPoRDgR_GxbM",
  authDomain: "cove-b30b4.firebaseapp.com",
  databaseURL: "https://cove-b30b4-default-rtdb.firebaseio.com",
  projectId: "cove-b30b4",
  storageBucket: "cove-b30b4.firebasestorage.app",
  messagingSenderId: "769872068444",
  appId: "1:769872068444:web:65ab0e799797a8eef6cb99"
};

const app = initializeApp(firebaseConfig), auth = getAuth(app), db = getFirestore(app), rtdb = getDatabase(app);
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const colors = ["#7fd1c0","#c4a7f0","#f2b97a","#8fb8f5","#f09aa5","#b5d88a"];
const color = n => colors[[...n].reduce((a, c) => a + c.charCodeAt(0), 0) % colors.length];
// One-time setup for profile pictures and banners: make a free Cloudinary account, then paste your cloud name
// and the name of an UNSIGNED upload preset here.
const CLOUD = { name: "dpe7v9jx", preset: "cove_profile" };
const CLOUD_ON = !CLOUD.name.includes("YOUR_") && !CLOUD.preset.includes("YOUR_");
const okImg = u => typeof u === "string" && u.length <= 300 && /^https:\/\/res\.cloudinary\.com\/[A-Za-z0-9_-]+\/image\/upload\/[A-Za-z0-9_.\/%~-]+$/.test(u);
const thumb = (u, w, h) => u.replace("/image/upload/", `/image/upload/c_fill,w_${w},h_${h},q_auto/`);   // resized copy, GIFs stay animated
const limitw = (u, w) => u.replace("/image/upload/", `/image/upload/c_limit,w_${w},q_auto/`);   // keeps the shape, GIFs stay animated
const photoByName = Object.create(null);                 // usernames are unique, so pictures are looked up by username
const setPhoto = d => { if (d?.username) { const k = d.username.toLowerCase(); if (okImg(d.avatarUrl)) photoByName[k] = d.avatarUrl; else delete photoByName[k]; } };
const av = (n, s = "", url) => {
  const p = url !== undefined ? url : photoByName[n.toLowerCase()];
  return p && okImg(p)
    ? `<div class="av ${s}" style="background-color:${color(n)};background-image:url('${thumb(p, 128, 128)}');background-size:cover;background-position:center"></div>`
    : `<div class="av ${s}" style="background:${color(n)}">${esc((n[0] || "?").toUpperCase())}</div>`;
};
async function uploadImage(file) {
  if (!CLOUD_ON) throw new Error("Picture uploads aren't set up yet.");
  if (!/^image\/(png|jpe?g|gif|webp)$/.test(file.type)) throw new Error("That file type isn't supported. Use PNG, JPG, GIF, or WebP.");
  if (file.size > 8 * 1024 * 1024) throw new Error("That file is over 8 MB. Try a smaller one.");
  const fd = new FormData(); fd.append("file", file); fd.append("upload_preset", CLOUD.preset);
  const r = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD.name}/image/upload`, { method: "POST", body: fd });
  if (!r.ok) throw new Error("The upload failed. Try again, or try a smaller file.");
  const url = (await r.json()).secure_url;
  if (!okImg(url) || !url.startsWith(`https://res.cloudinary.com/${CLOUD.name}/`)) throw new Error("The upload came back in an unexpected form.");
  return url;
}
const I = {
  chat: `<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-3.9A8 8 0 1 1 20 12z"/></svg>`,
  check: `<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`,
  x: `<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>`,
  search: `<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4-4"/></svg>`,
  vol: `<svg viewBox="0 0 24 24"><path d="M4 10v4h3l5 4V6L7 10zM16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/></svg>`,
  phone: `<svg viewBox="0 0 24 24"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A15 15 0 0 1 4 5a1 1 0 0 1 1-1z"/></svg>`
};

/* ---------- state ---------- */
let me = null, rels = [], profiles = {}, watchers = {}, unsubs = [], timers = [];
let presence = {}, myStatus = "online", connUnsub = null;
let convos = [], convoReady = false, seenUnread = {}, audioCtx = null;
let tab = "online", q = "", chat = null, chatMsgs = [], chatUnsub = null, shellFor = null;
let myServers = [], srv = null;

const other = r => r.users.find(u => u !== me.uid);
const nameOf = r => r.names[other(r)];
const accepted = () => rels.filter(r => r.status === "accepted");
const STATES = { online: ["online", "Online"], away: ["idle", "Away"], dnd: ["dnd", "Do not disturb"], offline: ["", "Offline"] };
const stateOf = uid => (uid === me?.uid ? myStatus : presence[uid]) || "offline";
const isOnline = uid => stateOf(uid) !== "offline";
const dotCls = uid => (STATES[stateOf(uid)] || STATES.offline)[0];
const labelOf = uid => (STATES[stateOf(uid)] || STATES.offline)[1];

/* ---------- auth screen ---------- */
let signup = false;
$("authSwitch").onclick = () => {
  signup = !signup;
  $("username").hidden = !signup; $("username").required = signup;
  $("authSub").textContent = signup ? "Create your account" : "Log in to continue";
  $("authBtn").textContent = signup ? "Sign up" : "Log in";
  $("authSwitch").textContent = signup ? "Have an account? Log in" : "Need an account? Sign up";
  $("password").autocomplete = signup ? "new-password" : "current-password";
  $("authMsg").textContent = "";
};
const nice = e => ({
  "auth/email-already-in-use": "That email is already registered.",
  "auth/invalid-credential": "Wrong email or password.",
  "auth/weak-password": "Password needs at least 6 characters.",
  "auth/invalid-email": "That email address doesn't look right.",
  "auth/too-many-requests": "Too many attempts. Wait a minute and try again."
}[e.code] || e.message || "Something went wrong.");

$("authForm").onsubmit = async e => {
  e.preventDefault();
  const msg = $("authMsg"); msg.textContent = "";
  const email = $("email").value.trim(), pw = $("password").value;
  try {
    if (signup) {
      const name = $("username").value.trim();
      if (!/^[a-zA-Z0-9_.]{3,20}$/.test(name)) throw { message: "Username: 3-20 letters, numbers, _ or ." };
      const key = name.toLowerCase();
      if ((await getDoc(doc(db, "usernames", key))).exists()) throw { message: "That username is taken." };
      const cred = await createUserWithEmailAndPassword(auth, email, pw);
      const b = writeBatch(db);
      b.set(doc(db, "usernames", key), { uid: cred.user.uid });
      b.set(doc(db, "users", cred.user.uid), { username: name, usernameLower: key, status: "online", createdAt: serverTimestamp() });
      await b.commit();
      sendEmailVerification(cred.user).catch(console.error);
    } else await signInWithEmailAndPassword(auth, email, pw);
  } catch (err) { msg.textContent = nice(err); }
};

/* ---------- session ---------- */
function stop() {
  unsubs.forEach(f => f()); Object.values(watchers).forEach(f => f()); chatUnsub?.(); closeServer(); myServers = []; connUnsub?.(); connUnsub = null; leaveCall();
  timers.forEach(clearInterval);
  unsubs = []; watchers = {}; timers = []; chatUnsub = null;
  rels = []; profiles = {}; presence = {}; chat = null; chatMsgs = []; shellFor = null; tab = "online"; q = "";
  convos = []; convoReady = false; seenUnread = {}; document.title = "Cove";
}

onAuthStateChanged(auth, async u => {
  stop();
  $("verify").hidden = true;
  if (!u) { me = null; $("app").hidden = true; $("auth").hidden = false; return; }
  if (!u.emailVerified) {
    me = null; $("app").hidden = true; $("auth").hidden = true; $("verify").hidden = false;
    $("verifyText").textContent = `We sent a verification link to ${u.email}. Open it, then come back here and press the button below. It often lands in spam. If it does, open it and click "Not spam".`;
    return;
  }
  await u.getIdToken(true);   // refresh so the security rules see the verified email
  let snap;
  for (let i = 0; i < 10; i++) {          // sign-up writes the profile just after the account exists
    snap = await getDoc(doc(db, "users", u.uid));
    if (snap.exists()) break;
    await new Promise(r => setTimeout(r, 300));
  }
  if (!snap.exists()) { await signOut(auth); return; }
  me = { uid: u.uid, username: snap.data().username };
  setPhoto(snap.data());
  myStatus = STATES[snap.data().status] ? snap.data().status : "online"; renderMe();
  if (!snap.data().createdAt) updateDoc(doc(db, "users", u.uid), { createdAt: new Date(u.metadata.creationTime) }).catch(console.error);
  $("auth").hidden = true; $("app").hidden = false;
  $("meName").textContent = me.username;

  startPresence(); warmCalls(); joinFromLink(); watchConvos(); updateNotifBar();

  unsubs.push(onSnapshot(query(collection(db, "friendships"), where("users", "array-contains", me.uid)), s => {
    rels = s.docs.map(d => ({ id: d.id, ...d.data() }));
    rels.filter(r => r.status === "accepted").forEach(r => watch(other(r)));
    if (chat && !rels.some(r => r.id === chat.id && r.status === "accepted")) closeChat();
    render();
  }, err => console.error(err)));
  unsubs.push(onSnapshot(collection(db, "users", me.uid, "servers"), s => {
    myServers = s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => a.name.localeCompare(b.name)); render();
  }, err => console.error(err)));
  render();
});

/* ---------- presence: online / away / do not disturb / offline ---------- */
const publish = () => set(dbRef(rtdb, "status/" + me.uid), { state: myStatus, changed: rtStamp() }).catch(console.error);

function startPresence() {
  const mine = dbRef(rtdb, "status/" + me.uid);
  connUnsub = onValue(dbRef(rtdb, ".info/connected"), async s => {
    if (s.val() !== true) return;
    // the server flips us to offline the moment this tab closes or the connection drops
    await onDisconnect(mine).set({ state: "offline", changed: rtStamp() }).catch(console.error);
    publish();
  });
}

function renderMe() {
  const el = $("meAv"), p = photoByName[me.username.toLowerCase()];
  el.className = "av " + STATES[myStatus][0];
  $("meStatus").textContent = STATES[myStatus][1];
  el.style.backgroundColor = color(me.username);
  el.style.backgroundImage = p ? `url('${thumb(p, 128, 128)}')` : "";
  el.style.backgroundSize = "cover"; el.style.backgroundPosition = "center";
  el.textContent = p ? "" : me.username[0].toUpperCase();
}

function setStatus(s) {
  if (!STATES[s]) return;
  myStatus = s; renderMe(); publish(); render();
  updateDoc(doc(db, "users", me.uid), { status: s }).catch(console.error);
}

function watch(uid) {
  if (watchers[uid]) return;
  const a = onSnapshot(doc(db, "users", uid), s => { profiles[uid] = s.data(); setPhoto(s.data()); render(); });
  const b = onValue(dbRef(rtdb, "status/" + uid), s => { presence[uid] = s.val()?.state || "offline"; render(); });
  watchers[uid] = () => { a(); b(); };
}

/* ---------- friends ---------- */
async function sendRequest(name) {
  const u = await getDoc(doc(db, "usernames", name.toLowerCase()));
  if (!u.exists()) return `No user named "${name}".`;
  const uid = u.data().uid;
  if (uid === me.uid) return "You can't add yourself.";
  const ref = doc(db, "friendships", [me.uid, uid].sort().join("_"));
  const ex = await getDoc(ref);
  if (ex.exists()) {
    const d = ex.data();
    if (d.status === "accepted") return `You're already friends with ${d.names[uid]}.`;
    if (d.to === me.uid) { await updateDoc(ref, { status: "accepted" }); return `You and ${d.names[uid]} are now friends.`; }
    return "Request already sent.";
  }
  const theirs = (await getDoc(doc(db, "users", uid))).data().username;
  await setDoc(ref, { users: [me.uid, uid], from: me.uid, to: uid, names: { [me.uid]: me.username, [uid]: theirs }, status: "pending", createdAt: serverTimestamp() });
  return `Request sent to ${theirs}.`;
}

/* ---------- chat ---------- */
function openConvo(c) {
  closeServer(); chatUnsub?.();
  chat = { id: c.id, type: c.type, uid: c.uid, name: c.name, members: c.members || [], names: c.names || {}, createdBy: c.createdBy };
  chatMsgs = [];
  const u1 = onSnapshot(query(collection(db, "chats", c.id, "messages"), orderBy("createdAt"), limit(200)),
    s => { chatMsgs = s.docs.map(d => ({ id: d.id, ...d.data() })); if (chat) render(); }, err => console.error(err));
  const u2 = CALLS_ON && c.type === "dm"
    ? onSnapshot(collection(db, "chats", c.id, "participants"),
        s => { if (chat?.id === c.id) { chat.parts = s.docs.map(d => ({ id: d.id, ...d.data() })); render(); } }, err => console.error(err))
    : () => {};
  chatUnsub = () => { u1(); u2(); };
  markRead(c.id);
  render();
}
function closeChat() { chatUnsub?.(); chatUnsub = null; chat = null; chatMsgs = []; }

/* ---------- roles and permissions ---------- */
const PERM_INFO = [
  ["General", [
    ["manageChannels", "Manage Channels", "Create, edit, delete, lock, and reorder channels and categories."],
    ["manageRoles", "Manage Roles", "Create, edit, and delete roles and give them to members. Whoever has this can give themselves any permission."]]],
  ["Membership", [
    ["kickMembers", "Kick Members", "Remove other members from the server. They can come back with the invite code."]]],
  ["Text channels", [
    ["sendMessages", "Send Messages", "Send messages in channels that aren't locked or private to them."],
    ["manageMessages", "Manage Messages", "Delete messages sent by other members."]]],
  ["Voice channels", [
    ["connectVoice", "Connect", "Join voice channels and calls."]]],
  ["Advanced", [
    ["administrator", "Administrator", "Every permission, plus access to private and locked channels. This is a dangerous permission to grant."]]]
];
const PERMS = PERM_INFO.flatMap(([, items]) => items.map(([k, l]) => [k, l]));
const DEFAULT_PERMS = { sendMessages: true, connectVoice: true, manageChannels: false, manageRoles: false, kickMembers: false, manageMessages: false, administrator: false };
const can = p => {
  if (!srv || !me) return false;
  if (srv.owner === me.uid) return true;
  const ev = srv.roles.find(r => r.id === "everyone"), m = srv.members.find(x => x.id === me.uid);
  return !!(ev?.perms?.[p] || m?.perms?.[p]);      // "everyone" permissions plus whatever the member's roles add
};
const okHex = c => typeof c === "string" && /^#[0-9a-fA-F]{6}$/.test(c);
const SWATCHES = ["#e74c3c", "#e67e22", "#f1c40f", "#2ecc71", "#1abc9c", "#3498db", "#9b59b6", "#e91e63", "#95a5a6", "#607d8b", "#ffffff", "#99aab5"];
// a person's name takes the color of the first role in the list (oldest first) that has one
const roleColor = m => {
  if (!m || !srv) return "";
  const r = srv.roles.find(x => x.id !== "everyone" && (m.roles || []).includes(x.id) && okHex(x.color));
  return r ? r.color : "";
};
const extraPerms = (ids, roles) => {                     // what a person's roles add on top of "everyone"
  const has = k => ids.some(id => roles.find(r => r.id === id)?.perms?.[k] === true), admin = has("administrator");
  return Object.fromEntries(PERMS.map(([k]) => [k, admin || has(k)]));       // Administrator = everything
};

/* ---------- calling: LiveKit (HD video, screen share, audio). Firestore only tracks who is in which call. ---------- */
// Paste the address of your Cove server here (the Render Web Service made from the calls-server folder).
// It powers the AI message check, and later the calls.
const CALL_API = "https://YOUR-CALL-SERVER.onrender.com";
const LK = window.LivekitClient;
const SERVER_ON = !CALL_API.includes("YOUR-");       // the Cove server address above is filled in: the AI message check can run
const CALLS_ENABLED = false;                         // change to true only after LiveKit is set up on the server
const CALLS_ON = SERVER_ON && CALLS_ENABLED;         // call buttons and voice channels stay hidden until then
const roomOf = (...b) => b.join("/");
const roomName = b => (b[0] === "chats" ? "dm_" + b[1] : `srv_${b[1]}_${b[3]}`);
const fresh = p => { const t = p.ping?.toMillis?.(); return !t || Date.now() - t < 60000; };
let call = null, callView = false;
const tiles = {};
const warmCalls = () => { if (!CALL_API.includes("YOUR-")) fetch(CALL_API + "/health").catch(() => {}); };   // wakes a sleeping free server

async function joinCall(base, label) {
  if (CALL_API.includes("YOUR-")) { alert("Calls aren't set up yet: the call server address is missing in script.js."); return; }
  if (!LK) { alert("The call library didn't load. Refresh the page and try again."); return; }
  if (call) await leaveCall();
  const c = call = { base, room: roomOf(...base), label, lk: null, timer: null, audio: [], speaking: new Set() };
  callView = true; renderCall();
  try {
    const r = await fetch(CALL_API + "/token", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room: roomName(base), idToken: await auth.currentUser.getIdToken() })
    });
    if (r.status === 403) throw { perm: true };
    if (!r.ok) throw new Error("token " + r.status);
    const { token, url } = await r.json();
    const lk = c.lk = new LK.Room({
      adaptiveStream: true, dynacast: true,
      audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      videoCaptureDefaults: { resolution: LK.VideoPresets.h720.resolution },
      publishDefaults: { simulcast: true, videoEncoding: LK.VideoPresets.h720.encoding, screenShareEncoding: LK.ScreenSharePresets.h1080fps30.encoding }
    });
    wireCall(c, lk);
    await lk.connect(url, token);
    if (call !== c) { lk.disconnect(); return; }
    const part = doc(db, ...base, "participants", me.uid);
    await setDoc(part, { name: me.username, ping: serverTimestamp() });
    c.timer = setInterval(() => updateDoc(part, { ping: serverTimestamp() }).catch(() => {}), 20000);
    applyAudio(); renderCall(); render();
  } catch (err) {
    console.error(err);
    if (call === c) {
      alert(err.perm ? "You don't have permission to join this call."
        : "Couldn't connect to the call. If nobody has used calls in a while, the call server may be waking up. Wait a minute and try again.");
      leaveCall();
    }
  }
}

function wireCall(c, lk) {
  const E = LK.RoomEvent, again = () => { if (call === c) syncStage(); };
  lk.on(E.TrackSubscribed, (track, _pub, p) => {
      if (track.kind === LK.Track.Kind.Audio) { const el = track.attach(); $("audioBox").appendChild(el); c.audio.push(el); applyAudio(); }
      again();
    })
    .on(E.TrackUnsubscribed, track => { track.detach().forEach(el => { el.remove(); c.audio = c.audio.filter(x => x !== el); }); again(); })
    .on(E.ParticipantConnected, again).on(E.ParticipantDisconnected, again)
    .on(E.TrackMuted, again).on(E.TrackUnmuted, again)
    .on(E.LocalTrackPublished, again).on(E.LocalTrackUnpublished, again)
    .on(E.ActiveSpeakersChanged, sp => { c.speaking = new Set(sp.map(p => p.identity)); markSpeaking(); })
    .on(E.AudioPlaybackStatusChanged, () => { if (!lk.canPlaybackAudio) lk.startAudio().catch(() => {}); })
    .on(E.Disconnected, () => { if (call === c) leaveCall(); });
}

async function leaveCall() {
  const c = call; if (!c) return;
  call = null; callView = false;
  clearInterval(c.timer);
  try { c.lk?.disconnect(); } catch {}
  c.audio.forEach(el => el.remove());
  Object.keys(tiles).forEach(k => { tiles[k].el.remove(); delete tiles[k]; });
  if (me) await deleteDoc(doc(db, ...c.base, "participants", me.uid)).catch(() => {});
  renderCall(); if (me) render();
}

function upsertTile(grid, key, p, pub, screen) {
  let t = tiles[key];
  if (!t) {
    const el = document.createElement("div");
    el.className = "tile" + (screen ? " screen" : "");
    el.innerHTML = `<video autoplay playsinline muted></video><div class="tav"></div><span class="tname"></span>`;
    el.onclick = () => el.classList.toggle("big");     // click a tile to enlarge it
    grid.appendChild(el);
    t = tiles[key] = { el, vid: el.querySelector("video"), av: el.querySelector(".tav"), nm: el.querySelector(".tname"), cur: null };
  }
  const who = p.name || p.identity;
  t.nm.textContent = who + (screen ? "'s screen" : p.isLocal ? " (you)" : "");
  t.av.textContent = who[0].toUpperCase(); t.av.style.background = color(who);
  const track = pub?.track && !pub.isMuted ? pub.track : null;
  if (track !== t.cur) { if (t.cur) t.cur.detach(t.vid); if (track) track.attach(t.vid); t.cur = track; }
  t.el.classList.toggle("novideo", !track);
  t.vid.style.transform = p.isLocal && !screen ? "scaleX(-1)" : "";     // mirror your own camera
}

function syncStage() {
  const grid = $("stage"); if (!grid || !call?.lk) return;
  const lk = call.lk, want = new Set();
  [lk.localParticipant, ...lk.remoteParticipants.values()].forEach(p => {
    want.add(p.identity); upsertTile(grid, p.identity, p, p.getTrackPublication(LK.Track.Source.Camera), false);
    const scr = p.getTrackPublication(LK.Track.Source.ScreenShare);
    if (scr?.track) { want.add(p.identity + ":s"); upsertTile(grid, p.identity + ":s", p, scr, true); }
  });
  Object.keys(tiles).forEach(k => { if (!want.has(k)) { tiles[k].el.remove(); delete tiles[k]; } });
  grid.dataset.n = Math.min(want.size, 6);
  markSpeaking(); renderStageControls();
}

function markSpeaking() {
  Object.entries(tiles).forEach(([k, t]) => t.el.classList.toggle("speaking", !k.endsWith(":s") && !!call?.speaking?.has(k)));
}

function renderStageControls() {
  const lp = call?.lk?.localParticipant; if (!lp) return;
  const deaf = $("deaf").getAttribute("aria-pressed") === "true", muted = deaf || $("mic").getAttribute("aria-pressed") === "true";
  $("cMic").classList.toggle("off", muted); $("cDeaf").classList.toggle("off", deaf);
  $("cCam").classList.toggle("active", lp.isCameraEnabled); $("cScreen").classList.toggle("active", lp.isScreenShareEnabled);
}

function applyAudio() {
  if (!call?.lk || call.lk.state !== LK.ConnectionState.Connected) return;
  const deaf = $("deaf").getAttribute("aria-pressed") === "true", muted = deaf || $("mic").getAttribute("aria-pressed") === "true";
  call.lk.localParticipant.setMicrophoneEnabled(!muted).then(renderStageControls).catch(() => {});
  call.audio.forEach(el => el.muted = deaf);
  renderStageControls();
}

async function toggleCam() {
  const lp = call?.lk?.localParticipant; if (!lp) return;
  try { await lp.setCameraEnabled(!lp.isCameraEnabled); }
  catch { alert("Couldn't start your camera. Check that this site is allowed to use it."); }
  syncStage();
}

async function toggleScreen() {
  const lp = call?.lk?.localParticipant; if (!lp) return;
  try {
    await lp.setScreenShareEnabled(!lp.isScreenShareEnabled,
      { audio: true, resolution: LK.ScreenSharePresets.h1080fps30.resolution },
      { screenShareEncoding: LK.ScreenSharePresets.h1080fps30.encoding });
  } catch { /* closing the picker without choosing lands here */ }
  syncStage();
}

function renderCall() {
  $("callBar").hidden = !call;
  $("stagePane").hidden = !(call && callView);
  if (!call) return;
  const up = call.lk?.state === LK.ConnectionState.Connected;
  $("callLabel").textContent = call.label; $("stageTitle").textContent = call.label;
  $("callState").textContent = up ? "Voice connected" : "Connecting...";
  if (up) syncStage();
}

function dmCallBtn() {
  if (!CALLS_ON) return "";
  const inIt = call?.room === roomOf("chats", chat.id), others = (chat.parts || []).some(p => p.id !== me.uid && fresh(p));
  return `<button class="callbtn ${inIt ? "on" : ""}" data-act="${inIt ? "leavecall" : "dmcall"}">${I.phone}${inIt ? "Leave call" : others ? "Join call" : "Call"}</button>`;
}

if (!navigator.mediaDevices?.getDisplayMedia) $("cScreen").hidden = true;      // phones can't share their screen
addEventListener("pagehide", () => { if (call && me) deleteDoc(doc(db, ...call.base, "participants", me.uid)).catch(() => {}); });

/* ---------- servers ---------- */
const randId = () => Array.from(crypto.getRandomValues(new Uint8Array(10)), b => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");

async function createServer(name) {
  const id = randId();
  await setDoc(doc(db, "servers", id), { name, owner: me.uid, createdAt: serverTimestamp() });
  await setDoc(doc(db, "servers", id, "roles", "everyone"), { name: "everyone", perms: DEFAULT_PERMS, createdAt: serverTimestamp() });
  await setDoc(doc(db, "servers", id, "members", me.uid), { name: me.username, roles: [], perms: {}, joinedAt: serverTimestamp() });
  await addDoc(collection(db, "servers", id, "channels"), { name: "general", type: "text", createdAt: serverTimestamp() });
  await setDoc(doc(db, "users", me.uid, "servers", id), { name, owner: true });
  return id;
}

async function joinServer(code) {
  let id = code.trim();
  try { id = new URL(id).searchParams.get("join") || id; } catch {}        // a whole link was pasted
  id = id.toLowerCase();
  try { const inv = await getDoc(doc(db, "invites", id)); if (inv.exists()) id = inv.data().sid; } catch {}   // custom codes point at a server
  if (!/^[a-z0-9]{10}$/.test(id)) return null;
  let name;
  try { const ex = await getDoc(doc(db, "servers", id)); if (ex.exists()) name = ex.data().name; } catch {}   // already a member
  if (!name) {
    try { await setDoc(doc(db, "servers", id, "members", me.uid), { name: me.username, roles: [], perms: {}, joinedAt: serverTimestamp() }); }
    catch { return null; }
    name = (await getDoc(doc(db, "servers", id))).data().name;
  }
  await setDoc(doc(db, "users", me.uid, "servers", id), { name });
  return { id, name };
}

function closeServer() {
  if (!srv) return;
  srv.u.forEach(f => f()); Object.values(srv.vu).forEach(f => f()); srv.mu?.(); srv = null; shellFor = null;
  $("srvSide").hidden = true; $("homeSide").hidden = false; $("rightTitle").textContent = "Active now";
}

function selectChannel(cid) {
  const s = srv; if (!s) return;
  s.mu?.(); s.mu = null; s.cid = cid || null; s.msgs = [];
  if (!cid) return;
  s.mu = onSnapshot(query(collection(db, "servers", s.id, "channels", cid, "messages"), orderBy("createdAt"), limit(200)),
    m => { if (srv === s && s.cid === cid) { s.msgs = m.docs.map(x => ({ id: x.id, ...x.data() })); render(); } }, err => console.error(err));
}

// older servers: the owner's browser adds the default role and gives members the new role fields
async function migrate(s) {
  if (srv !== s || s.owner !== me.uid || !s.rl || !s.ml || s.mig) return;
  const needRole = !s.roles.some(r => r.id === "everyone"), need = s.members.filter(m => !m.perms || !m.roles);
  if (!needRole && !need.length) return;
  s.mig = true;
  try {
    if (needRole) await setDoc(doc(db, "servers", s.id, "roles", "everyone"), { name: "everyone", perms: DEFAULT_PERMS, createdAt: serverTimestamp() });
    for (const m of need) await updateDoc(doc(db, "servers", s.id, "members", m.id), { roles: m.roles || [], perms: m.perms || {} });
  } catch (e) { console.error(e); }
}

function openServer(id, name) {
  closeChat(); closeServer();
  const s = srv = { id, name, owner: null, channels: [], cats: [], roles: [], members: [], cid: null, msgs: [], u: [], mu: null, vu: {}, vparts: {}, rl: false, ml: false };
  const live = fn => d => { if (srv === s) fn(d); }, bad = err => console.error(err), col = (...p) => collection(db, "servers", id, ...p);
  s.u.push(
    onSnapshot(doc(db, "servers", id), live(d => {
      if (!d.exists()) closeServer(); else { s.name = d.data().name; s.owner = d.data().owner;
        s.inviteCode = d.data().inviteCode || ""; s.moderation = d.data().moderation === true;
        s.blockedWords = Array.isArray(d.data().blockedWords) ? d.data().blockedWords.filter(w => typeof w === "string").slice(0, 50) : [];
        migrate(s);
        if (s.owner === me.uid && !myServers.find(x => x.id === id)?.owner) setDoc(doc(db, "users", me.uid, "servers", id), { owner: true }, { merge: true }).catch(() => {}); }
      render();
    }), err => {
      console.error(err);
      if (err.code === "permission-denied" && srv === s) {
        closeServer(); render(); deleteDoc(doc(db, "users", me.uid, "servers", id)).catch(() => {});
        alert("That server was deleted, or you're no longer a member of it.");
      }
    }),
    onSnapshot(col("channels"), live(c => {
      s.channels = c.docs.map(x => ({ id: x.id, ...x.data() }));
      ensureChannel(s);
      s.channels.filter(x => x.type === "voice" && !s.vu[x.id]).forEach(x => {
        s.vu[x.id] = onSnapshot(col("channels", x.id, "participants"), p => {
          if (srv === s) { s.vparts[x.id] = p.docs.map(d => ({ id: d.id, ...d.data() })); render(); }
        }, bad);
      });
      render();
    }), bad),
    onSnapshot(col("categories"), live(c => { s.cats = c.docs.map(x => ({ id: x.id, ...x.data() })); render(); }), bad),
    onSnapshot(col("roles"), live(r => { s.roles = r.docs.map(x => ({ id: x.id, ...x.data() })).sort((a, b) => (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0)); s.rl = true; migrate(s); render(); refreshSettings(); }), bad),
    onSnapshot(col("members"), live(m => {
      s.members = m.docs.map(x => ({ id: x.id, ...x.data() })); s.ml = true; ensureChannel(s);
      s.members.forEach(x => watch(x.id)); migrate(s); render(); refreshSettings();
    }), bad));
  shellFor = null; render();
}

function showCtx(items, x, y) {
  const m = $("ctxMenu");
  m.innerHTML = items.map(([a, l, i, cls]) => a === "sep" ? `<div class="msep"></div>` : `<button role="menuitem" class="${cls || ""}" data-act="${a}" data-id="${i || ""}">${l}</button>`).join("");
  m.hidden = false; placeAt(m, x, y);
}

async function leaveServerById(id, name) {
  let owner = null;
  try { owner = (await getDoc(doc(db, "servers", id))).data()?.owner; } catch (e) { console.error(e); }   // fails if the server is gone: then we just tidy up the list
  if (owner === me.uid) { alert("You own this server, so you can't leave it. Open its menu and delete it instead."); return false; }
  if (!confirm(`Leave ${name}?`)) return false;
  if (srv?.id === id) { closeServer(); render(); }
  try { await deleteDoc(doc(db, "servers", id, "members", me.uid)); } catch (e) { console.error(e); }
  await deleteDoc(doc(db, "users", me.uid, "servers", id)).catch(() => {});
  return true;
}

async function deleteServerById(id, name) {
  let owner = null;
  try { owner = (await getDoc(doc(db, "servers", id))).data()?.owner; } catch (e) { console.error(e); }
  if (owner !== me.uid) { alert("Only the server's owner can delete it."); return false; }
  const typed = prompt(`This permanently deletes "${name}" with every channel, message, role, and member. It can't be undone.\n\nType the server name to confirm:`);
  if (typed === null) return false;
  if (typed.trim() !== name) { alert("That didn't match the server name, so nothing was deleted."); return false; }
  if (srv?.id === id) { closeServer(); render(); }
  const sub = (...p) => collection(db, "servers", id, ...p);
  const wipe = async (colRef, size) => {                 // deletes a whole collection in small batches
    for (;;) {
      const snap = await getDocs(query(colRef, limit(size)));
      if (snap.empty) return;
      const b = writeBatch(db); snap.docs.forEach(d => b.delete(d.ref)); await b.commit();
    }
  };
  try {
    const chans = await getDocs(sub("channels"));
    for (const c of chans.docs) await wipe(sub("channels", c.id, "messages"), 8);
    await wipe(sub("channels"), 5); await wipe(sub("categories"), 5); await wipe(sub("roles"), 5);
    const others = (await getDocs(sub("members"))).docs.filter(d => d.id !== me.uid);
    for (let i = 0; i < others.length; i += 5) { const b = writeBatch(db); others.slice(i, i + 5).forEach(d => b.delete(d.ref)); await b.commit(); }
    try { const sd = (await getDoc(doc(db, "servers", id))).data(); if (sd?.inviteCode) await deleteDoc(doc(db, "invites", sd.inviteCode)); } catch (e) { console.error(e); }
    await deleteDoc(doc(db, "servers", id, "members", me.uid));
    await deleteDoc(doc(db, "servers", id));
    await deleteDoc(doc(db, "users", me.uid, "servers", id)).catch(() => {});
    return true;
  } catch (err) {
    console.error(err);
    alert("Something went wrong while deleting, so part of the server may be gone. Open its menu and try deleting again to finish.");
    return false;
  }
}

/* ---------- rendering ---------- */
const btn = (act, id, label, icon) => `<button class="ib" data-act="${act}" data-id="${id}" aria-label="${label}" title="${label}">${icon}</button>`;

function rowHtml(r) {
  const n = nameOf(r), pend = r.status === "pending", inc = pend && r.to === me.uid, dot = dotCls(other(r));
  const sub = pend ? (inc ? "Incoming friend request" : "Outgoing friend request") : labelOf(other(r));
  const btns = !pend ? btn("chat", r.id, "Message", I.chat) + btn("remove", r.id, "Remove friend", I.x)
    : inc ? btn("accept", r.id, "Accept", I.check) + btn("decline", r.id, "Decline", I.x)
    : btn("cancel", r.id, "Cancel request", I.x);
  return `<div class="row"><span class="plink" data-act="profile" data-uid="${other(r)}">${av(n, pend ? "nodot" : dot)}</span><div class="info plink" data-act="profile" data-uid="${other(r)}"><b>${esc(n)}</b><span class="st">${sub}</span></div>${btns}</div>`;
}

function shell(key, html, bind) {
  if (shellFor === key) return;
  replyDraft = null; attachDraft = null;
  $("view").innerHTML = html; $("view").classList.toggle("chat", key.startsWith("chat:") || key.startsWith("srv:"));
  shellFor = key; bind();
}

function fillList() {
  const base = tab === "online" ? accepted().filter(r => isOnline(other(r))) : tab === "all" ? accepted() : rels.filter(r => r.status === "pending");
  const list = base.filter(r => nameOf(r).toLowerCase().includes(q));
  const label = { online: "Online", all: "All friends", pending: "Pending" }[tab];
  const empty = { online: "No friends online right now.", all: "No friends yet. Use Add friend to send a request.", pending: "No pending requests." }[tab];
  $("list").innerHTML = `<div class="count">${label} — ${list.length}</div>` + (list.map(rowHtml).join("") || `<div class="empty">${empty}</div>`);
}

/* ---------- replies and reactions ---------- */
Object.assign(I, {
  smile: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8.5 14a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01"/></svg>`,
  reply: `<svg viewBox="0 0 24 24"><path d="M10 7L4 12l6 5M4 12h10a6 6 0 0 1 6 6v1"/></svg>`,
  dots: `<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>`
});
const EMOJI = "😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 😉 😍 🥰 😘 😋 😛 😜 🤪 😎 🤓 🥳 😏 😒 😞 😔 😟 😕 🙁 😣 😖 😫 😩 🥺 😢 😭 😤 😠 😡 🤬 🤯 😳 🥵 🥶 😱 😨 😰 😥 😓 🤗 🤔 🤭 🤫 😶 😐 😑 😬 🙄 😯 😦 😮 😲 🥱 😴 🤤 😪 😵 🤐 🥴 🤢 🤮 🤧 😷 🤒 🤕 🤑 🤠 👍 👎 👌 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ✋ 👋 👏 🙌 🤲 🙏 💪 ❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💔 💖 💯 💢 💥 💫 💦 🔥 ✨ ⭐ 🌟 🎉 🎊 🎈 ✅ ❌ ❓ ❗ 💀 👀 🙈 🙉 🙊 🐶 🐱 🐸 🍕 🍔 🍟 🍿 ☕ 🍺 🎮 🎵 🏆 🚀".split(" ");
const hidePops = () => ["ctxMenu", "statusMenu", "msgMenu", "picker"].forEach(id => { $(id).hidden = true; });
const placeAt = (el, x, y) => {
  el.style.left = Math.max(8, Math.min(x, innerWidth - el.offsetWidth - 8)) + "px";
  el.style.top = Math.max(8, Math.min(y, innerHeight - el.offsetHeight - 8)) + "px";
};
// the messages on screen belong to either an open friend chat or an open server channel
const msgCol = () => chat ? collection(db, "chats", chat.id, "messages") : srv?.cid ? collection(db, "servers", srv.id, "channels", srv.cid, "messages") : null;
const curMsgs = () => chat ? chatMsgs : srv?.msgs || [];
const nameOfUid = uid => uid === me.uid ? me.username : chat ? (chat.type === "group" ? chat.names?.[uid] || "Someone" : chat.name) : srv?.members.find(x => x.id === uid)?.name || "Someone";
let replyDraft = null, pickTarget = null, attachDraft = null;

async function toggleReact(mid, e) {
  const col = msgCol(), m = curMsgs().find(x => x.id === mid); if (!col || !m) return;
  const mine = (m.reactions?.[e] || []).includes(me.uid);
  await updateDoc(doc(col, mid), new FieldPath("reactions", e), mine ? arrayRemove(me.uid) : arrayUnion(me.uid));
}
I.image = `<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-8 8"/></svg>`;

async function attachFile(file, note) {
  if (!CLOUD_ON) { note("Image uploads aren't set up yet."); return; }
  const k0 = shellFor;
  attachDraft = { busy: true }; renderAttachBar();
  try { const url = await uploadImage(file); if (shellFor !== k0) return; attachDraft = { url }; }
  catch (err) { console.error(err); if (shellFor === k0) { attachDraft = null; note(err.message || "The upload failed."); } }
  renderAttachBar();
}
function renderAttachBar() {
  const b = $("attachBar"); if (!b) return;
  if (!attachDraft) { b.hidden = true; return; }
  b.hidden = false;
  b.innerHTML = attachDraft.busy ? `<span>Uploading image...</span>`
    : `<img src="${esc(thumb(attachDraft.url, 80, 80))}" alt="Attached image"><span>Image ready to send</span><button class="ib" data-act="clearattach" aria-label="Remove image" title="Remove image">${I.x}</button>`;
}

/* ---------- moderation: a quick built-in filter, plus an AI check when the Cove server is set up ---------- */
// <local-filter>
const LEET = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s" };
const flatten = t => t.toLowerCase().replace(/[013457@$]/g, c => LEET[c]).replace(/[^a-z\s]/g, "").replace(/(.)\1{2,}/g, "$1").replace(/\s+/g, " ").trim();
const FILLER = "(?:(?:are|r|re|so|such|a|an|really|very|fucking|the|total|complete|absolute|just|actually|literally)\\s){0,4}";
const BAD = [
  [/\b(kill\s?your\s?self|kys|go\s?die|hope\s?you\s?die|end\s?yourself)\b/, "encouraging self-harm"],
  [/\b(i\s?will|i\s?ll|im\s?gonna|im\s?going\s?to|gonna|going\s?to)\s(kill|hurt|stab|shoot|murder)\s(you|u|ur|your)\b/, "a threat"],
  [new RegExp("\\b(you|u|ur|youre|your)\\s" + FILLER + "(idiot|moron|stupid|loser|worthless|pathetic|ugly|trash|dumb|retarded|disgusting|freak)\\b"), "an insult"],
  [/\b(fuck|screw)\s(you|u|off)\b/, "an insult"],
  [/\b(stfu|shut\s?the\s?fuck\s?up)\b/, "an insult"],
  [/\bi\s?hate\s(you|u)\b/, "harassment"]
];
function localModerate(text, extra = []) {
  const flat = flatten(text), spaced = flat.replace(/\b([a-z])\s(?=[a-z]\b)/g, "$1");    // "k y s" becomes "kys"
  for (const [re, why] of BAD) for (const t of [flat, spaced]) {
    const m = re.exec(t);
    if (m && !/\b(not|never|dont|isnt|arent|wasnt)\b/.test(m[0])) return why;
  }
  for (const w of extra) { const nw = flatten(String(w)); if (nw && (" " + flat + " ").includes(" " + nw + " ")) return "a word this server blocks"; }
  return null;
}
// </local-filter>
async function aiModerate(text) {
  try {
    const r = await fetch(CALL_API + "/moderate", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, idToken: await auth.currentUser.getIdToken() }), signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;                              // if the AI can't be reached, the message goes through
    const j = await r.json();
    return j.ok ? null : (j.reason || "unfriendly");
  } catch { return null; }
}
async function modGuard(text) {
  if (!srv?.moderation) return null;
  const local = localModerate(text, srv.blockedWords || []);
  if (local) return `that looks like ${local}`;
  if (!SERVER_ON) return null;
  const ai = await aiModerate(text);
  return ai ? `it looks unfriendly (${ai})` : null;
}
async function saveModeration() {
  const words = [...new Set($("modWords").value.split("\n").map(w => w.trim().toLowerCase()).filter(w => w && w.length <= 30))].slice(0, 50);
  await updateDoc(doc(db, "servers", srv.id), { moderation: $("modOn").checked, blockedWords: words });
}

/* ---------- conversations: friend chats, chats with people you haven't added, and groups ---------- */
function chatFromMeta(m) {
  const uid = m.type === "dm" ? (m.members || []).find(u => u !== me.uid) : undefined, names = m.names || {};
  const name = m.type === "dm" ? (names[uid] || "Someone")
    : (m.title || Object.entries(names).filter(([u]) => u !== me.uid).map(([, n]) => n).slice(0, 3).join(", ") || "Group chat");
  return { id: m.id, type: m.type, uid, name, members: m.members || [], names, createdBy: m.createdBy };
}
function dmEntries() {
  const list = convos.map(c => {
    const e = chatFromMeta(c), ts = c.lastAt;
    e.unread = c.unread?.[me.uid] || 0; e.at = ts?.toMillis ? ts.toMillis() : ts === null ? Date.now() : 0;
    return e;
  });
  const have = new Set(list.map(x => x.id));
  accepted().filter(r => !have.has(r.id)).forEach(r => list.push({ id: r.id, type: "dm", uid: other(r), name: nameOf(r), members: r.users, names: r.names, unread: 0, at: 0 }));
  return list.sort((a, b) => b.at - a.at || a.name.localeCompare(b.name));
}
const dmRow = e => `<button class="dm ${chat?.id === e.id ? "on" : ""}" data-act="chat" data-id="${e.id}">${e.type === "group" ? av(e.name, "nodot") : av(e.name, dotCls(e.uid))}<span>${esc(e.name)}${e.type === "group" ? `<small>${e.members.length} members</small>` : ""}</span>${e.unread ? `<span class="badge sm">${e.unread > 99 ? "99+" : e.unread}</span>` : ""}</button>`;
function chatHeader() {
  if (chat.type === "group") return `<h1 class="plink" data-act="groupinfo" title="Group details">${av(chat.name, "nodot")}${esc(chat.name)} <span class="hint2">${chat.members.length} members</span></h1>`;
  return `<h1 class="plink" data-act="profile" data-uid="${chat.uid}">${av(chat.name, dotCls(chat.uid))}${esc(chat.name)}</h1>${dmCallBtn()}`;
}
function openConvoById(id) {
  const c = convos.find(x => x.id === id);
  if (c) return openConvo(chatFromMeta(c));
  const r = rels.find(x => x.id === id);
  if (r) startDm(other(r)).catch(err => { console.error(err); alert("Couldn't start that chat."); });
}
async function startDm(uid) {                              // works for friends and for people you only share a server with
  if (!uid || uid === me.uid) return;
  const members = [me.uid, uid].sort(), id = members.join("_");
  const known = convos.find(x => x.id === id);
  if (known) return openConvo(chatFromMeta(known));
  let uname = profiles[uid]?.username;
  if (!uname) { try { uname = (await getDoc(doc(db, "users", uid))).data()?.username; } catch (e) { console.error(e); } }
  if (!uname) { alert("Couldn't find that person."); return; }
  const ref = doc(db, "chats", id), names = { [me.uid]: me.username, [uid]: uname };
  const ex = await getDoc(ref);
  if (!ex.exists()) await setDoc(ref, { type: "dm", members, names, createdBy: me.uid, createdAt: serverTimestamp(), lastAt: serverTimestamp(), lastFrom: "", lastText: "", unread: {} });
  openConvo({ id, type: "dm", uid, name: uname, members, names, createdBy: ex.exists() ? ex.data().createdBy : me.uid });
}
async function sentInChat(c, text, img) {                  // remembers the last message and adds 1 to everyone else's unread count
  const data = { lastAt: serverTimestamp(), lastFrom: me.uid, lastText: (text || (img ? "Sent an image" : "")).slice(0, 100) };
  c.members.filter(u => u !== me.uid).forEach(u => { data[`unread.${u}`] = increment(1); });
  try { await updateDoc(doc(db, "chats", c.id), data); } catch (err) { console.error(err); }
}

/* ---------- unread counts and notifications ---------- */
const totalUnread = () => convos.reduce((n, c) => n + (c.unread?.[me.uid] || 0), 0);
function setBadges() {
  const t = totalUnread(), hb = $("homeBadge"), txt = t > 99 ? "99+" : String(t);
  if (hb) { hb.hidden = !t; hb.textContent = txt; }
  document.title = t ? `(${txt}) Cove` : "Cove";
}
function markRead(id) {                                    // only when you can actually see the window
  if (!id || document.visibilityState !== "visible" || !document.hasFocus()) return;
  const c = convos.find(x => x.id === id);
  if (c && (c.unread?.[me.uid] || 0) > 0) updateDoc(doc(db, "chats", id), new FieldPath("unread", me.uid), 0).catch(() => {});
}
function ping() {
  try {
    if (!audioCtx) return;
    const o = audioCtx.createOscillator(), g = audioCtx.createGain(), t = audioCtx.currentTime;
    o.type = "sine"; o.frequency.value = 880; g.gain.setValueAtTime(0.08, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    o.connect(g); g.connect(audioCtx.destination); o.start(t); o.stop(t + 0.25);
  } catch {}
}
function notifyMessage(c) {
  const visible = document.visibilityState === "visible", focused = visible && document.hasFocus();
  if (chat?.id === c.id && focused) return;                // you're reading it
  if (myStatus === "dnd") return;                          // Do Not Disturb: badges only, no pop-ups or sounds
  const who = c.names?.[c.lastFrom] || "Someone", title = c.type === "group" ? (c.title || "Group chat") : who;
  const body = (c.type === "group" ? who + ": " : "") + (c.lastText || "Sent a message");
  if (!focused && "Notification" in window && Notification.permission === "granted") {
    try { const n = new Notification(title, { body, tag: c.id }); n.onclick = () => { window.focus(); n.close(); openConvoById(c.id); }; }
    catch (e) { console.error(e); }
  }
  ping();
}
function watchConvos() {
  unsubs.push(onSnapshot(query(collection(db, "chats"), where("members", "array-contains", me.uid)), s => {
    convos = s.docs.map(d => ({ id: d.id, ...d.data() }));
    convos.forEach(c => { if (c.type === "dm") { const o = (c.members || []).find(u => u !== me.uid); if (o) watch(o); } });
    s.docChanges().forEach(ch => {
      const c = { id: ch.doc.id, ...ch.doc.data() }, mine = c.unread?.[me.uid] || 0, prev = seenUnread[c.id] || 0;
      seenUnread[c.id] = mine;
      if (ch.type !== "removed" && convoReady && mine > prev && c.lastFrom && c.lastFrom !== me.uid) notifyMessage(c);
    });
    convoReady = true;
    if (chat) {
      const cur = convos.find(x => x.id === chat.id);
      if (cur) Object.assign(chat, chatFromMeta(cur));
      else if (chat.type === "group") { closeChat(); shellFor = null; }
      if (chat) markRead(chat.id);
    }
    render();
  }, err => console.error(err)));
}
function updateNotifBar() {
  const b = $("notifBar"); if (!b) return;
  let off = false; try { off = localStorage.getItem("cove_notif_off") === "1"; } catch {}
  b.hidden = !("Notification" in window) || Notification.permission !== "default" || off;
}
document.addEventListener("click", () => { try { audioCtx ||= new (window.AudioContext || window.webkitAudioContext)(); } catch {} }, { once: true });
document.addEventListener("visibilitychange", () => { if (me && chat) markRead(chat.id); });
addEventListener("focus", () => { if (me && chat) markRead(chat.id); });

/* ---------- group chats (friends only) ---------- */
const friendPicks = skip => accepted().map(r => ({ uid: other(r), name: nameOf(r) })).filter(f => !skip.includes(f.uid))
  .map(f => `<label><input type="checkbox" data-u="${f.uid}" data-n="${esc(f.name)}"><span>${av(f.name, "nodot")} ${esc(f.name)}</span></label>`).join("");
const picked = () => [...document.querySelectorAll("#gPick input:checked")].map(b => ({ uid: b.dataset.u, name: b.dataset.n }));
function openGroupCreate() {
  const list = friendPicks([me.uid]);
  $("grpBody").innerHTML = `<div class="pform"><h2>Create a group chat</h2>
    <label class="fld">Group name (optional)<input id="gName" maxlength="40" autocomplete="off"></label>
    <div class="fld">Pick 2 or more friends<div class="perms col" id="gPick">${list || "<small>Add some friends first. Only friends can be put in a group.</small>"}</div></div>
    <div class="row-actions"><button class="primary" data-act="mkgroup">Create group</button><button class="link" data-act="closegrp">Cancel</button></div><div class="msg" id="gMsg" role="status"></div></div>`;
  $("grpModal").hidden = false;
}
async function mkGroup() {
  const say = t => { $("gMsg").textContent = t; }, picks = picked();
  if (picks.length < 2) return say("Pick at least 2 friends.");
  if (picks.length > 9) return say("A group can have up to 10 people, including you.");
  const names = { [me.uid]: me.username }; picks.forEach(p => { names[p.uid] = p.name; });
  const title = $("gName").value.trim() || picks.slice(0, 3).map(p => p.name).join(", "), id = randId(), members = [me.uid, ...picks.map(p => p.uid)];
  try { await setDoc(doc(db, "chats", id), { type: "group", title, members, names, createdBy: me.uid, createdAt: serverTimestamp(), lastAt: serverTimestamp(), lastFrom: "", lastText: "", unread: {} }); }
  catch (err) { console.error(err); return say("Couldn't create the group."); }
  $("grpModal").hidden = true;
  openConvo({ id, type: "group", name: title, members, names, createdBy: me.uid });
}
function openGroupInfo() {
  if (!chat || chat.type !== "group") return;
  const room = 10 - chat.members.length, list = room > 0 ? friendPicks(chat.members) : "";
  $("grpBody").innerHTML = `<div class="pform"><h2>Group chat</h2>
    <label class="fld">Name<input id="gName" maxlength="40" value="${esc(chat.name)}" autocomplete="off"></label>
    <div class="fld">Members (${chat.members.length})<div class="mlist" style="max-height:30vh">${chat.members.map(u => `<div class="mrow2"><div class="mtop plink" data-act="profile" data-uid="${u}">${av(nameOfUid(u), "nodot")}<b>${esc(nameOfUid(u))}${u === chat.createdBy ? " (creator)" : ""}</b></div></div>`).join("")}</div></div>
    ${list ? `<div class="fld">Add friends<div class="perms col" id="gPick">${list}</div></div>` : ""}
    <div class="row-actions"><button class="primary" data-act="savegroup">Save</button><button class="danger" data-act="leavegroup">Leave group</button><button class="link" data-act="closegrp">Close</button></div><div class="msg" id="gMsg" role="status"></div></div>`;
  $("grpModal").hidden = false;
}
async function saveGroup() {
  if (!chat || chat.type !== "group") return;
  const say = t => { $("gMsg").textContent = t; }, picks = picked();
  if (chat.members.length + picks.length > 10) return say("A group can have up to 10 people.");
  const names = { ...chat.names }; picks.forEach(p => { names[p.uid] = p.name; });
  try { await updateDoc(doc(db, "chats", chat.id), { title: $("gName").value.trim() || chat.name, names, members: [...chat.members, ...picks.map(p => p.uid)] }); }
  catch (err) { console.error(err); return say("Couldn't save that."); }
  $("grpModal").hidden = true;
}
async function leaveGroup() {
  if (!chat || chat.type !== "group" || !confirm(`Leave ${chat.name}?`)) return;
  const id = chat.id, rest = chat.members.filter(u => u !== me.uid);
  try { await updateDoc(doc(db, "chats", id), { members: rest }); } catch (err) { console.error(err); alert("Couldn't leave the group."); return; }
  $("grpModal").hidden = true; closeChat(); shellFor = null; render();
}

/* ---------- invite links ---------- */
const inviteLink = code => `${location.origin}${location.pathname}?join=${encodeURIComponent(code)}`;
async function saveInvite(raw) {
  const code = raw.trim().toLowerCase(), old = srv.inviteCode || "";
  if (code && !/^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(code)) throw new Error("Use 3 to 32 letters, numbers, or hyphens, and don't start or end with a hyphen.");
  if (/^[a-z0-9]{10}$/.test(code)) throw new Error("Pick another code. Exactly 10 plain letters or numbers is reserved.");
  if (code === old) return;
  const b = writeBatch(db);
  if (code) b.set(doc(db, "invites", code), { sid: srv.id });
  if (old) b.delete(doc(db, "invites", old));
  b.update(doc(db, "servers", srv.id), { inviteCode: code });
  try { await b.commit(); } catch (err) { console.error(err); throw new Error("That code is already taken, or couldn't be saved. Try another."); }
}
function joinFromLink() {
  const code = new URLSearchParams(location.search).get("join"); if (!code) return;
  history.replaceState(null, "", location.pathname);
  if (!confirm("Join the server from this invite link?")) return;
  joinServer(code).then(j => { if (j) openServer(j.id, j.name); else alert("That invite link doesn't work. It may have changed, or the server was deleted."); })
    .catch(err => { console.error(err); alert("Couldn't join from that link."); });
}

function renderReplyBar() {
  const b = $("replyBar"); if (!b) return;
  if (!replyDraft) { b.hidden = true; return; }
  b.hidden = false;
  b.innerHTML = `${I.reply}<span>Replying to <b>${esc(replyDraft.name)}</b></span><span class="rt">${esc(replyDraft.text)}</span><button class="ib" data-act="cancelreply" aria-label="Cancel reply" title="Cancel reply">${I.x}</button>`;
}
function setReply(m) {
  replyDraft = { id: m.id, from: m.from || "", name: nameOfUid(m.from), text: String(m.text || (m.image ? "Image" : "")).slice(0, 100) };
  renderReplyBar(); $("msgIn")?.focus();
}
function openPicker(mid, rect) {
  pickTarget = mid;
  const p = $("picker");
  if (!p.dataset.built) { p.innerHTML = EMOJI.map(e => `<button data-act="pickemoji" data-e="${e}" aria-label="${e}">${e}</button>`).join(""); p.dataset.built = "1"; }
  p.hidden = false; placeAt(p, rect.left, rect.bottom + 6);
}
function openMsgMenu(mid, x, y) {
  const m = curMsgs().find(q => q.id === mid); if (!m) return;
  const canDel = m.from === me.uid || (!!srv && !chat && can("manageMessages"));
  const mm = $("msgMenu");
  mm.innerHTML = `<div class="qrow">${["✅", "❤️", "🔥", "👍"].map(e => `<button data-act="react" data-id="${mid}" data-e="${e}" aria-label="React ${e}">${e}</button>`).join("")}</div>
    <button role="menuitem" data-act="pickreact" data-id="${mid}">Add Reaction</button><div class="msep"></div>
    <button role="menuitem" data-act="reply" data-id="${mid}">Reply</button>
    <button role="menuitem" data-act="copytext" data-id="${mid}">Copy Text</button>
    ${canDel ? `<div class="msep"></div><button role="menuitem" class="red" data-act="delmsg" data-id="${mid}">Delete Message</button>` : ""}`;
  mm.hidden = false; placeAt(mm, x, y);
}
function jumpTo(id) {
  const el = [...document.querySelectorAll("#msgs .m")].find(x => x.dataset.mid === id); if (!el) return;
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  el.classList.add("flash"); setTimeout(() => el.classList.remove("flash"), 1400);
}

const mTools = m => `<div class="mtools">${["✅", "❤️", "🔥"].map(e => `<button class="ib qk" data-act="react" data-id="${m.id}" data-e="${e}" aria-label="React ${e}">${e}</button>`).join("")}<span class="vsep"></span><button class="ib" data-act="pickreact" data-id="${m.id}" aria-label="Add reaction" title="Add reaction">${I.smile}</button><button class="ib rp" data-act="reply" data-id="${m.id}" aria-label="Reply" title="Reply">${I.reply}</button><button class="ib" data-act="msgmenu" data-id="${m.id}" aria-label="More" title="More">${I.dots}</button></div>`;
const rxChips = m => {
  const list = Object.entries(m.reactions || {}).filter(([e, u]) => Array.isArray(u) && u.length && e.length <= 16);
  if (!list.length) return "";
  return `<div class="rxs">` + list.map(([e, u]) => `<button class="rx ${u.includes(me.uid) ? "mine" : ""}" data-act="react" data-id="${m.id}" data-e="${esc(e)}" title="${esc(u.map(nameOfUid).join(", "))}">${esc(e)} <span>${u.length}</span></button>`).join("")
    + `<button class="rx add" data-act="pickreact" data-id="${m.id}" aria-label="Add reaction" title="Add reaction">${I.smile}</button></div>`;
};

function fillMsgs(list, who, emptyText, colorOf) {
  const el = $("msgs"), near = !el.children.length || el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  list.forEach(m => { if (m.from) watch(m.from); });          // loads each author's picture
  el.innerHTML = list.length ? list.map(m => {
    const n = who(m), c = colorOf?.(m), u = esc(m.from || ""), t = m.createdAt?.toDate?.().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) || "";
    const rp = m.replyTo && typeof m.replyTo === "object"
      ? `<div class="mreply" data-act="jumpmsg" data-id="${esc(m.replyTo.id || "")}">${I.reply}<b>${esc(m.replyTo.name || "Someone")}</b><span class="rt">${esc(m.replyTo.text || "")}</span></div>` : "";
    return `<div class="m" data-mid="${esc(m.id || "")}"><span class="plink" data-act="profile" data-uid="${u}">${av(n, "nodot")}</span><div class="mbody">${rp}<b class="plink" data-act="profile" data-uid="${u}" ${c ? `style="color:${c}"` : ""}>${esc(n)}</b><small>${t}</small>${m.text ? `<p>${esc(m.text)}</p>` : ""}${okImg(m.image) ? `<a class="mimg" href="${esc(m.image)}" target="_blank" rel="noopener noreferrer"><img class="mimgi" src="${esc(limitw(m.image, 800))}" alt="Image from ${esc(n)}" loading="lazy"></a>` : ""}${rxChips(m)}</div>${m.id ? mTools(m) : ""}</div>`;
  }).join("") : `<div class="empty">${esc(emptyText)}</div>`;
  if (near) el.scrollTop = el.scrollHeight;
  el.querySelectorAll("img.mimgi").forEach(im => { if (!im.complete) im.addEventListener("load", () => { if (near) el.scrollTop = el.scrollHeight; }); });
}

const msgPane = ph => `<div id="msgs" aria-live="polite"></div><div class="replybar" id="replyBar" hidden></div><div class="attachbar" id="attachBar" hidden></div><form class="send" id="sendForm"><button type="button" class="ib attach" data-act="attach" aria-label="Attach an image" title="Attach an image">${I.image}</button><input type="file" id="fMsg" accept="image/png,image/jpeg,image/gif,image/webp" hidden><input id="msgIn" placeholder="${esc(ph)}" autocomplete="off" maxlength="2000" aria-label="Message"><button class="primary" type="submit">Send</button></form><div class="sendnote" id="sendNote" role="status" hidden></div>`;
const bindSend = (col, extra = () => ({}), guard, after) => () => {
  const note = (t, ms = 6000) => {
    const n = $("sendNote"); if (!n) return;
    n.textContent = t; n.hidden = !t; clearTimeout(n._t);
    if (t && ms) n._t = setTimeout(() => { n.hidden = true; }, ms);
  };
  $("sendForm").onsubmit = async e => {
    e.preventDefault();
    const i = $("msgIn"), text = i.value.trim();
    if (attachDraft?.busy) { note("Wait for the image to finish uploading."); return; }
    if (!text && !attachDraft?.url) return;
    if (guard && text) {
      note("Checking your message...", 0);
      const why = await guard(text);
      if (why) { note(`Not sent: ${why}. Try rewording it.`); return; }
      note("");
    }
    const rd = replyDraft, ad = attachDraft;
    i.value = ""; replyDraft = null; attachDraft = null; renderReplyBar(); renderAttachBar();
    try { await addDoc(col(), { from: me.uid, text, ...extra(), ...(rd ? { replyTo: rd } : {}), ...(ad?.url ? { image: ad.url } : {}), createdAt: serverTimestamp() }); await after?.(text, ad?.url); }
    catch (err) { i.value = text; replyDraft = rd; attachDraft = ad; renderReplyBar(); renderAttachBar(); console.error(err); }
  };
  $("fMsg").onchange = e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) attachFile(f, note); };
  $("msgIn").addEventListener("paste", e => {
    const f = [...(e.clipboardData?.files || [])].find(x => x.type.startsWith("image/"));
    if (f) { e.preventDefault(); attachFile(f, note); }
  });
  renderReplyBar(); renderAttachBar();
  $("msgIn").focus();
};

function renderRail() {
  $("servers").innerHTML = myServers.map(x => `<button class="srv ${srv && srv.id === x.id ? "on" : ""}" data-act="server" data-id="${x.id}" data-name="${esc(x.name)}" style="background:${color(x.name)};color:#0b1417" aria-label="${esc(x.name)}" title="${esc(x.name)}">${esc(x.name[0].toUpperCase())}</button>`).join("");
  document.querySelector(".srv.home").classList.toggle("on", !srv);
}

function renderServer() {
  $("homeSide").hidden = true; $("srvSide").hidden = false;
  $("srvName").textContent = srv.name;
  $("addCh").hidden = !can("manageChannels");
  $("setBtn").hidden = !(can("manageRoles") || can("kickMembers"));
  $("leaveBtn").hidden = srv.owner === me.uid;
  const mgr = can("manageChannels"), vis = srv.channels.filter(canSee);
  const chBtn = c => {
    const v = c.type === "voice", liveCall = v && call?.room === roomOf("servers", srv.id, "channels", c.id);
    return `<div class="chwrap" data-drag="chan" data-id="${c.id}" ${mgr ? 'draggable="true"' : ""}><div class="dm ${!v && c.id === srv.cid ? "on" : ""} ${liveCall ? "live" : ""}" role="button" tabindex="0" data-act="chan" data-id="${c.id}" data-type="${v ? "voice" : "text"}"><span>${v ? I.vol : "#"} ${esc(c.name)} ${c.private ? I.lock : ""} ${c.locked && !v ? I.readonly : ""}</span></div>`
      + (mgr ? `<button class="ib chgear" data-act="editchan" data-id="${c.id}" aria-label="Edit channel" title="Edit channel">${I.gear}</button>` : "") + `</div>`
      + (v ? (srv.vparts[c.id] || []).filter(fresh).map(p => `<div class="vp">${av(p.name, "nodot")}<span>${esc(p.name)}</span></div>`).join("") : "");
  };
  const catHead = k => `<div class="cat" data-drag="cat" data-id="${k.id}" ${mgr ? 'draggable="true"' : ""}><span>${esc(k.name)}</span>${mgr ? `<button class="ib chgear" data-act="editcat" data-id="${k.id}" aria-label="Edit category" title="Edit category">${I.gear}</button>` : ""}</div>`;
  $("chList").innerHTML = sorted(vis.filter(c => !knownCat(c.categoryId))).map(chBtn).join("")
    + sorted(srv.cats).map(k => { const list = sorted(vis.filter(c => c.categoryId === k.id)); return list.length || mgr ? catHead(k) + list.map(chBtn).join("") : ""; }).join("");
  $("rightTitle").textContent = `Members — ${srv.members.length}`;
  $("activeList").innerHTML = srv.members.map(m => {
    const c = roleColor(m);
    return `<div class="card plink" data-act="profile" data-uid="${m.id}">${av(m.name, dotCls(m.id))}<div><b ${c ? `style="color:${c}"` : ""}>${esc(m.name)}</b><small>${m.id === srv.owner ? "Owner" : labelOf(m.id)}</small></div></div>`;
  }).join("");
  const ch = srv.channels.find(c => c.id === srv.cid);
  $("top").innerHTML = `<h1>${ch ? "# " + esc(ch.name) : esc(srv.name)}</h1>`;
  if (!ch) { shell("srv:none", `<div class="empty">No text channels yet.</div>`, () => {}); return; }
  shell("srv:" + srv.id + ":" + ch.id, msgPane("Message #" + ch.name),
    bindSend(() => collection(db, "servers", srv.id, "channels", ch.id, "messages"), () => ({ name: me.username }), modGuard));
  const inp = $("msgIn"), ok = can("sendMessages") && canSend(ch);
  if (inp) { inp.disabled = !ok; inp.placeholder = ok ? "Message #" + ch.name : canSend(ch) ? "You don't have permission to send messages." : "This channel is locked. Only staff can send messages here."; }
  fillMsgs(srv.msgs, m => m.name || "Unknown", `Welcome to #${ch.name}. Say something.`, m => roleColor(srv.members.find(x => x.id === m.from)), m => m.from === me.uid || can("manageMessages"));
}

/* ---------- server settings: roles and members ---------- */
Object.assign(I, {
  people: `<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/></svg>`,
  pencil: `<svg viewBox="0 0 24 24"><path d="M4 20l1-4L16.5 4.5a2 2 0 0 1 3 3L8 19zM14 7l3 3"/></svg>`,
  trash: `<svg viewBox="0 0 24 24"><path d="M4 7h16M10 7V4h4v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/></svg>`
});
let setTab = "roles", editRole = null, roleDraft = null, editTab = "display";
const shield = c => `<svg viewBox="0 0 24 24" style="fill:${okHex(c) ? c : "#99aab5"};stroke:none"><path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z"/></svg>`;

function startEdit(id) {
  const r = srv.roles.find(x => x.id === id); if (!r) return;
  editRole = id; editTab = id === "everyone" ? "perms" : "display";
  roleDraft = { id, name: r.name, color: okHex(r.color) ? r.color : "#99aab5", perms: { ...Object.fromEntries(PERMS.map(([k]) => [k, false])), ...(r.perms || {}) } };
}

function refreshSettings(force) {
  if (!srv || $("setModal").hidden) return;
  if (editRole && !force) return;                      // don't wipe what someone is typing
  $("setModal").querySelectorAll(".settabs .tab").forEach(b => b.classList.toggle("on", b.dataset.id === setTab));
  const canRoles = can("manageRoles"), body = $("setBody");
  if (setTab === "roles" && editRole) {
    const r = srv.roles.find(x => x.id === editRole);
    if (!r || !roleDraft) { editRole = null; roleDraft = null; return refreshSettings(true); }
    const ev = r.id === "everyone", d = roleDraft;
    const holders = srv.members.filter(m => (m.roles || []).includes(r.id)), free = srv.members.filter(m => !(m.roles || []).includes(r.id));
    const tabs = ev ? [["perms", "Permissions"]] : [["display", "Display"], ["perms", "Permissions"], ["members", `Manage Members (${holders.length})`]];
    const tab = ev ? "perms" : editTab;
    let main;
    if (tab === "display") {
      main = `<label class="fld">Role name<input data-d="name" maxlength="30" value="${esc(d.name)}"></label>
        <div class="fld">Role color<div class="swatches">${SWATCHES.map(c => `<button type="button" class="sw ${c === d.color ? "on" : ""}" data-act="pickcolor" data-color="${c}" style="background:${c}" aria-label="Color ${c}"></button>`).join("")}<input type="color" id="rColor" data-d="color" value="${d.color}" aria-label="Custom color"></div></div>`;
    } else if (tab === "perms") {
      main = `<label class="search"><input id="pSearch" placeholder="Search permissions" aria-label="Search permissions" autocomplete="off"></label>` + PERM_INFO.map(([g, items]) => {
        const rows = items.filter(([k]) => !(ev && k === "administrator")).map(([k, l, desc]) =>
          `<div class="prow" data-t="${esc((l + " " + desc).toLowerCase())}"><div><b>${l}</b><small>${desc}</small></div><label class="tg"><input type="checkbox" data-p="${k}" ${d.perms[k] ? "checked" : ""} aria-label="${l}"><span></span></label></div>`).join("");
        return rows ? `<div class="pgroup"><h4>${g}</h4>${rows}</div>` : "";
      }).join("");
    } else {
      main = `<div class="mlist">` + (holders.map(m => `<div class="mrow2"><div class="mtop">${av(m.name, "nodot")}<b>${esc(m.name)}</b><button class="ib" data-act="unrole" data-uid="${m.id}" data-id="${r.id}" aria-label="Remove ${esc(m.name)} from this role" title="Remove from role">${I.x}</button></div></div>`).join("") || `<div class="empty">Nobody has this role yet.</div>`) + `</div>`
        + (free.length ? `<select class="addmember" data-rid="${r.id}" aria-label="Add a member to this role"><option value="">+ Add member</option>${free.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join("")}</select>` : "");
    }
    body.innerHTML = `<button class="link" data-act="roleback">← Back to roles</button><h3>${esc(d.name)}</h3>`
      + (tabs.length > 1 ? `<div class="settabs">${tabs.map(([k, l]) => `<button class="tab ${k === tab ? "on" : ""}" data-act="roletab" data-id="${k}">${l}</button>`).join("")}</div>` : "")
      + main + `<div class="row-actions"><button class="primary" data-act="saverole">Save changes</button>${ev ? "" : `<button class="danger" data-act="delrole" data-id="${r.id}">Delete role</button>`}</div>`;
    return;
  }
  if (setTab === "roles") {
    const count = r => r.id === "everyone" ? srv.members.length : srv.members.filter(m => (m.roles || []).includes(r.id)).length;
    body.innerHTML = `<div class="rhead"><span>Roles — ${srv.roles.length}</span><span>Members</span></div><div class="rlist">`
      + srv.roles.map(r => `<div class="rrow"><span class="shield">${shield(r.color)}</span><b>${esc(r.name)}</b><span class="cnt">${count(r)} ${I.people}</span>`
        + (canRoles ? btn("editrole", r.id, "Edit role", I.pencil) + (r.id === "everyone" ? "" : btn("delrole", r.id, "Delete role", I.trash)) : "") + `</div>`).join("")
      + `</div>` + (canRoles ? `<button class="primary" data-act="newrole">Create role</button>` : "");
    return;
  }
  if (setTab === "invite") {
    const owner = srv.owner === me.uid, code = srv.inviteCode || srv.id, base = `${location.host}${location.pathname}?join=`;
    body.innerHTML = `<div class="fld">Invite link<div class="upl"><input id="invLink" readonly value="${esc(inviteLink(code))}" aria-label="Invite link"><button class="primary sm" data-act="copyinvite">Copy</button></div></div>`
      + (owner ? `<form id="invForm" class="fld">Custom invite code<div class="upl"><span class="hint2">${esc(base)}</span><input id="invCode" maxlength="32" value="${esc(srv.inviteCode || "")}" placeholder="my-server" autocomplete="off"><button class="primary sm" type="submit">Save</button></div>
          <span class="hint2">3 to 32 letters, numbers, or hyphens. Old links stop working when you change it.</span>${srv.inviteCode ? `<button type="button" class="link" data-act="resetinvite">Go back to a random code</button>` : ""}</form>`
        : `<span class="hint2">Only the server owner can change the invite link.</span>`);
    return;
  }
  if (setTab === "moderation") {
    const owner = srv.owner === me.uid;
    body.innerHTML = `<form id="modForm" class="pform" style="padding:0">
      <label class="chk"><input type="checkbox" id="modOn" ${srv.moderation ? "checked" : ""} ${owner ? "" : "disabled"}><span><b>Block unfriendly messages</b><small>Messages in this server are checked before they send. ${SERVER_ON ? "The AI check is on." : "Only the built-in filter is on, because the Cove server isn't set up for the AI check yet."}</small></span></label>
      <label class="fld">Extra blocked words, one per line<textarea id="modWords" rows="5" maxlength="1500" ${owner ? "" : "disabled"}>${esc((srv.blockedWords || []).join("\n"))}</textarea></label>
      ${owner ? `<button class="primary" type="submit">Save</button>` : `<span class="hint2">Only the server owner can change moderation.</span>`}</form>`;
    return;
  }
  body.innerHTML = `<div class="mlist">` + srv.members.map(m => {
    const owner = m.id === srv.owner, mine = (m.roles || []).map(id => srv.roles.find(r => r.id === id)).filter(Boolean);
    const free = srv.roles.filter(r => r.id !== "everyone" && !(m.roles || []).includes(r.id)), c = roleColor(m);
    return `<div class="mrow2"><div class="mtop">${av(m.name, "nodot")}<b ${c ? `style="color:${c}"` : ""}>${esc(m.name)}${owner ? " (owner)" : ""}</b>`
      + (can("kickMembers") && !owner && m.id !== me.uid ? `<button class="danger" data-act="kick" data-id="${m.id}">Kick</button>` : "") + `</div><div class="chips">`
      + mine.map(r => `<span class="chip" style="--c:${okHex(r.color) ? r.color : "#99aab5"}"><i></i>${esc(r.name)}${canRoles ? `<button data-act="unrole" data-uid="${m.id}" data-id="${r.id}" aria-label="Remove ${esc(r.name)}">×</button>` : ""}</span>`).join("")
      + (canRoles && free.length ? `<select class="addrole" data-uid="${m.id}" aria-label="Add a role to ${esc(m.name)}"><option value="">+ Add role</option>${free.map(r => `<option value="${r.id}">${esc(r.name)}</option>`).join("")}</select>` : "")
      + `</div></div>`;
  }).join("") + `</div>`;
}

async function syncMembers(list, rolesList, newIds) {       // rewrite roles + extra permissions on many members at once
  for (let i = 0; i < list.length; i += 5) {
    const b = writeBatch(db);
    list.slice(i, i + 5).forEach(m => { const ids = newIds(m); b.update(doc(db, "servers", srv.id, "members", m.id), { roles: ids, perms: extraPerms(ids, rolesList) }); });
    await b.commit();
  }
}
const setMemberRoles = (uid, ids) => updateDoc(doc(db, "servers", srv.id, "members", uid), { roles: ids, perms: extraPerms(ids, srv.roles) });

async function saveRole() {
  const d = roleDraft; if (!d) return;
  const id = d.id, ev = id === "everyone", perms = { ...d.perms };
  if (ev) perms.administrator = false;                  // "everyone" can never be Administrator
  const upd = ev ? { perms } : { name: d.name.trim() || "new role", color: okHex(d.color) ? d.color : "#99aab5", perms };
  await updateDoc(doc(db, "servers", srv.id, "roles", id), upd);
  if (!ev) await syncMembers(srv.members.filter(m => (m.roles || []).includes(id)), srv.roles.map(r => r.id === id ? { ...r, ...upd } : r), m => m.roles || []);
}

async function deleteRole(id) {
  const r = srv.roles.find(x => x.id === id);
  if (!r || id === "everyone" || !confirm(`Delete the role "${r.name}"? Everyone who has it will lose it.`)) return false;
  await syncMembers(srv.members.filter(m => (m.roles || []).includes(id)), srv.roles.filter(x => x.id !== id), m => (m.roles || []).filter(x => x !== id));
  await deleteDoc(doc(db, "servers", srv.id, "roles", id));
  return true;
}

/* ---------- profiles ---------- */
const fmtDate = d => d ? d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "Unknown";

async function openProfile(uid, edit = false) {
  if (!uid || !me) return;
  $("profModal").hidden = false; $("profBody").innerHTML = `<div class="empty">Loading...</div>`;
  watch(uid);
  let u = null;
  try { u = (await getDoc(doc(db, "users", uid))).data(); } catch (e) { console.error(e); }
  if (!u) { $("profBody").innerHTML = `<div class="empty">Couldn't load this profile.</div><div class="row-actions" style="padding:0 18px 18px"><button class="link" data-act="closeprof">Close</button></div>`; return; }
  renderProfile(uid, u, edit && uid === me.uid);
}

let profDraft = { avatarUrl: "", bannerUrl: "" };
const bannerStyle = (c, url) => `background-color:${c};` + (url ? `background-image:url('${thumb(url, 720, 240)}');background-size:cover;background-position:center` : "");
function paintProfPreview() {
  const b = document.querySelector("#profBody .pbanner"), a = document.querySelector("#profBody .pbig");
  if (b) b.setAttribute("style", bannerStyle($("pColor").value, profDraft.bannerUrl));
  if (a) a.innerHTML = av(me.username, dotCls(me.uid), profDraft.avatarUrl);
}
async function handleUpload(input, key) {
  const f = input.files?.[0]; input.value = ""; if (!f) return;
  const say = t => { $("profMsg").textContent = t; };
  say("Uploading...");
  try { profDraft[key] = await uploadImage(f); paintProfPreview(); say("Uploaded. Press Save to keep it."); }
  catch (err) { console.error(err); say(err.message || "The upload failed."); }
}

function renderProfile(uid, u, editing) {
  const mine = uid === me.uid, banner = okHex(u.bannerColor) ? u.bannerColor : "#5ec8b4", name = u.username || "Unknown";
  const made = u.createdAt?.toDate?.() || (mine ? new Date(auth.currentUser.metadata.creationTime) : null);
  const mem = srv?.members.find(x => x.id === uid);
  const avatarUrl = okImg(u.avatarUrl) ? u.avatarUrl : "", bannerUrl = okImg(u.bannerUrl) ? u.bannerUrl : "";
  const head = `<div class="pbanner" style="${bannerStyle(banner, bannerUrl)}"></div><div class="pbig">${av(name, dotCls(uid), avatarUrl)}</div>`;
  if (editing) {
    profDraft = { avatarUrl, bannerUrl };
    const upl = (label, pick, clear) => CLOUD_ON
      ? `<div class="fld">${label}<div class="upl"><button type="button" class="primary sm" data-act="${pick}">Upload</button><button type="button" class="link" data-act="${clear}">Remove</button></div></div>`
      : `<div class="fld">${label}<span class="hint2">Uploads need a one-time setup by whoever runs Cove.</span></div>`;
    $("profBody").innerHTML = head + `<form id="profForm" class="pform"><h2>Edit profile</h2>
      ${upl("Profile picture", "pickavatar", "clearavatar")}${upl("Banner image", "pickbannerimg", "clearbannerimg")}
      ${CLOUD_ON ? `<span class="hint2">PNG, JPG, GIF, or WebP up to 8 MB. GIFs stay animated.</span>` : ""}
      <input type="file" id="fAv" accept="image/png,image/jpeg,image/gif,image/webp" hidden><input type="file" id="fBn" accept="image/png,image/jpeg,image/gif,image/webp" hidden>
      <label class="fld">Pronouns<input id="pPron" maxlength="24" value="${esc(u.pronouns || "")}" placeholder="for example: she/her" autocomplete="off"></label>
      <label class="fld">About me<textarea id="pBio" maxlength="190" rows="4" placeholder="Tell people about yourself">${esc(u.bio || "")}</textarea></label>
      <div class="fld">Banner color<div class="swatches">${SWATCHES.map(c => `<button type="button" class="sw ${c === banner ? "on" : ""}" data-act="pickbanner" data-color="${c}" style="background:${c}" aria-label="Color ${c}"></button>`).join("")}<input type="color" id="pColor" value="${banner}" aria-label="Custom color"></div></div>
      <div class="row-actions"><button class="primary" type="submit">Save</button><button class="link" type="button" data-act="closeprof">Cancel</button></div><div class="msg" id="profMsg" role="status"></div></form>`;
    $("pColor").oninput = paintProfPreview;
    $("fAv").onchange = e => handleUpload(e.target, "avatarUrl");
    $("fBn").onchange = e => handleUpload(e.target, "bannerUrl");
    $("profForm").onsubmit = async e => {
      e.preventDefault();
      try {
        await updateDoc(doc(db, "users", me.uid), { pronouns: $("pPron").value.trim(), bio: $("pBio").value.trim(), bannerColor: $("pColor").value, avatarUrl: profDraft.avatarUrl || "", bannerUrl: profDraft.bannerUrl || "" });
        setPhoto({ username: me.username, avatarUrl: profDraft.avatarUrl }); renderMe(); render();
        openProfile(me.uid, false);
      } catch (err) { console.error(err); $("profMsg").textContent = "Couldn't save your profile."; }
    };
    return;
  }
  const roles = mem ? (mem.roles || []).map(id => srv.roles.find(r => r.id === id)).filter(Boolean) : [];
  $("profBody").innerHTML = head + `<div class="pinfo"><h2>${esc(name)}</h2>${u.pronouns ? `<div class="pron">${esc(u.pronouns)}</div>` : ""}<div class="pstat">${labelOf(uid)}</div>`
    + (u.bio ? `<h4>About me</h4><p class="bio">${esc(u.bio)}</p>` : "")
    + `<h4>Member since</h4><p>${fmtDate(made)}</p>`
    + (mem?.joinedAt?.toDate ? `<h4>Joined ${esc(srv.name)}</h4><p>${fmtDate(mem.joinedAt.toDate())}</p>` : "")
    + (roles.length ? `<h4>Roles</h4><div class="chips">${roles.map(r => `<span class="chip" style="--c:${okHex(r.color) ? r.color : "#99aab5"}"><i></i>${esc(r.name)}</span>`).join("")}</div>` : "")
    + `<div class="row-actions" style="margin-top:12px">${mine ? `<button class="primary" data-act="editprofile">Edit profile</button>` : `<button class="primary" data-act="dmuser" data-uid="${uid}">Message</button>`}<button class="link" data-act="closeprof">Close</button></div></div>`;
}

/* ---------- channel order, privacy, editing ---------- */
Object.assign(I, {
  lock: `<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>`,
  gear: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/></svg>`
});
I.readonly = `<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-3.9A8 8 0 0 1 20 12z"/><path d="M5 5l14 14"/></svg>`;
const pos = x => (typeof x.position === "number" ? x.position : x.createdAt?.toMillis?.() || 0);
const sorted = a => [...a].sort((x, y) => pos(x) - pos(y));
const knownCat = id => !!id && srv.cats.some(k => k.id === id);
// private channels: the owner, people who manage channels, and the chosen roles. The database rules enforce the same thing.
const canSee = c => {
  if (!c.private || srv.owner === me.uid) return true;
  const m = srv.members.find(x => x.id === me.uid);
  return !!(m?.perms?.manageChannels || (c.allowedRoles || []).some(r => (m?.roles || []).includes(r)));
};
// locked channel: everyone reads, only the owner, people who manage channels (administrators included), and chosen roles type
const canSend = c => {
  if (!c.locked || srv.owner === me.uid) return true;
  const m = srv.members.find(x => x.id === me.uid);
  return !!(m?.perms?.manageChannels || (c.lockRoles || []).some(r => (m?.roles || []).includes(r)));
};
function ensureChannel(s) {
  if (srv !== s) return;
  const ok = sorted(s.channels.filter(x => x.type !== "voice" && canSee(x)));
  if (!ok.some(x => x.id === s.cid)) selectChannel(ok[0]?.id);
}
const chRef = id => doc(db, "servers", srv.id, "channels", id), catRef = id => doc(db, "servers", srv.id, "categories", id);
async function commitWrites(writes) {                 // small batches stay inside Firestore's rule-lookup limit
  for (let i = 0; i < writes.length; i += 5) {
    const b = writeBatch(db); writes.slice(i, i + 5).forEach(([ref, data]) => b.update(ref, data)); await b.commit();
  }
}
function chLists() {
  const L = { "": sorted(srv.channels.filter(c => !knownCat(c.categoryId))) };
  srv.cats.forEach(k => { L[k.id] = sorted(srv.channels.filter(c => c.categoryId === k.id)); });
  return L;
}
async function moveChannel(id, info) {
  const ch = srv.channels.find(c => c.id === id); if (!ch || info.id === id) return;
  const L = chLists(), from = knownCat(ch.categoryId) ? ch.categoryId : "", rest = k => L[k].filter(c => c.id !== id);
  let to, idx;
  if (info.zone === "end") { to = ""; idx = rest("").length; }
  else if (info.kind === "cat") { to = info.id; idx = 0; }                      // dropped on a category name: top of that category
  else {
    const tc = srv.channels.find(c => c.id === info.id); if (!tc) return;
    to = knownCat(tc.categoryId) ? tc.categoryId : "";
    idx = rest(to).findIndex(c => c.id === info.id) + (info.after ? 1 : 0);
  }
  const target = rest(to); target.splice(idx, 0, ch);
  const writes = [], put = (list, key) => list.forEach((c, i) => { if (c.position !== i || (c.categoryId || "") !== key) writes.push([chRef(c.id), { categoryId: key || null, position: i }]); });
  put(target, to); if (from !== to) put(rest(from), from);
  await commitWrites(writes);
}
async function moveCategory(id, info) {
  const k = srv.cats.find(x => x.id === id); if (!k || info.id === id) return;
  const cats = sorted(srv.cats).filter(x => x.id !== id);
  let idx = cats.length;
  if (info.kind === "cat") idx = cats.findIndex(x => x.id === info.id) + (info.after ? 1 : 0);
  else if (info.zone !== "end") return;
  cats.splice(idx, 0, k);
  await commitWrites(cats.flatMap((c, i) => (c.position !== i ? [[catRef(c.id), { position: i }]] : [])));
}
async function deleteChannel(id) {
  const c = srv.channels.find(x => x.id === id);
  if (!c || !confirm(`Delete #${c.name}? Its messages can't be recovered.`)) return false;
  await deleteDoc(chRef(id)); return true;
}
async function deleteCategory(id) {
  const k = srv.cats.find(x => x.id === id);
  if (!k || !confirm(`Delete the category "${k.name}"? Its channels stay, outside any category.`)) return false;
  await commitWrites(srv.channels.filter(c => c.categoryId === id).map(c => [chRef(c.id), { categoryId: null }]));
  await deleteDoc(catRef(id)); return true;
}

let edit = null;
function openEdit(kind, id) {
  if (!srv) return;
  const actions = word => `<div class="row-actions"><button class="primary" data-act="saveedit">Save</button><button class="danger" data-act="deledit">Delete ${word}</button><button class="link" data-act="closeedit">Cancel</button></div><div class="msg" id="edMsg" role="status"></div>`;
  if (kind === "cat") {
    const k = srv.cats.find(x => x.id === id); if (!k) return;
    $("edBody").innerHTML = `<div class="pform"><h2>Edit category</h2><label class="fld">Category name<input id="edName" maxlength="30" value="${esc(k.name)}" autocomplete="off"></label>${actions("category")}</div>`;
  } else {
    const c = srv.channels.find(x => x.id === id); if (!c) return;
    const roles = srv.roles.filter(r => r.id !== "everyone"), voice = c.type === "voice";
    const checks = (attr, sel) => roles.length
      ? roles.map(r => `<label><input type="checkbox" ${attr}="${r.id}" ${sel.includes(r.id) ? "checked" : ""}><span class="chip" style="--c:${okHex(r.color) ? r.color : "#99aab5"}"><i></i>${esc(r.name)}</span></label>`).join("")
      : `<small>Make a role first in Server settings, then come back here.</small>`;
    $("edBody").innerHTML = `<div class="pform"><h2>Edit ${voice ? "voice " : ""}channel</h2>
      <label class="fld">Channel name<input id="edName" maxlength="30" value="${esc(c.name)}" autocomplete="off"></label>
      <label class="fld">Category<select id="edCat"><option value="">No category</option>${sorted(srv.cats).map(k => `<option value="${k.id}" ${k.id === c.categoryId ? "selected" : ""}>${esc(k.name)}</option>`).join("")}</select></label>
      <label class="chk"><input type="checkbox" id="edPrivate" ${c.private ? "checked" : ""}><span><b>Private channel</b><small>Only the roles you pick can see and use it. The owner and people who manage channels always can.</small></span></label>
      <div id="edRoles" class="perms col" ${c.private ? "" : "hidden"}>${checks("data-r", c.allowedRoles || [])}</div>
      ${voice ? "" : `<label class="chk"><input type="checkbox" id="edLocked" ${c.locked ? "checked" : ""}><span><b>Lock channel (view only)</b><small>Everyone who can see it can read it, but only the owner, administrators, people who manage channels, and the roles you pick can type.</small></span></label>
      <div id="edLockRoles" class="perms col" ${c.locked ? "" : "hidden"}>${checks("data-l", c.lockRoles || [])}</div>`}
      ${actions("channel")}</div>`;
    $("edPrivate").onchange = e => { $("edRoles").hidden = !e.target.checked; };
    if (!voice) $("edLocked").onchange = e => { $("edLockRoles").hidden = !e.target.checked; };
  }
  edit = { kind, id }; $("edModal").hidden = false;
}
async function saveEdit() {
  if (!edit || !srv) return;
  const say = t => { $("edMsg").textContent = t; };
  try {
    if (edit.kind === "cat") {
      const name = $("edName").value.trim(); if (!name) return say("Give it a name.");
      await updateDoc(catRef(edit.id), { name });
    } else {
      const c = srv.channels.find(x => x.id === edit.id), cat = $("edCat").value || null, priv = $("edPrivate").checked;
      const upd = { name: slug($("edName").value) || c.name, categoryId: cat, private: priv,
        allowedRoles: priv ? [...document.querySelectorAll("#edRoles [data-r]")].filter(b => b.checked).map(b => b.dataset.r) : [] };
      if (c.type !== "voice") { const lk = $("edLocked").checked; upd.locked = lk; upd.lockRoles = lk ? [...document.querySelectorAll("#edLockRoles [data-l]")].filter(b => b.checked).map(b => b.dataset.l) : []; }
      if ((c.categoryId || null) !== cat) upd.position = Date.now();               // moved to another category: goes to the end of it
      await updateDoc(chRef(edit.id), upd);
    }
    $("edModal").hidden = true; edit = null;
  } catch (err) { console.error(err); say("Couldn't save that. You may not have permission."); }
}

function render() {
  if (!me) return;
  renderRail(); setBadges();
  if (srv) return renderServer();
  $("homeSide").hidden = false; $("srvSide").hidden = true; $("rightTitle").textContent = "Active now";
  const fr = accepted().sort((a, b) => (+isOnline(other(b))) - (+isOnline(other(a))) || nameOf(a).localeCompare(nameOf(b)));
  $("dms").innerHTML = dmEntries().map(dmRow).join("") || `<p class="hint">Add a friend to start a conversation.</p>`;
  const on = fr.filter(r => isOnline(other(r)));
  $("activeList").innerHTML = on.length
    ? on.map(r => `<div class="card plink" data-act="profile" data-uid="${other(r)}">${av(nameOf(r), dotCls(other(r)))}<div><b>${esc(nameOf(r))}</b><small>${labelOf(other(r))}</small></div></div>`).join("")
    : `<p class="hint">Nobody is online right now.</p>`;

  const incoming = rels.filter(r => r.status === "pending" && r.to === me.uid).length;
  $("top").innerHTML = chat
    ? chatHeader()
    : `<h1>Friends</h1>` + [["online", "Online"], ["all", "All"], ["pending", "Pending" + (incoming ? ` (${incoming})` : "")]]
        .map(([k, l]) => `<button class="tab ${tab === k ? "on" : ""}" data-tab="${k}" role="tab">${l}</button>`).join("")
      + `<button class="tab cta" data-tab="add" role="tab">Add friend</button>`;

  if (chat) {
    const c0 = chat;
    shell("chat:" + chat.id, msgPane("Message " + chat.name), bindSend(() => collection(db, "chats", c0.id, "messages"), undefined, undefined, (text, img) => sentInChat(c0, text, img)));
    fillMsgs(chatMsgs, m => nameOfUid(m.from), chat.type === "group" ? "This is the start of the group chat. Say hi." : `This is the start of your chat with ${chat.name}. Say hi.`);
  } else if (tab === "add") {
    shell("add",
      `<div class="addbox"><b>Add a friend</b><p>Enter their username to send a friend request.</p><form id="addForm" style="display:flex;gap:8px"><label class="search" style="flex:1"><input id="uname" placeholder="Username" aria-label="Username" autocomplete="off"></label><button class="primary" type="submit">Send request</button></form><div class="msg" id="addMsg" role="status"></div></div>`,
      () => {
        $("addForm").onsubmit = async e => {
          e.preventDefault();
          const v = $("uname").value.trim(), out = $("addMsg");
          if (!v) { out.textContent = "Enter a username first."; return; }
          try { out.textContent = await sendRequest(v); $("uname").value = ""; }
          catch (err) { out.textContent = "Couldn't send that. Check your connection and try again."; console.error(err); }
        };
      });
  } else {
    shell("list", `<label class="search">${I.search}<input id="s" placeholder="Search" aria-label="Search friends"></label><div id="list"></div>`,
      () => { $("s").oninput = e => { q = e.target.value.toLowerCase(); fillList(); }; });
    fillList();
  }
}

/* ---------- clicks ---------- */
document.addEventListener("click", e => {
  const t = e.target.closest("[data-act],[data-tab]");
  if (!t || !me) { if (!t) hidePops(); return; }
  const rect0 = t.getBoundingClientRect(), appEl = $("app"), a0 = t.dataset.act;
  if (t.dataset.tab || a0 === "home" || a0 === "chat" || (a0 === "chan" && t.dataset.type !== "voice")) { callView = false; renderCall(); }
  if (a0 === "statusmenu") { const m = $("statusMenu"); m.hidden = !m.hidden; $("meBtn").setAttribute("aria-expanded", String(!m.hidden)); return; }
  hidePops();
  if (a0 === "setstatus") { setStatus(t.dataset.s); return; }
  if (a0 === "editprofile") { openProfile(me.uid, true); return; }
  if (a0 === "menu") { appEl.classList.toggle("nav-open"); appEl.classList.remove("mem-open"); return; }
  if (a0 === "members") { appEl.classList.toggle("mem-open"); appEl.classList.remove("nav-open"); return; }
  if (a0 !== "server") appEl.classList.remove("nav-open", "mem-open");   // keep the menu open after picking a server so you can pick a channel
  if (t.dataset.tab) { closeChat(); closeServer(); tab = t.dataset.tab; q = ""; shellFor = null; return render(); }
  const { act, id } = t.dataset, r = rels.find(x => x.id === id), ref = doc(db, "friendships", id || "x");
  if (act === "home") { closeChat(); closeServer(); shellFor = null; render(); }
  else if (act === "server") openServer(id, t.dataset.name);
  else if (act === "chan") {
    if (t.dataset.type === "voice") {
      const base = ["servers", srv.id, "channels", id], c = srv.channels.find(x => x.id === id);
      if (call?.room === roomOf(...base)) { callView = true; renderCall(); } else joinCall(base, `${srv.name} / ${c?.name || "voice"}`);
    }
    else { selectChannel(id); render(); }
  }
  else if (act === "dmcall" && chat) joinCall(["chats", chat.id], "Call with " + chat.name);
  else if (act === "leavecall") leaveCall();
  else if (act === "callview" && call) { callView = true; renderCall(); }
  else if (act === "callhide") { callView = false; renderCall(); }
  else if (act === "tmic") $("mic").click();
  else if (act === "tdeaf") $("deaf").click();
  else if (act === "tcam") toggleCam();
  else if (act === "tscreen") toggleScreen();
  else if (act === "settings" && srv) { setTab = "roles"; editRole = null; roleDraft = null; $("setMsg").textContent = ""; $("setModal").hidden = false; refreshSettings(true); }
  else if (act === "closeset") $("setModal").hidden = true;
  else if (act === "settab") { setTab = id; editRole = null; roleDraft = null; $("setMsg").textContent = ""; refreshSettings(true); }
  else if (act === "editrole" && srv) { startEdit(id); $("setMsg").textContent = ""; refreshSettings(true); }
  else if (act === "roleback") { editRole = null; roleDraft = null; refreshSettings(true); }
  else if (act === "roletab") { editTab = id; refreshSettings(true); }
  else if (act === "newrole" && srv) {
    addDoc(collection(db, "servers", srv.id, "roles"), { name: "new role", color: "#99aab5", perms: Object.fromEntries(PERMS.map(([k]) => [k, false])), createdAt: serverTimestamp() })
      .then(d => { startEdit(d.id); refreshSettings(true); }).catch(err => { console.error(err); $("setMsg").textContent = "Couldn't add that role."; });
  }
  else if (act === "delrole" && srv) {
    deleteRole(id).then(ok => { if (ok) { editRole = null; roleDraft = null; refreshSettings(true); } }).catch(err => { console.error(err); $("setMsg").textContent = "Couldn't delete that role."; });
  }
  else if (act === "unrole" && srv) {
    const m = srv.members.find(x => x.id === t.dataset.uid);
    if (m) setMemberRoles(m.id, (m.roles || []).filter(x => x !== id)).then(() => { if (editRole) refreshSettings(true); }).catch(err => { console.error(err); $("setMsg").textContent = "Couldn't change that."; });
  }
  else if (act === "pickcolor") { if (roleDraft) roleDraft.color = t.dataset.color; $("rColor").value = t.dataset.color; document.querySelectorAll("#setBody .sw").forEach(b => b.classList.toggle("on", b === t)); }
  else if (act === "pickbanner") { $("pColor").value = t.dataset.color; paintProfPreview(); document.querySelectorAll("#profBody .sw").forEach(b => b.classList.toggle("on", b === t)); }
  else if (act === "profile") { $("grpModal").hidden = true; openProfile(t.dataset.uid); }
  else if (act === "pickavatar") $("fAv")?.click();
  else if (act === "pickbannerimg") $("fBn")?.click();
  else if (act === "clearavatar") { profDraft.avatarUrl = ""; paintProfPreview(); }
  else if (act === "clearbannerimg") { profDraft.bannerUrl = ""; paintProfPreview(); }
  else if (act === "closeprof") $("profModal").hidden = true;
  else if (act === "dmuser") { $("profModal").hidden = true; startDm(t.dataset.uid).catch(err => { console.error(err); alert("Couldn't start that chat."); }); }
  else if (act === "newgroup") openGroupCreate();
  else if (act === "mkgroup") mkGroup();
  else if (act === "groupinfo") openGroupInfo();
  else if (act === "savegroup") saveGroup();
  else if (act === "leavegroup") leaveGroup();
  else if (act === "closegrp") $("grpModal").hidden = true;
  else if (act === "enablenotifs") { if ("Notification" in window) Notification.requestPermission().then(updateNotifBar).catch(updateNotifBar); }
  else if (act === "dismissnotifs") { try { localStorage.setItem("cove_notif_off", "1"); } catch {} updateNotifBar(); }
  else if (act === "attach") $("fMsg")?.click();
  else if (act === "clearattach") { attachDraft = null; renderAttachBar(); }
  else if (act === "copyinvite" && srv) {
    const link = inviteLink(srv.inviteCode || srv.id);
    (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(() => { $("setMsg").textContent = "Link copied."; }).catch(() => prompt("Copy this link:", link));
  }
  else if (act === "resetinvite" && srv) saveInvite("").then(() => { $("setMsg").textContent = "Back to a random code."; refreshSettings(true); }).catch(err => { $("setMsg").textContent = err.message; });
  else if (act === "editchan" && srv) openEdit("chan", id);
  else if (act === "editcat" && srv) openEdit("cat", id);
  else if (act === "delchan" && srv) deleteChannel(id).catch(err => { console.error(err); alert("Couldn't delete that channel."); });
  else if (act === "delcat" && srv) deleteCategory(id).catch(err => { console.error(err); alert("Couldn't delete that category."); });
  else if (act === "saveedit") saveEdit();
  else if (act === "deledit" && edit) {
    const e0 = edit;
    (e0.kind === "cat" ? deleteCategory(e0.id) : deleteChannel(e0.id))
      .then(ok => { if (ok) { $("edModal").hidden = true; edit = null; } })
      .catch(err => { console.error(err); $("edMsg").textContent = "Couldn't delete that."; });
  }
  else if (act === "closeedit") { $("edModal").hidden = true; edit = null; }
  else if (act === "delmsg") {
    const col = msgCol();
    if (col && confirm("Delete this message?")) deleteDoc(doc(col, id)).catch(err => { console.error(err); alert("Couldn't delete that message."); });
  }
  else if (act === "react") toggleReact(id, t.dataset.e).catch(err => { console.error(err); alert("Couldn't add that reaction."); });
  else if (act === "pickreact") openPicker(id, rect0);
  else if (act === "pickemoji") { if (pickTarget) toggleReact(pickTarget, t.dataset.e).catch(err => { console.error(err); alert("Couldn't add that reaction."); }); }
  else if (act === "reply") { const m = curMsgs().find(x => x.id === id); if (m) setReply(m); }
  else if (act === "cancelreply") { replyDraft = null; renderReplyBar(); }
  else if (act === "msgmenu") openMsgMenu(id, rect0.left, rect0.bottom);
  else if (act === "copytext") { const m = curMsgs().find(x => x.id === id); if (m) navigator.clipboard?.writeText(m.text || "").catch(() => {}); }
  else if (act === "jumpmsg") jumpTo(id);
  else if (act === "lockchan" && srv) {
    const c = srv.channels.find(x => x.id === id);
    if (c) updateDoc(chRef(id), { locked: !c.locked }).catch(err => { console.error(err); alert("Couldn't change that channel."); });
  }
  else if (act === "saverole" && srv) {
    saveRole().then(() => { $("setMsg").textContent = "Saved."; }).catch(err => { console.error(err); $("setMsg").textContent = "Couldn't save that."; });
  }
  else if (act === "kick" && srv) {
    const m = srv.members.find(x => x.id === id);
    if (m && confirm(`Kick ${m.name} from the server?`)) deleteDoc(doc(db, "servers", srv.id, "members", id)).catch(err => { console.error(err); $("setMsg").textContent = "Couldn't kick them."; });
  }
  else if (act === "closech") $("chModal").hidden = true;
  else if (act === "newserver") { $("modalMsg").textContent = ""; $("modal").hidden = false; $("srvNameIn").focus(); }
  else if (act === "closemodal") $("modal").hidden = true;
  else if (act === "invite" && srv) prompt("Invite link. Copy it and send it to your friends:", inviteLink(srv.inviteCode || srv.id));
  else if ((act === "newchannel" || act === "ctxcat") && srv) {
    $("chMsg").textContent = "";
    $("chCat").innerHTML = `<option value="">No category</option>` + sorted(srv.cats).map(k => `<option value="${k.id}">${esc(k.name)}</option>`).join("");
    const vo = $("chType").querySelector('option[value="voice"]'); vo.hidden = vo.disabled = !CALLS_ON; $("chType").value = "text";
    $("chModal").hidden = false; $(act === "ctxcat" ? "catName" : "chName").focus();
  }
  else if (act === "leave" && srv) leaveServerById(srv.id, srv.name).catch(err => { console.error(err); alert("Couldn't leave that server."); });
  else if (act === "leaveid") leaveServerById(id, myServers.find(x => x.id === id)?.name || "this server").catch(err => { console.error(err); alert("Couldn't leave that server."); });
  else if (act === "delserver" && srv) deleteServerById(srv.id, srv.name).catch(err => { console.error(err); alert("Couldn't delete that server."); });
  else if (act === "delserverid") deleteServerById(id, myServers.find(x => x.id === id)?.name || "").catch(err => { console.error(err); alert("Couldn't delete that server."); });
  else if (act === "srvmenu" && srv) {
    const items = [["invite", "Invite People", ""]];
    if (can("manageRoles") || can("kickMembers")) items.push(["settings", "Server Settings", ""]);
    if (can("manageChannels")) items.push(["newchannel", "Create Channel", ""], ["ctxcat", "Create Category", ""]);
    items.push(["sep"], srv.owner === me.uid ? ["delserver", "Delete Server", "", "red"] : ["leave", "Leave Server", "", "red"]);
    showCtx(items, rect0.left, rect0.bottom + 4);
  }
  else if (act === "chat") openConvoById(id);
  else if (act === "accept") updateDoc(ref, { status: "accepted" });
  else if (act === "decline" || act === "cancel") deleteDoc(ref);
  else if (act === "remove" && r && confirm(`Remove ${nameOf(r)} from your friends?`)) deleteDoc(ref);
});

$("createForm").onsubmit = async e => {
  e.preventDefault();
  const n = $("srvNameIn").value.trim(); if (!n) return;
  try { const id = await createServer(n); $("modal").hidden = true; $("srvNameIn").value = ""; openServer(id, n); }
  catch (err) { $("modalMsg").textContent = "Couldn't create the server. Try again."; console.error(err); }
};
$("joinForm").onsubmit = async e => {
  e.preventDefault();
  try {
    const j = await joinServer($("codeIn").value);
    if (!j) { $("modalMsg").textContent = "That invite code doesn't match a server."; return; }
    $("modal").hidden = true; $("codeIn").value = ""; openServer(j.id, j.name);
  } catch (err) { $("modalMsg").textContent = "Couldn't join. Try again."; console.error(err); }
};

["mic", "deaf"].forEach(id => $(id).onclick = e => {
  const b = e.currentTarget; b.setAttribute("aria-pressed", b.getAttribute("aria-pressed") !== "true"); applyAudio();
});
$("logout").onclick = async () => {
  await leaveCall();
  try { await set(dbRef(rtdb, "status/" + me.uid), { state: "offline", changed: rtStamp() }); } catch {}
  signOut(auth);
};
$("verifyOut").onclick = () => signOut(auth);
$("verifiedBtn").onclick = async () => {
  const u = auth.currentUser; if (!u) return;
  await u.reload();
  if (u.emailVerified) { await u.getIdToken(true); location.reload(); }
  else $("verifyMsg").textContent = "Not verified yet. Open the link in the email first.";
};
let resendWait = false;
$("resendBtn").onclick = async () => {
  if (resendWait || !auth.currentUser) return;
  resendWait = true; setTimeout(() => resendWait = false, 60000);
  try { await sendEmailVerification(auth.currentUser); $("verifyMsg").textContent = "Email sent again. It can take a minute."; }
  catch (err) { $("verifyMsg").textContent = nice(err); }
};

/* ---------- add channel / category, roles, member roles ---------- */
const slug = v => v.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30);
$("chForm").onsubmit = async e => {
  e.preventDefault();
  const name = slug($("chName").value); if (!name || !srv) return;
  try {
    await addDoc(collection(db, "servers", srv.id, "channels"), { name, type: $("chType").value, categoryId: $("chCat").value || null, createdAt: serverTimestamp(), position: Date.now() });
    $("chName").value = ""; $("chModal").hidden = true;
  } catch (err) { console.error(err); $("chMsg").textContent = "Couldn't create that. You may not have permission."; }
};
$("catForm").onsubmit = async e => {
  e.preventDefault();
  const name = $("catName").value.trim(); if (!name || !srv) return;
  try { await addDoc(collection(db, "servers", srv.id, "categories"), { name, createdAt: serverTimestamp(), position: Date.now() }); $("catName").value = ""; $("chModal").hidden = true; }
  catch (err) { console.error(err); $("chMsg").textContent = "Couldn't create that. You may not have permission."; }
};
$("setBody").addEventListener("change", e => {
  if (!srv) return;
  const a = e.target.closest("select.addrole"), b = e.target.closest("select.addmember");
  if (a && a.value) {
    const m = srv.members.find(x => x.id === a.dataset.uid);
    if (m) setMemberRoles(m.id, [...(m.roles || []), a.value]).catch(err => { console.error(err); $("setMsg").textContent = "Couldn't give that role."; });
  }
  if (b && b.value) {
    const m = srv.members.find(x => x.id === b.value);
    if (m) setMemberRoles(m.id, [...(m.roles || []), b.dataset.rid]).then(() => refreshSettings(true)).catch(err => { console.error(err); $("setMsg").textContent = "Couldn't give that role."; });
  }
});
$("setBody").addEventListener("submit", async e => {
  e.preventDefault(); if (!srv) return;
  const say = t => { $("setMsg").textContent = t; };
  try {
    if (e.target.id === "invForm") { await saveInvite($("invCode").value); say("Invite link saved."); refreshSettings(true); }
    if (e.target.id === "modForm") { await saveModeration(); say("Moderation settings saved."); }
  } catch (err) { console.error(err); say(err.message || "Couldn't save that."); }
});
$("setBody").addEventListener("input", e => {         // keeps the role being edited safe while you switch tabs
  const el = e.target;
  if (el.id === "pSearch") {
    const q = el.value.trim().toLowerCase();
    document.querySelectorAll("#setBody .prow").forEach(r => { r.hidden = !r.dataset.t.includes(q); });
    document.querySelectorAll("#setBody .pgroup").forEach(g => { g.hidden = !g.querySelector(".prow:not([hidden])"); });
    return;
  }
  if (!roleDraft) return;
  if (el.dataset.d) roleDraft[el.dataset.d] = el.value;
  else if (el.dataset.p) roleDraft.perms[el.dataset.p] = el.checked;
});
addEventListener("keydown", e => { if (e.key === "Escape") $("profModal").hidden = true; });

/* ---------- right-click menu in the channel list ---------- */
$("chList").addEventListener("contextmenu", e => {
  if (!srv || !can("manageChannels")) return;          // without permission, the browser's normal menu stays
  e.preventDefault();
  const t = e.target.closest("[data-drag]"), items = [];
  if (t?.dataset.drag === "chan") {
    const c = srv.channels.find(x => x.id === t.dataset.id);
    items.push(["editchan", "Edit channel", t.dataset.id]);
    if (c && c.type !== "voice") items.push(["lockchan", c.locked ? "Unlock channel" : "Lock channel", t.dataset.id]);
    items.push(["delchan", "Delete channel", t.dataset.id]);
  }
  if (t?.dataset.drag === "cat") items.push(["editcat", "Edit category", t.dataset.id], ["delcat", "Delete category", t.dataset.id]);
  items.push(["ctxcat", "Create category", ""], ["newchannel", "Create channel", ""]);
  const m = $("ctxMenu");
  m.innerHTML = items.map(([a, l, i]) => `<button role="menuitem" data-act="${a}" data-id="${i}">${l}</button>`).join("");
  m.hidden = false;
  m.style.left = Math.max(8, Math.min(e.clientX, innerWidth - m.offsetWidth - 8)) + "px";
  m.style.top = Math.max(8, Math.min(e.clientY, innerHeight - m.offsetHeight - 8)) + "px";
});
addEventListener("keydown", e => { if (e.key === "Escape") $("ctxMenu").hidden = true; });
["scroll", "resize"].forEach(ev => addEventListener(ev, e => { if (e.target?.closest?.("#picker, #msgMenu, #statusMenu, #ctxMenu")) return; hidePops(); }, true));
addEventListener("blur", e => { if (e.target === window) hidePops(); });      // leaving the tab closes menus; clicking inside the page must not

/* ---------- drag channels and categories to reorder them ---------- */
let drag = null;
const clearDrop = () => document.querySelectorAll("#chList .drop-before, #chList .drop-after, #chList .drop-into, #chList .dragging").forEach(el => el.classList.remove("drop-before", "drop-after", "drop-into", "dragging"));
const dropInfo = e => {
  const t = e.target.closest?.("[data-drag]");
  if (!t) return { zone: "end" };                       // empty space: end of the list
  const r = t.getBoundingClientRect();
  return { el: t, kind: t.dataset.drag, id: t.dataset.id, after: e.clientY > r.top + r.height / 2 };
};
$("chList").addEventListener("dragstart", e => {
  const el = e.target.closest?.("[data-drag]");
  if (!el || !can("manageChannels")) { e.preventDefault(); return; }
  drag = { kind: el.dataset.drag, id: el.dataset.id };
  e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", drag.id);
  setTimeout(() => el.classList.add("dragging"), 0);
});
$("chList").addEventListener("dragover", e => {
  if (!drag) return;
  e.preventDefault(); e.dataTransfer.dropEffect = "move";
  clearDrop();
  const i = dropInfo(e);
  if (i.el) i.el.classList.add(drag.kind === "chan" && i.kind === "cat" ? "drop-into" : i.after ? "drop-after" : "drop-before");
});
$("chList").addEventListener("drop", e => {
  if (!drag) return;
  e.preventDefault();
  const d = drag, info = dropInfo(e); drag = null; clearDrop();
  (d.kind === "chan" ? moveChannel(d.id, info) : moveCategory(d.id, info)).catch(err => { console.error(err); alert("Couldn't move that. You may not have permission."); });
});
$("chList").addEventListener("dragend", () => { drag = null; clearDrop(); });
addEventListener("keydown", e => {                      // channel rows are div buttons so they can be dragged in every browser
  if ((e.key === "Enter" || e.key === " ") && e.target.matches?.("div.dm[data-act]")) { e.preventDefault(); e.target.click(); }
});

/* ---------- right-click a message ---------- */
$("view").addEventListener("contextmenu", e => {
  const m = e.target.closest(".m[data-mid]"); if (!m || !m.dataset.mid) return;
  e.preventDefault(); hidePops(); openMsgMenu(m.dataset.mid, e.clientX, e.clientY);
});
addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  hidePops();
  if (replyDraft) { replyDraft = null; renderReplyBar(); }
});

/* ---------- right-click a server icon ---------- */
$("servers").addEventListener("contextmenu", e => {
  const b = e.target.closest('.srv[data-act="server"]'); if (!b) return;
  e.preventDefault(); hidePops();
  const mine = myServers.find(x => x.id === b.dataset.id);
  showCtx([["server", "Open server", b.dataset.id], ["sep"], mine?.owner ? ["delserverid", "Delete Server", b.dataset.id, "red"] : ["leaveid", "Leave Server", b.dataset.id, "red"]], e.clientX, e.clientY);
});
