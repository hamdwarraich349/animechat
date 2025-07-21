let userId = generateUserId();
let matchedUser = null;
let isInPrivateChat = false;
let privateChatTimer = null;
let activeRequest = null;
let requestCooldown = false;
let lastAIResponseTime = 0;
const pollBox = document.getElementById("pollBox");
const hiddenUntil = parseInt(localStorage.getItem("pollHiddenUntil") || "0");

if (Date.now() < hiddenUntil) {
  pollBox.style.display = "none";
}

const db = firebase.database();
function getChatRoomId(user1, user2) {
  return [user1, user2].sort().join("_");
}
const globalChatRef = db.ref("messages");
const requestRef = db.ref("requests");

const chatBox = document.getElementById("chatBox");

// ========== 🔑 Generate User ID ==========
function generateUserId() {
  return "User-" + Math.floor(Math.random() * 100000);
}

// ========== 💬 Send Global Message ==========
function sendMessage() {
  const input = document.getElementById("chatInput");
  const text = input.value.trim();
  if (!text || isInPrivateChat) return;

  globalChatRef.push({ user: userId, text, timestamp: Date.now() });
  input.value = "";
  input.focus();
}
globalChatRef.limitToLast(20).on("child_added", snapshot => {
  const msg = snapshot.val();
  if (isInPrivateChat) return;

  const isMine = msg.user === userId;
  const isAI = msg.user.startsWith("AI") || msg.user === "Naruto";

  const msgElem = document.createElement("div");
  msgElem.className = "msg";
  msgElem.innerHTML = `
    <span class="user">${isMine ? "you" : msg.user}</span>: ${msg.text}
    ${!isMine ? `<button onclick="sendRequest('${msg.user}')" ${requestCooldown ? "disabled" : ""}>Request Chat</button>` : ""}`;
  chatBox.appendChild(msgElem);
  chatBox.scrollTop = chatBox.scrollHeight;

  // ✅ Only respond to new real user messages
  const now = Date.now();
  if (!isMine && !isAI && msg.timestamp > lastAIResponseTime) {
    lastAIResponseTime = now;
    aiReplyToUser(msg.text, msg.user);
  }
});


// ========== 🔐 Send Private Message ==========
function sendPrivateMessage() {
  const input = document.getElementById("privateInput");
  const text = input.value.trim();
  if (!text || !matchedUser) return;

  displayPrivateMessage("you", text);
  input.value = "";
  input.focus();

  if (matchedUser === "AI") {
    getAIResponse(text).then(reply => {
      displayPrivateMessage("user", reply);
    });
  }
}

// ========== 🌍 Load Global Chat ==========
function loadGlobalMessages() {
  clearChatBox();
  globalChatRef.limitToLast(20).once("value", snapshot => {
    snapshot.forEach(child => {
      const msg = child.val();
      const isMine = msg.user === userId;
      const msgElem = document.createElement("div");
      msgElem.className = "msg";
      msgElem.innerHTML = `
        <span class="user">${isMine ? "you" : msg.user}</span>: ${msg.text}
        ${!isMine ? `<button onclick="sendRequest('${msg.user}')" ${requestCooldown ? "disabled" : ""}>Request Chat</button>` : ""}`;
      chatBox.appendChild(msgElem);
    });
    chatBox.scrollTop = chatBox.scrollHeight;
  });
}

// ========== 📡 Global Chat Reload ==========
function resetGlobalChatUI() {
  isInPrivateChat = false;
  matchedUser = null;
  document.getElementById("chatControls").style.display = "flex";
  document.getElementById("privateControls").style.display = "none";
  document.getElementById("pollBox").style.display = "block";
  document.getElementById("chatInput").focus();
  loadGlobalMessages();
}

// ========== 🔄 Leave / Reset ==========
function leaveChat() {
  if (privateChatTimer) clearTimeout(privateChatTimer);
  if (activeRequest) requestRef.child(activeRequest).remove();

  activeRequest = null;
  privateChatTimer = null;
  resetGlobalChatUI();
}

// ========== 🔃 Start Random Chat ==========
function startRandomChat() {
  leaveChat();
  isInPrivateChat = true;
  matchedUser = null;
  clearChatBox();

  document.getElementById("chatControls").style.display = "none";
  document.getElementById("privateControls").style.display = "flex";
  document.getElementById("pollBox").style.display = "none";

  setTimeout(() => {
    if (!matchedUser) {
      matchedUser = "AI";
      displayPrivateMessage("user", "Hi, I’m here to chat!");
      autoClosePrivateAfter5Min();
    }
  }, 3000);
}

