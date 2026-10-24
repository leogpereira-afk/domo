import {spawnSync} from 'node:child_process';
import {readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const cwd=fileURLToPath(new URL('../',import.meta.url));
for(const args of [
  ['--test','verificar-versoes.cjs','verificar-regras.cjs','tests/sync-preservacao.test.mjs','tests/calculos-regressoes.mjs','tests/sql-cas.test.mjs'],
  ['tests/server-regressions.mjs'],['tests/server-controls.mjs'],
  ...readdirSync(cwd).filter(f=>f.endsWith('.js')).map(f=>['--check',f])
]){
  const r=spawnSync(process.execPath,args,{cwd,stdio:'inherit'});
  if(r.status!==0){process.exit(r.status||1);}
}
console.log('Regressões, controles e sintaxe passaram.');
