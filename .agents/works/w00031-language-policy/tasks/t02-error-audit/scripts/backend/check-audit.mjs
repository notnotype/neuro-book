import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const root='/home/<user>/CodeRepository/neuro-book/.worktree/audit-w00031-t02';
const dir='/tmp/w00031-review/t02-audit/lab-backend';
const reportPath='/tmp/w00031-review/t02-audit/report-backend.md';
const report=fs.readFileSync(reportPath,'utf8');
const ts=createRequire(root+'/package.json')('typescript');
const files=fs.readFileSync(dir+'/production-files.txt','utf8').trimEnd().split('\n');
const han=/\p{Script=Han}/u;
const stats={hanLiteralNodes:0,hanLiteralNodesWithCall:0,hanLiteralNodesWithoutCall:0,hanLiteralFilesWithoutCall:0,filesWithParseDiagnostics:[],callKeysUnique:true,classifiedKeysUnique:true,unclassifiedKinds:{},supportScopeCalls:0};
const noCalls=[];
for(const file of files){
 const text=fs.readFileSync(path.join(root,file),'utf8');
 const source=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,file.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
 if(source.parseDiagnostics.length)stats.filesWithParseDiagnostics.push({file,count:source.parseDiagnostics.length});
 const walk=n=>{
  if((ts.isStringLiteral(n)||ts.isNoSubstitutionTemplateLiteral(n)||ts.isTemplateExpression(n))&&han.test(n.getText(source))){
   stats.hanLiteralNodes++;
   let parent=n;while(parent&&!ts.isCallExpression(parent)&&!ts.isNewExpression(parent))parent=parent.parent;
   if(parent)stats.hanLiteralNodesWithCall++;
   else {stats.hanLiteralNodesWithoutCall++;const loc=source.getLineAndCharacterOfPosition(n.getStart(source));noCalls.push({file,line:loc.line+1,column:loc.character+1,kind:ts.SyntaxKind[n.kind],text:n.getText(source)});}
  }
  ts.forEachChild(n,walk);
 };walk(source);
}
stats.hanLiteralFilesWithoutCall=new Set(noCalls.map(r=>r.file)).size;
const candidates=fs.readFileSync(dir+'/candidates.jsonl','utf8').trimEnd().split('\n').map(JSON.parse);
const classified=fs.readFileSync(dir+'/classified-calls.jsonl','utf8').trimEnd().split('\n').map(JSON.parse);
stats.callKeysUnique=new Set(candidates.map(r=>r.key)).size===candidates.length;
stats.classifiedKeysUnique=new Set(classified.map(r=>r.key)).size===classified.length;
stats.supportScopeCalls=candidates.filter(r=>/\/(scripts|demo|docs)\//.test(r.file)).length;
for(const r of classified.filter(r=>r.category==='无法分类')){const k=r.file.includes('/scripts/')?'脚本与验收':r.file.includes('/demo/')?'演示':r.file.includes('/docs/')?'文档站配置':'运行源码或声明';stats.unclassifiedKinds[k]=(stats.unclassifiedKinds[k]??0)+1;}
const overlapPairs=[];
for(let i=0;i<candidates.length;i++)for(let j=i+1;j<candidates.length;j++){const a=candidates[i],b=candidates[j];if(a.file===b.file&&((a.line<=b.line&&a.endLine>=b.endLine)||(b.line<=a.line&&b.endLine>=a.endLine)))overlapPairs.push([a.key,b.key]);}
stats.lineRangeContainmentPairs=overlapPairs.length;
stats.unclassifiedWithoutReason=classified.filter(r=>r.category==='无法分类'&&r.rule===null).length;
stats.unclassifiedRuleGroups={};for(const r of classified.filter(r=>r.category==='无法分类')){const key=r.rule?.split('-')[0]??'unreviewed';stats.unclassifiedRuleGroups[key]=(stats.unclassifiedRuleGroups[key]??0)+1;}
const counts=JSON.parse(fs.readFileSync(dir+'/classification-counts.json','utf8'));
stats.categorySumValid=Object.values(counts.counts).reduce((sum,n)=>sum+n,0)===candidates.length;
stats.packageSumsValid=Object.keys(counts.counts).every(category=>Object.values(counts.perPackage).reduce((sum,row)=>sum+row[category],0)===counts.counts[category]);
fs.writeFileSync(dir+'/line-range-overlaps.json',JSON.stringify(overlapPairs,null,2)+'\n');
fs.writeFileSync(dir+'/unclassified-calls.jsonl',classified.filter(r=>r.category==='无法分类').map(r=>JSON.stringify(r)).join('\n')+'\n');
const section2=report.split('## 二、通道表')[1]?.split('## 三、必查表')[0]??'';
const channels=[...new Set([...section2.matchAll(/^\| `(B-[A-Z0-9-]+)` \|/gm)].map(m=>m[1]))];
const seed='65d9daea06616b8fc8459bc7ef9cb2132cee25ed/backend';
const samples=channels.map(id=>({id,draw:createHash('sha256').update(seed+'/'+id).digest('hex')})).sort((a,b)=>a.draw.localeCompare(b.draw)).slice(0,5);
const headings=[...report.matchAll(/^## (.+)$/gm)].map(m=>m[1]);
const domainIds=[...report.split('## 二、通道表')[0].matchAll(/^\| `([^`]+)` \|/gm)].map(m=>m[1]);if(section2.includes('错误域表补录：`story.ingest-check`'))domainIds.push('story.ingest-check');
const domainSet=new Set(domainIds);
const unknownDomainIds=[...new Set(section2.split('\n').filter(line=>/^\| `B-/.test(line)).flatMap(line=>[...line.split(' | ')[1].matchAll(/\b[a-z][a-z-]*\.[a-z][a-z-]*(?:\.[a-z][a-z-]*)?\b/g)].map(m=>m[0])))].filter(id=>!domainSet.has(id));
const prefix=JSON.parse(fs.readFileSync(dir+'/report-prefix.json','utf8'));
const structural={headings,expectedHeadingsMatch:JSON.stringify(headings)===JSON.stringify(['一、错误域表','二、通道表','三、必查表','四、计数','五、发现']),channelCount:channels.length,channelIdsUnique:channels.length===[...section2.matchAll(/^\| `(B-[A-Z0-9-]+)` \|/gm)].length,errorDomains:domainIds.length,unknownDomainIds,missingChannelDefinitions:[...new Set([...report.matchAll(/`(B-[A-Z0-9-]+)`/g)].map(m=>m[1]))].filter(id=>!channels.includes(id)),existingPrefixUnchanged:createHash('sha256').update(Buffer.from(report).subarray(0,prefix.bytes)).digest('hex')===prefix.sha256,reportBytes:Buffer.byteLength(report),reportLines:report.split('\n').length-1};
fs.writeFileSync(dir+'/literal-without-call.jsonl',noCalls.map(r=>JSON.stringify(r)).join('\n')+'\n');
fs.writeFileSync(dir+'/boundary-counts.json',JSON.stringify(stats,null,2)+'\n');
fs.writeFileSync(dir+'/sample-channels.json',JSON.stringify({seed,algorithm:'SHA-256(seed + / + channelId)，hex 升序前五；通道 ID 去重',channels,samples},null,2)+'\n');
fs.writeFileSync(dir+'/report-check.json',JSON.stringify(structural,null,2)+'\n');
console.log(JSON.stringify({stats,samples,structural},null,2));
if(!stats.callKeysUnique||!stats.classifiedKeysUnique||!stats.categorySumValid||!stats.packageSumsValid||stats.unclassifiedWithoutReason||structural.missingChannelDefinitions.length||structural.unknownDomainIds.length||!structural.existingPrefixUnchanged)process.exitCode=1;