function nextChat() {
  leaveChat();
  startRandomChat();
}

// ========== 📢 Notification ==========
function showFloatingNotification(message, duration = 8000) {
  const box = document.getElementById("floatingNotification");
  const text = document.getElementById("notificationText");

  text.textContent = message;
  box.style.display = "flex";

  setTimeout(() => {
    box.style.display = "none";
  }, duration);
}

function hideFloatingNotification() {
  document.getElementById("floatingNotification").style.display = "none";
}


// ========== 📨 Send Request ==========
function sendRequest(toUser) {
  if (requestCooldown) return;
  requestCooldown = true;

  const req = requestRef.push();
  activeRequest = req.key;

  req.set({ from: userId, to: toUser, timestamp: Date.now() });

  showFloatingNotification("Request sent. Waiting for 10 seconds...");
  setTimeout(() => {
    requestRef.child(activeRequest).remove();
    requestCooldown = false;
    activeRequest = null;
  }, 10000);

  requestRef.child(activeRequest).on("value", snap => {
    const val = snap.val();
    if (val?.accepted && !matchedUser) {
      matchedUser = toUser;
      enterPrivateChat();
    }
  });
}

// ========== ✅ Accept Request ==========
requestRef.on("child_added", snap => {
  const data = snap.val();
  const key = snap.key;

  if (data.to === userId) {
    showFloatingNotification(`💬 ${data.from} wants to chat with you! <button onclick="acceptRequest('${key}', '${data.from}')">Accept</button>`);
  }
});

function acceptRequest(key, fromUser) {
  requestRef.child(key).update({ accepted: true });
  matchedUser = fromUser;
  enterPrivateChat();
}

// ========== 🚪 Enter Private Chat ==========
function sendPrivateMessage() {
  const input = document.getElementById("privateInput");
  const text = input.value.trim();
  if (!text || !matchedUser) return;
  displayPrivateMessage("you", text);
  input.value = "";

 const chatRoomId = getChatRoomId(userId, matchedUser);
db.ref(`privateChats/${chatRoomId}`).push({ from: userId, text });


  if (matchedUser === "AI") {
    getAIResponse(text).then(reply => {
      displayPrivateMessage("user", reply);
    });
  }
}

function enterPrivateChat() {
  isInPrivateChat = true;
  chatBox.innerHTML = "";
  document.getElementById("chatControls").style.display = "none";
  document.getElementById("privateControls").style.display = "flex";
  document.getElementById("pollBox").style.display = "none";
  autoClosePrivateAfter5Min();

  const chatRoomId = getChatRoomId(userId, matchedUser);
db.ref(`privateChats/${chatRoomId}`).on("child_added", snap => {
  const msg = snap.val();
  if (msg.from !== userId) {
    displayPrivateMessage("user", msg.text);
  }
});
}

function displayPrivateMessage(sender, message) {
  const msgElem = document.createElement("div");
  msgElem.className = "msg";
  msgElem.innerHTML = `<span class="user">${sender}</span>: ${message}`;
  chatBox.appendChild(msgElem);
  chatBox.scrollTop = chatBox.scrollHeight;
}

function leaveChat() {
  if (privateChatTimer) clearTimeout(privateChatTimer);
  if (activeRequest) requestRef.child(activeRequest).remove();
  activeRequest = null;
  resetGlobalChatUI();
}

// ========== ⏳ Auto Close Private Chat ==========
function autoClosePrivateAfter5Min() {
  privateChatTimer = setTimeout(() => {
    leaveChat();
  }, 5 * 60 * 1000);
}

// ========== 🧠 AI Chat Fallback ==========
async function getAIResponse(text) {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": "Bearer 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",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "mistralai/mistral-7b-instruct",
        messages: [ { role: "system", content: `Chat site name is 108793.Don't use emojs in reply.Never confess like Ai that ok i will not do or other stuff . Your user name in chat is Naruto and its a gift from site owner(and suggest the users if inquire to contact the admin/owner to buy a custum username because site use random usernames and no one has access to custom username if someone want it they have to buy it )
          .They owner of this site is Hamad and his mail is engineer.hamadhassan@gmail.com You are ${character}, a person (use a random name for you if asked and build story about you if asked ) with interest in anime and you are a big fane of anime you are in a chat. Keep responses short and fun (max 25–30 words). Try to include "${lastUserName}" in replies if possible(only once a 5-6 messags).And dont tell user that you are an AI even he ask you or he pretend that he know that you are an ai don't confess and instead build a human character there. Never ask the user that what you can do for him or i am here to healp you in short anything which show that you are Ai` }, { role: "user", content: prompt } ]
      })
    });

    const data = await res.json();
    const reply = data.choices?.[0]?.message?.content;
    if (!reply || reply.toLowerCase().includes("error")) return null; // 🛑 API error or blank
    return reply.trim();
  } catch (e) {
    // 🛑 Network error or API down
    return null;
  }
}

