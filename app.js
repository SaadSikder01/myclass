/* ============================================================
   MyClassroom - app.js  (Galene + Live Whiteboard - Option A)
   ============================================================ */

const SUPABASE_URL = "https://bytnxoltodeckrmwobgc.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ5dG54b2x0b2RlY2tybXdvYmdjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyNjgwNDYsImV4cCI6MjA5NDg0NDA0Nn0.14nw0jHluWSlQTbrguKpHsXwmDjnirUktpJ_RCE9iHs";

const GALENE_BASE_URL   = 'https://2a14-6781-000a-0000-0007.taild42689.ts.net';
const GALENE_GROUP      = 'classroom';
const GALENE_PROXY_URL  = 'https://bytnxoltodeckrmwobgc.supabase.co/functions/v1/galene-proxy';

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

let pendingMedia = null;
let membersRoleCache = {};
let currentEditMessageId = null;
let lastMessagesHash = '';
let shownLiveCallIds = new Set();

let currentLiveCallId = null;
let currentGaleneTeacherToken = null;
let currentGaleneStudentToken = null;
let liveHeartbeatTimer = null;
let pendingLiveCallId = null;
let pendingLiveBaseUrl = null;
let pendingLiveStudentToken = null;

// ✅ Live Whiteboard state
let liveWBChannel = null;
let liveWBSessionId = null;
let liveWBActive = false;
let wbBroadcastTimer = null;
let wbMode = 'normal'; // 'normal' | 'live-teacher' | 'live-student'

/* ============================================================
   INIT
   ============================================================ */
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

    setTimeout(enhanceCheckboxesToToggles, 0);
    const observer = new MutationObserver(() => enhanceCheckboxesToToggles());
    observer.observe(document.body, { childList: true, subtree: true });

    document.getElementById('media-image-input')?.addEventListener('change', e => {
        const f = e.target.files[0]; e.target.value = ''; if (f) setPendingMedia(f, 'image');
    });
    document.getElementById('media-video-input')?.addEventListener('change', e => {
        const f = e.target.files[0]; e.target.value = ''; if (f) setPendingMedia(f, 'video');
    });
    document.getElementById('media-audio-input')?.addEventListener('change', e => {
        const f = e.target.files[0]; e.target.value = ''; if (f) setPendingMedia(f, 'audio');
    });

    document.getElementById('wb-color')?.addEventListener('input', e => { wbColor = e.target.value; });
    document.getElementById('wb-fill')?.addEventListener('input', e => { wbFill = e.target.value; });
    document.getElementById('wb-size')?.addEventListener('input', e => { wbSize = parseInt(e.target.value); });

    document.addEventListener('click', (e) => {
        const pm = document.getElementById('plus-menu');
        const pb = document.getElementById('plus-btn');
        if (pm && pb && !pm.contains(e.target) && !pb.contains(e.target)) {
            pm.classList.add('hidden'); pb.classList.remove('open');
        }
    });

    document.getElementById('message-input')?.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            document.getElementById('msg-action-menu')?.remove();
            document.getElementById('edit-message-modal')?.classList.add('hidden');
            document.getElementById('poll-create-modal')?.classList.add('hidden');
            document.getElementById('add-student-modal')?.classList.add('hidden');
        }
    });

    document.addEventListener('keydown', (e) => {
        const modal = document.getElementById('whiteboard-modal');
        if (!modal || modal.classList.contains('hidden')) return;
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        if (wbMode === 'live-student') return;
        const key = e.key.toLowerCase();
        if (e.ctrlKey || e.metaKey) {
            if (key === 'z') { e.preventDefault(); e.shiftKey ? wbRedo() : wbUndo(); }
            else if (key === 'y') { e.preventDefault(); wbRedo(); }
            return;
        }
        if (key === 'delete' || key === 'backspace') { if (wbSelected) { e.preventDefault(); wbDeleteSelected(); } return; }
        const shortcuts = { 'v':'select','h':'pan','p':'pen','m':'highlighter','e':'eraser','l':'line','a':'arrow','r':'rect','o':'circle','t':'triangle','x':'text','n':'sticky' };
        if (shortcuts[key]) { e.preventDefault(); wbSetTool(shortcuts[key]); }
    });

    document.addEventListener('keydown', e => {
        if (e.code === 'Space') {
            const wbModal = document.getElementById('whiteboard-modal');
            if (wbModal && !wbModal.classList.contains('hidden') && !e.target.closest('input,textarea')) {
                wbSpaceHeld = true; e.preventDefault();
                if (wbCanvas && !wbPanning) wbCanvas.style.cursor = 'grab';
            }
        }
    });
    document.addEventListener('keyup', e => {
        if (e.code === 'Space') {
            wbSpaceHeld = false;
            if (wbCanvas && !wbPanning) {
                if (wbTool === 'pan') wbCanvas.style.cursor = 'grab';
                else if (wbTool === 'select') wbCanvas.style.cursor = 'default';
                else if (wbTool === 'text' || wbTool === 'sticky') wbCanvas.style.cursor = 'text';
                else wbCanvas.style.cursor = 'crosshair';
            }
        }
    });

    setTimeout(injectWhiteboardPanButton, 100);
    window.addEventListener('beforeunload', () => stopLiveHeartbeat());
});

function injectWhiteboardPanButton() {
    const toolbar = document.querySelector('.wb-toolbar');
    if (!toolbar) return;
    if (document.getElementById('wb-tool-pan')) return;
    const panBtn = document.createElement('button');
    panBtn.id = 'wb-tool-pan';
    panBtn.title = 'Pan (H · middle-mouse · hold Space)';
    panBtn.textContent = '✋';
    panBtn.setAttribute('onclick', "wbSetTool('pan')");
    const selectBtn = document.getElementById('wb-tool-select');
    if (selectBtn) selectBtn.insertAdjacentElement('afterend', panBtn);
    else toolbar.insertBefore(panBtn, toolbar.querySelector('button'));
}

function enhanceCheckboxesToToggles() {
    document.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        if (cb.closest('.switch')) return;
        const wrapper = document.createElement('label');
        wrapper.className = 'switch';
        const slider = document.createElement('span');
        slider.className = 'slider';
        cb.parentNode.insertBefore(wrapper, cb);
        wrapper.appendChild(cb);
        wrapper.appendChild(slider);
    });
}

/* ============================================================
   AUTH
   ============================================================ */
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
            if (group) { openClassroom(group.id, group.group_name, group.creator_id, group.unique_id); alert(`You are already a member of "${group.group_name}".`); }
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
    const emailEl = document.getElementById('login-email'), passEl = document.getElementById('login-password');
    if (!emailEl || !passEl) return alert("Something went wrong. Please reload.");
    const email = emailEl.value.trim(), password = passEl.value;
    if (!email || !password) return alert("Please enter both email and password.");
    try {
        const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) alert(error.message);
    } catch (err) { console.error(err); alert("Login failed. Please try again."); }
}
async function logoutUser() { await supabaseClient.auth.signOut(); location.reload(); }

/* ============================================================
   PROFILE
   ============================================================ */
function openProfileSettingsModal() {
    document.getElementById('profile-name-input').value = currentUser.user_metadata.name || "";
    document.getElementById('dark-mode-toggle').checked = document.body.classList.contains('dark-mode');
    toggleProfileModal(true);
}
function handleDarkModeToggle(checkbox) {
    if (checkbox.checked) { document.body.classList.add('dark-mode'); localStorage.setItem('darkMode', 'enabled'); }
    else { document.body.classList.remove('dark-mode'); localStorage.setItem('darkMode', 'disabled'); }
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
    if (error) return alert(error.message);
    const { error: profileErr } = await supabaseClient.from('profiles').upsert({ id: currentUser.id, name: newName, avatar_url: avatarUrl, email: currentUser.email }, { onConflict: 'id' });
    if (profileErr) console.warn("Profiles update error:", profileErr.message);
    alert("Profile updated successfully!");
    currentUser = data.user;
    showApp();
    document.querySelectorAll('.msg-row.me .msg-avatar').forEach(img => { if (avatarUrl) img.src = avatarUrl; });
    toggleProfileModal(false);
}

/* ============================================================
   GROUPS
   ============================================================ */
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
    const { data: groupData, error: groupErr } = await supabaseClient.from('groups').insert([{ group_name: name, unique_id: uniqueId, group_avatar: avatarUrl, creator_id: currentUser.id }]).select().single();
    if (groupErr) return alert("Failed to create group: " + groupErr.message);
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
        const { data: msgData } = await supabaseClient.from('messages').select('message_text, created_at, deleted_for_everyone, deleted_by_admin').eq('group_id', group.id).order('created_at', { ascending: false }).limit(1);
        let lastMsg = msgData?.length ? msgData[0].message_text : "No messages yet";
        const lastRec = msgData?.[0];
        if (lastRec) {
            if (lastRec.deleted_by_admin) lastMsg = 'This message was deleted by admin or teacher';
            else if (lastRec.deleted_for_everyone) lastMsg = 'This message was deleted';
            else if (lastMsg.startsWith('[IMAGE]')) lastMsg = '📷 Photo';
            else if (lastMsg.startsWith('[VIDEO]')) lastMsg = '🎥 Video';
            else if (lastMsg.startsWith('[AUDIO]')) lastMsg = '🎵 Audio';
            else if (lastMsg.startsWith('[WHITEBOARD]')) lastMsg = '🖌️ Whiteboard';
            else if (lastMsg.startsWith('[POLL]')) lastMsg = '📊 Poll';
            else if (lastMsg.startsWith('[LIVE_CLASS_STARTED]')) lastMsg = '🔴 Live class started';
            else if (lastMsg.startsWith('[LIVE_CLASS_ENDED]')) lastMsg = '⏹️ Live class ended';
        }
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

function openGroupSettingsModal() {
    if (currentUserRoleInActiveGroup !== 'teacher' && currentUserRoleInActiveGroup !== 'admin') {
        if (typeof toggleLeaveGroupModal === 'function') toggleLeaveGroupModal(true);
        else if (confirm("Do you want to leave this group?")) leaveGroup();
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
    else { alert("You have left the group."); backToGroupList(); loadMyGroups(); }
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
        if (newName) { activeGroupName = newName; document.getElementById('active-group-title').innerText = newName; }
        if (updateData.wallpaper_url) document.getElementById('chat-main-view').style.backgroundImage = `url('${updateData.wallpaper_url}')`;
    }
}

/* ============================================================
   MEMBERS
   ============================================================ */
async function cacheMemberRoles(groupId) {
    const { data } = await supabaseClient.from('group_members').select('user_id, role').eq('group_id', groupId);
    membersRoleCache = {};
    if (data) data.forEach(m => membersRoleCache[m.user_id] = m.role);
}
async function openGroupMembersModal() {
    if (!activeGroupId) return;
    const { data: members, error } = await supabaseClient.from('group_members').select('user_id, role, profiles(name, avatar_url)').eq('group_id', activeGroupId);
    if (error) return alert("Failed to load members!");
    membersRoleCache = {};
    members.forEach(m => membersRoleCache[m.user_id] = m.role);
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
        if (member.role === 'student' && canPromote) actionButtonsHtml += `<button class="make-admin-btn" onclick="event.stopPropagation(); makeMemberAdmin('${member.user_id}')">Make Admin</button>`;
        else if (member.role === 'admin' && isCurrentTeacher) actionButtonsHtml += `<button style="background:#e74c3c;color:white;border:none;padding:4px 12px;border-radius:15px;font-size:12px;cursor:pointer;" onclick="event.stopPropagation(); removeMemberAdmin('${member.user_id}')">Remove Admin</button>`;
        if (canPromote && member.user_id !== currentUser.id) actionButtonsHtml += `<button class="remove-member-btn" style="margin-left:5px;" onclick="event.stopPropagation(); removeMemberFromGroup('${member.user_id}')">Remove</button>`;
        const memberJson = encodeURIComponent(JSON.stringify({ user_id: member.user_id, name: profile.name, avatar_url: profile.avatar_url, role: member.role }));
        listContainer.innerHTML += `<li class="member-item"><div class="member-info" onclick="showMemberProfile(JSON.parse(decodeURIComponent('${memberJson}')))"><img class="member-avatar" src="${profile.avatar_url || 'https://placehold.co/38'}"><span class="member-name">${profile.name} ${badgeHtml}</span></div><div style="display:flex; gap:5px;">${actionButtonsHtml}</div></li>`;
    });
    toggleMembersModal(true);
}
async function removeMemberFromGroup(uid) {
    if (!confirm("Remove this member?")) return;
    const { error } = await supabaseClient.from('group_members').delete().eq('group_id', activeGroupId).eq('user_id', uid);
    if (error) alert("Failed: " + error.message);
    else { alert("Member removed."); openGroupMembersModal(); loadMyGroups(); }
}
async function makeMemberAdmin(uid) {
    if (!confirm("Are you sure?")) return;
    const { error } = await supabaseClient.from('group_members').update({ role: 'admin' }).eq('group_id', activeGroupId).eq('user_id', uid);
    if (error) alert("Failed: " + error.message);
    else { alert("Promoted to Admin!"); openGroupMembersModal(); }
}
async function removeMemberAdmin(uid) {
    if (!confirm("Are you sure?")) return;
    const { error } = await supabaseClient.from('group_members').update({ role: 'student' }).eq('group_id', activeGroupId).eq('user_id', uid);
    if (error) alert("Failed: " + error.message);
    else { alert("Admin role removed!"); openGroupMembersModal(); }
}

