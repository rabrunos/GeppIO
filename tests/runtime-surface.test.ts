import test from 'node:test'
import assert from 'node:assert/strict'
import { CapabilityRuntime } from '@geppio/runtime'
import { SurfaceBroker } from '@geppio/runtime/broker'
import type { Principal } from '@geppio/runtime/broker'
import type { Delivery, PeerEndpoint } from '@geppio/plugin-sdk'
test('registration is inert; selected dependencies are shared and disposed in reverse; failed additions unwind', () => {
  const events: string[] = []
  const start = (id: string) => () => { events.push(id); return () => { events.push('-'+id) } }
  const runtime = new CapabilityRuntime({ editor: { start: start('editor') }, panel: { requires:['editor'], start:start('panel') },
    terminal:{ start:start('terminal') }, broken:{requires:['terminal'], start:() => {throw new Error('activation')} } })
  assert.deepEqual(events,[])
  runtime.activate(['panel','editor']); runtime.activate(['panel'])
  assert.deepEqual(runtime.active,['editor','panel'])
  assert.throws(() => runtime.activate(['broken'])); assert.deepEqual(runtime.active,['editor','panel'])
  runtime.dispose(); runtime.dispose()
  assert.deepEqual(events,['editor','panel','terminal','-terminal','-panel','-editor'])
})
test('supervised endpoint binds caller, version, grants, cancellation, late replies and generation teardown', () => {
  const broker = new SurfaceBroker(), sent: Delivery[] = [], received: Delivery[] = []
  const endpoint: PeerEndpoint = { provider:'provider',kind:'command',name:'run',version:1 }
  const provider: Principal = { id:'provider',generation:'p',contract:{ html:'',css:'',offers:[endpoint],uses:[] } }
  const client: Principal = { id:'client',generation:'a',contract:{ html:'',css:'',offers:[],uses:[endpoint] } }
  const a = broker.attach(provider,true,message=>sent.push(message)), b = broker.attach(client,true,message=>received.push(message))
  const call = {v:1,op:'call',id:1,endpoint,value:'value'}
  b.receive(call); assert.deepEqual(received.pop()?.outcome,{ok:false,error:'denied'})
  b.receive({...call,endpoint:{...endpoint,version:2}}); assert.deepEqual(received.pop()?.outcome,{ok:false,error:'incompatible'})
  assert.ok(broker.grant(client,endpoint,true))
  b.receive({...call,caller:'provider'}); assert.equal(sent.length,0)
  b.receive(call); assert.equal(sent.at(-1)?.from,'client')
  b.receive({v:1,op:'reply',id:sent.at(-1)?.id,ok:true,value:'wrong'}); assert.equal(received.length,0)
  b.receive({v:1,op:'cancel',id:1}); assert.deepEqual(received.pop()?.outcome,{ok:false,error:'cancelled'})
  a.receive({v:1,op:'reply',id:sent[0]!.id,ok:true,value:'late'}); assert.equal(received.length,0)
  b.receive(call); a.receive({v:1,op:'reply',id:sent.at(-1)?.id,ok:true,value:'done'})
  assert.deepEqual(received.pop()?.outcome,{ok:true,value:'done'})
  b.receive(call); a.close(); assert.deepEqual(received.pop()?.outcome,{ok:false,error:'unavailable'})
  b.receive(call); assert.deepEqual(received.pop()?.outcome,{ok:false,error:'unavailable'})
  const next = broker.attach({...provider,generation:'new'},true,()=>{})
  a.receive(call); b.receive(call); assert.deepEqual(received.pop()?.outcome,{ok:false,error:'denied'})
  b.close(); next.close(); b.receive(call); assert.equal(received.length,0)
})
