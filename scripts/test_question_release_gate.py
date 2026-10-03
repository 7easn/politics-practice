#!/usr/bin/env python3
"""Synthetic independent-review protocol tests; these certify no real questions."""
import copy
import base64
import hashlib
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from question_release_gate import CHECKS, digest, validate
from build_subject_package import build

class ReleaseGateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.root = Path(self.temp.name)
        self.q = {'id':'synthetic-Q', 'prompt':'Synthetic only', 'options':['a','b'], 'answer':[0],
                  'option_explanations':['Synthetic a','Synthetic b'], 'plain_explanation':'Synthetic explanation',
                  'variations':['Synthetic variant'], 'note_refs':[{'locator':'synthetic-note','file_name':'synthetic.docx'}],
                  'source_ids':['synthetic-source'], 'review_status':'verified', 'scoring':{'total':0.5}}
        self.source = {'id':'synthetic-source','url':'https://example.invalid/synthetic','version':'1'}
        raw=b'PK\x03\x04synthetic-only'
        self.notes={'records':[{'id':'synthetic-note','text':'Synthetic note only','document':'synthetic.docx'}]}
        self.documents={'documents':[{'file_name':'synthetic.docx','sha256':hashlib.sha256(raw).hexdigest(),'base64':base64.b64encode(raw).decode()}]}
        self.bank = {'version':'synthetic-only', 'subjects':[], 'sources':[self.source], 'knowledgePoints':[],
                     'memoryQuestions':[self.q], 'predictions':[]}
        self.artifact = {'format':'independent-question-review-v1', 'scope':'whole-question', 'completed':True,
                         'author':'synthetic-author','reviewer':'synthetic-other-reviewer','completed_at':'2026-10-03T00:00:00Z',
                         'reviews':[{'question_id':self.q['id'], 'decision':'passed', 'question_snapshot':copy.deepcopy(self.q),
                                     'source_snapshots':{'synthetic-source':copy.deepcopy(self.source)},
                                     'note_snapshots':{'synthetic-note':copy.deepcopy(self.notes['records'][0])},
                                     'document_sha256':{'synthetic.docx':self.documents['documents'][0]['sha256']},
                                     'checks':{k:{'status':'passed','evidence':'Synthetic protocol fixture judgment only, no real question reviewed.'} for k in CHECKS}}]}
        self.write_artifact()

    def tearDown(self): self.temp.cleanup()

    def write_artifact(self):
        raw=json.dumps(self.artifact,ensure_ascii=False).encode();(self.root/'evidence.json').write_bytes(raw)
        self.index={'format':'question-review-index-v1','records':[{'question_id':self.q['id'],'artifact':'evidence.json','sha256':hashlib.sha256(raw).hexdigest()}]}

    def run_gate(self): return validate(self.bank,self.index,self.root,self.notes,self.documents)

    def test_pass_and_python_browser_hash_agreement(self):
        report,proofs=self.run_gate(); self.assertTrue(report['passed'])
        bank=copy.deepcopy(self.bank);bank['questionReviews']=proofs;bank['practiceRelease']={k:v for k,v in report.items() if k!='failures'}
        # Half marks, Unicode, integers and decimals must bind identically without editing content.
        payload={'bank':bank,'notes':self.notes,'documents':self.documents,'hash_fixture':{'unicode':'中文😀','n':[0.5,0,1,1e-7,1e-20],'bool':True,'null':None}}
        fixture=self.root/'fixture.json';fixture.write_text(json.dumps(payload,ensure_ascii=False))
        code="""globalThis.crypto=require('node:crypto').webcrypto;const assert=require('node:assert/strict'),a=require('./learning/subject-package.js');const p=JSON.parse(require('fs').readFileSync(process.argv[1]));(async()=>{
        const r=await a.auditQuestionReviews(p.bank,{notes:p.notes,documents:p.documents});assert(r.accepted.has(p.bank.memoryQuestions[0]));
        for(const [key,value] of [['prompt','changed'],['answer',[1]],['plain_explanation','changed'],['scoring',{total:1}],['variations',['changed']]]){const b=structuredClone(p.bank);b.memoryQuestions[0][key]=value;const x=await a.auditQuestionReviews(b);assert(!x.complete&&!x.accepted.has(b.memoryQuestions[0]));}
        const changedSource=structuredClone(p.bank);changedSource.sources[0].version='2';assert(!(await a.auditQuestionReviews(changedSource)).complete);
        const statusOnly=structuredClone(p.bank);delete statusOnly.questionReviews;assert.equal((await a.auditQuestionReviews(statusOnly)).passed,0);
        const missingCertificate=structuredClone(p.bank);delete missingCertificate.practiceRelease;assert.equal((await a.auditQuestionReviews(missingCertificate)).passed,0);
        const limited=structuredClone(p.bank);limited.questionReviews[0].scope='source-only';assert.equal((await a.auditQuestionReviews(limited)).passed,0);
        const changedNote=structuredClone(p.notes);changedNote.records[0].text='changed';assert(!(await a.auditQuestionReviews(p.bank,{notes:changedNote,documents:p.documents})).complete);
        const changedDoc=structuredClone(p.documents);changedDoc.documents[0].sha256='0'.repeat(64);assert(!(await a.auditQuestionReviews(p.bank,{notes:p.notes,documents:changedDoc})).complete);
        console.log(JSON.stringify({passed:r.passed,complete:r.complete,hash:await a.reviewHash(p.hash_fixture)}))})();"""
        actual=json.loads(subprocess.check_output([os.environ.get('NODE_EXECUTABLE','node'),'-e',code,str(fixture)],cwd=Path(__file__).resolve().parents[1]))
        self.assertEqual(actual,{'passed':1,'complete':True,'hash':digest(payload['hash_fixture'])})

    def test_status_only_fails(self):
        self.index['records']=[];report,_=self.run_gate();self.assertFalse(report['passed']);self.assertEqual(report['active_questions'],1)

    def test_legacy_component_chain_is_re_read(self):
        linked=self.root/'legacy.json';linked.write_text('{"synthetic":"old component"}')
        self.artifact['provenance_mode']='composed-legacy-reviews'
        self.artifact['legacy_evidence_chain']=[{'artifact':'legacy.json','sha256':hashlib.sha256(linked.read_bytes()).hexdigest(),
                                                'scope':'synthetic original whole-question review','record_locator':'$.synthetic'}]
        self.write_artifact();self.assertTrue(self.run_gate()[0]['passed'])
        linked.write_text('{"synthetic":"changed"}');self.assertFalse(self.run_gate()[0]['passed'])
        self.artifact['legacy_evidence_chain']=[];self.write_artifact();self.assertFalse(self.run_gate()[0]['passed'])

    def test_limited_review_and_self_review_fail(self):
        for field,value in [('scope','sources-only'),('scope','variants-only'),('reviewer','synthetic-author'),('completed',False)]:
            old=self.artifact[field];self.artifact[field]=value;self.write_artifact()
            self.assertFalse(self.run_gate()[0]['passed']);self.artifact[field]=old

    def test_each_current_semantic_change_invalidates(self):
        for field,value in [('prompt','changed'),('answer',[1]),('plain_explanation','changed'),('scoring',{'total':1}),('variations',['changed']),('note_refs',[{'locator':'changed'}])]:
            old=self.q[field];self.q[field]=value;self.assertFalse(self.run_gate()[0]['passed']);self.q[field]=old
        self.source['version']='2';self.assertFalse(self.run_gate()[0]['passed'])

    def test_current_note_and_word_versions_invalidate(self):
        self.notes['records'][0]['text']='changed';self.assertFalse(self.run_gate()[0]['passed'])
        self.notes['records'][0]['text']='Synthetic note only';self.documents['documents'][0]['sha256']='0'*64
        with self.assertRaisesRegex(ValueError,'Word bytes'): self.run_gate()

    def test_artifact_changes_and_incomplete_dimensions_fail(self):
        (self.root/'evidence.json').write_text('{}');self.assertFalse(self.run_gate()[0]['passed']);self.write_artifact()
        del self.artifact['reviews'][0]['checks']['scoring'];self.write_artifact();self.assertFalse(self.run_gate()[0]['passed'])

    def test_disabled_navigation_retained_but_not_counted(self):
        self.bank['memoryQuestions'].append({'id':'synthetic-navigation','practice_enabled':False,'duplicate_of':self.q['id']})
        report,proofs=self.run_gate();self.assertTrue(report['passed']);self.assertEqual(report['disabled_questions'],1);self.assertEqual(len(proofs),1)

    def test_traversal_and_duplicate_index_fail(self):
        self.index['records'][0]['artifact']='../evidence.json';self.assertFalse(self.run_gate()[0]['passed'])
        self.index['records'].append(copy.deepcopy(self.index['records'][0]))
        with self.assertRaises(ValueError):self.run_gate()

    def test_reviewed_build_cannot_bypass_evidence_gate(self):
        review={'status':'reviewed','scope':'Synthetic fixture only','limitations':['No real content accepted']}
        with self.assertRaisesRegex(ValueError,'independent evidence'):build('psychology','fixture',self.bank,self.notes,self.documents,review,self.root/'bad.zip')
        build('psychology','fixture',self.bank,self.notes,self.documents,review,self.root/'valid.zip',self.index,self.root)
        self.q['answer']=[1]
        with self.assertRaisesRegex(ValueError,'gate failed'):build('psychology','fixture',self.bank,self.notes,self.documents,review,self.root/'stale.zip',self.index,self.root)
        self.assertFalse((self.root/'stale.zip').exists())

if __name__=='__main__': unittest.main()
