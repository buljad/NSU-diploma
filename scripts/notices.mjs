import {createRequire} from 'node:module';import {dirname,resolve} from 'node:path';import fs from 'node:fs';import {root,client} from './common.mjs';
const roots=[createRequire(resolve(client,'package.json'))];let output='Third-party notices for the bundled browser runtime. Runtime server dependency licenses are included alongside their packages. Node.js notices are in LICENSE-NODE.txt.\n\n';
for(const name of ['@sveltejs/kit','svelte','devalue','esm-env','clsx']){
 let entry;for(const r of roots){try{entry=r.resolve(name+'/package.json');break;}catch{try{entry=r.resolve(name);break;}catch{}}}
 if(!entry)continue;let directory=dirname(entry),manifest;
 while(directory!==dirname(directory)){const file=resolve(directory,'package.json');if(fs.existsSync(file)){const m=JSON.parse(fs.readFileSync(file,'utf8'));if(m.name===name){manifest=m;break;}}directory=dirname(directory);}
 if(!manifest)continue;roots.push(createRequire(resolve(directory,'package.json')));output+='=== '+name+' '+manifest.version+' ('+manifest.license+') ===\n';
 const licenses=fs.readdirSync(directory).filter(n=>/^(licen[cs]e|copying|notice)(\..*)?$/i.test(n));
 for(const file of licenses)output+=fs.readFileSync(resolve(directory,file),'utf8')+'\n';output+='\n';
}
fs.writeFileSync(resolve(root,'THIRD_PARTY_NOTICES.txt'),output);console.log('Bundled runtime notices collected.');
