import {describe,it,expect} from 'vitest';
import {isEmptyCodexComposer} from '@/lib/tmux';
describe('empty composer observation',()=>{
 const screen='2,2\nold output\n\n› Ask Codex to do anything\n\n  GPT model\n  ? for shortcuts\n2,2\n';
 it('recognizes the observed empty layout',()=>expect(isEmptyCodexComposer(screen)).toBe(true));
 it.each([screen.replace('› Ask Codex to do anything','› old raw input'),screen.replaceAll('2,2','20,2'),screen.replace('shortcuts','unknown'),screen.replace('2,2\nold','3,2\nold'),screen.replace('› Ask Codex to do anything','› [Pasted Content 3 chars]'),''])('closes unknown/draft/moving cursor',s=>expect(isEmptyCodexComposer(s)).toBe(false));
});
