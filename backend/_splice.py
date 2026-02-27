"""Splice new dashboard body into database.py, replacing lines 2795-3784."""
import pathlib

db = pathlib.Path(r'c:\Users\Admin\MobileTelegramBot_clean\backend\database.py')
body = pathlib.Path(r'c:\Users\Admin\MobileTelegramBot_clean\backend\_new_dashboard_body.py')

lines = db.read_text(encoding='utf-8').splitlines(keepends=True)
new_body = body.read_text(encoding='utf-8')

# Replace lines 2795..3784 (1-indexed) => index 2794..3783
before = lines[:2794]
after = lines[3784:]

result = ''.join(before) + new_body + '\n' + ''.join(after)
db.write_text(result, encoding='utf-8')
print(f'Done. Before: {len(lines)} lines, After: {len(result.splitlines())} lines')
