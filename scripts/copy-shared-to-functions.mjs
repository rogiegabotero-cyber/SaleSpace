// Cloud Functions deploy only the functions/ folder, but the scheduled calls sync must
// read the sheet and attribute calls with exactly the same code the browser uses. This
// copies src/shared (plain ES modules with no browser/Firebase-client dependencies)
// into functions/shared before each deploy; run automatically by the predeploy hook in
// firebase.json. functions/shared is generated — edit src/shared instead.
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'

rmSync('functions/shared', { recursive: true, force: true })
mkdirSync('functions/shared', { recursive: true })
cpSync('src/shared', 'functions/shared', { recursive: true })
// functions/package.json is CommonJS; this marks the copied modules as ES modules.
writeFileSync('functions/shared/package.json', JSON.stringify({ type: 'module' }, null, 2) + '\n')
console.log('Copied src/shared -> functions/shared')
