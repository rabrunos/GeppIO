import test from 'node:test'
import assert from 'node:assert/strict'
import { initialWorkbench, modelId, groupFor, activePlacements } from '../src/shared/workbench/model.ts'
import type { Registry, WidgetType } from '../src/shared/workbench/model.ts'
import { groupTransferPlan, detachWidget, validateGroups } from '../src/shared/workbench/groups.ts'
import { moveView, configureBar, deleteBar } from '../src/shared/workbench/commands.ts'
import { serializeWorkbench, parseWorkbench } from '../src/shared/workbench/codec.ts'
import { captureComposition, applyComposition } from '../src/shared/workbench/compositions.ts'
import { readWorkbench } from '../src/shared/workbench/storage.ts'
import { WORKBENCH_KEY } from '../src/shared/workbench/model.ts'
const ids = ['a','b','c','d','e'].map(id => `host:${id}:view:main`)
// Controlled host declarations exist only in this fixture; real plugin eligibility is unchanged.
function fixture(eligible: number[], hosts = [0,1,2,3,4]) {
  const registry: Registry = new Map(ids.map((id, i) => [`host:${'abcde'[i]}`, { id: `host:${'abcde'[i]}`, owner:'host', fixture:'abcde'[i], title:id, category:'fixture', description:'fixture', appearance:'card', presence:'single-view', tabHost:hosts.includes(i), tabMember:true, constraint:{min:{width:100,height:100},max:{width:4096,height:4096},default:{width:200,height:200},regionMin:{sidebar:{width:150,height:100},bottom:{width:100,height:80}},regions:['main','sidebar',...(eligible.includes(i)?['bottom']:[])],resizeX:true,resizeY:true,overflow:'auto',responsive:'region'} } as WidgetType]))
  const source = initialWorkbench(); source.reference = { main:{width:1800,height:1200},sidebar:{width:250,height:1000},bottom:{width:1800,height:180} }
  source.organization.views = ids.map((id,i)=>({id,typeId:`host:${'abcde'[i]}`,modelId:modelId(`host:${'abcde'[i]}`)}))
  source.placements = [{id:ids[0]!,region:'main',x:0,y:0,width:300,height:300,preferred:{width:300,height:300}}]
  source.organization.groups = {version:1,entries:[{id:'group:00000000-0000-4000-8000-000000000000',frameId:ids[0]!,members:[...ids],active:ids[3]!}]}
  return {source,registry}
}
for (const eligible of [[2,3,4],[1,2,3,4],[3],[0,1,2,3,4],[]]) test(`regional split plan and atomic placement: 5 -> ${eligible.length}/${5-eligible.length}`,()=>{
  const {source,registry}=fixture(eligible), before=structuredClone(source), plan=groupTransferPlan(source,registry,ids[0]!,'bottom')!
  assert.deepEqual(plan.going,eligible.map(i=>ids[i])); assert.deepEqual(plan.staying,ids.filter(id=>!plan.going.includes(id)))
  const result=moveView(source,registry,ids[0]!,{...source.reference.bottom,region:'bottom',expanded:false},{x:800,y:0})
  if (!eligible.length) { assert.equal(result,null); assert.deepEqual(source,before); return }
  assert.ok(result); assert.deepEqual(result.organization.views,source.organization.views); assert.deepEqual(source,before)
  const moved=result.placements.find(p=>p.region==='bottom')!, stayed=result.placements.find(p=>p.region==='main')
  assert.equal(moved.id,plan.destinationFrame); assert.deepEqual(groupFor(result,moved.id)?.members??[moved.id],plan.going)
  assert.equal(groupFor(result,moved.id)?.active??moved.id,plan.going.includes(ids[3]!)?ids[3]:plan.going[0])
  if(plan.staying.length) { assert.ok(stayed); assert.equal(stayed.id,plan.sourceFrame); assert.deepEqual([stayed.x,stayed.y,stayed.width,stayed.height],[0,0,300,300]); assert.deepEqual(groupFor(result,stayed.id)?.members??[stayed.id],plan.staying); assert.equal(groupFor(result,stayed.id)?.active??stayed.id,plan.staying.includes(ids[3]!)?ids[3]:plan.staying[0]) }
  validateGroups(result,registry); assert.deepEqual(parseWorkbench(serializeWorkbench(result,registry),registry).organization.groups,result.organization.groups)
  if(plan.going.length>=2) { const reverse=moveView(result,registry,moved.id,{...result.reference.main,region:'main',expanded:false},{x:800,y:400})!; assert.ok(reverse); assert.equal(reverse.placements.some(p=>p.region==='bottom'),false); assert.deepEqual(groupFor(reverse,moved.id)!.members,plan.going) }
})
test('partitions refuse insufficient room and missing hosts without partial edits',()=>{
  const {source,registry}=fixture([2,3,4]), before=JSON.stringify(source)
  assert.equal(moveView(source,registry,ids[0]!,{region:'bottom',width:90,height:180,expanded:false}),null)
  assert.equal(moveView(source,registry,ids[0]!,{region:'bottom',width:1800,height:105,expanded:false}),null)
  assert.equal(JSON.stringify(source),before)
  for(const [eligible,hosts] of [[[2,3,4],[0,1]],[[0,1,2],[0]]]) { const f=fixture(eligible!,hosts!); assert.equal(groupTransferPlan(f.source,f.registry,ids[0]!,'bottom')!.allowed,false); assert.equal(moveView(f.source,f.registry,ids[0]!,{region:'bottom',width:1800,height:180,expanded:false}),null) }
})
test('Home/custom Sidebar groups own one packed frame, detach and bar metadata keep identities',()=>{
  const {source,registry}=fixture([0,1,2,3,4]), sidebar={...source.reference.sidebar,region:'sidebar' as const,expanded:false}
  const home=moveView(source,registry,ids[0]!,sidebar)!
  assert.ok(home); assert.equal(activePlacements(home).filter(p=>p.region==='sidebar').length,1); assert.equal(home.organization.bars[0]!.members.length,5)
  assert.deepEqual(parseWorkbench(serializeWorkbench(home,registry),registry).organization.groups,home.organization.groups)
  const next=structuredClone(home); next.organization.bars.push({id:'bar:custom',name:'Custom',icon:'widgets',userNamed:true,archived:false,members:[]}); next.organization.activeBar='bar:custom'
  const custom=moveView(next,registry,ids[0]!,sidebar,undefined,'home')!
  assert.ok(custom); assert.equal(custom.organization.bars[0]!.members.length,0); assert.equal(custom.organization.bars[1]!.members.length,5)
  const renamed=configureBar(custom,registry,{...custom.organization.bars[1]!,name:'Renamed'},sidebar)!
  assert.ok(renamed); assert.deepEqual(renamed.organization.groups,custom.organization.groups)
  const detached=detachWidget(custom,registry,ids[3]!)!
  assert.ok(detached); const stack=activePlacements(detached).filter(p=>p.region==='sidebar'); assert.equal(stack.length,2); assert.equal(stack[1]!.y,stack[0]!.height+10)
  assert.deepEqual(detached.organization.views,source.organization.views); assert.doesNotThrow(()=>serializeWorkbench(detached,registry))
  const archived=structuredClone(custom); archived.organization.activeBar='home'; archived.organization.bars[1]!.archived=true
  assert.equal(deleteBar(archived,'bar:custom')!.organization.groups!.entries.length,0)
  const shared=structuredClone(custom); shared.organization.bars[0]!.members=['host:a']; const saved=JSON.stringify(shared)
  assert.equal(moveView(shared,registry,ids[0]!,{...source.reference.main,region:'main',expanded:false},undefined,'bar:custom'),null); assert.equal(JSON.stringify(shared),saved)
})
test('Bottom compositions retain groups and omitted Main; old Main-only metadata loads unchanged',()=>{
  const {source,registry}=fixture([2,3,4]), old=serializeWorkbench(source,registry)
  let writes=0; const storage={getItem:(key:string)=>key===WORKBENCH_KEY?old:null,setItem:()=>{writes++}}
  const loaded=readWorkbench(storage,registry); assert.equal(loaded.recovery,false); assert.deepEqual(loaded.snapshot.organization.groups,source.organization.groups); assert.equal(writes,0); assert.equal(loaded.raw,old)
  const split=moveView(source,registry,ids[0]!,{...source.reference.bottom,region:'bottom',expanded:false})!
  const composition=captureComposition(split,'Bottom','format-widgets',['bottom']), frame=split.placements.find(p=>p.region==='bottom')!
  assert.equal(composition.groups!.entries.length,1); assert.equal(composition.views.length,3)
  const cleared=structuredClone(split); cleared.placements=cleared.placements.filter(p=>p.region!=='bottom'); cleared.organization.groups!.entries=cleared.organization.groups!.entries.filter(g=>g.frameId!==frame.id)
  const restored=applyComposition(cleared,registry,composition,'widgets')!
  assert.ok(restored); assert.deepEqual(restored.organization.groups!.entries,split.organization.groups!.entries); assert.doesNotThrow(()=>serializeWorkbench(restored,registry))
})
