import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where, orderBy, limit,
  onSnapshot, addDoc, serverTimestamp, writeBatch }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCkpXVTOwjHuzG0msQPhtDuPoRDgR_GxbM",
  authDomain: "cove-b30b4.firebaseapp.com",
  projectId: "cove-b30b4",
  storageBucket: "cove-b30b4.firebasestorage.app",
  messagingSenderId: "769872068444",
  appId: "1:769872068444:web:65ab0e799797a8eef6cb99"
};

const app = initializeApp(firebaseConfig), auth = getAuth(app), db = getFirestore(app);
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const colors = ["#7fd1c0","#c4a7f0","#f2b97a","#8fb8f5","#f09aa5","#b5d88a"];
const color = n => colors[[...n].reduce((a, c) => a + c.charCodeAt(0), 0) % colors.length];
const av = (n, s = "") => `<div class="av ${s}" style="background:${color(n)}">${esc((n[0] || "?").toUpperCase())}</div>`;
const I = {
  chat: `<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-3.9A8 8 0 1 1 20 12z"/></svg>`,
  check: `<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`,
  x: `<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>`,
  search: `<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4-4"/></svg>`
};

/* ---------- state ---------- */
let me = null, rels = [], profiles = {}, watchers = {}, unsubs = [], timers = [];
let tab = "online", q = "", chat = null, chatMsgs = [], chatUnsub = null, shellFor = null;
let myServers = [], srv = null;

const other = r => r.users.find(u => u !== me.uid);
const nameOf = r => r.names[other(r)];
const accepted = () => rels.filter(r => r.status === "accepted");
const isOnline = uid => { const t = profiles[uid]?.lastSeen?.toMillis?.(); return !!t && Date.now() - t < 120000; };

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
      b.set(doc(db, "users", cred.user.uid), { username: name, usernameLower: key, lastSeen: serverTimestamp() });
      await b.commit();
    } else await signInWithEmailAndPassword(auth, email, pw);
  } catch (err) { msg.textContent = nice(err); }
};

/* ---------- session ---------- */
function stop() {
  unsubs.forEach(f => f()); Object.values(watchers).forEach(f => f()); chatUnsub?.(); closeServer(); myServers = [];
  timers.forEach(clearInterval);
  unsubs = []; watchers = {}; timers = []; chatUnsub = null;
  rels = []; profiles = {}; chat = null; chatMsgs = []; shellFor = null; tab = "online"; q = "";
}

