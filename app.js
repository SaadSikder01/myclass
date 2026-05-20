const SUPABASE_URL = "https://bytnxoltodeckrmwobgc.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ5dG54b2x0b2RlY2tybXdvYmdjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyNjgwNDYsImV4cCI6MjA5NDg0NDA0Nn0.14nw0jHluWSlQTbrguKpHsXwmDjnirUktpJ_RCE9iHs";

const supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
let currentUser = null;
let activeGroupId = null;
let activeGroupCreatorId = null;
let activeGroupUniqueId = null;

document.addEventListener("DOMContentLoaded", () => {
    supabase.auth.onAuthStateChange((event, session) => {
        if (session) {
            currentUser = session.user;
            showApp();
            loadMyGroups();
            listenToRealtimeData();
        } else {
            showAuth();
        }
    });
});

function toggleAuthForms(showSignup) {
    document.getElementById('login-form').classList.toggle('hidden', showSignup);
    document.getElementById('signup-form').classList.toggle('hidden', !showSignup);
}

// ================= AUTHENTICATION =================
async function registerUser() {
    const name = document.getElementById('signup-name').value;
    const email = document.getElementById('signup-email').value;
    const password = document.getElementById('signup-password').value;
    const confirmPassword = document.getElementById('signup-confirm-password').value;
    const avatarFile = document.getElementById('signup-avatar').files[0];

    if(password !== confirmPassword) { alert("Passwords don't match!"); return; }

    let avatarUrl = "https://placehold.co/150";
    if (avatarFile) {
        const filePath = `avatars/${Date.now()}_${avatarFile.name}`;
        await supabase.storage.from('classroom_uploads').upload(filePath, avatarFile);
        avatarUrl = supabase.storage.from('classroom_uploads').getPublicUrl(filePath).data.publicUrl;
    }

    const { error } = await supabase.auth.signUp({ email, password, options: { data: { name, avatar_url: avatarUrl } } });
    if (error) alert(error.message); else alert("Signup successful!");
}

async function loginUser() {
    const { error } = await supabase.auth.signInWithPassword({
        email: document.getElementById('login-email').value,
        password: document.getElementById('login-password').value
    });
    if (error) alert(error.message);
}

async function logoutUser() { await supabase.auth.signOut(); location.reload(); }

// ================= CLASSROOM GROUPS =================
async function createGroup() {
    const name = document.getElementById('group-name').value;
    const uniqueId = document.getElementById('group-unique-id').value.trim();
    const avatarFile = document.getElementById('group-avatar').files[0];

    if(!name || !uniqueId) { alert("Fill all fields!"); return; }

    let avatarUrl = "https://placehold.co/150";
    if (avatarFile) {
        const filePath = `groups/${Date.now()}_${avatarFile.name}`;
        await supabase.storage.from('classroom_uploads').upload(filePath, avatarFile);
        avatarUrl = supabase.storage.from('classroom_uploads').getPublicUrl(filePath).data.publicUrl;
    }

    // ১. গ্রুপ টেবিলে ডাটা ইনসার্ট
    const { data: groupData, error: groupErr } = await supabase.from('groups').insert([
        { group_name: name, unique_id: uniqueId, group_avatar: avatarUrl, creator_id: currentUser.id }
    ]).select().single();

    if (groupErr) { alert("Unique ID already exists!"); return; }

    // ২. টিচারকে মেম্বার হিসেবে অ্যাড করা
    await supabase.from('group_members').insert([{ group_id: groupData.id, user_id: currentUser.id, role: 'teacher' }]);
    
    alert("Classroom Created Successfully!");
    loadMyGroups();
}

async function loadMyGroups() {
    const { data, error } = await supabase.from('group_members').select('group_id, groups(*)').eq('user_id', currentUser.id);
    const list = document.getElementById('my-groups-list');
    list.innerHTML = "";
    if(data) {
        data.forEach(item => {
            if(item.groups) {
                list.innerHTML += `<li><a href="#" onclick="openClassroom('${item.groups.id}', '${item.groups.group_name}', '${item.groups.creator_id}', '${item.groups.unique_id}')">🏫 ${item.groups.group_name} (${item.groups.unique_id})</a></li>`;
            }
        });
    }
}

// ================= SEARCH & JOIN REQUESTS =================
async function searchGroup() {
    const uniqueId = document.getElementById('search-id').value.trim();
    const resultDiv = document.getElementById('search-result');
    
    const { data, error } = await supabase.from('groups').select('*').eq('unique_id', uniqueId).single();
    if(!data) { resultDiv.innerHTML = "<span style='color:red;'>Classroom not found!</span>"; return; }

    resultDiv.innerHTML = `
        <div>
            <strong>${data.group_name}</strong><br>
            <button onclick="sendJoinRequest('${data.id}')">Send Join Request</button>
        </div>`;
}

async function sendJoinRequest(groupId) {
    const { error } = await supabase.from('join_requests').insert([{ group_id: groupId, user_id: currentUser.id }]);
    if (error) alert("Already requested or member!"); else alert("Request sent successfully!");
}

