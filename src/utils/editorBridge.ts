import type * as Monaco from 'monaco-editor'

/**
 * Module-level bridge to the Monaco editor instance. Lets the 3D scene jump
 * to / highlight specific lines without prop-drilling the editor through
 * React's tree.
 */

type Editor = Monaco.editor.IStandaloneCodeEditor
type MonacoNS = typeof Monaco

let editorRef: Editor | null = null
let monacoRef: MonacoNS | null = null

let executionDecorationCollection: Monaco.editor.IEditorDecorationsCollection | null = null
let selectionDecorationCollection: Monaco.editor.IEditorDecorationsCollection | null = null

export function registerEditor(editor: Editor, monaco: MonacoNS): void {
  editorRef = editor
  monacoRef = monaco
  executionDecorationCollection = editor.createDecorationsCollection()
  selectionDecorationCollection = editor.createDecorationsCollection()
}

export function unregisterEditor(): void {
  executionDecorationCollection?.clear()
  selectionDecorationCollection?.clear()
  executionDecorationCollection = null
  selectionDecorationCollection = null
  editorRef = null
  monacoRef = null
}

/** Reveal a line and softly highlight it as the "current" execution line. */
export function highlightExecutionLine(line: number | null): void {
  if (!editorRef || !monacoRef || !executionDecorationCollection) return
  if (line === null || line < 1) {
    executionDecorationCollection.clear()
    return
  }
  executionDecorationCollection.set([
    {
      range: new monacoRef.Range(line, 1, line, 1),
      options: {
        isWholeLine: true,
        className: 'sspe-execution-line',
        glyphMarginClassName: 'sspe-execution-glyph',
        linesDecorationsClassName: 'sspe-execution-gutter',
      },
    },
  ])
  editorRef.revealLineInCenterIfOutsideViewport(line, 0)
}

/** Highlight the line of a selected node (different colour from execution). */
export function highlightSelectionLine(line: number | null): void {
  if (!editorRef || !monacoRef || !selectionDecorationCollection) return
  if (line === null || line < 1) {
    selectionDecorationCollection.clear()
    return
  }
  selectionDecorationCollection.set([
    {
      range: new monacoRef.Range(line, 1, line, 1),
      options: {
        isWholeLine: true,
        className: 'sspe-selected-line',
        linesDecorationsClassName: 'sspe-selected-gutter',
      },
    },
  ])
  editorRef.revealLineInCenter(line, 0)
}
