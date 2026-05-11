import * as THREE from 'three'
import type {
  EdgeType,
  NodeType,
  SemanticEdge,
  SemanticGraph,
  SemanticNode,
} from './types'

/* eslint-disable @typescript-eslint/no-explicit-any */

interface VisitContext {
  parentId: string | null
  currentFunc: string | null
}

interface AstNode {
  _type?: string
  [k: string]: any
}

const META_KEYS = new Set(['_type', 'lineno', 'col_offset', 'end_lineno', 'end_col_offset'])

/**
 * Convert a Python AST JSON (as produced by the Pyodide worker) into a
 * SemanticGraph suitable for the 3D scene. Positions are initialised to the
 * origin; the layout engine assigns the actual 3D coordinates.
 */
export function astToGraph(ast: unknown): SemanticGraph {
  const nodes: SemanticNode[] = []
  const edges: SemanticEdge[] = []

  let idCounter = 0
  const uid = (prefix: string) => `${prefix}_${idCounter++}`

  // function name -> node id of its FunctionDef
  const functionIds = new Map<string, string>()
  // (scope:name) -> last variable definition node id (for dependsOn edges)
  const variableDefs = new Map<string, string>()

  function addNode(
    id: string,
    type: NodeType,
    label: string,
    metadata: Record<string, unknown>,
  ): SemanticNode {
    const node: SemanticNode = {
      id,
      type,
      label,
      metadata,
      position: new THREE.Vector3(0, 0, 0),
    }
    nodes.push(node)
    return node
  }

  function addEdge(
    source: string,
    target: string,
    type: EdgeType,
    metadata?: Record<string, unknown>,
  ): void {
    if (!source || !target || source === target) return
    edges.push({ id: uid('e'), source, target, type, metadata })
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  function collectNameUsages(n: any): string[] {
    const out: string[] = []
    const walk = (x: any): void => {
      if (!x || typeof x !== 'object') return
      if (Array.isArray(x)) {
        x.forEach(walk)
        return
      }
      if (x._type === 'Name' && typeof x.id === 'string') {
        out.push(x.id)
        return
      }
      for (const k of Object.keys(x)) {
        if (META_KEYS.has(k)) continue
        walk(x[k])
      }
    }
    walk(n)
    return out
  }

  function funcNameOf(call: any): string {
    if (!call) return '<call>'
    const f = call.func
    if (!f) return '<call>'
    if (f._type === 'Name' && typeof f.id === 'string') return f.id
    if (f._type === 'Attribute' && typeof f.attr === 'string') return f.attr
    return '<call>'
  }

  /**
   * Extract a sensible iteration count for a `for` loop using `range(...)`.
   * Falls back to 3 if the bounds aren't a literal.
   */
  function loopIterations(forNode: any): number {
    if (forNode?.iter?._type === 'Call' && forNode.iter.func?._type === 'Name' && forNode.iter.func.id === 'range') {
      const args = forNode.iter.args ?? []
      const lit = (a: any): number | null =>
        a && a._type === 'Constant' && typeof a.value === 'number' ? a.value : null
      if (args.length === 1) {
        const n = lit(args[0])
        if (n !== null) return Math.max(1, Math.min(n, 16))
      }
      if (args.length >= 2) {
        const start = lit(args[0])
        const stop = lit(args[1])
        if (start !== null && stop !== null) return Math.max(1, Math.min(stop - start, 16))
      }
    }
    return 3
  }

  function recordVariable(name: string, scope: string | null, nodeId: string): void {
    variableDefs.set(`${scope ?? '__module__'}:${name}`, nodeId)
  }

  function connectDependencies(
    expr: any,
    consumerId: string,
    scope: string | null,
  ): void {
    const names = collectNameUsages(expr)
    const seen = new Set<string>()
    for (const name of names) {
      if (seen.has(name)) continue
      seen.add(name)
      const key = `${scope ?? '__module__'}:${name}`
      const defId = variableDefs.get(key)
      if (defId && defId !== consumerId) {
        addEdge(defId, consumerId, 'dependsOn', { variable: name })
      }
    }
  }

  /** Render a compact human-readable form of a small expression. */
  function compactExprText(expr: any): string {
    if (!expr || typeof expr !== 'object') return ''
    const t = expr._type
    if (t === 'Constant') return literalValueOf(expr) ?? '?'
    if (t === 'Name') return expr.id ?? '?'
    if (t === 'Compare') {
      const left = compactExprText(expr.left)
      const ops: string[] = (expr.ops ?? []).map((op: any) => {
        const map: Record<string, string> = {
          Eq: '==', NotEq: '!=', Lt: '<', LtE: '<=', Gt: '>', GtE: '>=',
          Is: 'is', IsNot: 'is not', In: 'in', NotIn: 'not in',
        }
        return map[op?._type ?? ''] ?? '?'
      })
      const rights: string[] = (expr.comparators ?? []).map(compactExprText)
      let out = left
      for (let i = 0; i < ops.length; i++) out += ` ${ops[i]} ${rights[i] ?? '?'}`
      return out.slice(0, 40)
    }
    if (t === 'BinOp') {
      const map: Record<string, string> = {
        Add: '+', Sub: '-', Mult: '*', Div: '/', FloorDiv: '//', Mod: '%', Pow: '**',
      }
      const op = map[expr.op?._type ?? ''] ?? '?'
      return `${compactExprText(expr.left)} ${op} ${compactExprText(expr.right)}`.slice(0, 40)
    }
    if (t === 'BoolOp') {
      const op = expr.op?._type === 'And' ? 'and' : 'or'
      return (expr.values ?? []).map(compactExprText).join(` ${op} `).slice(0, 40)
    }
    if (t === 'UnaryOp') {
      const map: Record<string, string> = { USub: '-', UAdd: '+', Not: 'not ', Invert: '~' }
      const op = map[expr.op?._type ?? ''] ?? ''
      return `${op}${compactExprText(expr.operand)}`.slice(0, 40)
    }
    if (t === 'Call') {
      const f = expr.func
      const fname = f?._type === 'Name' ? f.id : f?._type === 'Attribute' ? f.attr : 'call'
      return `${fname}(…)`
    }
    return literalValueOf(expr) ?? ''
  }

  /** Pull a literal display value out of an expression, if statically obvious. */
  function literalValueOf(expr: any): string | null {
    if (!expr || typeof expr !== 'object') return null
    if (expr._type === 'Constant') {
      const v = expr.value
      if (v === null) return 'None'
      if (typeof v === 'string') return JSON.stringify(v).slice(0, 40)
      return String(v)
    }
    if (expr._type === 'List') return `[…${(expr.elts ?? []).length}]`
    if (expr._type === 'Dict') return `{…${(expr.keys ?? []).length}}`
    if (expr._type === 'Tuple') return `(…${(expr.elts ?? []).length})`
    if (expr._type === 'Set') return `{set:${(expr.elts ?? []).length}}`
    if (expr._type === 'UnaryOp' && expr.op?._type === 'USub') {
      const inner = literalValueOf(expr.operand)
      return inner !== null ? `-${inner}` : null
    }
    if (expr._type === 'Name') return expr.id
    if (expr._type === 'BinOp') return 'expr'
    if (expr._type === 'Call') {
      const f = expr.func
      const fname = f?._type === 'Name' ? f.id : f?._type === 'Attribute' ? f.attr : 'call'
      return `${fname}(…)`
    }
    return null
  }

  // ─── Pre-pass: collect function names ───────────────────────────────────

  const collectFunctions = (n: any): void => {
    if (!n || typeof n !== 'object') return
    if (Array.isArray(n)) {
      n.forEach(collectFunctions)
      return
    }
    if (n._type === 'FunctionDef' || n._type === 'AsyncFunctionDef') {
      // Reserve an id up-front so Call sites can reference it during walk.
      if (!functionIds.has(n.name)) {
        functionIds.set(n.name, '')
      }
    }
    for (const k of Object.keys(n)) {
      if (META_KEYS.has(k)) continue
      collectFunctions(n[k])
    }
  }
  collectFunctions(ast)

  // ─── Walker ─────────────────────────────────────────────────────────────

  function visit(n: AstNode | null | undefined, ctx: VisitContext): string | null {
    if (!n || typeof n !== 'object') return null
    const t = n._type

    switch (t) {
      case 'Module':
      case 'Interactive': {
        for (const stmt of n.body ?? []) visit(stmt, ctx)
        return null
      }

      case 'FunctionDef':
      case 'AsyncFunctionDef': {
        const id = uid('fn')
        functionIds.set(n.name, id)
        const argNames: string[] = (n.args?.args ?? [])
          .map((a: any) => a?.arg)
          .filter((a: unknown): a is string => typeof a === 'string')
        addNode(id, 'function', n.name, {
          args: argNames,
          lineno: n.lineno,
        })
        if (ctx.parentId) addEdge(ctx.parentId, id, 'executes')

        // Treat function arguments as defined variables inside the function scope.
        for (const arg of argNames) recordVariable(arg, n.name, id)

        for (const stmt of n.body ?? []) {
          visit(stmt, { parentId: id, currentFunc: n.name })
        }
        return id
      }

      case 'ClassDef': {
        const id = uid('fn')
        addNode(id, 'function', `class ${n.name}`, { lineno: n.lineno, isClass: true })
        if (ctx.parentId) addEdge(ctx.parentId, id, 'executes')
        for (const stmt of n.body ?? []) {
          visit(stmt, { parentId: id, currentFunc: ctx.currentFunc })
        }
        return id
      }

      case 'For':
      case 'AsyncFor':
      case 'While': {
        const id = uid('loop')
        const label = t === 'While' ? 'while' : 'for'
        const iterations = t === 'While' ? 3 : loopIterations(n)
        addNode(id, 'loop', label, {
          iterations,
          lineno: n.lineno,
        })
        if (ctx.parentId) addEdge(ctx.parentId, id, 'executes')

        // Loop target is a defined variable inside the loop body.
        if (t !== 'While' && n.target?._type === 'Name' && typeof n.target.id === 'string') {
          recordVariable(n.target.id, ctx.currentFunc, id)
        }
        connectDependencies(n.iter ?? n.test, id, ctx.currentFunc)

        for (const stmt of n.body ?? []) {
          visit(stmt, { parentId: id, currentFunc: ctx.currentFunc })
        }
        for (const stmt of n.orelse ?? []) {
          visit(stmt, { parentId: id, currentFunc: ctx.currentFunc })
        }
        return id
      }

      case 'If': {
        const id = uid('cond')
        const testRepr = compactExprText(n.test)
        addNode(id, 'condition', 'if', {
          lineno: n.lineno,
          test: testRepr,
          hasElse: (n.orelse ?? []).length > 0,
        })
        if (ctx.parentId) addEdge(ctx.parentId, id, 'executes')
        connectDependencies(n.test, id, ctx.currentFunc)

        for (const stmt of n.body ?? []) {
          const childId = visit(stmt, { parentId: id, currentFunc: ctx.currentFunc })
          if (childId) addEdge(id, childId, 'controlsFlow', { branch: 'true', label: 'YES' })
        }
        for (const stmt of n.orelse ?? []) {
          const childId = visit(stmt, { parentId: id, currentFunc: ctx.currentFunc })
          if (childId) addEdge(id, childId, 'controlsFlow', { branch: 'false', label: 'NO' })
        }
        return id
      }

      case 'Assign':
      case 'AnnAssign':
      case 'AugAssign': {
        const targets: any[] = t === 'Assign' ? n.targets ?? [] : n.target ? [n.target] : []
        let lastId: string | null = null
        const initialValue = literalValueOf(n.value)
        const valueExpr = compactExprText(n.value)
        for (const target of targets) {
          const name = target?._type === 'Name' && typeof target.id === 'string' ? target.id : 'expr'
          const id = uid('var')
          addNode(id, 'variable', name, {
            lineno: n.lineno,
            op: t,
            initialValue,
            valueExpr,
          })
          if (ctx.parentId) addEdge(ctx.parentId, id, 'executes')
          recordVariable(name, ctx.currentFunc, id)
          connectDependencies(n.value, id, ctx.currentFunc)
          lastId = id
        }
        // Visit nested calls inside the value so they appear as nodes.
        visitNestedCalls(n.value, lastId ?? ctx.parentId, ctx)
        return lastId
      }

      case 'Return': {
        if (n.value) {
          const child = visit(n.value, ctx)
          if (child && ctx.currentFunc) {
            const fnId = functionIds.get(ctx.currentFunc)
            if (fnId) addEdge(fnId, child, 'returns')
            return child
          }
          if (!child) {
            // Compound expression (BinOp etc.) — create a return marker so the
            // flow has a visible target, then mount nested Calls below it.
            const id = uid('ret')
            addNode(id, 'expression', 'return', { lineno: n.lineno })
            if (ctx.parentId) addEdge(ctx.parentId, id, 'executes')
            if (ctx.currentFunc) {
              const fnId = functionIds.get(ctx.currentFunc)
              if (fnId) addEdge(fnId, id, 'returns')
            }
            connectDependencies(n.value, id, ctx.currentFunc)
            visitNestedCalls(n.value, id, ctx)
            return id
          }
        }
        return null
      }

      case 'Expr':
        return visit(n.value, ctx)

      case 'Call': {
        const funcName = funcNameOf(n)
        const isRecursion = ctx.currentFunc !== null && ctx.currentFunc === funcName
        const id = uid(isRecursion ? 'rec' : 'expr')
        const nodeType: NodeType = isRecursion ? 'recursion' : 'expression'
        addNode(id, nodeType, `${funcName}()`, {
          lineno: n.lineno,
          callee: funcName,
        })
        if (ctx.parentId) addEdge(ctx.parentId, id, 'executes')
        const targetFn = functionIds.get(funcName)
        if (targetFn) addEdge(id, targetFn, 'calls')
        for (const arg of n.args ?? []) connectDependencies(arg, id, ctx.currentFunc)
        // Nested calls inside args become their own nodes.
        for (const arg of n.args ?? []) visitNestedCalls(arg, id, ctx)
        return id
      }

      case 'Lambda': {
        const id = uid('fn')
        addNode(id, 'function', 'lambda', { lineno: n.lineno })
        if (ctx.parentId) addEdge(ctx.parentId, id, 'executes')
        return id
      }

      case 'Try': {
        const id = uid('cond')
        addNode(id, 'condition', 'try', { lineno: n.lineno })
        if (ctx.parentId) addEdge(ctx.parentId, id, 'executes')
        for (const stmt of n.body ?? []) visit(stmt, { parentId: id, currentFunc: ctx.currentFunc })
        for (const h of n.handlers ?? []) visit(h, { parentId: id, currentFunc: ctx.currentFunc })
        for (const stmt of n.orelse ?? []) visit(stmt, { parentId: id, currentFunc: ctx.currentFunc })
        for (const stmt of n.finalbody ?? []) visit(stmt, { parentId: id, currentFunc: ctx.currentFunc })
        return id
      }

      case 'ExceptHandler': {
        for (const stmt of n.body ?? []) visit(stmt, ctx)
        return null
      }

      default: {
        // Generic traversal for unhandled nodes — recurse into anything that
        // smells like a statement list so we don't silently drop logic.
        for (const k of Object.keys(n)) {
          if (META_KEYS.has(k)) continue
          const v = n[k]
          if (Array.isArray(v)) {
            for (const child of v) visit(child, ctx)
          }
        }
        return null
      }
    }
  }

  function visitNestedCalls(expr: any, parentId: string | null, ctx: VisitContext): void {
    if (!expr || typeof expr !== 'object') return
    if (Array.isArray(expr)) {
      for (const item of expr) visitNestedCalls(item, parentId, ctx)
      return
    }
    if (expr._type === 'Call') {
      visit(expr, { ...ctx, parentId })
      return
    }
    for (const k of Object.keys(expr)) {
      if (META_KEYS.has(k)) continue
      visitNestedCalls(expr[k], parentId, ctx)
    }
  }

  visit(ast as AstNode, { parentId: null, currentFunc: null })

  return { nodes, edges }
}
