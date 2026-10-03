#!/usr/bin/env python3
"""Build one private, stored-ZIP subject container. No network or publication."""
import argparse, base64, hashlib, json, pathlib, zipfile
LIMIT = 256 * 1024

def encoded(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode('utf-8')

def build(subject, version, bank, notes, documents, review, output):
    if subject not in ('psychology', 'politics', 'english'):
        raise ValueError('Unsupported subject')
    if not isinstance(review, dict) or review.get('status') not in ('incomplete', 'reviewed-with-limitations', 'reviewed') or not isinstance(review.get('scope'), str) or not isinstance(review.get('limitations'), list):
        raise ValueError('Explicit semantic review scope/status/limitations required')
    objects, bodies = [], {}
    def add(body, role, component, field='', start=0, count=0):
        if not 0 < len(body) <= LIMIT:
            raise ValueError('An object exceeds bounded object limit; split its schema explicitly')
        index = len(objects)
        name = f'objects/{index:04d}.bin' if role == 'asset' else f'objects/{index:04d}.json'
        objects.append(dict(index=index, path=name, role=role, component=component, field=field, start=start, count=count, bytes=len(body), sha256=hashlib.sha256(body).hexdigest()))
        bodies[name] = body
    def component(name, value):
        if not isinstance(value, dict): raise ValueError('Component must be an object')
        arrays = {k:v for k,v in value.items() if isinstance(v, list)}
        add(encoded({k:v for k,v in value.items() if k not in arrays}), 'root', name)
        for field, values in arrays.items():
            start, batch, size = 0, [], 2
            for value in values:
                body = encoded(value)
                if len(body) + 2 > LIMIT: raise ValueError(f'Oversized {name}.{field} record')
                if batch and size + len(body) + 1 > LIMIT:
                    add(encoded(batch), 'array', name, field, start, len(batch));start += len(batch);batch, size = [], 2
                batch.append(value);size += len(body) + (1 if len(batch) > 1 else 0)
            add(encoded(batch), 'array', name, field, start, len(batch))
    if not isinstance(bank.get('memoryQuestions'), list) or not isinstance(bank.get('predictions'), list) or not isinstance(notes.get('records'), list):
        raise ValueError('Bank and notes required')
    for field in ('memoryQuestions', 'predictions'):
        ids=[q.get('id') for q in bank[field]]
        if any(not isinstance(i,str) or not i for i in ids) or len(ids)!=len(set(ids)):raise ValueError('Duplicate/missing question ID')
    ids = [q['id'] for q in bank['memoryQuestions'] + bank['predictions']]
    if len(ids) != len(set(ids)): raise ValueError('Question IDs collide across banks')
    component('bank', bank);component('notes', notes)
    document_root={k:v for k,v in documents.items() if k != 'documents'}
    metadata=[]
    for i,doc in enumerate(documents.get('documents', [])):
        raw=base64.b64decode(doc['base64'], validate=True)
        digest=hashlib.sha256(raw).hexdigest()
        if len(raw)>8388608 or digest != doc.get('sha256') or not raw.startswith(b'PK\x03\x04'):raise ValueError('Word checksum/signature mismatch')
        if not doc['file_name'].endswith('.docx') or '/' in doc['file_name'] or '\\' in doc['file_name']:raise ValueError('Unsafe Word filename')
        metadata.append({k:v for k,v in doc.items() if k!='base64'} | {'asset_field':f'word-{i}', 'bytes':len(raw)})
        for start in range(0,len(raw),LIMIT):add(raw[start:start+LIMIT], 'asset', 'documents', f'word-{i}', start, min(LIMIT,len(raw)-start))
    component('documents', document_root | {'documents':metadata})
    manifest=dict(format='private-subject-package',schema_version=1,subject=subject,package_version=version,file_complete=True,semantic_review=review,objects=objects)
    body=encoded(manifest)
    if len(body)>128*1024 or len(objects)>2048 or sum(o['bytes'] for o in objects)>128*1024*1024:raise ValueError('Package resource limit')
    output=pathlib.Path(output);output.parent.mkdir(parents=True,exist_ok=True)
    with zipfile.ZipFile(output,'w',compression=zipfile.ZIP_STORED,allowZip64=False) as z:
        for name,data in [('manifest.json',body),*bodies.items()]:
            entry=zipfile.ZipInfo(name,date_time=(2026,1,1,0,0,0));entry.compress_type=zipfile.ZIP_STORED;entry.external_attr=0o600 << 16;z.writestr(entry,data)
    return {'objects':len(objects),'bytes':output.stat().st_size,'manifest_sha256':hashlib.sha256(body).hexdigest(),'package_sha256':hashlib.sha256(output.read_bytes()).hexdigest(),'file_complete':True,'semantic_review':review}

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--subject',required=True);p.add_argument('--version',required=True)
    for name in ('bank','notes','documents','review','output'):p.add_argument('--'+name,required=True)
    a=p.parse_args();load=lambda n:json.loads(pathlib.Path(getattr(a,n)).read_text())
    print(json.dumps(build(a.subject,a.version,load('bank'),load('notes'),load('documents'),load('review'),a.output),ensure_ascii=False))
