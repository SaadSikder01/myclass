const SUPABASE_URL = "https://bytnxoltodeckrmwobgc.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ5dG54b2x0b2RlY2tybXdvYmdjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyNjgwNDYsImV4cCI6MjA5NDg0NDA0Nn0.14nw0jHluWSlQTbrguKpHsXwmDjnirUktpJ_RCE9iHs";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUser = null,
    activeGroupId = null,
    activeGroupCreatorId = null,
    activeGroupUniqueId = null,
    currentUserRoleInActiveGroup = null,
    chatPollingInterval = null,
    activeGroupName = '',
    activeGroupAvatar = '',
    pendingLiveClassUrl = null,
    restrictMessaging = false,
    currentPopupMemberId = null,
    currentPopupMemberName = '',
    currentPopupMemberAvatar = '',
    currentPopupMemberRole = '';

document.addEventListener("DOMContentLoaded", () => {
    if (localStorage.getItem('darkMode') === 'enabled') document.body.classList.add('dark-mode');
    supabaseClient.auth.onAuthStateChange((event, session) => {
        if (session) {
            currentUser = session.user;
            showApp();
            loadMyGroups();
            listenToRealtimeData();
            checkUrlForJoinRequest();
        } else {
            showAuth();
        }
    });
});

function toggleAuthForms(showSignup) {
    document.getElementById('login-form').classList.toggle('hidden', showSignup);
    document.getElementById('signup-form').classList.toggle('hidden', !showSignup);
}

async function checkUrlForJoinRequest() {
    const urlParams = new URLSearchParams(window.location.search);
    const groupIdToJoin = urlParams.get('joinGroup');
    if (groupIdToJoin && currentUser) {
        const cleanUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
        window.history.pushState({ path: cleanUrl }, '', cleanUrl);
        const { data: isMember } = await supabaseClient.from('group_members').select('role').eq('group_id', groupIdToJoin).eq('user_id', currentUser.id).maybeSingle();
        if (isMember) {
            const { data: group } = await supabaseClient.from('groups').select('*').eq('id', groupIdToJoin).single();
            if (group) {
                openClassroom(group.id, group.group_name, group.creator_id, group.unique_id);
                alert(`You are already a member of "${group.group_name}".`);
            }
            return;
        }
        const { error } = await supabaseClient.from('join_requests').insert([{ group_id: groupIdToJoin, user_id: currentUser.id }]);
        if (error) alert("You have already sent a request or it is pending approval!");
        else alert("Successfully sent a join request via the shared link! Wait for teacher approval.");
    }
}

async function registerUser() {
    const name = document.getElementById('signup-name').value,
          email = document.getElementById('signup-email').value,
          password = document.getElementById('signup-password').value,
          confirmPassword = document.getElementById('signup-confirm-password').value,
          avatarFile = document.getElementById('signup-avatar').files[0];
    if (!name || !email || !password) return alert("Please fill all required fields!");
    if (password !== confirmPassword) return alert("Passwords don't match!");
    let avatarUrl = "https://placehold.co/150";
    if (avatarFile) {
        const filePath = `avatars/${Date.now()}_${avatarFile.name}`;
        const { error: uploadErr } = await supabaseClient.storage.from('classroom_uploads').upload(filePath, avatarFile);
        if (uploadErr) return alert(`Image upload failed: ${uploadErr.message}`);
        avatarUrl = supabaseClient.storage.from('classroom_uploads').getPublicUrl(filePath).data.publicUrl;
    }
    const { error: signUpErr } = await supabaseClient.auth.signUp({ email, password, options: { data: { name, avatar_url: avatarUrl } } });
    if (signUpErr) alert(signUpErr.message);
    else { alert("Signup successful! Please login."); toggleAuthForms(false); }
}

async function loginUser() {
    const emailEl = document.getElementById('login-email'),
          passEl = document.getElementById('login-password');
    if (!emailEl || !passEl) return alert("Something went wrong. Please reload.");
    const email = emailEl.value.trim(),
          password = passEl.value;
    if (!email || !password) return alert("Please enter both email and password.");
    try {
        const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) alert(error.message);
    } catch (err) {
        console.error(err);
        alert("Login failed. Please try again.");
    }
}

async function logoutUser() { await supabaseClient.auth.signOut(); location.reload(); }

