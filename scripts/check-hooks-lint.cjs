const assert = require('node:assert/strict')
const { ESLint } = require('eslint')

// Compiler-backed rules can silently skip functions they cannot analyze.
// Include try/finally, as the old plugin skipped real workspace components.
const probes = [
  ['refs', 'const ref = useRef(0); ref.current = value;'],
  ['set-state-in-effect', 'const [n, setN] = useState(0); useEffect(() => { setN(value) }, [value]);'],
  ['preserve-manual-memoization', 'const result = useCallback(async () => { await Promise.resolve(); return data?.value ? data.value : null }, [data?.value]);'],
  ['immutability', 'const run = useCallback(() => run(), []);'],
]

async function main() {
  const eslint = new ESLint()
  for (const [rule, body] of probes) {
    const source = `import {useRef,useState,useEffect,useMemo,useCallback} from 'react';
export default function Probe({value,data}) {
  ${body}
  async function save() { try { await Promise.resolve() } finally { console.log('done') } }
  return <button onClick={save}>{value}{typeof result === 'undefined' ? null : String(result)}</button>
}`
    const [result] = await eslint.lintText(source, { filePath: 'src/hooks-lint-probe.tsx' })
    assert.ok(result.messages.some(message => message.ruleId === `react-hooks/${rule}`), `Hooks rule silently skipped: ${rule}`)
  }
  console.log('Hooks lint probes passed (4 rules, including try/finally)')
}

main().catch(error => { console.error(error); process.exitCode = 1 })
