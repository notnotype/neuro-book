import {createGrid} from '../../../../../../packages/nb-ui/src/components/layout/grid.ts';
let seed=0x4e424f4f;
const rand=(n)=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
for(let trial=0;trial<10000;trial++){
 const axis=trial%2?'height':'width',cross=axis==='width'?'height':'width',count=2+rand(6),sash=rand(8);
 const children=Array.from({length:count},(_,i)=>{
  const low=rand(101),high=low+rand(401),weight=rand(201);
  return {kind:'leaf',id:'n'+i,ref:'r'+i,size:{[axis]:weight,[cross]:100},minimumSize:{[axis]:low,[cross]:0},maximumSize:{[axis]:high,[cross]:1000}};
 });
 const lows=children.reduce((s,n)=>s+n.minimumSize[axis],0),highs=children.reduce((s,n)=>s+n.maximumSize[axis],0),available=lows+rand(highs-lows+1);
 const root={kind:'branch',id:'root',orientation:axis==='width'?'horizontal':'vertical',children};
 const grid=createGrid(root,{sashSize:sash}),before=JSON.stringify(grid.serialize()),container={[axis]:available+sash*(count-1),[cross]:100},result=grid.layout(container);
 const reverse=createGrid({...root,children:[...children].reverse()},{sashSize:sash}).layout(container);
 let problem=Math.abs(result.sizes.root[axis]-container[axis])>1e-4 || before!==JSON.stringify(grid.serialize());
 for(const child of children){
  const value=result.sizes[child.id][axis];
  problem ||= !Number.isFinite(value)||value<child.minimumSize[axis]-1e-4||value>child.maximumSize[axis]+1e-4||Math.abs(value-reverse.sizes[child.id][axis])>1e-4;
 }
 if(problem){console.log(JSON.stringify({trial,container,children,result,reverse}));process.exit(1);}
}
console.log('10000 seeded feasible layouts: both axes, sash conservation, constraints, order independence and unchanged intent passed');
