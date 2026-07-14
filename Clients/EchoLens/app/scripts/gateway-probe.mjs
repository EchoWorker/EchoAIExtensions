// Headless e2e probe: replicates EchoLens's gateway-client wire protocol against
// the live EchoAI gateway to prove auth → plugin.connect → chat.completions →
// streamed chat.event works. Run: node scripts/gateway-probe.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const lock = JSON.parse(
  fs.readFileSync(path.join(os.homedir(), '.echoai', 'gateway.lock'), 'utf8'),
)
console.log('gateway:', lock.url)

// Node 22+ has a global WebSocket — no `ws` dependency needed.
const ws = new WebSocket(lock.url)
let id = 1
const pending = new Map()
let answer = ''

function rpc(method, params) {
  return new Promise((resolve, reject) => {
    const myId = id++
    pending.set(myId, { resolve, reject })
    ws.send(JSON.stringify({ jsonrpc: '2.0', method, params, id: myId }))
    setTimeout(() => {
      if (pending.has(myId)) { pending.delete(myId); reject(new Error('timeout ' + method)) }
    }, 30000)
  })
}

ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString())
  if (msg.method === 'chat.event' && msg.params) {
    const p = msg.params
    const type = p.type, event = p.event
    if ((type === 'token' || type === 'text') && event === 'append') {
      const d = p.content ?? p.delta ?? ''
      answer += d
      process.stdout.write(d)
    } else if (type === 'turn' && event === 'end') {
      console.log('\n--- turn end, status:', p.status, '---')
      console.log('TOTAL ANSWER CHARS:', answer.length)
      ws.close()
      process.exit(answer.length > 0 ? 0 : 2)
    } else if (type === 'error' && event === 'raise') {
      console.error('\nERROR EVENT:', p.message ?? p.content)
      ws.close()
      process.exit(3)
    }
    return
  }
  if (typeof msg.id === 'number') {
    const pr = pending.get(msg.id)
    if (!pr) return
    pending.delete(msg.id)
    if (msg.error) pr.reject(new Error(msg.error.message))
    else pr.resolve(msg.result)
  }
})

ws.addEventListener('open', async () => {
  try {
    await rpc('auth', { token: lock.token })
    console.log('[ok] auth')
    await rpc('plugin.connect', { plugin_name: 'echolens', plugin_type: 'client', workspace: '' })
    console.log('[ok] plugin.connect')

    const screenContext = `<screen_context scope="window" elements="3">
<window name="Notepad - test.txt" id="1">
  <text>Hello from EchoLens screen perception</text>
  <button name="Save" id="2"/>
</window>
</screen_context>

What does this window show and what can I do in it? Answer in one sentence.`

    const res = await rpc('chat.completions', {
      session_key: 'echolens_probe_' + Date.now(),
      content: screenContext,
      plugin_name: 'echolens',
    })
    console.log('[ok] chat.completions turn_id:', res.turn_id)
    console.log('--- streaming answer ---')
  } catch (e) {
    console.error('RPC failed:', e.message)
    ws.close()
    process.exit(4)
  }
})

ws.addEventListener('error', () => { console.error('ws error'); process.exit(5) })

