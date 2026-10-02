// Seed through the tested runtime so this helper never opens a second SQLite owner.
async function seedPackagedMcpSmoke(rpc) {
  const title = '安装版 MCP 验收'
  const background = '河谷两岸以渡口往来，船工和记账人共同经营渡船。'
  const novelId = await rpc('novel', 'create', [{ title, userBackground: background, launchMode: 'fast_launch' }])
  return { novelId, title, background }
}

module.exports = { seedPackagedMcpSmoke }
