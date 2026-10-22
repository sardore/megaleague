import {test,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {SessionScope} from '../../src/online/scope.js';
import {sessionRuntime} from '../../src/online/session-model.js';
let session,scope;
beforeEach(()=>{
  session={generation:7,sessionToken:'session-7'};
  sessionRuntime.activeSession=session;
  sessionRuntime.counters={staleCallbackDropCount:0};
  scope=new SessionScope(session);
});
test('a queued callback cannot act on a replacement session',()=>{
  let invoked=0;
  const callback=scope.guard(scope.capture('old-input'),()=>invoked++);
  sessionRuntime.activeSession={generation:8,sessionToken:'session-8'};
  assert.equal(callback(),false);
  assert.equal(invoked,0);
  assert.equal(sessionRuntime.counters.staleCallbackDropCount,1);
});
test('phase transitions cancel phase work and retain session work',()=>{
  let cancelled=0;
  const phaseKey={},sessionKey={};
  scope.resources.set(phaseKey,{kind:'listener',phase:'ENTRY',cancel:()=>cancelled++});
  scope.resources.set(sessionKey,{kind:'listener',phase:'SESSION',cancel:()=>cancelled++});
  const oldPhase=scope.capture('entry-work');
  const wholeSession=scope.capture('chat','SESSION');
  scope.transitionPhase('IN_BATTLE');
  assert.equal(cancelled,1);
  assert.equal(scope.valid(oldPhase),false);
  assert.equal(scope.valid(wholeSession),true);
  assert.equal(scope.resources.has(sessionKey),true);
});
test('closing cancels every resource once and invalidates pending work',()=>{
  let cancelled=0;
  scope.resources.set('socket',{phase:'SESSION',cancel:()=>cancelled++});
  scope.resources.set('animation',{phase:'IN_BATTLE',cancel:()=>cancelled++});
  const captured=scope.capture('late-ack','SESSION');
  assert.equal(scope.close(),true);
  assert.equal(scope.close(),false);
  assert.equal(cancelled,2);
  assert.equal(scope.valid(captured),false);
  assert.equal(scope.resources.size,0);
  assert.equal(scope.abortController.signal.aborted,true);
});
test('a session token change invalidates a captured command',()=>{
  const captured=scope.capture('command','SESSION');
  session.sessionToken='different-room';
  assert.equal(scope.valid(captured),false);
});
