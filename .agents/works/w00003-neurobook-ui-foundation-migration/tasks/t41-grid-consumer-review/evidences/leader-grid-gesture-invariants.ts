import {createGrid} from '../../../../../../packages/nb-ui/src/components/layout/grid.ts';
let seed=0x4e424752;
const rand=(n)=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
for(let trial=0;trial<3000;trial++){
 const count=2+rand(5),axis=trial%2?'height':'width',cross=axis==='width'?'height':'width',sash=rand(4);
 const children=Array.from({length:count},(_,i)=>{const low=rand(41);return {kind:'leaf',id:'n'+i,ref:'r'+i,size:{[axis]:rand(101),[cross]:100},minimumSize:{[axis]:low,[cross]:0},maximumSize:{[axis]:low+20+rand(201),[cross]:1000}}});
 const lows=children.reduce((s,c)=>s+c.minimumSize[axis],0),highs=children.reduce((s,c)=>s+c.maximumSize[axis],0),available=lows+rand(highs-lows+1);
 const grid=createGrid({kind:'branch',id:'root',orientation:axis==='width'?'horizontal':'vertical',children},{sashSize:sash}),container={[axis]:available+sash*(count-1),[cross]:100},layout=grid.layout(container);
 const baseline=Object.fromEntries(children.map(c=>[c.id,layout.sizes[c.id][axis]])),target={...baseline},i=rand(count),j=(i+1+rand(count-1))%count;
 const grow=Math.min(children[i].maximumSize[axis]-target[children[i].id],target[children[j].id]-children[j].minimumSize[axis]),delta=Math.max(0,grow)*0.37;
 target[children[i].id]+=delta;target[children[j].id]-=delta;
 const result=grid.resizeBranch('root',axis,baseline,target),actual=grid.layout(container);
 if(!result.ok||children.some(c=>Math.abs(actual.sizes[c.id][axis]-target[c.id])>1e-4)){console.log(JSON.stringify({trial,children,container,baseline,target,result,actual}));process.exit(1);}
}
console.log('3000 seeded legal branch gestures reproduce the complete target on both axes with constrained siblings');
