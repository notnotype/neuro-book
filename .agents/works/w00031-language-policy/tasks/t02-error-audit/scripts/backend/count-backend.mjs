import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import {createRequire} from 'node:module';
const root='/home/<user>/CodeRepository/neuro-book/.worktree/audit-w00031-t02';
const out='/tmp/w00031-review/t02-audit/lab-backend';
const require=createRequire(root+'/package.json');
const ts=require('typescript');
const all=cp.execFileSync('/usr/bin/git',['ls-files'],{cwd:root,encoding:'utf8'}).trimEnd().split('\n');
const whole=new Set(['nb-runtime','nb-harness','nb-session','nb-profile','nb-workflow','nb-history','nb-memory','owned-process','file-snapshot-cache']);
function owned(p){const [base,pkg,...rest]=p.split('/');const r=rest.join('/');if(base!=='packages')return false;if(whole.has(pkg))return true;if(['nb-story','dev-panel'].includes(pkg))return !r.startsWith('src/web/');if(pkg!=='neuro-book')return false;return /^src\/(server|backend|project|cli|shared|plugin-platform)\//.test(r)||/^src\/plugins\/[^/]+\/(backend|shared)\//.test(r)||(/^plugin-sdk\//.test(r)&&!r.startsWith('plugin-sdk/examples/'))||r.startsWith('scripts/');}
const files=all.filter(owned).sort();
const code=files.filter(p=>/\.(?:tsx?|jsx?|mjs|cjs|vue)$/.test(p));
const support=p=>/(^|\/)(tests?|testing|fixtures?|e2e|benchmarks?)(\/|\.)|\.(?:test|spec|e2e)\./.test(p);
const production=code.filter(p=>!support(p));
for(const [name,list] of [['owned-files',files],['code-files',code],['production-files',production]])fs.writeFileSync(out+'/'+name+'.txt',list.join('\n')+'\n');
const han=/\p{Script=Han}/u;
const hanGlobal=/\p{Script=Han}/gu;
const candidates=[];const classes=[];const raws=[];
for(const file of production){
 const text=fs.readFileSync(path.join(root,file),'utf8');
 const rawLines=text.split('\n').flatMap((s,i)=>han.test(s)?[{line:i+1,text:s}]:[]);
 raws.push({file,lines:rawLines.length,matches:[...text.matchAll(hanGlobal)].length});
 const source=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,file.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
 const units=new Map();
 const loc=n=>source.getLineAndCharacterOfPosition(n.getStart(source));
 const walk=n=>{
  if(ts.isClassDeclaration(n)&&n.heritageClauses?.some(h=>h.types.some(t=>/Error/.test(t.expression.getText(source))))){const p=loc(n);classes.push({file,line:p.line+1,name:n.name?.text??'<anonymous>',declaration:n.getText(source)});}
  if((ts.isStringLiteral(n)||ts.isNoSubstitutionTemplateLiteral(n)||ts.isTemplateExpression(n))&&han.test(n.getText(source))){
   let parent=n;while(parent&&!ts.isCallExpression(parent)&&!ts.isNewExpression(parent))parent=parent.parent;
   if(parent){
    const key=parent.getStart(source);const p=loc(parent);const item=units.get(key)??{file,line:p.line+1,column:p.character+1,endLine:source.getLineAndCharacterOfPosition(parent.end).line+1,callee:parent.expression.getText(source),kind:ts.isNewExpression(parent)?'new':'call',snippets:[],expression:parent.getText(source)};
    item.snippets.push(n.getText(source));units.set(key,item);
   }
  }
  ts.forEachChild(n,walk);
 };walk(source);
 for(const row of units.values()){row.key=`${row.file}:${row.line}:${row.column}`;candidates.push(row);}
}
fs.writeFileSync(out+'/raw-counts.json',JSON.stringify(raws,null,2)+'\n');
fs.writeFileSync(out+'/candidates.jsonl',candidates.map(x=>JSON.stringify(x)).join('\n')+'\n');
fs.writeFileSync(out+'/error-classes.json',JSON.stringify(classes,null,2)+'\n');
const counts={baseline:cp.execFileSync('/usr/bin/git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),files:files.length,codeFiles:code.length,productionFiles:production.length,rawHanLines:raws.reduce((n,r)=>n+r.lines,0),rawHanCharacters:raws.reduce((n,r)=>n+r.matches,0),callBoundaryCandidates:candidates.length,errorClasses:classes.length,perPackage:{}};
for(const file of production){const pkg=file.split('/')[1];counts.perPackage[pkg]??={files:0,rawHanLines:0,candidates:0};counts.perPackage[pkg].files++;}
for(const row of raws)counts.perPackage[row.file.split('/')[1]].rawHanLines+=row.lines;
for(const row of candidates)counts.perPackage[row.file.split('/')[1]].candidates++;
fs.writeFileSync(out+'/counts.json',JSON.stringify(counts,null,2)+'\n');
console.log(JSON.stringify(counts,null,2));