function openProfileSettingsModal() {
    document.getElementById('profile-name-input').value = currentUser.user_metadata.name || "";
    document.getElementById('dark-mode-toggle').checked = document.body.classList.contains('dark-mode');
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
    const { data, error } = await supabaseClient.auth.updateUser({ data: { name: newName, avatar_url: avatarUrl } });
    if (error) alert(error.message);
    else {
        alert("Profile updated successfully!");
        currentUser = data.user;
        showApp();
        toggleProfileModal(false);
    }
}

async function createGroup() {
    const name = document.getElementById('group-name').value,
          uniqueId = document.getElementById('group-unique-id').value.trim(),
          avatarFile = document.getElementById('group-avatar').files[0];
    if (!name || !uniqueId) return alert("Fill all fields!");
    let avatarUrl = "https://placehold.co/150";
    if (avatarFile) {
        const filePath = `groups/${Date.now()}_${avatarFile.name}`;
        await supabaseClient.storage.from('classroom_uploads').upload(filePath, avatarFile);
        avatarUrl = supabaseClient.storage.from('classroom_uploads').getPublicUrl(filePath).data.publicUrl;
    }
    const { data: groupData, error: groupErr } = await supabaseClient.from('groups').insert([{
        group_name: name,
        unique_id: uniqueId,
        group_avatar: avatarUrl,
        creator_id: currentUser.id,
        restrict_messaging: false
    }]).select().single();
    if (groupErr) return alert("Unique ID already exists!");
    await supabaseClient.from('group_members').insert([{ group_id: groupData.id, user_id: currentUser.id, role: 'teacher' }]);
    alert("Classroom Created Successfully!");
    toggleCreateModal(false);
    loadMyGroups();
}

