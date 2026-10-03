#!/usr/bin/env python3
"""Fail-closed whole-question release gate; never promotes historical review labels."""
import argparse
import base64
import hashlib
import json
import math
import struct
from pathlib import Path

CHECKS = ('prompt', 'answer', 'explanation', 'scoring', 'variants',
          'note_provenance', 'source_support', 'original_claim_limits')

def canonical(value):
    # Tagged tree with IEEE754 numeric bytes avoids Python/JS 1.0 and exponent differences.
    # All keys sort by UTF16 (the browser's ordering); no original content is normalized.
    def tree(v):
        if v is None: return ['null']
        if isinstance(v, bool): return ['boolean', v]
        if isinstance(v, (float, int)):
            if not math.isfinite(v) or float(v).is_integer() and abs(v) > 9007199254740991:
                raise ValueError('Nonfinite or unsafe numeric review binding')
            return ['number', struct.pack('>d', float(v)).hex()]
        if isinstance(v, str): return ['string', v]
        if isinstance(v, dict):
            if any(not isinstance(k, str) for k in v): raise ValueError('Review binding keys must be strings')
            return ['object', [[k, tree(v[k])] for k in sorted(v, key=lambda k:k.encode('utf-16-be'))]]
        if isinstance(v, list): return ['array', [tree(x) for x in v]]
        raise ValueError('Unsupported review binding value')
    return json.dumps(tree(value), ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode('utf-8')

def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()

def disabled(q):
    return q.get('practice_enabled') is False or q.get('safe_for_quiz') is False

def source_ids(q):
    ids = list(q.get('source_ids', []))
    ids += [x['id'] for x in q.get('source_refs', []) if isinstance(x, dict) and isinstance(x.get('id'), str)]
    if any(not isinstance(x, str) or not x for x in ids): raise ValueError('Invalid question source ID')
    return sorted(set(ids))

def validate(bank, index, evidence_root, notes=None, documents=None):
    if index.get('format') != 'question-review-index-v1' or not isinstance(index.get('records'), list):
        raise ValueError('A genuine independent whole-question evidence index is required')
    root = Path(evidence_root).resolve()
    refs, sources, questions, proofs, failures = {}, {}, {}, [], []
    for r in index['records']:
        qid = r.get('question_id')
        if not isinstance(qid, str) or qid in refs: raise ValueError('Duplicate/missing review index question ID')
        refs[qid] = r
    for s in bank.get('sources', []):
        if s.get('id') in sources: raise ValueError('Duplicate source ID')
        sources[s.get('id')] = s
    cache = {}
    note_records = {n['id']:n for n in (notes or {}).get('records', [])}
    document_hashes = {d['file_name']:d['sha256'] for d in (documents or {}).get('documents', [])}
    if len(note_records) != len((notes or {}).get('records', [])) or len(document_hashes) != len((documents or {}).get('documents', [])):
        raise ValueError('Duplicate current note IDs or original document filenames')
    for d in (documents or {}).get('documents', []):
        raw = base64.b64decode(d.get('base64', ''), validate=True)
        if not raw.startswith(b'PK\x03\x04') or hashlib.sha256(raw).hexdigest() != d['sha256']:
            raise ValueError('Actual original Word bytes differ from declared current document SHA')
    for kind in ('memoryQuestions', 'predictions'):
        for q in bank.get(kind, []):
            qid = q.get('id')
            if not isinstance(qid, str) or not qid or qid in questions: raise ValueError('Duplicate/missing question ID')
            questions[qid] = q
            if disabled(q):
                if not (q.get('disabled_reason') or q.get('duplicate_of') or q.get('quiz_release_block')):
                    failures.append({'id': qid, 'reason': 'Disabled question requires a visible reason'})
                continue
            try:
                r = refs.get(qid)
                if not r: raise ValueError('No whole-question evidence index entry; review_status is insufficient')
                relative = r.get('artifact', '')
                if not isinstance(relative, str) or not relative or Path(relative).is_absolute(): raise ValueError('Evidence path must be relative')
                path = (root / relative).resolve()
                if root not in path.parents or not path.is_file(): raise ValueError('Evidence path escapes root or is unreadable')
                if path not in cache:
                    raw = path.read_bytes(); cache[path] = (hashlib.sha256(raw).hexdigest(), json.loads(raw))
                artifact_sha, artifact = cache[path]
                if artifact_sha != r.get('sha256'): raise ValueError('Evidence artifact SHA mismatch')
                if artifact.get('format') != 'independent-question-review-v1' or artifact.get('scope') != 'whole-question' or artifact.get('completed') is not True:
                    raise ValueError('Source-only, variant-only and technical review do not pass whole-question review')
                reviewer, author = artifact.get('reviewer'), artifact.get('author')
                if not isinstance(reviewer, str) or not reviewer.strip() or not isinstance(author, str) or not author.strip() or reviewer == author or not artifact.get('completed_at'):
                    raise ValueError('Completed independent reviewer and distinct author must be identified')
                rows = [x for x in artifact.get('reviews', []) if x.get('question_id') == qid]
                if len(rows) != 1: raise ValueError('Evidence must contain exactly one matching review record')
                row = rows[0]
                if row.get('decision') != 'passed': raise ValueError('Independent review is not passed')
                checks = row.get('checks', {})
                if any(not isinstance(checks.get(k), dict) or checks[k].get('status') != 'passed' or not isinstance(checks[k].get('evidence'), str) or len(checks[k]['evidence'].strip()) < 12 for k in CHECKS):
                    raise ValueError('All eight review dimensions require an explicit passed judgment and substantive evidence')
                qsha = digest(q)
                if digest(row.get('question_snapshot')) != qsha: raise ValueError('Current whole question differs from independently reviewed snapshot')
                used = source_ids(q)
                if not used or not q.get('note_refs'): raise ValueError('Current question lacks source or note provenance')
                expected_sources = row.get('source_snapshots', {})
                if set(expected_sources) != set(used): raise ValueError('Reviewed source set differs from current question references')
                bindings = {}
                for sid in used:
                    if sid not in sources or digest(sources[sid]) != digest(expected_sources[sid]): raise ValueError('Current source version differs from reviewed source snapshot: ' + sid)
                    bindings[sid] = digest(sources[sid])
                if notes is None or documents is None: raise ValueError('Current notes and original document versions are required')
                note_bindings, doc_bindings = {}, {}
                for ref in q['note_refs']:
                    locator = ref.get('locator', '')
                    nid = locator[6:] if locator.startswith('audit:') else locator
                    name = ref.get('file_name')
                    if nid not in note_records or name not in document_hashes or (note_records[nid].get('document') or note_records[nid].get('source')) != name:
                        raise ValueError('Note locator and original document do not match current material versions')
                    note_bindings[nid] = digest(note_records[nid]);doc_bindings[name] = document_hashes[name]
                reviewed_notes = row.get('note_snapshots', {})
                if set(reviewed_notes) != set(note_bindings) or any(digest(reviewed_notes[nid]) != sha for nid,sha in note_bindings.items()):
                    raise ValueError('Current note record differs from independently reviewed note snapshot')
                if row.get('document_sha256') != doc_bindings: raise ValueError('Current original Word version differs from independently reviewed version')
                proofs.append({'id': qid, 'kind': kind, 'question_sha256': qsha, 'source_sha256': bindings,
                               'note_record_sha256': note_bindings, 'document_sha256': doc_bindings,
                               'binding_algorithm': 'typed-tree-ieee754-v1',
                               'reviewer': reviewer, 'author': author, 'completed_at': artifact['completed_at'],
                               'scope': 'whole-question', 'decision': 'passed', 'checks': checks,
                               'evidence_artifact_sha256': artifact_sha, 'evidence_artifact': relative})
            except (ValueError, TypeError, KeyError, OSError) as err:
                failures.append({'id': qid, 'reason': str(err)})
    if set(refs) - set(questions): raise ValueError('Evidence index contains unknown question IDs')
    active = sum(not disabled(q) for q in questions.values())
    report = {'format': 'question-release-gate-v1', 'passed': not failures and bool(active),
              'active_questions': active, 'disabled_questions': len(questions)-active,
              'current_bound_reviews': len(proofs), 'failures': failures,
              'review_index_sha256': digest(index), 'bank_sha256': digest({k:v for k,v in bank.items() if k not in ('questionReviews','practiceRelease')})}
    return report, proofs

if __name__ == '__main__':
    p = argparse.ArgumentParser(); p.add_argument('--bank', required=True); p.add_argument('--index', required=True)
    p.add_argument('--evidence-root', required=True); p.add_argument('--report', required=True); p.add_argument('--approved-bank')
    p.add_argument('--notes', required=True);p.add_argument('--documents', required=True)
    a = p.parse_args(); bank = json.loads(Path(a.bank).read_text()); index = json.loads(Path(a.index).read_text())
    report, proofs = validate(bank, index, a.evidence_root, json.loads(Path(a.notes).read_text()), json.loads(Path(a.documents).read_text()))
    Path(a.report).write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
    if report['passed'] and a.approved_bank:
        bank['questionReviews'] = proofs
        bank['practiceRelease'] = {k:v for k,v in report.items() if k != 'failures'}
        Path(a.approved_bank).write_text(json.dumps(bank, ensure_ascii=False, separators=(',', ':')))
    print(json.dumps({k:v for k,v in report.items() if k != 'failures'}, ensure_ascii=False))
    raise SystemExit(0 if report['passed'] else 1)