// ================= TEACHER PANEL: NOTIFICATIONS =================
async function loadNotifications() {
    const { data } = await supabase.from('join_requests').select('id, status, groups!inner(creator_id), profiles(name, email)').eq('groups.creator_id', currentUser.id).eq('status', 'pending');
    const list = document.getElementById('requests-list');
    const badge = document.getElementById('noti-count');
    list.innerHTML = "";
    
    if(data && data.length > 0) {
        badge.innerText = data.length;
        badge.classList.remove('hidden');
        data.forEach(req => {
            list.innerHTML += `<li>${req.profiles.name} wants to join. <button onclick="actionRequest('${req.id}', 'accepted')">Accept</button> <button class='secondary' onclick="actionRequest('${req.id}', 'rejected')">Reject</button></li>`;
        });
    } else {
        badge.classList.add('hidden');
        list.innerHTML = "<li>No pending requests</li>";
    }
}

async function actionRequest(reqId, status) {
    if(status === 'accepted') {
        const { data: reqData } = await supabase.from('join_requests').select('*').eq('id', reqId).single();
        await supabase.from('group_members').insert([{ group_id: reqData.group_id, user_id: reqData.user_id, role: 'student' }]);
    }
    await supabase.from('join_requests').update({ status: status }).eq('id', reqId);
    loadNotifications();
    loadMyGroups();
}

// ================= DIRECT EMAIL INVITE =================
async function directAddUser() {
    const email = document.getElementById('invite-email').value.trim();
    const { data: userProfile } = await supabase.from('profiles').select('id').eq('email', email).single();
    
    if(!userProfile) { alert("User with this email has not registered yet!"); return; }
    
    const { error } = await supabase.from('group_members').insert([{ group_id: activeGroupId, user_id: userProfile.id, role: 'student' }]);
    if(error) alert("User is already in this class!"); else alert("Student added directly!");
}

// ================= CHAT & CALL LOGIC =================
async function openClassroom(id, name, creatorId, uniqueId) {
    activeGroupId = id; activeGroupCreatorId = creatorId; activeGroupUniqueId = uniqueId;
    document.getElementById('no-group-selected').classList.add('hidden');
    document.getElementById('active-classroom').classList.remove('hidden');
    document.getElementById('active-group-title').innerText = name;

    // যদি কারেন্ট ইউজার টিচার হয়, তবে ইনভাইট জোন ও কল বাটন স্পেশাল হবে
    if (currentUser.id === creatorId) {
        document.getElementById('teacher-invite-zone').classList.remove('hidden');
        document.getElementById('call-btn').innerText = "📹 Start Class (Admin)";
        document.getElementById('call-btn').disabled = false;
    } else {
        document.getElementById('teacher-invite-zone').classList.add('hidden');
        document.getElementById('call-btn').innerText = "📹 Call (Waiting for Teacher)";
        document.getElementById('call-btn').disabled = true; // স্টুডেন্ট কল শুরু করতে পারবে না
    }
    loadMessages();
}

async function sendMessage() {
    const text = document.getElementById('message-input').value;
    if(!text) return;
    await supabase.from('messages').insert([{ group_id: activeGroupId, sender_id: currentUser.id, message_text: text }]);
    document.getElementById('message-input').value = "";
}

async function loadMessages() {
    const { data } = await supabase.from('messages').select('message_text, profiles(name)').eq('group_id', activeGroupId).order('created_at', { ascending: true });
    const chatBox = document.getElementById('chat-messages');
    chatBox.innerHTML = "";
    if(data) {
        data.forEach(msg => {
            chatBox.innerHTML += `<div><strong>${msg.profiles.name}:</strong> ${msg.message_text}</div>`;
        });
        chatBox.scrollTop = chatBox.scrollHeight;
    }
}

// 📹 JITSI MEET CALLING INTEGRATION (The Core)
function startClassCall() {
    if (currentUser.id !== activeGroupCreatorId) {
        alert("Only the Teacher can start the live class!");
        return;
    }
    // আপনার নিজস্ব কাস্টমাইজড Jitsi সার্ভার ডোমেইন এবং সিকিউর ইউনিক আইডি রুম লিংক তৈরি করা
    const jitsiUrl = `https://myclassbd.shop/${activeGroupUniqueId}`;
    
    // ১. চ্যাটে অটোমেটিক নোটিফিকেশন পাঠানো যেন স্টুডেন্টরা এক ক্লিকে ঢুকতে পারে
    const callNotice = `🔴 Live Class Started! Click here to join: ${jitsiUrl}`;
    supabase.from('messages').insert([{ group_id: activeGroupId, sender_id: currentUser.id, message_text: callNotice }]);
    
    // ২. নতুন ট্যাবে টিচারের জন্য জিৎসি কল উইন্ডো ওপেন করা
    window.open(jitsiUrl, '_blank');
}

// ================= REALTIME SUBSCRIPTION =================
function listenToRealtimeData() {
    supabase.channel('custom-all-channel')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
        if(payload.new.group_id === activeGroupId) loadMessages();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'join_requests' }, payload => {
        loadNotifications();
    })
    .subscribe();
    loadNotifications();
}

function toggleNotifications() { document.getElementById('notification-panel').classList.toggle('hidden'); }
function showApp() {
    document.getElementById('auth-container').classList.add('hidden');
    document.getElementById('app-container').classList.remove('hidden');
    document.getElementById('welcome-user').innerText = `Welcome, ${currentUser.user_metadata.name || currentUser.email}`;
    document.getElementById('user-avatar').src = currentUser.user_metadata.avatar_url || "https://placehold.co/40";
}
function showAuth() {
    document.getElementById('auth-container').classList.remove('hidden');
    document.getElementById('app-container').classList.add('hidden');
}