async function loadMyGroups() {
    const { data: memberData } = await supabaseClient.from('group_members').select('group_id, groups(*)').eq('user_id', currentUser.id);
    if (!memberData) return;
    const sortedGroupsList = [];
    for (const item of memberData) {
        if (!item.groups) continue;
        const group = item.groups;
        const { data: msgData } = await supabaseClient.from('messages').select('message_text, created_at').eq('group_id', group.id).order('created_at', { ascending: false }).limit(1);
        const lastMsg = msgData?.length ? msgData[0].message_text : "No messages yet";
        const lastMsgTime = msgData?.length ? new Date(msgData[0].created_at) : new Date(group.created_at);
        sortedGroupsList.push({ ...group, lastMsg, lastMsgTime });
    }
    sortedGroupsList.sort((a, b) => b.lastMsgTime - a.lastMsgTime);
    const listContainer = document.getElementById('my-groups-list');
    listContainer.innerHTML = "";
    sortedGroupsList.forEach(group => {
        let timeStr = group.lastMsg !== "No messages yet" ? new Date(group.lastMsgTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "";
        listContainer.innerHTML += `<li><a href="javascript:void(0);" class="chat-item" onclick="openClassroom('${group.id}', '${group.group_name}', '${group.creator_id}', '${group.unique_id}')"><img class="chat-item-avatar" src="${group.group_avatar || 'https://placehold.co/50'}"><div class="chat-item-info"><div class="chat-item-header"><span class="chat-item-name">${group.group_name}</span><span class="chat-item-time">${timeStr}</span></div><p class="chat-item-msg">${group.lastMsg}</p></div></a></li>`;
    });
}

// ==================== SETTINGS ICON ====================
function openGroupSettingsModal() {
    if (currentUserRoleInActiveGroup !== 'teacher' && currentUserRoleInActiveGroup !== 'admin') {
        if (typeof toggleLeaveGroupModal === 'function') {
            toggleLeaveGroupModal(true);
        } else {
            if (confirm("Do you want to leave this group?")) leaveGroup();
        }
        return;
    }
    document.getElementById('edit-group-name').value = activeGroupName;
    const restrictToggle = document.getElementById('restrict-messaging-toggle');
    if (restrictToggle) restrictToggle.checked = restrictMessaging;
    toggleGroupModal(true);
}

function confirmLeaveGroup() {
    if (typeof toggleLeaveGroupModal === 'function') toggleLeaveGroupModal(false);
    if (confirm("Are you sure you want to leave this group?")) leaveGroup();
}

async function leaveGroup() {
    if (!activeGroupId) return;
    const { error } = await supabaseClient.from('group_members').delete().eq('group_id', activeGroupId).eq('user_id', currentUser.id);
    if (error) alert("Failed: " + error.message);
    else {
        alert("You have left the group.");
        backToGroupList();
        loadMyGroups();
    }
}

async function saveGroupSettings() {
    const newName = document.getElementById('edit-group-name').value.trim(),
          avatarFile = document.getElementById('edit-group-avatar').files[0],
          wallpaperFile = document.getElementById('edit-group-wallpaper').files[0];
    let updateData = {};
    const restrictToggle = document.getElementById('restrict-messaging-toggle');
    if (restrictToggle) updateData.restrict_messaging = restrictToggle.checked;
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
    if (error) alert("Failed: " + error.message);
    else {
        if (restrictToggle) restrictMessaging = restrictToggle.checked;
        updateMessageInputState();
        alert("Classroom settings updated successfully!");
        toggleGroupModal(false);
        loadMyGroups();
        if (newName) {
            activeGroupName = newName;
            document.getElementById('active-group-title').innerText = newName;
        }
        if (updateData.wallpaper_url) document.getElementById('chat-main-view').style.backgroundImage = `url('${updateData.wallpaper_url}')`;
    }
}

// ========== GROUP MEMBERS MODAL ==========
async function openGroupMembersModal() {
    if (!activeGroupId) return;
    const { data: members, error } = await supabaseClient
        .from('group_members')
        .select('user_id, role, profiles(name, avatar_url)')
        .eq('group_id', activeGroupId);
    if (error) return alert("Failed to load members!");

    const listContainer = document.getElementById('classroom-members-list');
    listContainer.innerHTML = "";
    const isCurrentTeacher = (currentUserRoleInActiveGroup === 'teacher'),
          canPromote = (currentUserRoleInActiveGroup === 'teacher' || currentUserRoleInActiveGroup === 'admin');

    members.forEach(member => {
        const profile = member.profiles || { name: "Unknown User", avatar_url: "https://placehold.co/38" };
        let badgeHtml = '';
        if (member.role === 'teacher') badgeHtml = '<span class="admin-badge">Teacher</span>';
        else if (member.role === 'admin') badgeHtml = '<span class="admin-badge">Admin</span>';

        let actionButtonsHtml = '';
        if (member.role === 'student' && canPromote) {
            actionButtonsHtml += `<button class="make-admin-btn" onclick="event.stopPropagation(); makeMemberAdmin('${member.user_id}')">Make Admin</button>`;
        } else if (member.role === 'admin' && isCurrentTeacher) {
            actionButtonsHtml += `<button class="remove-admin-btn" style="background:#e74c3c; color:white; border:none; padding:4px 12px; border-radius:15px; font-size:12px; cursor:pointer;" onclick="event.stopPropagation(); removeMemberAdmin('${member.user_id}')">Remove Admin</button>`;
        }
        if (canPromote && member.user_id !== currentUser.id) {
            actionButtonsHtml += `<button class="remove-member-btn" style="background:#d32f2f; color:white; border:none; padding:4px 12px; border-radius:15px; font-size:12px; cursor:pointer; margin-left:5px;" onclick="event.stopPropagation(); removeMemberFromGroup('${member.user_id}')">Remove</button>`;
        }

        listContainer.innerHTML += `
            <li class="member-item">
                <div class="member-info" onclick="showMemberProfile({user_id: '${member.user_id}', name: '${profile.name}', avatar_url: '${profile.avatar_url}', role: '${member.role}'})">
                    <img class="member-avatar" src="${profile.avatar_url || 'https://placehold.co/38'}" alt="Avatar">
                    <span class="member-name">${profile.name} ${badgeHtml}</span>
                </div>
                <div style="display:flex; gap:5px;">${actionButtonsHtml}</div>
            </li>`;
    });
    toggleMembersModal(true);
}

async function removeMemberFromGroup(memberUserId) {
    if (!confirm("Are you sure you want to remove this member from the group?")) return;
    const { error } = await supabaseClient.from('group_members').delete().eq('group_id', activeGroupId).eq('user_id', memberUserId);
    if (error) alert("Failed: " + error.message);
    else {
        alert("Member removed successfully.");
        openGroupMembersModal();
        loadMyGroups();
    }
}

async function makeMemberAdmin(memberUserId) {
    if (!confirm("Are you sure?")) return;
    const { error } = await supabaseClient.from('group_members').update({ role: 'admin' }).eq('group_id', activeGroupId).eq('user_id', memberUserId);
    if (error) alert("Failed: " + error.message);
    else { alert("Member promoted to Admin!"); openGroupMembersModal(); }
}
async function removeMemberAdmin(memberUserId) {
    if (!confirm("Are you sure?")) return;
    const { error } = await supabaseClient.from('group_members').update({ role: 'student' }).eq('group_id', activeGroupId).eq('user_id', memberUserId);
    if (error) alert("Failed: " + error.message);
    else { alert("Admin role removed!"); openGroupMembersModal(); }
}

async function searchGroup() {
    const uniqueId = document.getElementById('search-id').value.trim(),
          resultDiv = document.getElementById('search-result');
    if (!uniqueId) { resultDiv.classList.add('hidden'); return; }
    const { data } = await supabaseClient.from('groups').select('*').eq('unique_id', uniqueId).single();
    resultDiv.classList.remove('hidden');
    if (!data) { resultDiv.innerHTML = "<span style='color:red;'>Classroom not found!</span>"; return; }
    resultDiv.innerHTML = `<div style='background:var(--msg-search-bg); padding:10px 15px; border-radius:10px; display:flex; justify-content:space-between;'><div><strong>${data.group_name}</strong><div style="font-size:11px;">ID: ${data.unique_id}</div></div><button onclick="sendJoinRequest('${data.id}')" style='padding:4px 12px; font-size:12px; background:var(--wa-teal); border:none; border-radius:15px; color:white;'>Join</button></div>`;
}
async function sendJoinRequest(groupId) {
    const { error } = await supabaseClient.from('join_requests').insert([{ group_id: groupId, user_id: currentUser.id }]);
    if (error) alert("Already requested or member!");
    else {
        alert("Request sent!");
        document.getElementById('search-id').value = "";
        document.getElementById('search-result').classList.add('hidden');
    }
}

function shareGroupLink() {
    if (!activeGroupId) return;
    const shareUrl = `${window.location.origin}${window.location.pathname}?joinGroup=${activeGroupId}`;
    navigator.clipboard.writeText(shareUrl).then(() => alert("Link copied!")).catch(() => alert("Copy failed! " + shareUrl));
}

async function loadNotifications() {
    const { data } = await supabaseClient
        .from('join_requests')
        .select('id, status, groups!inner(creator_id, group_name), profiles(name, email)')
        .eq('groups.creator_id', currentUser.id)
        .eq('status', 'pending');
    const list = document.getElementById('requests-list'),
          badge = document.getElementById('noti-count');
    list.innerHTML = "";
    if (data && data.length) {
        badge.innerText = data.length;
        badge.classList.remove('hidden');
        data.forEach(req => {
            const groupName = req.groups?.group_name || 'Unknown Group';
            list.innerHTML += `
                <li style="background: var(--msg-search-bg); padding: 10px; border-radius: 8px; margin-bottom: 8px;">
                    <div style="font-size:13px;">👤 <strong>${req.profiles.name}</strong> (${req.profiles.email})</div>
                    <div style="font-size:12px; color: var(--wa-teal); margin-top: 2px;">📘 Wants to join <strong>${groupName}</strong></div>
                    <div style="display:flex; gap:5px; justify-content:flex-end; margin-top: 6px;">
                        <button onclick="actionRequest('${req.id}','accepted')" style="padding:3px 10px; background:var(--wa-teal); border:none; color:white; border-radius:4px;">Accept</button>
                        <button class="secondary" onclick="actionRequest('${req.id}','rejected')" style="padding:3px 10px;">Reject</button>
                    </div>
                </li>`;
        });
    } else {
        badge.classList.add('hidden');
        list.innerHTML = "<li style='text-align:center; color:#777;'>No pending requests</li>";
    }
}
async function actionRequest(reqId, status) {
    if (status === 'accepted') {
        const { data: reqData } = await supabaseClient.from('join_requests').select('*').eq('id', reqId).single();
        await supabaseClient.from('group_members').insert([{ group_id: reqData.group_id, user_id: reqData.user_id, role: 'student' }]);
    }
    await supabaseClient.from('join_requests').update({ status }).eq('id', reqId);
    loadNotifications();
    loadMyGroups();
}
async function directAddUser() {
    const email = document.getElementById('invite-email').value.trim();
    if (!email) return alert("Enter student email!");
    const { data: userProfile } = await supabaseClient.from('profiles').select('id').eq('email', email).single();
    if (!userProfile) return alert("User not registered!");
    const { error } = await supabaseClient.from('group_members').insert([{ group_id: activeGroupId, user_id: userProfile.id, role: 'student' }]);
    if (error) alert("User already in class!");
    else {
        alert("Student added!");
        document.getElementById('invite-email').value = "";
    }
}

// ========== SHORT POLLING ==========
async function openClassroom(id, name, creatorId, uniqueId) {
    if (chatPollingInterval) clearInterval(chatPollingInterval);
    activeGroupId = id; activeGroupCreatorId = creatorId; activeGroupUniqueId = uniqueId; activeGroupName = name;
    const { data: group } = await supabaseClient.from('groups').select('group_avatar, restrict_messaging').eq('id', id).single();
    activeGroupAvatar = group?.group_avatar || 'https://placehold.co/150';
    restrictMessaging = group?.restrict_messaging || false;

    document.getElementById('no-group-selected').classList.add('hidden');
    document.getElementById('active-classroom').classList.remove('hidden');
    document.getElementById('active-group-title').innerText = name;
    document.getElementById('active-group-id-display').innerText = `ID: ${uniqueId}`;
    document.getElementById('app-layout').classList.add('chat-open');
    document.getElementById('app-container').classList.add('group-open');

    chatPollingInterval = setInterval(() => { if (activeGroupId) { loadMessages(); loadMyGroups(); } }, 4000);

    const { data: wall } = await supabaseClient.from('groups').select('wallpaper_url').eq('id', id).single();
    document.getElementById('chat-main-view').style.backgroundImage = wall?.wallpaper_url ? `url('${wall.wallpaper_url}')` : '';

    const { data: memberRole } = await supabaseClient.from('group_members').select('role').eq('group_id', id).eq('user_id', currentUser.id).maybeSingle();
    currentUserRoleInActiveGroup = memberRole ? memberRole.role : 'student';

    const callBtn = document.getElementById('call-btn');
    if (currentUserRoleInActiveGroup === 'teacher' || currentUserRoleInActiveGroup === 'admin') {
        document.getElementById('toggle-invite-btn').classList.remove('hidden');
        callBtn.disabled = false;
    } else {
        document.getElementById('toggle-invite-btn').classList.add('hidden');
        document.getElementById('teacher-invite-zone').classList.add('hidden');
        callBtn.disabled = true;
    }

    updateMessageInputState();
    loadMessages();
}

function updateMessageInputState() {
    const input = document.getElementById('message-input');
    const sendBtn = document.querySelector('.chat-footer button');
    if (!input || !sendBtn) return;
    if (restrictMessaging && currentUserRoleInActiveGroup !== 'teacher' && currentUserRoleInActiveGroup !== 'admin') {
        input.disabled = true; input.placeholder = "Only admins can send messages"; sendBtn.disabled = true;
    } else {
        input.disabled = false; input.placeholder = "Type a message..."; sendBtn.disabled = false;
    }
}

function backToGroupList() {
    document.getElementById('app-layout').classList.remove('chat-open');
    document.getElementById('app-container').classList.remove('group-open');
}

async function sendMessage() {
    const input = document.getElementById('message-input');
    const messageText = input.value.trim();
    if (!messageText || !activeGroupId) return;
    if (restrictMessaging && currentUserRoleInActiveGroup !== 'teacher' && currentUserRoleInActiveGroup !== 'admin') {
        return alert("Only teachers and admins can send messages.");
    }
    const { error } = await supabaseClient.from('messages').insert([{ message_text: messageText, sender_id: currentUser.id, group_id: activeGroupId }]);
    if (error) alert("Message send failed!");
    else {
        await loadMessages();
        input.value = '';
        document.getElementById('chat-messages').scrollTop = document.getElementById('chat-messages').scrollHeight;
    }
}

async function loadMessages() {
    const chatBox = document.getElementById('chat-messages');
    const prevHeight = chatBox.scrollHeight, prevTop = chatBox.scrollTop, clientH = chatBox.clientHeight;
    const distanceFromBottom = prevHeight - prevTop - clientH;
    const isNearBottom = distanceFromBottom < 50;

    const { data } = await supabaseClient
        .from('messages')
        .select('id, message_text, sender_id, created_at, profiles(name, avatar_url)')
        .eq('group_id', activeGroupId)
        .order('created_at', { ascending: true });

    chatBox.innerHTML = "";
    let newLiveClassUrl = null;

    if (data) {
        const now = new Date();
        data.forEach(msg => {
            const isMe = msg.sender_id === currentUser.id;
            const avatarUrl = msg.profiles?.avatar_url || 'https://placehold.co/30';
            const senderName = isMe ? 'You' : (msg.profiles?.name || 'Unknown');
            let msgHtml;

            if (msg.message_text.startsWith('[LIVE_CLASS_STARTED]')) {
                const callUrl = msg.message_text.replace('[LIVE_CLASS_STARTED]', '');
                msgHtml = `<div style="background: var(--card-bg); border-left: 5px solid #d32f2f; padding: 12px; border-radius: 8px;">
                    <strong>🔴 The Class Has Started!</strong><br>
                    <button onclick="window.open('${callUrl}','_self')" style="background:#25D366; color:white; border:none; padding:6px 15px; border-radius:20px; cursor:pointer;">👉 Join Class</button>
                </div>`;
                const msgTime = new Date(msg.created_at);
                const diffSeconds = (now - msgTime) / 1000;
                if (!isMe && diffSeconds <= 10) newLiveClassUrl = callUrl;
            } else {
                msgHtml = `<div class="text">${msg.message_text}</div>`;
            }

            chatBox.innerHTML += `
                <div class="msg-row ${isMe ? 'me' : 'them'}">
                    <div class="bubble">
                        <div class="sender-name">
                            <img class="msg-avatar" src="${avatarUrl}" onclick="event.stopPropagation(); showMemberProfile({user_id: '${msg.sender_id}', name: '${senderName}', avatar_url: '${avatarUrl}', role: 'Member'})" />
                            ${senderName}
                        </div>
                        ${msgHtml}
                    </div>
                </div>`;
        });

        if (newLiveClassUrl) showIncomingCallPopup(newLiveClassUrl);

        if (isNearBottom) chatBox.scrollTop = chatBox.scrollHeight;
        else chatBox.scrollTop = chatBox.scrollHeight - distanceFromBottom - clientH;
    }
}

function showIncomingCallPopup(callUrl) {
    pendingLiveClassUrl = callUrl;
    document.getElementById('call-group-avatar').src = activeGroupAvatar;
    document.getElementById('call-group-name').innerText = activeGroupName;
    document.getElementById('incoming-call-popup').classList.remove('hidden');
}
function closeIncomingCallPopup() {
    document.getElementById('incoming-call-popup').classList.add('hidden');
    pendingLiveClassUrl = null;
}
function joinLiveClass() {
    if (pendingLiveClassUrl) {
        window.open(pendingLiveClassUrl, '_self');
        closeIncomingCallPopup();
    }
}

function startClassCall() {
    if (currentUserRoleInActiveGroup !== 'teacher' && currentUserRoleInActiveGroup !== 'admin') {
        return alert("Only Teachers and Admins can start the live class!");
    }
    const mirotalkUrl = `https://myclassbd.shop/join/${activeGroupUniqueId}`;
    const callNotice = `[LIVE_CLASS_STARTED]${mirotalkUrl}`;
    supabaseClient
        .from('messages')
        .insert([{ group_id: activeGroupId, sender_id: currentUser.id, message_text: callNotice }])
        .then(() => { window.open(mirotalkUrl, '_self'); });
}

function listenToRealtimeData() {
    supabaseClient
        .channel('custom-all-channel')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'join_requests' }, async payload => {
            loadNotifications();
            if (payload.eventType === 'UPDATE' && payload.new.user_id === currentUser.id && payload.new.status === 'accepted') {
                const { data: groupData } = await supabaseClient.from('groups').select('group_name').eq('id', payload.new.group_id).single();
                alert(`🎉 Your request has been accepted for "${groupData.group_name}"!`);
                loadMyGroups();
            }
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'group_members' }, async payload => {
            if (payload.new.user_id === currentUser.id) {
                if (payload.new.role === 'admin' && payload.old?.role !== 'admin') {
                    const { data: groupData } = await supabaseClient.from('groups').select('group_name').eq('id', payload.new.group_id).single();
                    alert(`🎉 Congrats! You are now an Admin for "${groupData.group_name}".`);
                }
                if (payload.new.role === 'student' && payload.old?.role === 'admin') {
                    const { data: groupData } = await supabaseClient.from('groups').select('group_name').eq('id', payload.new.group_id).single();
                    alert(`⚠️ Notice: You have been removed from Admin role in "${groupData.group_name}".`);
                }
                if (payload.new.group_id == activeGroupId) {
                    currentUserRoleInActiveGroup = payload.new.role;
                    openClassroom(activeGroupId, activeGroupName, activeGroupCreatorId, activeGroupUniqueId);
                }
            }
        })
        .subscribe();
    loadNotifications();
}