onAuthStateChanged(auth, async u => {
  stop();
  if (!u) { me = null; $("app").hidden = true; $("auth").hidden = false; return; }
  let snap;
  for (let i = 0; i < 10; i++) {          // sign-up writes the profile just after the account exists
    snap = await getDoc(doc(db, "users", u.uid));
    if (snap.exists()) break;
    await new Promise(r => setTimeout(r, 300));
  }
  if (!snap.exists()) { await signOut(auth); return; }
  me = { uid: u.uid, username: snap.data().username };
  $("auth").hidden = true; $("app").hidden = false;
  $("meName").textContent = me.username;
  $("meAv").textContent = me.username[0].toUpperCase(); $("meAv").style.background = color(me.username);

  const beat = () => updateDoc(doc(db, "users", me.uid), { lastSeen: serverTimestamp() }).catch(() => {});
  beat(); timers.push(setInterval(beat, 60000), setInterval(render, 30000));

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

function watch(uid) {
  if (watchers[uid]) return;
  watchers[uid] = onSnapshot(doc(db, "users", uid), s => { profiles[uid] = s.data(); render(); });
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
function openChat(r) {
  closeServer(); chatUnsub?.();
  chat = { id: r.id, uid: other(r), name: nameOf(r) }; chatMsgs = [];
  chatUnsub = onSnapshot(query(collection(db, "chats", r.id, "messages"), orderBy("createdAt"), limit(200)),
    s => { chatMsgs = s.docs.map(d => d.data()); if (chat) render(); }, err => console.error(err));
  render();
}
function closeChat() { chatUnsub?.(); chatUnsub = null; chat = null; chatMsgs = []; }

/* ---------- servers ---------- */
const randId = () => Array.from(crypto.getRandomValues(new Uint8Array(10)), b => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");

async function createServer(name) {
  const id = randId();
  await setDoc(doc(db, "servers", id), { name, owner: me.uid, createdAt: serverTimestamp() });
  await setDoc(doc(db, "servers", id, "members", me.uid), { name: me.username, joinedAt: serverTimestamp() });
  await addDoc(collection(db, "servers", id, "channels"), { name: "general", createdAt: serverTimestamp() });
  await setDoc(doc(db, "users", me.uid, "servers", id), { name });
  return id;
}

async function joinServer(code) {
  const id = code.trim().toLowerCase();
  if (!/^[a-z0-9]{10}$/.test(id)) return null;
  let name;
  try { const ex = await getDoc(doc(db, "servers", id)); if (ex.exists()) name = ex.data().name; } catch {}   // already a member
  if (!name) {
    try { await setDoc(doc(db, "servers", id, "members", me.uid), { name: me.username, joinedAt: serverTimestamp() }); }
    catch { return null; }
    name = (await getDoc(doc(db, "servers", id))).data().name;
  }
  await setDoc(doc(db, "users", me.uid, "servers", id), { name });
  return { id, name };
}

function closeServer() {
  if (!srv) return;
  srv.u.forEach(f => f()); srv.mu?.(); srv = null; shellFor = null;
  $("srvSide").hidden = true; $("homeSide").hidden = false; $("rightTitle").textContent = "Active now";
}

function selectChannel(cid) {
  const s = srv; if (!s) return;
  s.mu?.(); s.mu = null; s.cid = cid || null; s.msgs = [];
  if (!cid) return;
  s.mu = onSnapshot(query(collection(db, "servers", s.id, "channels", cid, "messages"), orderBy("createdAt"), limit(200)),
    m => { if (srv === s && s.cid === cid) { s.msgs = m.docs.map(x => x.data()); render(); } }, err => console.error(err));
}

function openServer(id, name) {
  closeChat(); closeServer();
  const s = srv = { id, name, owner: null, channels: [], members: [], cid: null, msgs: [], u: [], mu: null };
  const live = fn => d => { if (srv === s) fn(d); }, bad = err => console.error(err);
  s.u.push(
    onSnapshot(doc(db, "servers", id), live(d => { if (!d.exists()) closeServer(); else { s.name = d.data().name; s.owner = d.data().owner; } render(); }), bad),
    onSnapshot(query(collection(db, "servers", id, "channels"), orderBy("createdAt")), live(c => {
      s.channels = c.docs.map(x => ({ id: x.id, ...x.data() }));
      if (!s.channels.some(x => x.id === s.cid)) selectChannel(s.channels[0]?.id);
      render();
    }), bad),
    onSnapshot(collection(db, "servers", id, "members"), live(m => {
      s.members = m.docs.map(x => ({ id: x.id, ...x.data() })); s.members.forEach(x => watch(x.id)); render();
    }), bad));
  shellFor = null; render();
}

async function leaveServer() {
  const id = srv.id; closeServer(); render();
  try { await deleteDoc(doc(db, "servers", id, "members", me.uid)); } catch (e) { console.error(e); }
  deleteDoc(doc(db, "users", me.uid, "servers", id)).catch(() => {});
}

/* ---------- rendering ---------- */
const btn = (act, id, label, icon) => `<button class="ib" data-act="${act}" data-id="${id}" aria-label="${label}" title="${label}">${icon}</button>`;

function rowHtml(r) {
  const n = nameOf(r), pend = r.status === "pending", inc = pend && r.to === me.uid, on = isOnline(other(r));
  const sub = pend ? (inc ? "Incoming friend request" : "Outgoing friend request") : (on ? "Online" : "Offline");
  const btns = !pend ? btn("chat", r.id, "Message", I.chat) + btn("remove", r.id, "Remove friend", I.x)
    : inc ? btn("accept", r.id, "Accept", I.check) + btn("decline", r.id, "Decline", I.x)
    : btn("cancel", r.id, "Cancel request", I.x);
  return `<div class="row">${av(n, pend ? "nodot" : on ? "online" : "")}<div class="info"><b>${esc(n)}</b><span class="st">${sub}</span></div>${btns}</div>`;
}

function shell(key, html, bind) {
  if (shellFor === key) return;
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

function fillMsgs(list, who, emptyText) {
  const el = $("msgs"), near = !el.children.length || el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  el.innerHTML = list.length ? list.map(m => {
    const n = who(m), t = m.createdAt?.toDate?.().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) || "";
    return `<div class="m">${av(n, "nodot")}<div><b>${esc(n)}</b><small>${t}</small><p>${esc(m.text)}</p></div></div>`;
  }).join("") : `<div class="empty">${esc(emptyText)}</div>`;
  if (near) el.scrollTop = el.scrollHeight;
}

const msgPane = ph => `<div id="msgs" aria-live="polite"></div><form class="send" id="sendForm"><input id="msgIn" placeholder="${esc(ph)}" autocomplete="off" maxlength="2000" aria-label="Message"><button class="primary" type="submit">Send</button></form>`;
const bindSend = (col, extra = () => ({})) => () => {
  $("sendForm").onsubmit = async e => {
    e.preventDefault();
    const i = $("msgIn"), text = i.value.trim(); if (!text) return;
    i.value = "";
    try { await addDoc(col(), { from: me.uid, text, ...extra(), createdAt: serverTimestamp() }); }
    catch (err) { i.value = text; console.error(err); }
  };
  $("msgIn").focus();
};

function renderRail() {
  $("servers").innerHTML = myServers.map(x => `<button class="srv ${srv && srv.id === x.id ? "on" : ""}" data-act="server" data-id="${x.id}" data-name="${esc(x.name)}" style="background:${color(x.name)};color:#0b1417" aria-label="${esc(x.name)}" title="${esc(x.name)}">${esc(x.name[0].toUpperCase())}</button>`).join("");
  document.querySelector(".srv.home").classList.toggle("on", !srv);
}

function renderServer() {
  $("homeSide").hidden = true; $("srvSide").hidden = false;
  $("srvName").textContent = srv.name;
  $("addCh").hidden = srv.owner !== me.uid; $("leaveBtn").hidden = srv.owner === me.uid;
  $("chList").innerHTML = srv.channels.map(c => `<button class="dm ${c.id === srv.cid ? "on" : ""}" data-act="chan" data-id="${c.id}"><span># ${esc(c.name)}</span></button>`).join("");
  $("rightTitle").textContent = `Members — ${srv.members.length}`;
  $("activeList").innerHTML = srv.members.map(m => `<div class="card">${av(m.name, isOnline(m.id) ? "online" : "")}<div><b>${esc(m.name)}</b><small>${m.id === srv.owner ? "Owner" : isOnline(m.id) ? "Online" : "Offline"}</small></div></div>`).join("");
  const ch = srv.channels.find(c => c.id === srv.cid);
  $("top").innerHTML = `<h1>${ch ? "# " + esc(ch.name) : esc(srv.name)}</h1>`;
  if (!ch) return;
  shell("srv:" + srv.id + ":" + ch.id, msgPane("Message #" + ch.name),
    bindSend(() => collection(db, "servers", srv.id, "channels", ch.id, "messages"), () => ({ name: me.username })));
  fillMsgs(srv.msgs, m => m.name || "Unknown", `Welcome to #${ch.name}. Say something.`);
}

function render() {
  if (!me) return;
  renderRail();
  if (srv) return renderServer();
  $("homeSide").hidden = false; $("srvSide").hidden = true; $("rightTitle").textContent = "Active now";
  const fr = accepted().sort((a, b) => (+isOnline(other(b))) - (+isOnline(other(a))) || nameOf(a).localeCompare(nameOf(b)));
  $("dms").innerHTML = fr.map(r => `<button class="dm" data-act="chat" data-id="${r.id}">${av(nameOf(r), isOnline(other(r)) ? "online" : "")}<span>${esc(nameOf(r))}</span></button>`).join("")
    || `<p class="hint">Add a friend to start a conversation.</p>`;
  const on = fr.filter(r => isOnline(other(r)));
  $("activeList").innerHTML = on.length
    ? on.map(r => `<div class="card">${av(nameOf(r), "online")}<div><b>${esc(nameOf(r))}</b><small>Online</small></div></div>`).join("")
    : `<p class="hint">Nobody is online right now.</p>`;

  const incoming = rels.filter(r => r.status === "pending" && r.to === me.uid).length;
  $("top").innerHTML = chat
    ? `<h1>${av(chat.name, isOnline(chat.uid) ? "online" : "")}${esc(chat.name)}</h1>`
    : `<h1>Friends</h1>` + [["online", "Online"], ["all", "All"], ["pending", "Pending" + (incoming ? ` (${incoming})` : "")]]
        .map(([k, l]) => `<button class="tab ${tab === k ? "on" : ""}" data-tab="${k}" role="tab">${l}</button>`).join("")
      + `<button class="tab cta" data-tab="add" role="tab">Add friend</button>`;

  if (chat) {
    shell("chat:" + chat.id, msgPane("Message " + chat.name), bindSend(() => collection(db, "chats", chat.id, "messages")));
    fillMsgs(chatMsgs, m => (m.from === me.uid ? me.username : chat.name), `This is the start of your chat with ${chat.name}. Say hi.`);
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
  const t = e.target.closest("[data-act],[data-tab]"); if (!t || !me) return;
  if (t.dataset.tab) { closeChat(); closeServer(); tab = t.dataset.tab; q = ""; shellFor = null; return render(); }
  const { act, id } = t.dataset, r = rels.find(x => x.id === id), ref = doc(db, "friendships", id || "x");
  if (act === "home") { closeChat(); closeServer(); shellFor = null; render(); }
  else if (act === "server") openServer(id, t.dataset.name);
  else if (act === "chan") { selectChannel(id); render(); }
  else if (act === "newserver") { $("modalMsg").textContent = ""; $("modal").hidden = false; $("srvNameIn").focus(); }
  else if (act === "closemodal") $("modal").hidden = true;
  else if (act === "invite" && srv) prompt("Invite code. Copy it and send it to your friends:", srv.id);
  else if (act === "newchannel" && srv) {
    const n = (prompt("Channel name?") || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30);
    if (n) addDoc(collection(db, "servers", srv.id, "channels"), { name: n, createdAt: serverTimestamp() }).catch(console.error);
  }
  else if (act === "leave" && srv && confirm(`Leave ${srv.name}?`)) leaveServer();
  else if (act === "chat" && r) openChat(r);
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
  const b = e.currentTarget; b.setAttribute("aria-pressed", b.getAttribute("aria-pressed") !== "true");
});
$("logout").onclick = () => signOut(auth);
