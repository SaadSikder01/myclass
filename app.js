// ================= CONFIGURATION =================
const SUPABASE_URL = "https://bytnxoltodeckrmwobgc.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ5dG54b2x0b2RlY2tybXdvYmdjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyNjgwNDYsImV4cCI6MjA5NDg0NDA0Nn0.14nw0jHluWSlQTbrguKpHsXwmDjnirUktpJ_RCE9iHs";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUser = null;
let activeGroupId = null;
let activeGroupCreatorId = null;
let activeGroupUniqueId = null;
let currentUserRoleInActiveGroup = null; // মেম্বার পারমিশন ও রোল ট্র্যাক করার জন্য

document.addEventListener("DOMContentLoaded", () => {
    // ডার্ক মোড আগে থেকে ইন্যাবল থাকলে সেটা অ্যাপ্লাই করা
    if (localStorage.getItem('darkMode') === 'enabled') {
        document.body.classList.add('dark-mode');
    }

    supabaseClient.auth.onAuthStateChange((event, session) => {
        if (session) {
            currentUser = session.user;
            showApp();
            loadMyGroups();
            listenToRealtimeData();
            checkUrlForJoinRequest(); // শেয়ার লিংকের মাধ্যমে কেউ আসলে তা হ্যান্ডেল করার ফাংশন
        } else {
            showAuth();
        }
    });
});

function toggleAuthForms(showSignup) {
    document.getElementById('login-form').classList.toggle('hidden', showSignup);
    document.getElementById('signup-form').classList.toggle('hidden', !showSignup);
}

// ================= 🔗 SHARED LINK AUTO-JOIN DETECTOR =================
// ================= 🔗 SHARED LINK AUTO-JOIN DETECTOR (FIXED) =================
async function checkUrlForJoinRequest() {
    const urlParams = new URLSearchParams(window.location.search);
    const groupIdToJoin = urlParams.get('joinGroup');
    
    if (groupIdToJoin && currentUser) {
        // ইউআরএল ক্লিন করা যাতে পেজ রিফ্রেশ দিলে বারবার লুপ না হয়
        const cleanUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
        window.history.pushState({ path: cleanUrl }, '', cleanUrl);

        // ১. চেক করা ইউজার অলরেডি এই ক্লাসের মেম্বার বা শিক্ষক কিনা
        const { data: isMember } = await supabaseClient
            .from('group_members')
            .select('role')
            .eq('group_id', groupIdToJoin)
            .eq('user_id', currentUser.id)
            .maybeSingle();

        if (isMember) {
            // অলরেডি মেম্বার হলে সরাসরি ক্লাস ডাটা নিয়ে চ্যাট ওপেন হবে
            const { data: group } = await supabaseClient.from('groups').select('*').eq('id', groupIdToJoin).single();
            if (group) {
                openClassroom(group.id, group.group_name, group.creator_id, group.unique_id);
                alert(`You are already a member of "${group.group_name}". Classroom opened directly!`);
            }
            return;
        }

        // ২. মেম্বার না হলে জয়েন রিকোয়েস্ট পাঠানো
        const { error } = await supabaseClient
            .from('join_requests')
            .insert([{ group_id: groupIdToJoin, user_id: currentUser.id }]);
            
        if (error) {
            alert("You have already sent a request or it is pending approval!");
        } else {
            alert("Successfully sent a join request via the shared link! Wait for teacher approval.");
        }
    }
}