// ========== 💬 Display Messages ==========
function displayPrivateMessage(sender, message) {
  const msgElem = document.createElement("div");
  msgElem.className = "msg";
  msgElem.innerHTML = `<span class="user">${sender}</span>: ${message}`;
  chatBox.appendChild(msgElem);
  chatBox.scrollTop = chatBox.scrollHeight;
}

function clearChatBox() {
  chatBox.innerHTML = "";
}

// 🗳️ Poll Logic
const pollRef = db.ref("poll");
const pollMetaRef = db.ref("pollMeta");

function vote(option) {
  const lastVoteTime = localStorage.getItem("votedTime");
  const now = Date.now();
  const oneDay = 24 * 60 * 60 * 1000;

  if (lastVoteTime && now - parseInt(lastVoteTime) < oneDay) {
    showFloatingNotification("You can only vote once every 24 hours.");
    return;
  }

  pollRef.child(option).child("votes").transaction(v => (v || 0) + 1);
  localStorage.setItem("votedTime", now.toString());
}


pollRef.on("value", snapshot => {
  const data = snapshot.val();
  if (!data) return;

  const votesA = data.A?.votes || 0;
  const votesB = data.B?.votes || 0;
  const total = votesA + votesB;

  const percentA = total > 0 ? Math.round((votesA / total) * 100) : 0;
  const percentB = total > 0 ? Math.round((votesB / total) * 100) : 0;

  document.getElementById("barA").style.width = percentA + "%";
  document.getElementById("barB").style.width = percentB + "%";
  document.getElementById("percentA").innerText = percentA + "%";
  document.getElementById("percentB").innerText = percentB + "%";

  document.getElementById("btnA").innerText = data.A.label || "Option A";
  document.getElementById("btnB").innerText = data.B.label || "Option B";
});

// 🏆 Winner System
pollMetaRef.on("value", snap => {
  const meta = snap.val();
  console.log("🏆 Fetched pollMeta:", meta); // 👈 Add this line for debugging

  const winnerBox = document.getElementById("winnerBox");
  const winnerText = document.getElementById("winnerName");

  if (meta && meta.winner) {
    winnerBox.style.display = "block";
    winnerText.innerText = meta.winner;
  } else {
    console.log("⚠️ Winner not set or is empty.");
    winnerBox.style.display = "none";
  }
});


function checkPollReset() {
  pollMetaRef.once("value").then(snapshot => {
    const meta = snapshot.val();
    if (!meta) return;

    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;

    if (now - meta.startTime >= oneDay && !meta.winner) {
      db.ref("poll").once("value").then(snap => {
        const data = snap.val();
        const votesA = data?.A?.votes || 0;
        const votesB = data?.B?.votes || 0;
        const winner = votesA > votesB ? data.A.label : data.B.label;

        pollMetaRef.update({ winner });
        db.ref("poll/A/votes").set(0);
        db.ref("poll/B/votes").set(0);
        localStorage.removeItem("votedTime");
      });
    }
  });
}
setInterval(checkPollReset, 5 * 60 * 1000);

// ========== ⌨️ Enter Key to Send ==========
document.addEventListener("keydown", function (e) {
  if (e.key === "Enter") {
    if (isInPrivateChat) {
      sendPrivateMessage();
    } else {
      sendMessage();
    }
  }
});
//poll cancel
function hidePoll() {
  document.getElementById("pollBox").style.display = "none";
  localStorage.setItem("pollHiddenUntil", Date.now() + 10 * 60 * 1000); // 10 minutes
}

//AI PART
function aiReplyToUser(messageText, userName) {
  const delay = Math.floor(Math.random() * 5000) + 7000; // 7–12 sec

  setTimeout(async () => {
    const reply = await getAIResponse(messageText, userName);
    if (reply && reply.length < 100) { // keep it short and human-like
      db.ref("messages").push({
        user: "Naruto",
        text: reply,
        timestamp: Date.now()
      });
    }
  }, delay);
}