function toggleNotifications() { document.getElementById('notification-panel').classList.toggle('hidden'); }

// ========== STAR LOGIC ==========
async function showMemberProfile(member) {
    currentPopupMemberId = member.user_id;
    currentPopupMemberName = member.name;
    currentPopupMemberAvatar = member.avatar_url || 'https://placehold.co/150';
    currentPopupMemberRole = member.role;

    document.getElementById('popup-member-avatar').src = currentPopupMemberAvatar;
    document.getElementById('popup-member-name').innerText = currentPopupMemberName;
    const roleSpan = document.getElementById('popup-member-role');
    roleSpan.innerText = currentPopupMemberRole ? (currentPopupMemberRole.charAt(0).toUpperCase() + currentPopupMemberRole.slice(1)) : 'Member';
    roleSpan.style.display = 'inline-block';

    await updateStarUI();
    document.getElementById('member-profile-popup').classList.remove('hidden');
}

async function updateStarUI() {
    if (!currentPopupMemberId || !currentUser) return;
    const starBtn = document.getElementById('star-btn');
    const starCountSpan = document.getElementById('star-count');

    const { count, error: countErr } = await supabaseClient
        .from('user_stars')
        .select('*', { count: 'exact', head: true })
        .eq('receiver_user_id', currentPopupMemberId);
    if (!countErr) starCountSpan.innerText = count || 0;

    if (currentUser.id === currentPopupMemberId) {
        starBtn.style.opacity = '0.3'; starBtn.disabled = true; return;
    }
    const { data, error } = await supabaseClient
        .from('user_stars')
        .select('id')
        .eq('giver_user_id', currentUser.id)
        .eq('receiver_user_id', currentPopupMemberId)
        .maybeSingle();
    if (!error && data) {
        starBtn.innerHTML = '★'; starBtn.style.color = '#e4b400';
    } else {
        starBtn.innerHTML = '☆'; starBtn.style.color = '#aaa';
    }
    starBtn.style.opacity = '1'; starBtn.disabled = false;
}