/* ============================================================
   SEARCH & NOTIFICATIONS
   ============================================================ */
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
    else { alert("Request sent!"); document.getElementById('search-id').value = ""; document.getElementById('search-result').classList.add('hidden'); }
}
function shareGroupLink() {
    if (!activeGroupId) return;
    const shareUrl = `${window.location.origin}${window.location.pathname}?joinGroup=${activeGroupId}`;
    navigator.clipboard.writeText(shareUrl).then(() => alert("Link copied!")).catch(() => alert("Copy failed! " + shareUrl));
}
async function loadNotifications() {
    const { data } = await supabaseClient.from('join_requests').select('id, status, groups!inner(creator_id, group_name), profiles(name, email)').eq('groups.creator_id', currentUser.id).eq('status', 'pending');
    const list = document.getElementById('requests-list'), badge = document.getElementById('noti-count');
    list.innerHTML = "";
    if (data && data.length) {
        badge.innerText = data.length; badge.classList.remove('hidden');
        data.forEach(req => {
            const groupName = req.groups?.group_name || 'Unknown Group';
            list.innerHTML += `<li style="background: var(--msg-search-bg); padding: 10px; border-radius: 8px; margin-bottom: 8px;"><div style="font-size:13px;">👤 <strong>${req.profiles.name}</strong> (${req.profiles.email})</div><div style="font-size:12px; color: var(--wa-teal); margin-top: 2px;">📘 Wants to join <strong>${groupName}</strong></div><div style="display:flex; gap:5px; justify-content:flex-end; margin-top: 6px;"><button onclick="actionRequest('${req.id}','accepted')" style="padding:3px 10px; background:var(--wa-teal); border:none; color:white; border-radius:4px;">Accept</button><button class="secondary" onclick="actionRequest('${req.id}','rejected')" style="padding:3px 10px;">Reject</button></div></li>`;
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
    loadNotifications(); loadMyGroups();
}

/* ============================================================
   ADD STUDENT
   ============================================================ */
function openAddStudentModal() {
    if (currentUserRoleInActiveGroup !== 'teacher' && currentUserRoleInActiveGroup !== 'admin') return alert("Only teachers and admins can add students.");
    if (!activeGroupId) return alert("No active classroom selected.");
    const inp = document.getElementById('add-student-email');
    if (inp) inp.value = '';
    document.getElementById('add-student-modal').classList.remove('hidden');
    setTimeout(() => inp?.focus(), 120);
}
function closeAddStudentModal() {
    document.getElementById('add-student-modal').classList.add('hidden');
    const inp = document.getElementById('add-student-email');
    if (inp) inp.value = '';
}
async function submitAddStudent() {
    const input = document.getElementById('add-student-email');
    const email = (input.value || '').trim().toLowerCase();
    if (!email) return alert("Please enter the student's email.");
    if (!activeGroupId) return alert("No active classroom selected.");
    const { data: userProfile, error: profErr } = await supabaseClient.from('profiles').select('id, name').eq('email', email).maybeSingle();
    if (profErr) return alert("Lookup failed: " + profErr.message);
    if (!userProfile) return alert("❌ User not registered.\n\nAsk the student to sign up first with this email:\n" + email);
    const { data: existing } = await supabaseClient.from('group_members').select('user_id').eq('group_id', activeGroupId).eq('user_id', userProfile.id).maybeSingle();
    if (existing) return alert(`ℹ️ ${userProfile.name || email} is already a member.`);
    const { error } = await supabaseClient.from('group_members').insert([{ group_id: activeGroupId, user_id: userProfile.id, role: 'student' }]);
    if (error) return alert("Failed to add student: " + error.message);
    closeAddStudentModal();
    const toast = document.createElement('div');
    toast.textContent = `✅ ${userProfile.name || email} added successfully!`;
    toast.style.cssText = 'position:fixed;bottom:100px;left:50%;transform:translateX(-50%);background:linear-gradient(135deg,var(--wa-teal),var(--wa-light-green));color:white;padding:12px 22px;border-radius:24px;font-weight:600;z-index:9999;box-shadow:0 8px 22px rgba(0,0,0,.25);font-size:14px;';
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2200);
    loadMyGroups(); cacheMemberRoles(activeGroupId);
}
async function directAddUser() { return submitAddStudent(); }

/* ============================================================
   OPEN CLASSROOM
   ============================================================ */
async function openClassroom(id, name, creatorId, uniqueId) {
    if (chatPollingInterval) clearInterval(chatPollingInterval);
    activeGroupId = id; activeGroupCreatorId = creatorId; activeGroupUniqueId = uniqueId; activeGroupName = name;
    lastMessagesHash = ''; shownLiveCallIds = new Set();
    hideLiveBanner(); stopLiveHeartbeat(); closeMeetingRoom();

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
    await cacheMemberRoles(id);

    const callBtn = document.getElementById('call-btn');
    const inviteBtn = document.getElementById('toggle-invite-btn');
    if (currentUserRoleInActiveGroup === 'teacher' || currentUserRoleInActiveGroup === 'admin') {
        if (inviteBtn) inviteBtn.classList.remove('hidden');
        if (callBtn) callBtn.disabled = false;
        const savedToken = sessionStorage.getItem('galene_teacher_token');
        const savedCallId = sessionStorage.getItem('galene_call_id');
        const savedStudentToken = sessionStorage.getItem('galene_student_token');
        if (savedToken && savedCallId) {
            const { data: activeCall } = await supabaseClient.from('live_calls').select('*').eq('id', savedCallId).eq('active', true).maybeSingle();
            if (activeCall) {
                currentLiveCallId = activeCall.id;
                currentGaleneTeacherToken = savedToken;
                currentGaleneStudentToken = savedStudentToken;
                showLiveBanner(); startLiveHeartbeat();
            } else {
                sessionStorage.removeItem('galene_teacher_token');
                sessionStorage.removeItem('galene_call_id');
                sessionStorage.removeItem('galene_student_token');
            }
        }
    } else {
        if (inviteBtn) inviteBtn.classList.add('hidden');
        if (callBtn) callBtn.disabled = true;
    }
    updateMessageInputState();
    loadMessages();
}
function updateMessageInputState() {
    const input = document.getElementById('message-input');
    const sendBtn = document.querySelector('.send-icon-btn');
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
    clearPendingMedia();
}

/* ============================================================
   MEDIA PREVIEW
   ============================================================ */
function setPendingMedia(file, type) {
    if (!activeGroupId) return;
    if (restrictMessaging && currentUserRoleInActiveGroup !== 'teacher' && currentUserRoleInActiveGroup !== 'admin') return alert("Only teachers and admins can send messages.");
    if (file.size > 50 * 1024 * 1024) return alert("File too large (max 50MB).");
    pendingMedia = { file, type }; renderPendingMedia();
}
function clearPendingMedia() { pendingMedia = null; renderPendingMedia(); }
function renderPendingMedia() {
    const area = document.getElementById('media-preview-area');
    if (!area) return;
    if (!pendingMedia) { area.classList.add('hidden'); area.innerHTML = ''; return; }
    area.classList.remove('hidden');
    const { file, type } = pendingMedia;
    const sizeKb = (file.size / 1024).toFixed(0);
    const sizeStr = sizeKb > 1024 ? (sizeKb / 1024).toFixed(1) + ' MB' : sizeKb + ' KB';
    let thumbHtml = '';
    if (type === 'image') thumbHtml = `<img class="mp-thumb" src="${URL.createObjectURL(file)}" alt="">`;
    else if (type === 'video') thumbHtml = `<div class="mp-thumb" style="display:flex;align-items:center;justify-content:center;font-size:22px;background:#000;color:#fff;">🎥</div>`;
    else thumbHtml = `<div class="mp-thumb" style="display:flex;align-items:center;justify-content:center;font-size:22px;background:#e0f7fa;color:#00695c;">🎵</div>`;
    area.innerHTML = `<div class="media-preview-item">${thumbHtml}<div class="mp-info"><div class="mp-name">${file.name || (type + ' file')}</div><div class="mp-size">${sizeStr} · ${type.toUpperCase()}</div></div><button class="mp-remove" onclick="clearPendingMedia()" title="Remove">×</button></div><div class="mp-caption-hint">Add a caption (optional), then tap Send.</div>`;
}

/* ============================================================
   SEND MESSAGE
   ============================================================ */
async function sendMessage() {
    const input = document.getElementById('message-input');
    const messageText = input.value.trim();
    if (!activeGroupId) return;
    if (restrictMessaging && currentUserRoleInActiveGroup !== 'teacher' && currentUserRoleInActiveGroup !== 'admin') return alert("Only teachers and admins can send messages.");
    if (!messageText && !pendingMedia) return;
    if (pendingMedia) {
        const { file, type } = pendingMedia;
        const ok = await uploadMedia(file, type, messageText);
        clearPendingMedia(); input.value = '';
        if (!ok) return;
    } else if (messageText) {
        const { error } = await supabaseClient.from('messages').insert([{ message_text: messageText, sender_id: currentUser.id, group_id: activeGroupId }]);
        if (error) return alert("Message send failed!");
        input.value = '';
    }
    lastMessagesHash = ''; await loadMessages();
    const box = document.getElementById('chat-messages'); box.scrollTop = box.scrollHeight;
    input.focus();
}
async function uploadMedia(file, type, caption) {
    if (!file || !activeGroupId) return false;
    const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
    const filePath = `media/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
    const { error: upErr } = await supabaseClient.storage.from('classroom_uploads').upload(filePath, file);
    if (upErr) { alert("Upload failed: " + upErr.message); return false; }
    const url = supabaseClient.storage.from('classroom_uploads').getPublicUrl(filePath).data.publicUrl;
    const prefix = type === 'image' ? '[IMAGE]' : type === 'video' ? '[VIDEO]' : '[AUDIO]';
    const { error } = await supabaseClient.from('messages').insert([{ message_text: prefix + url, sender_id: currentUser.id, group_id: activeGroupId }]);
    if (error) { alert("Send failed: " + error.message); return false; }
    if (caption && caption.trim()) await supabaseClient.from('messages').insert([{ message_text: caption.trim(), sender_id: currentUser.id, group_id: activeGroupId }]);
    return true;
}

/* ============================================================
   DELETE FOR ME
   ============================================================ */
function getDeletedForMe() {
    try { return JSON.parse(localStorage.getItem('deletedForMe') || '[]').map(String); }
    catch { return []; }
}
function addDeletedForMe(id) {
    const arr = getDeletedForMe(); const sid = String(id);
    if (!arr.includes(sid)) arr.push(sid);
    localStorage.setItem('deletedForMe', JSON.stringify(arr));
}

/* ============================================================
   LOAD MESSAGES
   ============================================================ */
async function loadMessages() {
    const chatBox = document.getElementById('chat-messages');
    if (!chatBox) return;
    let hasPlaying = false;
    chatBox.querySelectorAll('video,audio').forEach(m => { if (!m.paused && !m.ended && m.currentTime > 0.1) hasPlaying = true; });
    if (hasPlaying) return;

    const prevHeight = chatBox.scrollHeight, prevTop = chatBox.scrollTop, clientH = chatBox.clientHeight;
    const distanceFromBottom = prevHeight - prevTop - clientH;
    const isNearBottom = distanceFromBottom < 50;

    const { data } = await supabaseClient.from('messages').select('id, message_text, sender_id, created_at, edited_at, deleted_for_everyone, deleted_by_admin, deleted_by_name, profiles(name, avatar_url)').eq('group_id', activeGroupId).order('created_at', { ascending: true });

    const hash = (data || []).map(m => [m.id, m.message_text || '', m.edited_at || '', m.deleted_for_everyone ? 1 : 0, m.deleted_by_admin ? 1 : 0].join('|')).join('||');
    if (hash === lastMessagesHash && chatBox.children.length > 0) return;
    lastMessagesHash = hash;

    const pollIds = (data || []).filter(m => (m.message_text || '').startsWith('[POLL]')).map(m => m.id);
    let allVotes = [];
    if (pollIds.length > 0) {
        const { data: votesData } = await supabaseClient.from('poll_votes').select('message_id, user_id, option_index').in('message_id', pollIds);
        allVotes = votesData || [];
    }

    chatBox.innerHTML = "";
    let newLiveCallPayload = null;

    if (data) {
        const now = new Date();
        const myFreshAvatar = currentUser.user_metadata.avatar_url || 'https://placehold.co/30';
        const deletedForMe = getDeletedForMe();

        data.forEach(msg => {
            if (deletedForMe.includes(String(msg.id))) return;
            const isMe = msg.sender_id === currentUser.id;
            let avatarUrl, senderName;
            if (isMe) { avatarUrl = myFreshAvatar; senderName = 'You'; }
            else { avatarUrl = msg.profiles?.avatar_url || 'https://placehold.co/30'; senderName = msg.profiles?.name || 'Unknown'; }
            const senderRole = membersRoleCache[msg.sender_id] || 'Member';
            const memberJson = encodeURIComponent(JSON.stringify({ user_id: msg.sender_id, name: senderName, avatar_url: avatarUrl, role: senderRole }));

            let msgHtml;
            const txt = msg.message_text || '';
            const isDeleted = msg.deleted_for_everyone || msg.deleted_by_admin;
            const isEdited = !!msg.edited_at;

            if (isDeleted) {
                const label = msg.deleted_by_admin ? `🚫 This message was deleted${msg.deleted_by_name ? ` by ${msg.deleted_by_name}` : ' by admin or teacher'}` : `🚫 This message was deleted`;
                msgHtml = `<div class="deleted-msg-text">${label}</div>`;
            } else if (txt.startsWith('[LIVE_CLASS_STARTED]')) {
                const rest = txt.replace('[LIVE_CLASS_STARTED]', '');
                const parts = rest.split('|');
                if (parts.length === 3) {
                    const [callId, baseUrl, token] = parts;
                    msgHtml = `<div style="background: var(--card-bg); border-left: 5px solid #d32f2f; padding: 12px; border-radius: 8px;"><strong>🔴 The Class Has Started!</strong><br><button onclick="joinLiveClassFromMessage('${callId}', '${baseUrl}', '${token}')" style="background:#25D366; color:white; border:none; padding:6px 15px; border-radius:20px; cursor:pointer; margin-top:6px;">👉 Join Class</button></div>`;
                    const msgTime = new Date(msg.created_at);
                    if (!isMe && (now - msgTime) / 1000 <= 10 && !shownLiveCallIds.has(String(msg.id))) newLiveCallPayload = { callId, baseUrl, token, msgId: String(msg.id) };
                } else {
                    msgHtml = `<div style="background: var(--card-bg); border-left: 5px solid #999; padding: 12px; border-radius: 8px; opacity:.7;"><strong>🔴 Live class</strong> <span style="font-size:12px;color:#999;">(expired)</span></div>`;
                }
            } else if (txt.startsWith('[LIVE_CLASS_ENDED]')) {
                msgHtml = `<div style="background: var(--card-bg); border-left: 5px solid #999; padding: 12px; border-radius: 8px; opacity:.8;"><strong>⏹️ Live class ended</strong></div>`;
            } else if (txt.startsWith('[IMAGE]')) {
                const url = txt.replace('[IMAGE]', '');
                msgHtml = `<div class="media-msg"><img src="${url}" onclick="openImagePreview('${url}')" alt="image"></div>`;
            } else if (txt.startsWith('[VIDEO]')) {
                const url = txt.replace('[VIDEO]', '');
                msgHtml = `<div class="media-msg"><video src="${url}" controls preload="metadata"></video></div>`;
            } else if (txt.startsWith('[AUDIO]')) {
                const url = txt.replace('[AUDIO]', '');
                msgHtml = `<div class="media-msg"><audio src="${url}" controls preload="metadata"></audio></div>`;
            } else if (txt.startsWith('[WHITEBOARD]')) {
                try {
                    const wb = JSON.parse(txt.replace('[WHITEBOARD]', ''));
                    const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(wb))));
                    msgHtml = `<div class="wb-msg-wrap"><span class="wb-label">🖌️ ${wb.name}</span><img class="wb-thumb" src="${wb.imgUrl || wb.url}" onclick="openWhiteboardFromB64('${b64}')" alt="whiteboard"></div>`;
                } catch (err) { msgHtml = `<div class="text">[Whiteboard]</div>`; }
            } else if (txt.startsWith('[POLL]')) {
                try {
                    const poll = JSON.parse(txt.replace('[POLL]', ''));
                    const votes = allVotes.filter(v => String(v.message_id) === String(msg.id));
                    msgHtml = renderPollHtml(msg.id, poll, votes);
                } catch (err) { msgHtml = `<div class="text">[Poll]</div>`; }
            } else {
                msgHtml = `<div class="text">${txt}</div>`;
            }
            const editedTag = (isEdited && !isDeleted) ? '<span class="edited-tag">(edited)</span>' : '';
            chatBox.innerHTML += `<div class="msg-row ${isMe ? 'me' : 'them'}"><div class="bubble"><div class="msg-actions-trigger" onclick="openMsgActionMenu(event, '${msg.id}', '${msg.sender_id}', ${isDeleted})" title="More"><svg viewBox="0 0 24 24"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg></div><div class="sender-name"><img class="msg-avatar" src="${avatarUrl}" onclick="event.stopPropagation(); showMemberProfile(JSON.parse(decodeURIComponent('${memberJson}')))" /><span class="sender-name-link" onclick="event.stopPropagation(); showMemberProfile(JSON.parse(decodeURIComponent('${memberJson}')))">${senderName}</span>${editedTag}</div>${msgHtml}</div></div>`;
        });

        if (newLiveCallPayload) {
            shownLiveCallIds.add(newLiveCallPayload.msgId);
            showIncomingCallPopup(newLiveCallPayload.callId, newLiveCallPayload.baseUrl, newLiveCallPayload.token);
        }
        if (isNearBottom) chatBox.scrollTop = chatBox.scrollHeight;
        else chatBox.scrollTop = chatBox.scrollHeight - distanceFromBottom - clientH;
    }
}

/* ============================================================
   MESSAGE ACTION MENU / DELETE / EDIT — unchanged
   ============================================================ */
function openMsgActionMenu(event, messageId, senderId, isDeleted) {
    event.stopPropagation(); event.preventDefault();
    document.querySelectorAll('.msg-action-menu').forEach(m => m.remove());
    if (isDeleted) return;
    const isMe = String(senderId) === String(currentUser.id);
    const isAdminOrTeacher = currentUserRoleInActiveGroup === 'teacher' || currentUserRoleInActiveGroup === 'admin';
    const items = [];
    if (isMe) items.push({ icon: '<svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>', label: 'Edit Message', action: () => openEditMessage(messageId) });
    items.push({ icon: '<svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>', label: 'Delete for me', danger: true, action: () => deleteForMe(messageId) });
    if (isMe || isAdminOrTeacher) items.push({ icon: '<svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>', label: isMe ? 'Delete for everyone' : 'Delete for everyone (as admin)', danger: true, action: () => deleteForEveryone(messageId, senderId) });

    const menu = document.createElement('div');
    menu.className = 'msg-action-menu'; menu.id = 'msg-action-menu';
    items.forEach(it => {
        const div = document.createElement('div');
        div.className = 'ma-item' + (it.danger ? ' danger' : '');
        div.innerHTML = `${it.icon}<span>${it.label}</span>`;
        div.onclick = (ev) => { ev.stopPropagation(); menu.remove(); it.action(); };
        menu.appendChild(div);
    });
    document.body.appendChild(menu);

    const rect = event.currentTarget.getBoundingClientRect();
    const menuW = menu.offsetWidth || 200, menuH = menu.offsetHeight || 100;
    let left = rect.right - menuW, top = rect.bottom + 6;
    if (left < 8) left = 8;
    if (left + menuW > window.innerWidth - 8) left = window.innerWidth - menuW - 8;
    if (top + menuH > window.innerHeight - 8) top = rect.top - menuH - 6;
    menu.style.left = left + 'px'; menu.style.top = top + 'px';
    setTimeout(() => {
        const closer = (e) => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', closer); } };
        document.addEventListener('click', closer);
    }, 10);
}

function deleteForMe(messageId) {
    addDeletedForMe(messageId);
    document.querySelectorAll('.msg-row').forEach(row => {
        const trig = row.querySelector('.msg-actions-trigger');
        if (trig && trig.getAttribute('onclick') && trig.getAttribute('onclick').includes(`'${messageId}'`)) row.remove();
    });
    lastMessagesHash = '';
}
async function deleteForEveryone(messageId, senderId) {
    const isMe = String(senderId) === String(currentUser.id);
    const isAdminOrTeacher = currentUserRoleInActiveGroup === 'teacher' || currentUserRoleInActiveGroup === 'admin';
    if (!isMe && !isAdminOrTeacher) return alert("You can't delete this message.");
    if (!confirm(isMe ? "Delete this message for everyone?" : "Delete this message for everyone as admin/teacher?")) return;
    const updateData = isMe ? { message_text: '', deleted_for_everyone: true } : { message_text: '', deleted_for_everyone: true, deleted_by_admin: true, deleted_by_name: currentUser.user_metadata.name || currentUser.email };
    const { error } = await supabaseClient.from('messages').update(updateData).eq('id', messageId);
    if (error) return alert("Failed: " + error.message);
    await supabaseClient.from('poll_votes').delete().eq('message_id', messageId);
    lastMessagesHash = ''; await loadMessages(); await loadMyGroups();
}
function openEditMessage(messageId) {
    supabaseClient.from('messages').select('message_text').eq('id', messageId).single().then(({ data, error }) => {
        if (error || !data) return alert("Could not load message.");
        const txt = data.message_text || '';
        if (txt.startsWith('[')) return alert("This type of message cannot be edited. You can only delete it.");
        currentEditMessageId = messageId;
        document.getElementById('edit-message-input').value = txt;
        document.getElementById('edit-message-modal').classList.remove('hidden');
        setTimeout(() => document.getElementById('edit-message-input').focus(), 100);
    });
}
function closeEditModal() { currentEditMessageId = null; document.getElementById('edit-message-modal').classList.add('hidden'); }
async function saveEditedMessage() {
    if (!currentEditMessageId) return;
    const newText = document.getElementById('edit-message-input').value.trim();
    if (!newText) return alert("Message can't be empty.");
    const { error } = await supabaseClient.from('messages').update({ message_text: newText, edited_at: new Date().toISOString() }).eq('id', currentEditMessageId);
    if (error) return alert("Failed: " + error.message);
    closeEditModal(); lastMessagesHash = ''; await loadMessages();
}

/* ============================================================
   POLL
   ============================================================ */
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c])); }
function renderPollHtml(messageId, poll, votes) {
    const totalVotes = votes.length;
    const myVote = votes.find(v => String(v.user_id) === String(currentUser.id));
    const myOption = myVote ? myVote.option_index : -1;
    let optionsHtml = '';
    poll.options.forEach((opt, idx) => {
        const count = votes.filter(v => v.option_index === idx).length;
        const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
        optionsHtml += `<div class="poll-opt ${myOption === idx ? 'voted' : ''}" onclick="votePoll('${messageId}', ${idx})"><div class="poll-bar" style="width:${pct}%"></div><div class="poll-opt-content"><span class="poll-opt-text">${escapeHtml(opt)}</span><span class="poll-opt-count">${count} · ${pct}%</span></div></div>`;
    });
    return `<div class="poll-msg"><div class="poll-q">📊 <span>${escapeHtml(poll.question)}</span> <span class="poll-badge">Poll</span></div>${optionsHtml}<div class="poll-total"><span>${totalVotes} vote${totalVotes !== 1 ? 's' : ''}</span>${myVote ? `<span>✓ You voted</span>` : `<span style="opacity:.7">Tap to vote</span>`}</div></div>`;
}
async function votePoll(messageId, optionIndex) {
    if (!currentUser || !messageId) return;
    const midStr = String(messageId);
    const { data: existing } = await supabaseClient.from('poll_votes').select('id, option_index').eq('message_id', midStr).eq('user_id', currentUser.id).maybeSingle();
    if (existing) {
        if (existing.option_index === optionIndex) await supabaseClient.from('poll_votes').delete().eq('id', existing.id);
        else await supabaseClient.from('poll_votes').update({ option_index: optionIndex }).eq('id', existing.id);
    } else await supabaseClient.from('poll_votes').insert([{ message_id: midStr, user_id: currentUser.id, option_index: optionIndex }]);
    lastMessagesHash = ''; await loadMessages();
}
function openPollCreateModal() {
    document.getElementById('plus-menu').classList.add('hidden');
    document.getElementById('plus-btn').classList.remove('open');
    if (restrictMessaging && currentUserRoleInActiveGroup !== 'teacher' && currentUserRoleInActiveGroup !== 'admin') return alert("Only teachers and admins can create polls when messaging is restricted.");
    document.getElementById('poll-question').value = '';
    const list = document.getElementById('poll-options-list');
    list.innerHTML = ''; addPollOptionField(); addPollOptionField();
    document.getElementById('poll-create-modal').classList.remove('hidden');
    setTimeout(() => document.getElementById('poll-question').focus(), 100);
}
function closePollCreateModal() { document.getElementById('poll-create-modal').classList.add('hidden'); }
function addPollOptionField() {
    const list = document.getElementById('poll-options-list');
    if (list.children.length >= 8) return alert("Maximum 8 options allowed.");
    const idx = list.children.length + 1;
    const div = document.createElement('div');
    div.style.cssText = 'display:flex; gap:6px; margin-bottom:8px; align-items:center;';
    div.innerHTML = `<input type="text" class="poll-option-input" placeholder="Option ${idx}" style="margin:0; flex:1; min-width:0;" maxlength="120"><button type="button" onclick="this.parentElement.remove()" title="Remove" style="background:#d32f2f; border:none; color:white; border-radius:50%; width:34px; height:34px; padding:0; font-size:18px; cursor:pointer; flex-shrink:0;">×</button>`;
    list.appendChild(div);
}
async function createPoll() {
    const question = document.getElementById('poll-question').value.trim();
    if (!question) return alert("Please enter a question.");
    const inputs = document.querySelectorAll('.poll-option-input');
    const options = [];
    inputs.forEach(inp => { const v = inp.value.trim(); if (v) options.push(v); });
    if (options.length < 2) return alert("Need at least 2 options.");
    const { error } = await supabaseClient.from('messages').insert([{ message_text: '[POLL]' + JSON.stringify({ question, options }), sender_id: currentUser.id, group_id: activeGroupId }]);
    if (error) return alert("Failed: " + error.message);
    closePollCreateModal(); lastMessagesHash = ''; await loadMessages();
    document.getElementById('chat-messages').scrollTop = document.getElementById('chat-messages').scrollHeight;
}

/* ═══════════════════════════════════════════════════════════
   GALENE LIVE CLASS (via Supabase Proxy) + LIVE WHITEBOARD
   ═══════════════════════════════════════════════════════════ */

async function createGaleneToken(permissions, username, expiresInMs) {
    const body = { permissions };
    if (username) body.username = username;
    if (expiresInMs) body.expires = new Date(Date.now() + expiresInMs).toISOString();

    try {
        const res = await fetch(GALENE_PROXY_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
                'apikey': SUPABASE_ANON_KEY
            },
            body: JSON.stringify({
                path: `.groups/${GALENE_GROUP}/.tokens/`,
                body: body,
            }),
        });
        const data = await res.json();
        console.log('Galene proxy response:', data);
        if (data.status !== 201 || !data.location) {
            console.error('❌ Token creation failed:', data);
            return null;
        }
        return data.location;
    } catch (e) {
        console.error('❌ Galene proxy error:', e);
        return null;
    }
}

async function revokeGaleneToken(token) {
    if (!token) return;
    try {
        await fetch(GALENE_PROXY_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
                'apikey': SUPABASE_ANON_KEY
            },
            body: JSON.stringify({
                path: `.groups/${GALENE_GROUP}/.tokens/${token}`,
                method: 'DELETE',
                body: null,
            }),
        });
    } catch (e) {
        console.warn('Token revoke warning (non-critical):', e);
    }
}

async function startClassCall() {
    if (currentUserRoleInActiveGroup !== 'teacher' && currentUserRoleInActiveGroup !== 'admin') {
        return alert("Only Teachers and Admins can start the live class!");
    }
    if (!activeGroupId) return;

    if (currentLiveCallId && currentGaleneTeacherToken) {
        openMeetingRoom(currentGaleneTeacherToken, currentUser.user_metadata.name || 'Teacher');
        return;
    }

    await supabaseClient.from('live_calls').update({ active: false, ended_at: new Date().toISOString() }).eq('group_id', activeGroupId).eq('active', true);

    const { data: callData, error: callErr } = await supabaseClient
        .from('live_calls')
        .insert([{ group_id: activeGroupId, teacher_id: currentUser.id, room_name: GALENE_GROUP, active: true }])
        .select().single();
    if (callErr) return alert("Failed to start class: " + callErr.message);

    const teacherName = currentUser.user_metadata.name || currentUser.email || 'Teacher';
    // ✅ op + present + message সব একসাথে দিতে হবে
const teacherToken = await createGaleneToken(['op', 'present', 'message'], teacherName, 2 * 60 * 60 * 1000);
    if (!teacherToken) {
        await supabaseClient.from('live_calls').update({ active: false, ended_at: new Date().toISOString() }).eq('id', callData.id);
        return alert("❌ Failed to create teacher token.\n\nPossible causes:\n1. Supabase Edge Function not deployed\n2. Edge Function JWT verification blocking\n3. Galene server unreachable\n\nCheck browser console for details.");
    }

    currentLiveCallId = callData.id;
    currentGaleneTeacherToken = teacherToken;
    sessionStorage.setItem('galene_teacher_token', teacherToken);
    sessionStorage.setItem('galene_call_id', callData.id);

    openMeetingRoom(teacherToken, teacherName);

    // Student: শুধু view (কোনো present নেই) — chat করতে চাইলে 'message' যোগ করুন
const studentToken = await createGaleneToken(['message'], null, 2 * 60 * 60 * 1000);
    if (studentToken) {
        currentGaleneStudentToken = studentToken;
        sessionStorage.setItem('galene_student_token', studentToken);
        const baseUrl = `${GALENE_BASE_URL}/group/${GALENE_GROUP}/`;
        const notice = `[LIVE_CLASS_STARTED]${currentLiveCallId}|${baseUrl}|${studentToken}`;
        await supabaseClient.from('messages').insert([{ group_id: activeGroupId, sender_id: currentUser.id, message_text: notice }]);
    }

    startLiveHeartbeat(); showLiveBanner();
    lastMessagesHash = ''; await loadMessages();
}

/* ✅ UPDATED: student join — open INSIDE meeting room iframe */
async function joinLiveClassFromMessage(callId, baseUrl, token) {
    const { data } = await supabaseClient.from('live_calls').select('active, ended_at').eq('id', callId).maybeSingle();
    if (!data || !data.active || data.ended_at) return alert("⛔ This class has already ended.\n\nAsk your teacher to start a new session.");

    currentLiveCallId = callId;
    const myName = currentUser.user_metadata.name || currentUser.email || 'Student';
    openMeetingRoom(token, myName);

    // Subscribe to live whiteboard broadcasts
    await subscribeToLiveWB(callId);
}
function joinLiveClass() {
    if (!pendingLiveCallId || !pendingLiveBaseUrl || !pendingLiveStudentToken) { closeIncomingCallPopup(); return; }
    joinLiveClassFromMessage(pendingLiveCallId, pendingLiveBaseUrl, pendingLiveStudentToken);
    closeIncomingCallPopup();
}
function showIncomingCallPopup(callId, baseUrl, token) {
    pendingLiveCallId = callId; pendingLiveBaseUrl = baseUrl; pendingLiveStudentToken = token;
    document.getElementById('call-group-avatar').src = activeGroupAvatar;
    document.getElementById('call-group-name').innerText = activeGroupName;
    document.getElementById('incoming-call-popup').classList.remove('hidden');
}
function closeIncomingCallPopup() {
    document.getElementById('incoming-call-popup').classList.add('hidden');
    pendingLiveCallId = null; pendingLiveBaseUrl = null; pendingLiveStudentToken = null;
}

/* ✅ UPDATED: openMeetingRoom with role-based controls */
function openMeetingRoom(token, username) {
    const panel = document.getElementById('meeting-room-panel');
    const iframe = document.getElementById('meeting-room-iframe');
    const status = document.getElementById('meeting-room-status');
    if (!panel || !iframe) { console.warn('Meeting room panel missing'); return; }

    iframe.src = `${GALENE_BASE_URL}/group/${GALENE_GROUP}/?token=${encodeURIComponent(token)}&username=${encodeURIComponent(username)}`;
    if (status) status.innerText = `(${username})`;
    panel.classList.remove('hidden');
    document.body.style.overflow = 'hidden';

    const wbBtn = document.getElementById('meeting-wb-btn');
    const endBtn = document.getElementById('meeting-end-btn');
    const leaveBtn = document.getElementById('meeting-leave-btn');
    const isTeacher = currentUserRoleInActiveGroup === 'teacher' || currentUserRoleInActiveGroup === 'admin';

    if (isTeacher) {
        if (wbBtn) { wbBtn.style.display = 'inline-flex'; wbBtn.innerText = '🖌️ Whiteboard'; }
        if (endBtn) endBtn.style.display = 'inline-flex';
        if (leaveBtn) leaveBtn.style.display = 'none';
    } else {
        if (wbBtn) wbBtn.style.display = liveWBActive ? 'inline-flex' : 'none';
        if (endBtn) endBtn.style.display = 'none';
        if (leaveBtn) leaveBtn.style.display = 'inline-flex';
    }
}

/* ✅ UPDATED: closeMeetingRoom */
function closeMeetingRoom() {
    const panel = document.getElementById('meeting-room-panel');
    const iframe = document.getElementById('meeting-room-iframe');
    if (!panel) return;
    panel.classList.add('hidden');
    panel.classList.remove('fullscreen-mode');
    if (iframe) iframe.src = 'about:blank';
    document.body.style.overflow = '';
    const fsBtn = document.getElementById('meeting-fs-btn');
    if (fsBtn) fsBtn.innerText = '⛶ Full';
    if (wbMode === 'live-student') {
        stopLiveWhiteboardForViewer();
    }
}

/* ✅ NEW: leave meeting (student) */
async function leaveMeetingRoom() {
    if (!confirm("Leave the live class?")) return;
    await closeMeetingRoom();
    currentLiveCallId = null;
}

function toggleMeetingFullscreen() {
    const panel = document.getElementById('meeting-room-panel');
    const fsBtn = document.getElementById('meeting-fs-btn');
    if (!panel) return;
    panel.classList.toggle('fullscreen-mode');
    if (panel.classList.contains('fullscreen-mode')) {
        if (panel.requestFullscreen) panel.requestFullscreen().catch(() => {});
        if (fsBtn) fsBtn.innerText = '⤢ Exit';
    } else {
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        if (fsBtn) fsBtn.innerText = '⛶ Full';
    }
}

function startLiveHeartbeat() {
    stopLiveHeartbeat();
    const beat = async () => {
        if (!currentLiveCallId) return;
        const { data } = await supabaseClient.from('live_calls').select('active').eq('id', currentLiveCallId).maybeSingle();
        if (!data || !data.active) {
            stopLiveHeartbeat(); hideLiveBanner();
            currentLiveCallId = null; currentGaleneTeacherToken = null; currentGaleneStudentToken = null;
            return;
        }
        await supabaseClient.from('live_calls').update({ last_heartbeat: new Date().toISOString() }).eq('id', currentLiveCallId);
    };
    beat(); liveHeartbeatTimer = setInterval(beat, 15000);
}
function stopLiveHeartbeat() { if (liveHeartbeatTimer) { clearInterval(liveHeartbeatTimer); liveHeartbeatTimer = null; } }

function showLiveBanner() {
    document.getElementById('live-class-banner')?.remove();
    if (!document.getElementById('live-banner-anim')) {
        const s = document.createElement('style');
        s.id = 'live-banner-anim';
        s.textContent = '@keyframes rec-pulse{0%,100%{opacity:1}50%{opacity:.3}}';
        document.head.appendChild(s);
    }
    const banner = document.createElement('div');
    banner.id = 'live-class-banner';
    banner.style.cssText = 'position:fixed;bottom:20px;right:20px;background:linear-gradient(135deg,#d32f2f,#e74c3c);color:white;padding:12px 16px;border-radius:14px;z-index:9998;box-shadow:0 10px 30px rgba(211,47,47,.5);display:flex;align-items:center;gap:10px;font-weight:600;font-size:13px;flex-wrap:wrap;max-width:calc(100vw - 40px);';
    banner.innerHTML = `<span style="display:flex;align-items:center;gap:6px;white-space:nowrap;"><span style="width:10px;height:10px;border-radius:50%;background:white;animation:rec-pulse 1s infinite;"></span>Live Class</span><button onclick="openMeetingRoom(currentGaleneTeacherToken || sessionStorage.getItem('galene_teacher_token'), currentUser.user_metadata.name || 'Teacher')" style="background:white;color:#128C7E;border:none;padding:6px 12px;border-radius:16px;font-weight:700;cursor:pointer;font-size:12px;">Open</button><button onclick="endLiveClass()" style="background:white;color:#d32f2f;border:none;padding:6px 12px;border-radius:16px;font-weight:700;cursor:pointer;font-size:12px;">End</button>`;
    document.body.appendChild(banner);
}
function hideLiveBanner() { document.getElementById('live-class-banner')?.remove(); }

/* ✅ UPDATED: endLiveClass with WB stop */
async function endLiveClass() {
    if (!currentLiveCallId) return;
    if (!confirm("End the live class for everyone?")) return;
    const callId = currentLiveCallId;
    const groupId = activeGroupId;
    const teacherToken = currentGaleneTeacherToken || sessionStorage.getItem('galene_teacher_token');
    const studentToken = currentGaleneStudentToken || sessionStorage.getItem('galene_student_token');

    if (liveWBActive) await stopLiveWhiteboard();

    if (teacherToken) await revokeGaleneToken(teacherToken);
    if (studentToken) await revokeGaleneToken(studentToken);

    await supabaseClient.from('live_calls').update({ active: false, ended_at: new Date().toISOString() }).eq('id', callId);
    await supabaseClient.from('messages').insert([{ group_id: groupId, sender_id: currentUser.id, message_text: `[LIVE_CLASS_ENDED]${callId}` }]);

    stopLiveHeartbeat(); hideLiveBanner(); closeMeetingRoom();
    currentLiveCallId = null; currentGaleneTeacherToken = null; currentGaleneStudentToken = null;
    sessionStorage.removeItem('galene_teacher_token');
    sessionStorage.removeItem('galene_call_id');
    sessionStorage.removeItem('galene_student_token');

    lastMessagesHash = ''; await loadMessages();
    alert("✅ Live class ended. Students can no longer join.");
}

/* ============================================================
   REALTIME
   ============================================================ */
function listenToRealtimeData() {
    supabaseClient.channel('custom-all-channel')
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
                    const { data: g } = await supabaseClient.from('groups').select('group_name').eq('id', payload.new.group_id).single();
                    alert(`🎉 Congrats! You are now an Admin for "${g.group_name}".`);
                }
                if (payload.new.role === 'student' && payload.old?.role === 'admin') {
                    const { data: g } = await supabaseClient.from('groups').select('group_name').eq('id', payload.new.group_id).single();
                    alert(`⚠️ Notice: Admin role removed in "${g.group_name}".`);
                }
                if (payload.new.group_id == activeGroupId) {
                    currentUserRoleInActiveGroup = payload.new.role;
                    cacheMemberRoles(activeGroupId);
                    openClassroom(activeGroupId, activeGroupName, activeGroupCreatorId, activeGroupUniqueId);
                }
            }
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'poll_votes' }, () => {
            if (activeGroupId) { lastMessagesHash = ''; loadMessages(); }
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, (payload) => {
            if (!activeGroupId) return;
            if (payload.new && String(payload.new.group_id) === String(activeGroupId)) { lastMessagesHash = ''; loadMessages(); }
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'live_calls' }, (payload) => {
            if (payload.new && !payload.new.active && pendingLiveCallId === payload.new.id) closeIncomingCallPopup();
        })
        .subscribe();
    loadNotifications();
}
function toggleNotifications() { document.getElementById('notification-panel').classList.toggle('hidden'); }

/* ============================================================
   STARS
   ============================================================ */
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
    const starBtn = document.getElementById('star-btn'), starCountSpan = document.getElementById('star-count');
    const { count } = await supabaseClient.from('user_stars').select('*', { count: 'exact', head: true }).eq('receiver_user_id', currentPopupMemberId);
    starCountSpan.innerText = count || 0;
    if (currentUser.id === currentPopupMemberId) { starBtn.style.opacity = '0.3'; starBtn.disabled = true; return; }
    const { data } = await supabaseClient.from('user_stars').select('id').eq('giver_user_id', currentUser.id).eq('receiver_user_id', currentPopupMemberId).maybeSingle();
    if (data) { starBtn.innerHTML = '★'; starBtn.style.color = '#e4b400'; }
    else { starBtn.innerHTML = '☆'; starBtn.style.color = '#aaa'; }
    starBtn.style.opacity = '1'; starBtn.disabled = false;
}
async function toggleStar() {
    if (!currentPopupMemberId || !currentUser || currentUser.id === currentPopupMemberId) return;
    const { data } = await supabaseClient.from('user_stars').select('id').eq('giver_user_id', currentUser.id).eq('receiver_user_id', currentPopupMemberId).maybeSingle();
    if (data) await supabaseClient.from('user_stars').delete().eq('id', data.id);
    else await supabaseClient.from('user_stars').insert([{ giver_user_id: currentUser.id, receiver_user_id: currentPopupMemberId }]);
    await updateStarUI(); await updateMyStarCount();
}
async function updateMyStarCount() {
    if (!currentUser) return;
    const { count } = await supabaseClient.from('user_stars').select('*', { count: 'exact', head: true }).eq('receiver_user_id', currentUser.id);
    const span = document.getElementById('my-star-count');
    if (span) span.innerText = `★ ${count || 0}`;
}

/* ============================================================
   SHOW APP / AUTH
   ============================================================ */
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
    stopLiveHeartbeat(); hideLiveBanner();
}

/* ============================================================
   PLUS MENU
   ============================================================ */
function togglePlusMenu(e) {
    e?.stopPropagation();
    const menu = document.getElementById('plus-menu'), btn = document.getElementById('plus-btn');
    const isHidden = menu.classList.contains('hidden');
    menu.classList.toggle('hidden', !isHidden);
    btn.classList.toggle('open', isHidden);
}
function triggerFileInput(type) {
    document.getElementById('plus-menu').classList.add('hidden');
    document.getElementById('plus-btn').classList.remove('open');
    if (type === 'image') document.getElementById('media-image-input').click();
    else if (type === 'video') document.getElementById('media-video-input').click();
    else if (type === 'audio') document.getElementById('media-audio-input').click();
}

/* ============================================================
   AUDIO RECORD
   ============================================================ */
let _mediaRecorder = null, _audioChunks = [], _recStream = null, _recordCancelled = false;
async function startAudioRecording() {
    document.getElementById('plus-menu').classList.add('hidden');
    document.getElementById('plus-btn').classList.remove('open');
    if (!activeGroupId) return;
    if (restrictMessaging && currentUserRoleInActiveGroup !== 'teacher' && currentUserRoleInActiveGroup !== 'admin') return alert("Only teachers and admins can send messages.");
    if (!navigator.mediaDevices || !window.MediaRecorder) return alert("Audio recording not supported.");
    try {
        _recStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        _mediaRecorder = new MediaRecorder(_recStream);
        _audioChunks = []; _recordCancelled = false;
        _mediaRecorder.ondataavailable = e => { if (e.data.size > 0) _audioChunks.push(e.data); };
        _mediaRecorder.onstop = async () => {
            _recStream.getTracks().forEach(t => t.stop());
            document.getElementById('recording-indicator').classList.add('hidden');
            if (_recordCancelled) return;
            const mime = _mediaRecorder.mimeType || 'audio/webm';
            const ext = mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm';
            const blob = new Blob(_audioChunks, { type: mime });
            const file = new File([blob], `rec_${Date.now()}.${ext}`, { type: mime });
            setPendingMedia(file, 'audio');
        };
        _mediaRecorder.start();
        document.getElementById('recording-indicator').classList.remove('hidden');
    } catch (err) { alert("Microphone access denied: " + err.message); }
}
function stopAudioRecording() { if (_mediaRecorder && _mediaRecorder.state !== 'inactive') _mediaRecorder.stop(); }
function cancelAudioRecording() { _recordCancelled = true; if (_mediaRecorder && _mediaRecorder.state !== 'inactive') _mediaRecorder.stop(); }

/* ============================================================
   IMAGE PREVIEW
   ============================================================ */
function openImagePreview(url) {
    document.getElementById('image-preview-img').src = url;
    document.getElementById('image-preview-modal').classList.remove('hidden');
}
function closeImagePreview() {
    document.getElementById('image-preview-modal').classList.add('hidden');
    document.getElementById('image-preview-img').src = '';
}

/* ============================================================
   WHITEBOARD — with live broadcast hooks
   ============================================================ */
let wbCanvas, wbCtx;
let wbObjects = [], wbUndoStack = [], wbRedoStack = [];
let wbSelected = null, wbTool = 'pen';
let wbColor = '#000000', wbFill = '#ffffff', wbSize = 3;
let wbTempPath = null, wbTempShape = null;
let wbBoardName = 'Untitled Board';
let wbIsInited = false, wbImageCache = {};
let wbPointer = { active: false, mode: null, startX: 0, startY: 0, origBounds: null, origObj: null, handle: null, beforeState: null };
let wbOffset = { x: 0, y: 0 };
let wbPanning = false;
let wbPanStart = { x: 0, y: 0, ox: 0, oy: 0 };
let wbSpaceHeld = false;

function openWhiteboardNamePrompt() {
    document.getElementById('plus-menu').classList.add('hidden');
    document.getElementById('plus-btn').classList.remove('open');
    document.getElementById('wb-name-input').value = '';
    document.getElementById('wb-name-modal').classList.remove('hidden');
}
function closeWbNamePrompt() { document.getElementById('wb-name-modal').classList.add('hidden'); }
function createWhiteboard() {
    const name = document.getElementById('wb-name-input').value.trim() || 'Untitled Board';
    wbBoardName = name;
    wbObjects = []; wbUndoStack = []; wbRedoStack = []; wbSelected = null;
    wbOffset = { x: 0, y: 0 };
    closeWbNamePrompt(); openWhiteboard();
}
function openWhiteboard() {
    document.getElementById('whiteboard-modal').classList.remove('hidden');
    document.getElementById('wb-title-label').innerText = '🖌️ ' + wbBoardName;
    injectWhiteboardPanButton();
    setTimeout(() => { initWbCanvas(); wbResize(true); renderWhiteboard(); }, 70);
}
function closeWhiteboard() {
    document.getElementById('whiteboard-modal').classList.add('hidden');
    document.getElementById('whiteboard-window').classList.remove('wb-fullscreen');
    document.getElementById('wb-fs-btn').innerText = '⛶';
    wbSelected = null; wbTempPath = null; wbTempShape = null; wbPanning = false;
}
function initWbCanvas() {
    wbCanvas = document.getElementById('wb-canvas');
    wbCtx = wbCanvas.getContext('2d');
    if (!wbIsInited) {
        wbCanvas.addEventListener('pointerdown', wbPointerDown);
        wbCanvas.addEventListener('pointermove', wbPointerMove);
        wbCanvas.addEventListener('pointerup', wbPointerUp);
        wbCanvas.addEventListener('pointerleave', wbPointerUp);
        wbCanvas.addEventListener('contextmenu', e => e.preventDefault());
        wbCanvas.addEventListener('mousedown', e => { if (e.button === 1) e.preventDefault(); });
        window.addEventListener('resize', () => wbResize());
        wbIsInited = true;
    }
}
function wbResize(initial) {
    if (!wbCanvas) return;
    if (document.getElementById('whiteboard-modal').classList.contains('hidden')) return;
    const wrap = wbCanvas.parentElement;
    const newW = wrap.clientWidth, newH = wrap.clientHeight;
    if (wbCanvas.width === newW && wbCanvas.height === newH && !initial) return;
    wbCanvas.width = newW; wbCanvas.height = newH;
    renderWhiteboard();
}
function wbToggleFullscreen() {
    const win = document.getElementById('whiteboard-window');
    win.classList.toggle('wb-fullscreen');
    document.getElementById('wb-fs-btn').innerText = win.classList.contains('wb-fullscreen') ? '⤢' : '⛶';
    setTimeout(() => wbResize(), 320);
}
function wbSetTool(tool) {
    if (wbMode === 'live-student') return;
    wbTool = tool;
    ['select','pan','pen','highlighter','eraser','line','arrow','rect','circle','triangle','text','sticky'].forEach(t => {
        const btn = document.getElementById('wb-tool-' + t);
        if (btn) btn.classList.toggle('active', t === tool);
    });
    if (tool !== 'select') wbSelected = null;
    if (wbCanvas) {
        if (tool === 'pan') wbCanvas.style.cursor = 'grab';
        else if (tool === 'select') wbCanvas.style.cursor = 'default';
        else if (tool === 'text' || tool === 'sticky') wbCanvas.style.cursor = 'text';
        else wbCanvas.style.cursor = 'crosshair';
        renderWhiteboard();
    }
}
function getObjectBounds(obj) {
    if (obj.type === 'path') {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        obj.points.forEach(p => { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); });
        const pad = (obj.size || 3) / 2 + 6;
        return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
    }
    if (obj.type === 'line' || obj.type === 'arrow') return { x: Math.min(obj.x1, obj.x2) - 6, y: Math.min(obj.y1, obj.y2) - 6, w: Math.abs(obj.x2 - obj.x1) + 12, h: Math.abs(obj.y2 - obj.y1) + 12 };
    if (['rect','circle','triangle'].includes(obj.type)) return { x: Math.min(obj.x1, obj.x2) - 4, y: Math.min(obj.y1, obj.y2) - 4, w: Math.abs(obj.x2 - obj.x1) + 8, h: Math.abs(obj.y2 - obj.y1) + 8 };
    if (obj.type === 'text') {
        wbCtx.font = `${obj.fontSize}px sans-serif`;
        const lines = (obj.text || '').split('\n');
        let maxW = 0; lines.forEach(l => { maxW = Math.max(maxW, wbCtx.measureText(l).width); });
        return { x: obj.x - 4, y: obj.y - 4, w: maxW + 8, h: lines.length * obj.fontSize * 1.2 + 8 };
    }
    if (obj.type === 'sticky' || obj.type === 'image') return { x: obj.x, y: obj.y, w: obj.w, h: obj.h };
    return { x: 0, y: 0, w: 0, h: 0 };
}
function getHandles(b) { return { nw: { x: b.x, y: b.y }, ne: { x: b.x + b.w, y: b.y }, sw: { x: b.x, y: b.y + b.h }, se: { x: b.x + b.w, y: b.y + b.h } }; }
function hitTest(obj, x, y) { const b = getObjectBounds(obj); return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h; }
function hitHandle(x, y) {
    if (!wbSelected) return null;
    const b = getObjectBounds(wbSelected);
    const handles = getHandles(b);
    for (const [name, h] of Object.entries(handles)) if (Math.abs(x - h.x) < 9 && Math.abs(y - h.y) < 9) return name;
    return null;
}
function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}
function drawArrowHead(x1, y1, x2, y2, color, size) {
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const len = 10 + size * 1.6;
    wbCtx.fillStyle = color;
    wbCtx.beginPath();
    wbCtx.moveTo(x2, y2);
    wbCtx.lineTo(x2 - len * Math.cos(angle - Math.PI / 6), y2 - len * Math.sin(angle - Math.PI / 6));
    wbCtx.lineTo(x2 - len * Math.cos(angle + Math.PI / 6), y2 - len * Math.sin(angle + Math.PI / 6));
    wbCtx.closePath(); wbCtx.fill();
}
function drawObject(obj) {
    if (obj.type === 'path') {
        wbCtx.save();
        wbCtx.globalAlpha = obj.tool === 'highlighter' ? 0.35 : 1;
        wbCtx.strokeStyle = obj.color; wbCtx.lineWidth = obj.size;
        wbCtx.lineCap = 'round'; wbCtx.lineJoin = 'round';
        wbCtx.beginPath();
        if (obj.points.length) { wbCtx.moveTo(obj.points[0].x, obj.points[0].y); for (let i = 1; i < obj.points.length; i++) wbCtx.lineTo(obj.points[i].x, obj.points[i].y); }
        wbCtx.stroke(); wbCtx.restore();
    } else if (obj.type === 'line' || obj.type === 'arrow') {
        wbCtx.strokeStyle = obj.color; wbCtx.lineWidth = obj.size; wbCtx.lineCap = 'round';
        wbCtx.beginPath(); wbCtx.moveTo(obj.x1, obj.y1); wbCtx.lineTo(obj.x2, obj.y2); wbCtx.stroke();
        if (obj.type === 'arrow') drawArrowHead(obj.x1, obj.y1, obj.x2, obj.y2, obj.color, obj.size);
    } else if (obj.type === 'rect') {
        const x = Math.min(obj.x1, obj.x2), y = Math.min(obj.y1, obj.y2), w = Math.abs(obj.x2 - obj.x1), h = Math.abs(obj.y2 - obj.y1);
        if (obj.fill && obj.fill !== 'none') { wbCtx.fillStyle = obj.fill; wbCtx.fillRect(x, y, w, h); }
        wbCtx.strokeStyle = obj.color; wbCtx.lineWidth = obj.size; wbCtx.strokeRect(x, y, w, h);
    } else if (obj.type === 'circle') {
        const cx = (obj.x1 + obj.x2) / 2, cy = (obj.y1 + obj.y2) / 2, rx = Math.abs(obj.x2 - obj.x1) / 2, ry = Math.abs(obj.y2 - obj.y1) / 2;
        wbCtx.beginPath(); wbCtx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        if (obj.fill && obj.fill !== 'none') { wbCtx.fillStyle = obj.fill; wbCtx.fill(); }
        wbCtx.strokeStyle = obj.color; wbCtx.lineWidth = obj.size; wbCtx.stroke();
    } else if (obj.type === 'triangle') {
        const x1 = obj.x1, y1 = obj.y1, x2 = obj.x2, y2 = obj.y2;
        wbCtx.beginPath();
        wbCtx.moveTo((x1 + x2) / 2, y1);
        wbCtx.lineTo(x2, y2);
        wbCtx.lineTo(x1, y2);
        wbCtx.closePath();
        if (obj.fill && obj.fill !== 'none') { wbCtx.fillStyle = obj.fill; wbCtx.fill(); }
        wbCtx.strokeStyle = obj.color; wbCtx.lineWidth = obj.size; wbCtx.stroke();
    } else if (obj.type === 'text') {
        wbCtx.fillStyle = obj.color;
        wbCtx.font = `${obj.fontSize}px sans-serif`;
        wbCtx.textBaseline = 'top';
        (obj.text || '').split('\n').forEach((line, i) => wbCtx.fillText(line, obj.x, obj.y + i * obj.fontSize * 1.2));
    } else if (obj.type === 'sticky') {
        wbCtx.fillStyle = obj.fill || '#fff9c4';
        wbCtx.strokeStyle = obj.color || '#f9a825';
        wbCtx.lineWidth = 2;
        roundRect(wbCtx, obj.x, obj.y, obj.w, obj.h, 8);
        wbCtx.fill(); wbCtx.stroke();
        wbCtx.fillStyle = '#222';
        wbCtx.font = `${obj.fontSize || 14}px sans-serif`;
        wbCtx.textBaseline = 'top';
        const pad = 8, maxW = obj.w - pad * 2;
        const words = (obj.text || '').split(/\s+/);
        let line = '', y = obj.y + pad;
        words.forEach(word => {
            const test = line ? line + ' ' + word : word;
            if (wbCtx.measureText(test).width > maxW && line) { wbCtx.fillText(line, obj.x + pad, y); line = word; y += (obj.fontSize || 14) * 1.3; }
            else line = test;
        });
        if (line) wbCtx.fillText(line, obj.x + pad, y);
    } else if (obj.type === 'image') {
        let img = wbImageCache[obj.url];
        if (!img) {
            img = new Image(); img.crossOrigin = 'anonymous';
            img.onload = () => { wbImageCache[obj.url] = img; renderWhiteboard(); };
            img.src = obj.url; wbImageCache[obj.url] = img;
        }
        if (img.complete && img.naturalWidth > 0) wbCtx.drawImage(img, obj.x, obj.y, obj.w, obj.h);
    }
}
function drawSelection(obj) {
    const b = getObjectBounds(obj);
    wbCtx.save();
    wbCtx.strokeStyle = '#00a884'; wbCtx.setLineDash([5, 3]); wbCtx.lineWidth = 1.5;
    wbCtx.strokeRect(b.x, b.y, b.w, b.h);
    wbCtx.setLineDash([]);
    const handles = getHandles(b);
    wbCtx.fillStyle = '#00a884'; wbCtx.strokeStyle = '#fff'; wbCtx.lineWidth = 2;
    Object.values(handles).forEach(h => { wbCtx.fillRect(h.x - 5, h.y - 5, 10, 10); wbCtx.strokeRect(h.x - 5, h.y - 5, 10, 10); });
    wbCtx.restore();
}
function renderWhiteboard() {
    if (!wbCtx) return;
    wbCtx.setTransform(1, 0, 0, 1, 0, 0);
    wbCtx.fillStyle = '#ffffff';
    wbCtx.fillRect(0, 0, wbCanvas.width, wbCanvas.height);
    wbCtx.setTransform(1, 0, 0, 1, wbOffset.x, wbOffset.y);
    wbObjects.forEach(drawObject);
    if (wbTempPath) drawObject(wbTempPath);
    if (wbTempShape) drawObject(wbTempShape);
    if (wbSelected && wbTool === 'select' && wbMode !== 'live-student') drawSelection(wbSelected);
    wbCtx.setTransform(1, 0, 0, 1, 0, 0);
}
function wbSnapshot() { return JSON.stringify(wbObjects); }
function wbPushHistory() {
    wbUndoStack.push(wbSnapshot());
    if (wbUndoStack.length > 60) wbUndoStack.shift();
    wbRedoStack = [];
    if (wbMode === 'live-teacher') scheduleBroadcastWB();
}
function wbUndo() {
    if (wbMode === 'live-student') return;
    if (!wbUndoStack.length) return;
    wbRedoStack.push(wbSnapshot());
    wbObjects = JSON.parse(wbUndoStack.pop());
    wbSelected = null; renderWhiteboard();
    if (wbMode === 'live-teacher') scheduleBroadcastWB();
}
function wbRedo() {
    if (wbMode === 'live-student') return;
    if (!wbRedoStack.length) return;
    wbUndoStack.push(wbSnapshot());
    wbObjects = JSON.parse(wbRedoStack.pop());
    wbSelected = null; renderWhiteboard();
    if (wbMode === 'live-teacher') scheduleBroadcastWB();
}
function wbDeleteSelected() {
    if (wbMode === 'live-student') return;
    if (!wbSelected) return;
    wbPushHistory();
    wbObjects = wbObjects.filter(o => o.id !== wbSelected.id);
    wbSelected = null; renderWhiteboard();
    if (wbMode === 'live-teacher') scheduleBroadcastWB();
}
function wbClear() {
    if (wbMode === 'live-student') return;
    if (!confirm("Clear the entire board?")) return;
    wbPushHistory();
    wbObjects = []; wbSelected = null; renderWhiteboard();
    if (wbMode === 'live-teacher') scheduleBroadcastWB();
}
function moveObject(obj, dx, dy) {
    if (obj.type === 'path') obj.points.forEach(p => { p.x += dx; p.y += dy; });
    else if (['line','arrow','rect','circle','triangle'].includes(obj.type)) { obj.x1 += dx; obj.y1 += dy; obj.x2 += dx; obj.y2 += dy; }
    else if (obj.type === 'text') { obj.x += dx; obj.y += dy; }
    else if (obj.type === 'sticky' || obj.type === 'image') { obj.x += dx; obj.y += dy; }
}
function applyResize(origBounds, origObj, handle, newX, newY) {
    let nx = origBounds.x, ny = origBounds.y, nw = origBounds.w, nh = origBounds.h;
    if (handle === 'nw') { nx = newX; ny = newY; nw = origBounds.x + origBounds.w - newX; nh = origBounds.y + origBounds.h - newY; }
    else if (handle === 'ne') { ny = newY; nw = newX - origBounds.x; nh = origBounds.y + origBounds.h - newY; }
    else if (handle === 'sw') { nx = newX; nw = origBounds.x + origBounds.w - newX; nh = newY - origBounds.y; }
    else if (handle === 'se') { nw = newX - origBounds.x; nh = newY - origBounds.y; }
    if (nw < 12) nw = 12; if (nh < 12) nh = 12;
    const sx = nw / origBounds.w, sy = nh / origBounds.h;
    const sp = p => ({ x: nx + (p.x - origBounds.x) * sx, y: ny + (p.y - origBounds.y) * sy });
    const cur = wbSelected;
    if (cur.type === 'path') cur.points = origObj.points.map(sp);
    else if (['line','arrow','rect','circle','triangle'].includes(cur.type)) {
        const p1 = sp({ x: origObj.x1, y: origObj.y1 }), p2 = sp({ x: origObj.x2, y: origObj.y2 });
        cur.x1 = p1.x; cur.y1 = p1.y; cur.x2 = p2.x; cur.y2 = p2.y;
    } else if (cur.type === 'text') {
        const p = sp({ x: origObj.x, y: origObj.y });
        cur.x = p.x; cur.y = p.y; cur.fontSize = Math.max(8, origObj.fontSize * Math.min(sx, sy));
    } else if (cur.type === 'sticky' || cur.type === 'image') { cur.x = nx; cur.y = ny; cur.w = nw; cur.h = nh; }
}
function getWbPos(e) {
    const rect = wbCanvas.getBoundingClientRect();
    return {
        x: (e.clientX - rect.left) * (wbCanvas.width / rect.width) - wbOffset.x,
        y: (e.clientY - rect.top) * (wbCanvas.height / rect.height) - wbOffset.y
    };
}
function wbPointerDown(e) {
    if (wbMode === 'live-student') return;
    if (e.button === 1 || wbTool === 'pan' || wbSpaceHeld) {
        e.preventDefault();
        wbPanning = true;
        wbPanStart.x = e.clientX; wbPanStart.y = e.clientY;
        wbPanStart.ox = wbOffset.x; wbPanStart.oy = wbOffset.y;
        try { wbCanvas.setPointerCapture(e.pointerId); } catch (_) {}
        if (wbCanvas) wbCanvas.style.cursor = 'grabbing';
        return;
    }
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const p = getWbPos(e);
    try { wbCanvas.setPointerCapture(e.pointerId); } catch (_) {}
    wbPointer.active = true; wbPointer.startX = p.x; wbPointer.startY = p.y; wbPointer.beforeState = wbSnapshot();
    if (wbTool === 'select') {
        const h = hitHandle(p.x, p.y);
        if (h) { wbPointer.mode = 'resize'; wbPointer.handle = h; wbPointer.origBounds = getObjectBounds(wbSelected); wbPointer.origObj = JSON.parse(JSON.stringify(wbSelected)); return; }
        let hit = null;
        for (let i = wbObjects.length - 1; i >= 0; i--) if (hitTest(wbObjects[i], p.x, p.y)) { hit = wbObjects[i]; break; }
        wbSelected = hit; wbPointer.mode = hit ? 'move' : null;
        renderWhiteboard(); return;
    }
    if (wbTool === 'eraser') { wbPointer.mode = 'erase'; eraseAt(p.x, p.y); return; }
    if (wbTool === 'pen' || wbTool === 'highlighter') {
        wbPointer.mode = 'draw';
        wbTempPath = { id: 'o_' + Date.now() + '_' + Math.random().toString(36).slice(2), type: 'path', tool: wbTool, points: [p], color: wbColor, size: wbTool === 'highlighter' ? wbSize * 5 : wbSize };
        renderWhiteboard(); return;
    }
    if (['line','arrow','rect','circle','triangle'].includes(wbTool)) {
        wbPointer.mode = 'shape';
        wbTempShape = { id: 'o_' + Date.now() + '_' + Math.random().toString(36).slice(2), type: wbTool, x1: p.x, y1: p.y, x2: p.x, y2: p.y, color: wbColor, fill: (wbTool === 'line' || wbTool === 'arrow') ? 'none' : wbFill, size: wbSize };
        renderWhiteboard(); return;
    }
    if (wbTool === 'text') {
        const text = prompt("Enter text:");
        if (text) { wbPushHistory(); wbObjects.push({ id: 'o_' + Date.now(), type: 'text', x: p.x, y: p.y, text, color: wbColor, fontSize: 14 + wbSize * 2 }); renderWhiteboard(); }
        wbPointer.active = false; return;
    }
    if (wbTool === 'sticky') {
        const text = prompt("Sticky note text:");
        if (text) { wbPushHistory(); wbObjects.push({ id: 'o_' + Date.now(), type: 'sticky', x: p.x, y: p.y, w: 160, h: 120, text, fill: (wbFill === '#ffffff' ? '#fff9c4' : wbFill), color: '#f9a825', fontSize: 14 }); renderWhiteboard(); }
        wbPointer.active = false; return;
    }
}
function wbPointerMove(e) {
    if (wbMode === 'live-student') return;
    if (wbPanning) {
        wbOffset.x = wbPanStart.ox + (e.clientX - wbPanStart.x);
        wbOffset.y = wbPanStart.oy + (e.clientY - wbPanStart.y);
        renderWhiteboard(); return;
    }
    if (!wbPointer.active) return;
    const p = getWbPos(e);
    if (wbPointer.mode === 'draw') { wbTempPath.points.push(p); renderWhiteboard(); return; }
    if (wbPointer.mode === 'shape') { wbTempShape.x2 = p.x; wbTempShape.y2 = p.y; renderWhiteboard(); return; }
    if (wbPointer.mode === 'move' && wbSelected) { moveObject(wbSelected, p.x - wbPointer.startX, p.y - wbPointer.startY); wbPointer.startX = p.x; wbPointer.startY = p.y; renderWhiteboard(); return; }
    if (wbPointer.mode === 'resize' && wbSelected) { applyResize(wbPointer.origBounds, wbPointer.origObj, wbPointer.handle, p.x, p.y); renderWhiteboard(); return; }
    if (wbPointer.mode === 'erase') { eraseAt(p.x, p.y); return; }
}
function wbPointerUp(e) {
    if (wbMode === 'live-student') return;
    if (wbPanning) {
        wbPanning = false;
        if (wbCanvas) {
            if (wbTool === 'pan' || wbSpaceHeld) wbCanvas.style.cursor = 'grab';
            else if (wbTool === 'select') wbCanvas.style.cursor = 'default';
            else if (wbTool === 'text' || wbTool === 'sticky') wbCanvas.style.cursor = 'text';
            else wbCanvas.style.cursor = 'crosshair';
        }
        return;
    }
    if (!wbPointer.active) return;
    wbPointer.active = false;
    if (wbPointer.mode === 'draw' && wbTempPath) {
        if (wbTempPath.points.length > 1) wbObjects.push(wbTempPath);
        wbTempPath = null;
        if (wbSnapshot() !== wbPointer.beforeState) wbPushHistory();
        renderWhiteboard();
    } else if (wbPointer.mode === 'shape' && wbTempShape) {
        const dx = Math.abs(wbTempShape.x2 - wbTempShape.x1), dy = Math.abs(wbTempShape.y2 - wbTempShape.y1);
        if (dx > 3 || dy > 3) wbObjects.push(wbTempShape);
        wbTempShape = null;
        if (wbSnapshot() !== wbPointer.beforeState) wbPushHistory();
        renderWhiteboard();
    } else if (wbPointer.mode === 'move' || wbPointer.mode === 'resize') {
        if (wbSnapshot() !== wbPointer.beforeState) { wbUndoStack.push(wbPointer.beforeState); if (wbUndoStack.length > 60) wbUndoStack.shift(); wbRedoStack = []; }
        renderWhiteboard();
    } else if (wbPointer.mode === 'erase') {
        if (wbSnapshot() !== wbPointer.beforeState) { wbUndoStack.push(wbPointer.beforeState); if (wbUndoStack.length > 60) wbUndoStack.shift(); wbRedoStack = []; }
        renderWhiteboard();
    }
    wbPointer.mode = null; wbPointer.origBounds = null; wbPointer.origObj = null; wbPointer.handle = null; wbPointer.beforeState = null;
    if (wbMode === 'live-teacher') scheduleBroadcastWB();
}
function eraseAt(x, y) {
    const before = wbObjects.length;
    for (let i = wbObjects.length - 1; i >= 0; i--) if (hitTest(wbObjects[i], x, y)) wbObjects.splice(i, 1);
    if (wbObjects.length !== before) { wbSelected = null; renderWhiteboard(); }
}
function wbInsertImage() {
    if (wbMode === 'live-student') return;
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.onchange = async () => {
        const file = input.files[0]; if (!file) return;
        const filePath = `whiteboard-images/${Date.now()}_${Math.random().toString(36).slice(2)}.${(file.name.split('.').pop() || 'png').toLowerCase()}`;
        const { error } = await supabaseClient.storage.from('classroom_uploads').upload(filePath, file);
        if (error) return alert("Upload failed: " + error.message);
        const url = supabaseClient.storage.from('classroom_uploads').getPublicUrl(filePath).data.publicUrl;
        const img = new Image(); img.crossOrigin = 'anonymous';
        img.onload = () => {
            const maxW = wbCanvas.width * 0.45, maxH = wbCanvas.height * 0.45;
            let w = img.width, h = img.height;
            const ratio = Math.min(maxW / w, maxH / h, 1);
            w *= ratio; h *= ratio;
            wbPushHistory();
            wbObjects.push({ id: 'o_' + Date.now(), type: 'image', x: (wbCanvas.width - w) / 2 - wbOffset.x, y: (wbCanvas.height - h) / 2 - wbOffset.y, w, h, url });
            wbImageCache[url] = img;
            renderWhiteboard();
            if (wbMode === 'live-teacher') scheduleBroadcastWB();
        };
        img.src = url;
    };
    input.click();
}
function _wbExportCanvas() {
    const tmp = document.createElement('canvas');
    tmp.width = wbCanvas.width; tmp.height = wbCanvas.height;
    const tctx = tmp.getContext('2d');
    tctx.fillStyle = '#fff'; tctx.fillRect(0, 0, tmp.width, tmp.height);
    const prevSelected = wbSelected; wbSelected = null;
    const realCtx = wbCtx; wbCtx = tctx;
    wbCtx.setTransform(1, 0, 0, 1, wbOffset.x, wbOffset.y);
    wbObjects.forEach(drawObject);
    wbCtx.setTransform(1, 0, 0, 1, 0, 0);
    wbCtx = realCtx; wbSelected = prevSelected;
    return tmp;
}
async function wbSavePdf() {
    if (!window.jspdf) return alert("PDF library not loaded.");
    const { jsPDF } = window.jspdf;
    const tmp = _wbExportCanvas();
    const imgData = tmp.toDataURL('image/png');
    const pdf = new jsPDF('l', 'mm', 'a4');
    const pw = pdf.internal.pageSize.getWidth(), ph = pdf.internal.pageSize.getHeight();
    const ratio = tmp.width / tmp.height;
    let w = pw - 20, h = w / ratio;
    if (h > ph - 20) { h = ph - 20; w = h * ratio; }
    pdf.addImage(imgData, 'PNG', (pw - w) / 2, (ph - h) / 2, w, h);
    pdf.save(`${wbBoardName || 'board'}.pdf`);
}
async function wbSendToGroup() {
    if (wbMode === 'live-student') return;
    if (!activeGroupId) return alert("No active group.");
    if (restrictMessaging && currentUserRoleInActiveGroup !== 'teacher' && currentUserRoleInActiveGroup !== 'admin') return alert("Only teachers/admins can send.");
    const tmp = _wbExportCanvas();
    const blob = await new Promise(res => tmp.toBlob(res, 'image/png'));
    const imgPath = `whiteboards/${Date.now()}_${Math.random().toString(36).slice(2)}.png`;
    const { error: imgErr } = await supabaseClient.storage.from('classroom_uploads').upload(imgPath, blob, { contentType: 'image/png' });
    if (imgErr) return alert("Image upload failed: " + imgErr.message);
    const imgUrl = supabaseClient.storage.from('classroom_uploads').getPublicUrl(imgPath).data.publicUrl;
    const wbData = { name: wbBoardName, imgUrl, width: wbCanvas.width, height: wbCanvas.height, objects: wbObjects };
    const jsonBlob = new Blob([JSON.stringify(wbData)], { type: 'application/json' });
    const jsonPath = `whiteboards-data/${Date.now()}_${Math.random().toString(36).slice(2)}.json`;
    const { error: jsonErr } = await supabaseClient.storage.from('classroom_uploads').upload(jsonPath, jsonBlob, { contentType: 'application/json' });
    if (jsonErr) return alert("Data upload failed: " + jsonErr.message);
    const jsonUrl = supabaseClient.storage.from('classroom_uploads').getPublicUrl(jsonPath).data.publicUrl;
    const payload = JSON.stringify({ name: wbBoardName, imgUrl, jsonUrl });
    const { error } = await supabaseClient.from('messages').insert([{ message_text: '[WHITEBOARD]' + payload, sender_id: currentUser.id, group_id: activeGroupId }]);
    if (error) return alert("Send failed: " + error.message);
    lastMessagesHash = ''; await loadMessages();
    document.getElementById('chat-messages').scrollTop = document.getElementById('chat-messages').scrollHeight;
    alert("✅ Whiteboard sent to group!");
}
async function openWhiteboardFromMessage(wb) {
    wbBoardName = wb.name || 'Board';
    wbObjects = []; wbUndoStack = []; wbRedoStack = []; wbSelected = null;
    wbOffset = { x: 0, y: 0 };
    if (wb.jsonUrl) {
        try {
            const res = await fetch(wb.jsonUrl);
            const data = await res.json();
            wbObjects = data.objects || [];
        } catch (err) { console.warn("Could not load whiteboard data.", err); wbObjects = []; }
    }
    openWhiteboard();
}
function openWhiteboardFromB64(b64) {
    try {
        const json = decodeURIComponent(escape(atob(b64)));
        openWhiteboardFromMessage(JSON.parse(json));
    } catch (e) { alert("Cannot open whiteboard"); }
}

/* ═══════════════════════════════════════════════════════════
   🖌️ LIVE WHITEBOARD FUNCTIONS
   ═══════════════════════════════════════════════════════════ */

function handleWBButton() {
    if (currentUserRoleInActiveGroup === 'teacher' || currentUserRoleInActiveGroup === 'admin') {
        toggleLiveWhiteboard();
    } else {
        viewLiveWhiteboardForStudent();
    }
}

async function toggleLiveWhiteboard() {
    if (!currentLiveCallId) return alert("Start the live class first.");
    if (liveWBActive) {
        if (confirm("Stop the live whiteboard for everyone?")) await stopLiveWhiteboard();
    } else {
        await startLiveWhiteboard();
    }
}

async function startLiveWhiteboard() {
    if (!wbCanvas) {
        wbBoardName = 'Live Board';
        wbObjects = []; wbUndoStack = []; wbRedoStack = [];
        wbOffset = { x: 0, y: 0 };
    }

    const { data, error } = await supabaseClient
        .from('live_wb_sessions')
        .insert([{
            live_call_id: currentLiveCallId,
            group_id: activeGroupId,
            teacher_id: currentUser.id,
            board_name: wbBoardName || 'Live Board',
            objects: wbObjects || []
        }])
        .select().single();

    if (error) return alert("Failed to start whiteboard: " + error.message);

    liveWBSessionId = data.id;
    liveWBActive = true;
    wbMode = 'live-teacher';

    openLiveWhiteboardUI('teacher');

    liveWBChannel = supabaseClient.channel(`live-wb:${currentLiveCallId}`, {
        config: { broadcast: { self: false } }
    });
    liveWBChannel.subscribe((status) => {
        if (status === 'SUBSCRIBED') broadcastWBState();
    });

    const wbBtn = document.getElementById('meeting-wb-btn');
    if (wbBtn) wbBtn.innerText = '⏹️ Stop Board';
}

function openLiveWhiteboardUI(role) {
    const modal = document.getElementById('whiteboard-modal');
    if (!modal) return;
    modal.classList.remove('hidden');
    document.getElementById('wb-title-label').innerText = '🔴 Live: ' + (wbBoardName || 'Untitled Board');

    const cvs = document.getElementById('wb-canvas');
    const tb = document.querySelector('.wb-toolbar');
    const info = document.getElementById('live-wb-info');

    if (role === 'student') {
        if (cvs) cvs.style.pointerEvents = 'none';
        if (tb) tb.style.display = 'none';
        if (info) info.style.display = 'flex';
    } else {
        if (cvs) cvs.style.pointerEvents = 'auto';
        if (tb) tb.style.display = 'flex';
        if (info) info.style.display = 'none';
    }

    setTimeout(() => {
        initWbCanvas();
        wbResize(true);
        renderWhiteboard();
    }, 100);
}

function scheduleBroadcastWB() {
    if (!liveWBActive || wbMode !== 'live-teacher') return;
    if (wbBroadcastTimer) clearTimeout(wbBroadcastTimer);
    wbBroadcastTimer = setTimeout(() => broadcastWBState(), 250);
}

async function broadcastWBState() {
    if (!liveWBChannel || !liveWBActive) return;
    const payload = { objects: wbObjects, offset: wbOffset, name: wbBoardName };
    try {
        await liveWBChannel.send({ type: 'broadcast', event: 'wb-state', payload });
        if (liveWBSessionId) {
            await supabaseClient
                .from('live_wb_sessions')
                .update({ objects: wbObjects, updated_at: new Date().toISOString() })
                .eq('id', liveWBSessionId);
        }
    } catch (e) { console.warn('WB broadcast error:', e); }
}

async function stopLiveWhiteboard() {
    if (!liveWBActive) return;
    if (liveWBChannel) {
        try { await liveWBChannel.send({ type: 'broadcast', event: 'wb-stop', payload: {} }); } catch (e) {}
    }
    if (liveWBSessionId) {
        await supabaseClient
            .from('live_wb_sessions')
            .update({ active: false, updated_at: new Date().toISOString() })
            .eq('id', liveWBSessionId);
    }
    if (liveWBChannel) {
        await supabaseClient.removeChannel(liveWBChannel);
        liveWBChannel = null;
    }
    liveWBActive = false;
    liveWBSessionId = null;
    wbMode = 'normal';

    const cvs = document.getElementById('wb-canvas');
    if (cvs) cvs.style.pointerEvents = 'auto';
    const tb = document.querySelector('.wb-toolbar');
    if (tb) tb.style.display = 'flex';
    const info = document.getElementById('live-wb-info');
    if (info) info.style.display = 'none';

    closeWhiteboard();

    const wbBtn = document.getElementById('meeting-wb-btn');
    if (wbBtn) wbBtn.innerText = '🖌️ Whiteboard';
}

async function subscribeToLiveWB(callId) {
    const { data } = await supabaseClient
        .from('live_wb_sessions')
        .select('*')
        .eq('live_call_id', callId)
        .eq('active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (data) {
        liveWBSessionId = data.id;
        liveWBActive = true;
        wbMode = 'live-student';
        wbObjects = data.objects || [];
        wbBoardName = data.board_name || 'Live Board';
        wbOffset = { x: 0, y: 0 };
        openLiveWhiteboardUI('student');
        const wbBtn = document.getElementById('meeting-wb-btn');
        if (wbBtn) { wbBtn.style.display = 'inline-flex'; wbBtn.innerText = '🖌️ View Board'; }
    }

    if (liveWBChannel) await supabaseClient.removeChannel(liveWBChannel);
    liveWBChannel = supabaseClient.channel(`live-wb:${callId}`, {
        config: { broadcast: { self: false } }
    });

    liveWBChannel
        .on('broadcast', { event: 'wb-state' }, ({ payload }) => {
            if (wbMode !== 'live-student') return;
            wbObjects = payload.objects || [];
            wbOffset = payload.offset || { x: 0, y: 0 };
            wbBoardName = payload.name || 'Live Board';
            wbSelected = null;
            renderWhiteboard();
            const wbBtn = document.getElementById('meeting-wb-btn');
            if (wbBtn) { wbBtn.style.display = 'inline-flex'; wbBtn.innerText = '🖌️ View Board'; }
        })
        .on('broadcast', { event: 'wb-stop' }, () => {
            if (wbMode === 'live-student') stopLiveWhiteboardForViewer();
        })
        .subscribe();
}

async function stopLiveWhiteboardForViewer() {
    liveWBActive = false;
    liveWBSessionId = null;
    wbMode = 'normal';
    if (liveWBChannel) {
        await supabaseClient.removeChannel(liveWBChannel);
        liveWBChannel = null;
    }
    const cvs = document.getElementById('wb-canvas');
    if (cvs) cvs.style.pointerEvents = 'auto';
    const tb = document.querySelector('.wb-toolbar');
    if (tb) tb.style.display = 'flex';
    const info = document.getElementById('live-wb-info');
    if (info) info.style.display = 'none';
    closeWhiteboard();
    const wbBtn = document.getElementById('meeting-wb-btn');
    if (wbBtn) wbBtn.style.display = 'none';
}

function hideLiveWBForStudent() {
    document.getElementById('whiteboard-modal').classList.add('hidden');
}

function viewLiveWhiteboardForStudent() {
    if (!liveWBActive || wbMode !== 'live-student') return;
    document.getElementById('whiteboard-modal').classList.remove('hidden');
    setTimeout(() => { initWbCanvas(); wbResize(true); renderWhiteboard(); }, 80);
}





/* ✅ Listen for actions from Galene iframe */
window.addEventListener('message', (event) => {
    if (!event.data || event.data.type !== 'galene-action') return;
    const action = event.data.action;
    if (action === 'whiteboard') {
        handleWBButton();
    } else if (action === 'endclass') {
        endLiveClass();
    } else if (action === 'leave') {
        closeMeetingRoom();
        currentLiveCallId = null;
        currentGaleneTeacherToken = null;
        currentGaleneStudentToken = null;
        sessionStorage.removeItem('galene_teacher_token');
        sessionStorage.removeItem('galene_call_id');
        sessionStorage.removeItem('galene_student_token');
    }
});
