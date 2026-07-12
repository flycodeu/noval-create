const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')

const RUNTIME_MARKER = Symbol.for('novelforge.projectTsRuntime')

function registerProjectTsRuntime(workspaceRoot) {
  if (globalThis[RUNTIME_MARKER]) return
  globalThis[RUNTIME_MARKER] = true

  const originalResolveFilename = Module._resolveFilename
  Module._resolveFilename = function resolveProjectModule(request, parent, isMain, options) {
    if (request.startsWith('@/')) {
      return originalResolveFilename.call(this, path.join(workspaceRoot, 'src', request.slice(2)), parent, isMain, options)
    }
    if (request.startsWith('@main/')) {
      return originalResolveFilename.call(this, path.join(workspaceRoot, 'electron', request.slice(6)), parent, isMain, options)
    }

    if ((request.startsWith('./') || request.startsWith('../')) && !path.extname(request)) {
      const baseDir = parent && parent.filename ? path.dirname(parent.filename) : process.cwd()
      const directCandidates = ['.ts', '.tsx', '.js', '.json'].map((ext) => path.resolve(baseDir, request + ext))
      for (const candidate of directCandidates) {
        if (fs.existsSync(candidate)) return candidate
      }

      const indexCandidates = ['.ts', '.tsx', '.js'].map((ext) => path.resolve(baseDir, request, 'index' + ext))
      for (const candidate of indexCandidates) {
        if (fs.existsSync(candidate)) return candidate
      }
    }

    return originalResolveFilename.call(this, request, parent, isMain, options)
  }

  function compileTs(module, filename) {
    const source = fs.readFileSync(filename, 'utf8')
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
      fileName: filename,
    })
    module._compile(outputText, filename)
  }

  require.extensions['.ts'] = compileTs
  require.extensions['.tsx'] = compileTs
}

module.exports = { registerProjectTsRuntime }