async function toggleStar() {
    if (!currentPopupMemberId || !currentUser || currentUser.id === currentPopupMemberId) return;
    const { data, error } = await supabaseClient
        .from('user_stars')
        .select('id')
        .eq('giver_user_id', currentUser.id)
        .eq('receiver_user_id', currentPopupMemberId)
        .maybeSingle();
    if (error) return alert("Something went wrong.");
    if (data) {
        await supabaseClient.from('user_stars').delete().eq('id', data.id);
    } else {
        await supabaseClient.from('user_stars').insert([{ giver_user_id: currentUser.id, receiver_user_id: currentPopupMemberId }]);
    }
    await updateStarUI();
    await updateMyStarCount();
}

async function updateMyStarCount() {
    if (!currentUser) return;
    const { count, error } = await supabaseClient
        .from('user_stars')
        .select('*', { count: 'exact', head: true })
        .eq('receiver_user_id', currentUser.id);
    const span = document.getElementById('my-star-count');
    if (span) {
        span.innerText = `★ ${count || 0}`;
    }
}

function showApp() {
    document.getElementById('auth-container').classList.add('hidden');
    document.getElementById('app-container').classList.remove('hidden');
    document.getElementById('welcome-user').innerText = currentUser.user_metadata.name || currentUser.email;
    document.getElementById('user-avatar').src = currentUser.user_metadata.avatar_url || "https://placehold.co/40";
    updateMyStarCount();
}

function showAuth() {
    document.getElementById('auth-container').classList.remove('hidden');
    document.getElementById('app-container').classList.add('hidden');
    if (chatPollingInterval) { clearInterval(chatPollingInterval); chatPollingInterval = null; }
}
