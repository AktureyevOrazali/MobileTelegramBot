import logging
logging.basicConfig(level=logging.INFO)
from backend.database import execute, get_user_bins, get_user_sections, list_chats_for_user, user_can_access_chat

user = execute("SELECT * FROM users WHERE role='operator' LIMIT 1").fetchone()
chats = list_chats_for_user(user['id'], user['role'])

print(f"Testing chats for user {user['id']} (role: {user['role']})")
fails = 0
for c in chats:
    acc = user_can_access_chat(user['id'], user['role'], c['chat_id'], c['dialog_id'])
    print(f"Chat {c['chat_id']} Dialog {c['dialog_id']} Section {c.get('section')} Bin {c.get('bin')}: {acc}")
    if not acc:
        fails += 1
print(f"Fails: {fails} out of {len(chats)}")