// ================= AUTHENTICATION =================
async function registerUser() {
    const name = document.getElementById('signup-name').value;
    const email = document.getElementById('signup-email').value;
    const password = document.getElementById('signup-password').value;
    const confirmPassword = document.getElementById('signup-confirm-password').value;
    const avatarFile = document.getElementById('signup-avatar').files[0];

    if (!name || !email || !password) { alert("Please fill all required fields!"); return; }
    if (password !== confirmPassword) { alert("Passwords don't match!"); return; }

    let avatarUrl = "https://placehold.co/150";
    
    if (avatarFile) {
        const filePath = `avatars/${Date.now()}_${avatarFile.name}`;
        const { error: uploadErr } = await supabaseClient.storage.from('classroom_uploads').upload(filePath, avatarFile);
            
        if (uploadErr) {
            alert(`Image upload failed: ${uploadErr.message}`);
            return;
        }
        avatarUrl = supabaseClient.storage.from('classroom_uploads').getPublicUrl(filePath).data.publicUrl;
    }

    const { error: signUpErr } = await supabaseClient.auth.signUp({ 
        email, 
        password, 
        options: { data: { name, avatar_url: avatarUrl } } 
    });
    
    if (signUpErr) alert(signUpErr.message); 
    else { alert("Signup successful! Please login."); toggleAuthForms(false); }
}

async function loginUser() {
    const { error } = await supabaseClient.auth.signInWithPassword({
        email: document.getElementById('login-email').value,
        password: document.getElementById('login-password').value
    });
    if (error) alert(error.message);
}

async function logoutUser() { 
    await supabaseClient.auth.signOut(); 
    location.reload(); 
}

// ================= 👤 USER PROFILE SETTINGS & DARK MODE =================
function openProfileSettingsModal() {
    document.getElementById('profile-name-input').value = currentUser.user_metadata.name || "";
    const isDark = document.body.classList.contains('dark-mode');
    document.getElementById('dark-mode-toggle').checked = isDark;
    toggleProfileModal(true);
}

function handleDarkModeToggle(checkbox) {
    if (checkbox.checked) {
        document.body.classList.add('dark-mode');
        localStorage.setItem('darkMode', 'enabled');
    } else {
        document.body.classList.remove('dark-mode');
        localStorage.setItem('darkMode', 'disabled');
    }
}

async function saveProfileSettings() {
    const newName = document.getElementById('profile-name-input').value.trim();
    const avatarFile = document.getElementById('profile-avatar-input').files[0];
    
    let avatarUrl = currentUser.user_metadata.avatar_url;
    
    if (avatarFile) {
        const filePath = `avatars/${Date.now()}_${avatarFile.name}`;
        await supabaseClient.storage.from('classroom_uploads').upload(filePath, avatarFile);
        avatarUrl = supabaseClient.storage.from('classroom_uploads').getPublicUrl(filePath).data.publicUrl;
    }
    
    const { data, error } = await supabaseClient.auth.updateUser({
        data: { name: newName, avatar_url: avatarUrl }
    });
    
    if (error) {
        alert(error.message);
    } else {
        alert("Profile updated successfully!");
        currentUser = data.user;
        showApp(); // হেডার রেন্ডার রিফ্রেশ
        toggleProfileModal(false);
    }
}

// ================= 🏫 CLASSROOM GROUPS & WHATSAPP SORTING =================
async function createGroup() {
    const name = document.getElementById('group-name').value;
    const uniqueId = document.getElementById('group-unique-id').value.trim();
    const avatarFile = document.getElementById('group-avatar').files[0];

    if (!name || !uniqueId) { alert("Fill all fields!"); return; }

    let avatarUrl = "https://placehold.co/150";
    if (avatarFile) {
        const filePath = `groups/${Date.now()}_${avatarFile.name}`;
        await supabaseClient.storage.from('classroom_uploads').upload(filePath, avatarFile);
        avatarUrl = supabaseClient.storage.from('classroom_uploads').getPublicUrl(filePath).data.publicUrl;
    }

    const { data: groupData, error: groupErr } = await supabaseClient.from('groups').insert([
        { group_name: name, unique_id: uniqueId, group_avatar: avatarUrl, creator_id: currentUser.id }
    ]).select().single();

    if (groupErr) { alert("Unique ID already exists!"); return; }

    await supabaseClient.from('group_members').insert([
        { group_id: groupData.id, user_id: currentUser.id, role: 'teacher' }
    ]);
    
    alert("Classroom Created Successfully!");
    toggleCreateModal(false);
    loadMyGroups();
}

