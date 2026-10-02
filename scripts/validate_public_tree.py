#!/usr/bin/env python3
"""Reject private material in the candidate Git/Pages tree."""
import subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
paths=subprocess.check_output(['git','ls-files','-z','--cached','--others','--exclude-standard'],cwd=ROOT).decode().split('\0')
for name in paths:
    if not name or not (ROOT/name).is_file():continue
    assert not name.startswith(('private/','materials/','.library-tools/')), name+' private input in candidate tree'
    assert name!='backend/allowlist-kiky.sql',name+' personal UUID file'
    assert Path(name).suffix.lower() not in ('.docx','.xlsx','.zip','.pdf','.json','.jpeg','.jpg'),name+' private content/artifact file'
    assert name not in ('bank.json','data.js','心理学综合题库_单文件版.html'),name+' legacy content publication'
for target in ['learning/index.html','politics/index.html']:
    html=(ROOT/target).read_text()
    assert '返回学习室登录入口' in html and 'location.replace' in html,target+' not redirected to canonical root'
assert '学习室维护中' in (ROOT/'index.html').read_text() or 'data-private-login' in (ROOT/'index.html').read_text(),'anonymous root must be login/maintenance only'
print('PASS: public candidate contains no data banks, source documents or private artifacts; old entries redirect to root.')
