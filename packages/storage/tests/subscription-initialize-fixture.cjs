#!/usr/bin/env node
const { createInterface } = require("node:readline")
const { readdirSync } = require("node:fs")
const methods = []
createInterface({ input: process.stdin }).on("line", (line) => {
  const request = JSON.parse(line)
  methods.push(request.method)
  if (request.method !== "initialize") process.exit(13)
  process.stdout.write(
    JSON.stringify({
      id: request.id,
      result: {
        nodeExecutable: process.execPath,
        home: process.env.HOME,
        codexHome: process.env.CODEX_HOME,
        path: process.env.PATH,
        profileEmpty: readdirSync(process.env.HOME).length === 0,
        workspaceEmpty: readdirSync(process.cwd()).length === 0,
        credentialInherited: ["OPENAI_API_KEY", "OPENROUTER_API_KEY", "CODEX_API_KEY"].some(
          (key) => process.env[key] !== undefined,
        ),
        methods,
      },
    }) + "\n",
  )
})
