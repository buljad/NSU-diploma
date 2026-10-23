import test from 'node:test';
import assert from 'node:assert/strict';
import { StabilogramClient } from '../packages/client/src/lib/websocket/client';
import type { StabilogramSample } from '../packages/shared/src/types';

function sample(deviceTime:number,serverTime:number):StabilogramSample {
  return {sensors:{d1:100,d2:100,d3:100,d4:100},raw:{x:0,y:0,z:0,f:400},centered:{x:0,y:0,z:0,f:400},filtered:{x:0,y:0,z:0,f:400},mm:{x:0,y:0},deviceTime,serverTime,clientTime:serverTime,packetNumber:deviceTime,isValid:true};
}
function setup(){
  const client=new StabilogramClient(),samples:StabilogramSample[]=[],calibrations:unknown[]=[],errors:unknown[]=[];
  client.setStore({processSample:s=>samples.push(s),setWsConnected:()=>{},setDeviceConnected:()=>{},setCalibration:c=>calibrations.push(c),setAxisConfig:()=>{},setConnectionDetails:()=>{}});
  client.on('ERROR',error=>errors.push(error));
  const receive=(message:unknown)=>(client as unknown as {handleMessage:(text:string)=>void}).handleMessage(JSON.stringify(message));
  return {samples,calibrations,errors,receive};
}

test('coalesced serial batch preserves 100 Hz device intervals even when server milliseconds coincide',()=>{
  const {samples,receive}=setup();receive({type:'DATA_BATCH',data:[sample(100,1000),sample(110,1000),sample(120,1000)]});
  assert.equal(samples.length,3);assert.equal(samples[1].clientTime-samples[0].clientTime,10);assert.equal(samples[2].clientTime-samples[1].clientTime,10);
  assert.deepEqual(samples.map(s=>s.deviceTime),[100,110,120]);
});
test('server intervals are retained when device clock does not increase, without inventing 50 Hz',()=>{
  const {samples,receive}=setup();receive({type:'DATA_BATCH',data:[sample(0,1000),sample(0,1013),sample(0,1030)]});
  assert.equal(samples[1].clientTime-samples[0].clientTime,13);assert.equal(samples[2].clientTime-samples[1].clientTime,17);
});
test('missing sensor/vector fields do not enter recording or display and a later valid sample works',()=>{
  const {samples,errors,receive}=setup();receive({type:'DATA',data:{...sample(1,1000),sensors:{}}});receive({type:'DATA',data:{...sample(2,1001),raw:{}}});receive({type:'DATA',data:sample(3,1002)});
  assert.equal(samples.length,1);assert.equal(errors.length,2);
});
test('physical reconnect refreshes calibration snapshot and clears incompatible stale calibration',()=>{
  const {calibrations,receive}=setup();const calibration={sensorOffsets:{d1:1,d2:2,d3:3,d4:4},platformSize:{width:300,height:300},sensorDistance:{x:260,y:260},timestamp:1000,sampleCount:200,isValid:true};
  receive({type:'SERIAL_CONNECTED',testMode:false,port:'COM3',calibrated:true,calibration});receive({type:'SERIAL_CONNECTED',testMode:false,port:'COM4',calibrated:false,calibration:null});
  assert.deepEqual(calibrations,[calibration,null]);
});