async function loadMyGroups() {
    const { data: memberData, error: memErr } = await supabaseClient
        .from('group_members')
        .select('group_id, groups(*)')
        .eq('user_id', currentUser.id);

    if (memErr || !memberData) return;

    const sortedGroupsList = [];

    for (const item of memberData) {
        if (!item.groups) continue;
        const group = item.groups;

        const { data: msgData } = await supabaseClient
            .from('messages')
            .select('message_text, created_at')
            .eq('group_id', group.id)
            .order('created_at', { ascending: false })
            .limit(1);

        const hasMessage = msgData && msgData.length > 0;
        const lastMsg = hasMessage ? msgData[0].message_text : "No messages yet";
        const lastMsgTime = hasMessage ? new Date(msgData[0].created_at) : new Date(group.created_at);

        sortedGroupsList.push({ ...group, lastMsg, lastMsgTime });
    }

    sortedGroupsList.sort((a, b) => b.lastMsgTime - a.lastMsgTime);

    const listContainer = document.getElementById('my-groups-list');
    listContainer.innerHTML = "";

    sortedGroupsList.forEach(group => {
        let timeStr = "";
        if (group.lastMsg !== "No messages yet") {
            timeStr = new Date(group.lastMsgTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }

        listContainer.innerHTML += `
            <li>
                <a href="javascript:void(0);" class="chat-item" onclick="openClassroom('${group.id}', '${group.group_name}', '${group.creator_id}', '${group.unique_id}')">
                    <img class="chat-item-avatar" src="${group.group_avatar || 'https://placehold.co/50'}" alt="Group Avatar">
                    <div class="chat-item-info">
                        <div class="chat-item-header">
                            <span class="chat-item-name">${group.group_name}</span>
                            <span class="chat-item-time">${timeStr}</span>
                        </div>
                        <p class="chat-item-msg">${group.lastMsg}</p>
                    </div>
                </a>
            </li>
        `;
    });
}
// ================= ⚙️ GROUP SETTINGS (TEACHER / ADMIN CONTROL) =================
function openGroupSettingsModal() {
    if (currentUserRoleInActiveGroup !== 'teacher' && currentUserRoleInActiveGroup !== 'admin') {
        alert("Only Teachers and Admins can modify classroom settings!");
        return;
    }
    document.getElementById('edit-group-name').value = document.getElementById('active-group-title').innerText;
    toggleGroupModal(true);
}

async function saveGroupSettings() {
    const newName = document.getElementById('edit-group-name').value.trim();
    const avatarFile = document.getElementById('edit-group-avatar').files[0];
    const wallpaperFile = document.getElementById('edit-group-wallpaper').files[0];
    
    let updateData = {};
    if (newName) updateData.group_name = newName;
    
    if (avatarFile) {
        const filePath = `groups/${Date.now()}_${avatarFile.name}`;
        await supabaseClient.storage.from('classroom_uploads').upload(filePath, avatarFile);
        updateData.group_avatar = supabaseClient.storage.from('classroom_uploads').getPublicUrl(filePath).data.publicUrl;
    }
    
    if (wallpaperFile) {
        const filePath = `wallpapers/${Date.now()}_${wallpaperFile.name}`;
        await supabaseClient.storage.from('classroom_uploads').upload(filePath, wallpaperFile);
        updateData.wallpaper_url = supabaseClient.storage.from('classroom_uploads').getPublicUrl(filePath).data.publicUrl;
    }
    
    const { error } = await supabaseClient.from('groups').update(updateData).eq('id', activeGroupId);
    
    if (error) {
        alert("Failed to update settings: " + error.message);
    } else {
        alert("Classroom settings updated successfully!");
        toggleGroupModal(false);
        loadMyGroups(); // সাইডবার রিফ্রেশ
        
        if (newName) document.getElementById('active-group-title').innerText = newName;
        if (updateData.wallpaper_url) {
            document.getElementById('chat-main-view').style.backgroundImage = `url('${updateData.wallpaper_url}')`;
        }
    }
}

// ================= 👥 GROUP MEMBERS & MULTI-ADMIN LOGIC =================
async function openGroupMembersModal() {
    if (!activeGroupId) return;
    
    const { data: members, error } = await supabaseClient
        .from('group_members')
        .select('user_id, role, profiles(name, avatar_url)')
        .eq('group_id', activeGroupId);
        
    if (error) { alert("Failed to load members!"); return; }
    
    const listContainer = document.getElementById('classroom-members-list');
    listContainer.innerHTML = "";
    
    const isCurrentTeacher = (currentUserRoleInActiveGroup === 'teacher');
    const canPromote = (currentUserRoleInActiveGroup === 'teacher' || currentUserRoleInActiveGroup === 'admin');
    
    members.forEach(member => {
        const profile = member.profiles || { name: "Unknown User", avatar_url: "https://placehold.co/38" };
        
        let badgeHtml = "";
        if (member.role === 'teacher') badgeHtml = `<span class="admin-badge">Teacher</span>`;
        else if (member.role === 'admin') badgeHtml = `<span class="admin-badge">Admin</span>`;
        
        let actionButtonHtml = "";
        
        // যদি মেম্বার স্টুডেন্ট হয় এবং কারেন্ট ইউজার টিচার/এডমিন হয় -> Make Admin বাটন দেখাবে
        if (member.role === 'student' && canPromote) {
            actionButtonHtml = `<button class="make-admin-btn" onclick="makeMemberAdmin('${member.user_id}')">Make Admin</button>`;
        } 
        // যদি মেম্বার অলরেডি এডমিন হয় এবং মেইন 'টিচার' তাকে বাদ দিতে চায় -> Remove Admin বাটন দেখাবে
        else if (member.role === 'admin' && isCurrentTeacher) {
            actionButtonHtml = `<button class="remove-admin-btn" style="background:#e74c3c; color:white; border:none; padding:4px 12px; border-radius:15px; font-size:12px; cursor:pointer;" onclick="removeMemberAdmin('${member.user_id}')">Remove Admin</button>`;
        }
        
        listContainer.innerHTML += `
            <li class="member-item" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                <div class="member-info" style="display:flex; align-items:center; gap:10px;">
                    <img class="member-avatar" src="${profile.avatar_url || 'https://placehold.co/38'}" alt="Avatar" style="width:38px; height:38px; border-radius:50%;">
                    <span class="member-name">${profile.name} ${badgeHtml}</span>
                </div>
                ${actionButtonHtml}
            </li>
        `;
    });
    
    toggleMembersModal(true);
}
async function makeMemberAdmin(memberUserId) {
    if (confirm("Are you sure you want to make this member a Group Admin?")) {
        const { error } = await supabaseClient
            .from('group_members')
            .update({ role: 'admin' })
            .eq('group_id', activeGroupId)
            .eq('user_id', memberUserId);
            
        if (error) {
            alert("Failed to assign admin role: " + error.message);
        } else {
            alert("Member promoted to Admin successfully!");
            openGroupMembersModal(); // রিফ্রেশ লিস্ট
        }
    }
}

async function removeMemberAdmin(memberUserId) {
    if (confirm("Are you sure you want to remove Admin rights from this member?")) {
        const { error } = await supabaseClient
            .from('group_members')
            .update({ role: 'student' }) // রোল পরিবর্তন করে আবার স্টুডেন্ট বানিয়ে দেওয়া হলো
            .eq('group_id', activeGroupId)
            .eq('user_id', memberUserId);
            
        if (error) {
            alert("Failed to remove admin role: " + error.message);
        } else {
            alert("Admin role removed successfully!");
            openGroupMembersModal(); // মেম্বার লিস্ট রিফ্রেশ করা
        }
    }
}
// ================= MESSENGER STYLE ID SEARCH =================
async function searchGroup() {
    const uniqueId = document.getElementById('search-id').value.trim();
    const resultDiv = document.getElementById('search-result');
    
    if (!uniqueId) { resultDiv.classList.add('hidden'); return; }
    
    const { data } = await supabaseClient.from('groups').select('*').eq('unique_id', uniqueId).single();
    resultDiv.classList.remove('hidden');

    if (!data) { 
        resultDiv.innerHTML = "<span style='color:red; font-size:13px; padding-left:5px;'>Classroom not found!</span>"; 
        return; 
    }

    resultDiv.innerHTML = `
        <div style='background:var(--msg-search-bg); padding:10px 15px; border-radius:10px; display:flex; justify-content:space-between; align-items:center;'>
            <div>
                <strong style="font-size:14px;">${data.group_name}</strong>
                <div style="font-size:11px; opacity:0.7;">ID: ${data.unique_id}</div>
            </div>
            <button onclick="sendJoinRequest('${data.id}')" style='padding:4px 12px; font-size:12px; margin:0; background:var(--wa-teal); border:none; width:auto; border-radius:15px;'>Join</button>
        </div>`;
}

async function sendJoinRequest(groupId) {
    const { error } = await supabaseClient.from('join_requests').insert([{ group_id: groupId, user_id: currentUser.id }]);
    if (error) alert("Already requested or member!"); 
    else {
        alert("Request sent successfully!");
        document.getElementById('search-id').value = "";
        document.getElementById('search-result').classList.add('hidden');
    }
}

// ================= 🔗 GENERATE & COPY SHARE LINK =================
function shareGroupLink() {
    if (!activeGroupId) return;
    
    // বর্তমান ইউআরএল ট্র্যাক করে তার সাথে joinGroup প্যারামিটার হিসেবে মেইন ID জোড়া হচ্ছে
    const shareUrl = `${window.location.origin}${window.location.pathname}?joinGroup=${activeGroupId}`;
    
    navigator.clipboard.writeText(shareUrl).then(() => {
        alert("Classroom join link copied to clipboard! Anyone with this link can request to join after login.");
    }).catch(err => {
        // সেফটি ব্যাকআপ (যদি ব্রাউজার ক্লিপবোর্ড পারমিশন ব্লক করে)
        alert("Copy failed! Please manually share this link: " + shareUrl);
    });
}

// ================= NOTIFICATIONS =================
// ================= BEAUTIFIED REQUESTS LIST =================
async function loadNotifications() {
    const { data } = await supabaseClient
        .from('join_requests')
        .select('id, status, groups!inner(creator_id), profiles(name, email)')
        .eq('groups.creator_id', currentUser.id)
        .eq('status', 'pending');
        
    const list = document.getElementById('requests-list');
    const badge = document.getElementById('noti-count');
    list.innerHTML = "";
    
    if (data && data.length > 0) {
        badge.innerText = data.length;
        badge.classList.remove('hidden');
        
        data.forEach(req => {
            list.innerHTML += `
                <li style="background: var(--msg-search-bg); padding: 10px; border-radius: 8px; margin-bottom: 8px; display: flex; flex-direction: column; gap: 6px;">
                    <div style="font-size: 13px; color: var(--text-color);">
                        👤 <strong>${req.profiles.name}</strong> <span style="opacity:0.7; font-size:11px;">(${req.profiles.email})</span> wants to join.
                    </div>
                    <div style="display: flex; gap: 5px; justify-content: flex-end;">
                        <button onclick="actionRequest('${req.id}', 'accepted')" style="padding: 3px 10px; font-size: 11px; margin: 0; width: auto; background: var(--wa-teal); border: none;">Accept</button>
                        <button class="secondary" onclick="actionRequest('${req.id}', 'rejected')" style="padding: 3px 10px; font-size: 11px; margin: 0; width: auto;">Reject</button>
                    </div>
                </li>`;
        });
    } else {
        badge.classList.add('hidden');
        list.innerHTML = `<li style="text-align: center; color: #777; padding: 10px 0; font-size:13px;">No pending requests</li>`;
    }
}
async function actionRequest(reqId, status) {
    if (status === 'accepted') {
        const { data: reqData } = await supabaseClient.from('join_requests').select('*').eq('id', reqId).single();
        await supabaseClient.from('group_members').insert([{ group_id: reqData.group_id, user_id: reqData.user_id, role: 'student' }]);
    }
    await supabaseClient.from('join_requests').update({ status: status }).eq('id', reqId);
    loadNotifications();
    loadMyGroups();
}

// ================= DIRECT EMAIL INVITE =================
async function directAddUser() {
    const email = document.getElementById('invite-email').value.trim();
    if (!email) { alert("Please enter a student email!"); return; }
    
    const { data: userProfile } = await supabaseClient.from('profiles').select('id').eq('email', email).single();
    
    if (!userProfile) { alert("User with this email has not registered yet!"); return; }
    
    const { error } = await supabaseClient.from('group_members').insert([{ group_id: activeGroupId, user_id: userProfile.id, role: 'student' }]);
    if (error) alert("User is already in this class!"); 
    else { 
        alert("Student added directly successfully!"); 
        document.getElementById('invite-email').value = ""; 
    }
}

// ================= CHAT LOGIC =================
async function openClassroom(id, name, creatorId, uniqueId) {
    activeGroupId = id; activeGroupCreatorId = creatorId; activeGroupUniqueId = uniqueId;
    document.getElementById('no-group-selected').classList.add('hidden');
    document.getElementById('active-classroom').classList.remove('hidden');
    document.getElementById('active-group-title').innerText = name;
    
    // সাদ ভাই, আপনার রিকোয়ারমেন্ট অনুযায়ী এখানে ইউনিক আইডি শো হবে
    document.getElementById('active-group-id-display').innerText = `ID: ${uniqueId}`;

    document.getElementById('app-layout').classList.add('chat-open');

    // ক্লাসরুমের ব্যাকগ্রাউন্ড ওয়ালপেপার লোড করা
    const { data: groupDetails } = await supabaseClient.from('groups').select('wallpaper_url').eq('id', id).single();
    if (groupDetails && groupDetails.wallpaper_url) {
        document.getElementById('chat-main-view').style.backgroundImage = `url('${groupDetails.wallpaper_url}')`;
    } else {
        document.getElementById('chat-main-view').style.backgroundImage = ''; 
    }

    // কারেন্ট ইউজারের রোল চেক
    const { data: memberRoleData } = await supabaseClient
        .from('group_members')
        .select('role')
        .eq('group_id', id)
        .eq('user_id', currentUser.id)
        .maybeSingle();

    currentUserRoleInActiveGroup = memberRoleData ? memberRoleData.role : 'student';

    // রোল অনুযায়ী কন্ট্রোল বাটন হ্যান্ডেল করা
    if (currentUserRoleInActiveGroup === 'teacher' || currentUserRoleInActiveGroup === 'admin') {
        document.getElementById('toggle-invite-btn').classList.remove('hidden');
        document.getElementById('call-btn').innerText = "Live Class";
        document.getElementById('call-btn').disabled = false;
    } else {
        // স্টুডেন্ট হলে ইনপুট টগল করার বাটন ও সেকশন দুটোই সম্পূর্ণ ব্লক থাকবে
        document.getElementById('toggle-invite-btn').classList.add('hidden');
        document.getElementById('teacher-invite-zone').classList.add('hidden');
        document.getElementById('call-btn').innerText = "Live Waiting...";
        document.getElementById('call-btn').disabled = true;
    }
    loadMessages();
}

function backToGroupList() {
    document.getElementById('app-layout').classList.remove('chat-open');
}

// ================= CHAT MESSAGING (FIXED) =================
async function sendMessage() {
    const input = document.getElementById('message-input');
    const messageText = input.value.trim();
    
    // মেসেজ টেক্সট অথবা একটিভ গ্রুপ আইডি না থাকলে রিটার্ন করবে
    if (!messageText || !activeGroupId) return;

    try {
        // ১. সুপাবেসে মেসেজ পাঠানো (সঠিক ক্লায়েন্ট, কলাম এবং গ্রুপ আইডি সহ)
        const { data, error } = await supabaseClient
            .from('messages') 
            .insert([{ 
                message_text: messageText, 
                sender_id: currentUser.id,
                group_id: activeGroupId 
            }])
            .select(); // নতুন মেসেজের ডেটা রিটার্ন করবে

        if (error) {
            console.error("Supabase Error:", error);
            alert("মেসেজ পাঠানো যায়নি!");
            return;
        }

        // ২. পেজ রিফ্রেশ না করে সাথে সাথে স্ক্রিনে মেসেজ লোড করা
        if (typeof loadMessages === "function") {
            await loadMessages(); 
        }

        input.value = ''; // ইনপুট বক্স খালি করা
        
        // চ্যাট বক্স স্বয়ংক্রিয়ভাবে স্ক্রল করে নিচে নামানো
        const chatBox = document.getElementById('chat-messages');
        if (chatBox) {
            chatBox.scrollTop = chatBox.scrollHeight;
        }

    } catch (err) {
        console.error("Runtime Error:", err);
    }
}

async function loadMessages() {
    const { data } = await supabaseClient
        .from('messages')
        .select('message_text, sender_id, profiles(name)')
        .eq('group_id', activeGroupId)
        .order('created_at', { ascending: true });
        
    const chatBox = document.getElementById('chat-messages');
    chatBox.innerHTML = "";
    
    if (data) {
        data.forEach(msg => {
            const isMe = msg.sender_id === currentUser.id;
            let messageContentHtml = "";

            // 🔔 চেক করা হচ্ছে এটা কি লাইভ ক্লাসের স্পেশাল মেসেজ কিনা
            if (msg.message_text.startsWith('[LIVE_CLASS_STARTED]')) {
                const callUrl = msg.message_text.replace('[LIVE_CLASS_STARTED]', '');
                
                // সুন্দর একটি বাটন কার্ড ডিজাইন
                messageContentHtml = `
                    <div style="background: var(--card-bg); border-left: 5px solid #d32f2f; padding: 12px; border-radius: 8px; margin-top: 5px; box-shadow: 0 2px 5px rgba(0,0,0,0.05);">
                        <strong style="color: #d32f2f; display: block; margin-bottom: 5px;">🔴 The Class Has Started!</strong>
                        <span style="font-size: 13px; opacity: 0.8; display: block; margin-bottom: 10px;">Click the join button below to enter the classroom.</span>
                        <button onclick="window.open('${callUrl}', '_blank')" style="background: #25D366; color: white; border: none; padding: 6px 15px; font-size: 13px; border-radius: 20px; width: auto; cursor: pointer; font-weight: bold; margin: 0;">
                            👉 Join Class
                        </button>
                    </div>
                `;
            } else {
                // সাধারণ টেক্সট মেসেজ
                messageContentHtml = `<div class="text">${msg.message_text}</div>`;
            }

            // চ্যাট বক্সে মেসেজ বা বাটন পুশ করা
            chatBox.innerHTML += `
                <div class="msg-row ${isMe ? 'me' : 'them'}">
                    <div class="bubble">
                        <div class="sender-name">${isMe ? 'You' : msg.profiles.name}</div>
                        ${messageContentHtml}
                    </div>
                </div>`;
        });
        chatBox.scrollTop = chatBox.scrollHeight;
    }
}

function startClassCall() {
    if (currentUserRoleInActiveGroup !== 'teacher' && currentUserRoleInActiveGroup !== 'admin') {
        alert("Only Teachers and Admins can start the live class!");
        return;
    }

    // তোমার নিজস্ব Mirotalk SFU লিঙ্ক এবং ক্লাসের ইউনিক আইডি জোড়া হচ্ছে
    const mirotalkUrl = `https://myclassbd.shop/join/${activeGroupUniqueId}`;
    
    // ডাটাবেজে একটি স্পেশাল টেক্সট ফরম্যাট পাঠানো হচ্ছে, যা আমরা পরে বাটন বানাবো
    const callNotice = `[LIVE_CLASS_STARTED]${mirotalkUrl}`;
    
    // সুপাবেসে মেসেজ ইনসার্ট করা
    supabaseClient.from('messages').insert([
        { group_id: activeGroupId, sender_id: currentUser.id, message_text: callNotice }
    ]).then(() => {
        // শিক্ষকের জন্য নতুন ট্যাবে সরাসরি ভিডিও কল ওপেন হবে
        window.open(mirotalkUrl, '_blank');
    });
}

// ================= REALTIME SUBSCRIPTION =================
// ================= REALTIME SUBSCRIPTION (UPDATED WITH STUDENT ALERT) =================
function listenToRealtimeData() {
    supabaseClient.channel('custom-all-channel')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
        // ডাটাবেজ টাইপ মিসম্যাচ এড়াতে == ব্যবহার করা হয়েছে
        if (payload.new.group_id == activeGroupId) {
            loadMessages();
        }
        loadMyGroups();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'join_requests' }, async payload => {
        // শিক্ষকের প্যানেল আপডেট
        loadNotifications();
        
        // স্টুডেন্টের নিজের জন্য রিয়েলটাইম এক্সেপ্টেন্স এলার্ট লজিক
        if (payload.eventType === 'UPDATE' && payload.new.user_id === currentUser.id && payload.new.status === 'accepted') {
            const { data: groupData } = await supabaseClient
                .from('groups')
                .select('group_name')
                .eq('id', payload.new.group_id)
                .single();
                
            const className = groupData ? groupData.group_name : "Classroom";
            alert(`🎉 Your request has been accepted for the group: "${className}"!`);
            loadMyGroups(); // স্টুডেন্টের বামপাশের চ্যাট লিস্ট রিফ্রেশ করে গ্রুপটি যোগ করা
        }
    })
    // 🆕 এই নতুন অংশটি এখানে সুন্দরভাবে বসে গেছে
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'group_members' }, async payload => {
        // চেক করা হচ্ছে রোল আপডেটটি বর্তমান ইউজারের অ্যাকাউন্টে হয়েছে কি না
        if (payload.new.user_id === currentUser.id) {
            
            // 🔔 অভিনন্দন নোটিফিকেশন: যদি আগে এডমিন না থাকে এবং এখন এডমিন হয়
            if (payload.new.role === 'admin' && payload.old?.role !== 'admin') {
                const { data: groupData } = await supabaseClient.from('groups').select('group_name').eq('id', payload.new.group_id).single();
                const className = groupData ? groupData.group_name : "Classroom";
                alert(`🎉 Congrats! You are now an Admin for the "${className}" group.`);
            }
            
            // ⚠️ ডিমোশন নোটিফিকেশন: যদি এডমিন থেকে বাদ দিয়ে স্টুডেন্ট করা হয়
            if (payload.new.role === 'student' && payload.old?.role === 'admin') {
                const { data: groupData } = await supabaseClient.from('groups').select('group_name').eq('id', payload.new.group_id).single();
                const className = groupData ? groupData.group_name : "Classroom";
                alert(`⚠️ Notice: You have been removed from the Admin role in "${className}" group.`);
            }

            // কারেন্ট ওপেন থাকা চ্যাটে রোল পরিবর্তন হলে ভিউ এবং পারমিশন আপডেট করা
            if (payload.new.group_id == activeGroupId) {
                currentUserRoleInActiveGroup = payload.new.role;
                openClassroom(activeGroupId, document.getElementById('active-group-title').innerText, activeGroupCreatorId, activeGroupUniqueId);
            }
        }
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




