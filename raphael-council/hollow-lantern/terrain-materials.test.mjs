import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {loadHollowLanternMaterials} from './terrain-materials.mjs';
function fixture(t){const root=mkdtempSync(join(tmpdir(),'lantern-material-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF9sAAAAASUVORK5CYII=','base64');writeFileSync(join(root,'wood.png'),bytes);const entry={sceneId:'briefing',terrain:'floor',approved:true,purpose:'material-only',file:'wood.png',sha256:createHash('sha256').update(bytes).digest('hex')};const path=join(root,'materials.json');return {root,entry,bytes,load(entries=[entry]){writeFileSync(path,JSON.stringify({version:1,kind:'terrain-materials',entries}));return loadHollowLanternMaterials(path);}};}
test('approved material maps only its explicit scene and terrain',t=>{const f=fixture(t);assert.deepEqual(f.load(),{briefing:{floor:f.bytes}});});
test('unapproved, mismatched and mechanical material entries reject',t=>{const f=fixture(t);for(const override of [{approved:false},{sha256:'0'.repeat(64)},{terrain:'wall'},{terrain:'cover'},{purpose:'map-background'},{sceneId:'invented'},{file:'../outside.png'}])assert.throws(()=>f.load([{...f.entry,...override}]));assert.throws(()=>f.load([f.entry,f.entry]));});

test('verified bytes remain pinned when the source file changes',t=>{const f=fixture(t),assets=f.load();writeFileSync(join(f.root,'wood.png'),Buffer.from('replaced'));assert.deepEqual(assets.briefing.floor,f.bytes);assert.throws(()=>f.load());});