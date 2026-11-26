import {describe,it,expect} from 'vitest';
import {isEmptyCodexComposer, emptyCodexComposer} from '@/lib/tmux';
describe('ambiguous composer observation',()=>{
 const screen='2,2\nold output\n\n› Ask Codex to do anything\n\n  GPT model\n  ? for shortcuts\n2,2\n';
 it.each([
  ['empty placeholder or literal placeholder draft plus Home',screen],
  ['ordinary draft',screen.replace('› Ask Codex to do anything','› old raw input')],
  ['multiline draft',screen.replace('\n\n  GPT','\nsecond draft line\n  GPT')],
  ['cursor at end',screen.replaceAll('2,2','26,2')],
  ['moving cursor',screen.replace('2,2\nold','3,2\nold')],
  ['colored placeholder',screen.replace('Ask Codex to do anything','\x1b[2mAsk Codex to do anything\x1b[0m')],
  ['unknown',''],
 ])('refuses %s',(_label,s)=>expect(isEmptyCodexComposer(s)).toBe(false));
 it('refuses structural emptiness claims without touching a runtime',async()=>{
  expect(await emptyCodexComposer('nonexistent-fixture-session')).toBe(false);
 });
});
