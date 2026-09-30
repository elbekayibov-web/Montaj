// CodeMirror 6 editor styled like the Arduino IDE 2 dark theme.

import { EditorView, basicSetup } from 'codemirror';
import { EditorState, StateEffect, StateField } from '@codemirror/state';
import { Decoration, MatchDecorator, ViewPlugin, keymap } from '@codemirror/view';
import { cpp, cppLanguage } from '@codemirror/lang-cpp';
import { HighlightStyle, syntaxHighlighting, indentUnit } from '@codemirror/language';
import { setDiagnostics } from '@codemirror/lint';
import { completeFromList } from '@codemirror/autocomplete';
import { indentWithTab } from '@codemirror/commands';
import { tags as t } from '@lezer/highlight';

const FUNCS = [
  'pinMode', 'digitalWrite', 'digitalRead', 'analogRead', 'analogWrite', 'delay', 'delayMicroseconds', 'millis', 'micros',
  'tone', 'noTone', 'map', 'constrain', 'random', 'randomSeed', 'isnan', 'pulseIn', 'setup', 'loop', 'String',
  'begin', 'print', 'println', 'available', 'read', 'readString', 'readStringUntil', 'parseInt', 'parseFloat', 'write', 'printf',
  'readTemperature', 'readHumidity', 'computeHeatIndex', 'abs', 'min', 'max', 'pow', 'sqrt',
];
const CONSTS = ['HIGH', 'LOW', 'INPUT', 'OUTPUT', 'INPUT_PULLUP', 'LED_BUILTIN', 'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'DHT11', 'DHT22', 'HEX', 'DEC', 'BIN', 'OCT', 'PI'];

const arduinoWords = new MatchDecorator({
  regexp: new RegExp(`\\b(Serial|DHT|${FUNCS.join('|')}|${CONSTS.join('|')})\\b`, 'g'),
  decoration: (m) => Decoration.mark({
    class: m[1] === 'Serial' || m[1] === 'DHT' ? 'cm-ard-serial' : CONSTS.includes(m[1]) ? 'cm-ard-const' : 'cm-ard-fn',
  }),
});
const arduinoHighlight = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = arduinoWords.createDeco(view); }
  update(u) { this.decorations = arduinoWords.updateDeco(u, this.decorations); }
}, { decorations: (v) => v.decorations });

const style = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.modifier], color: '#0ca1a6' },
  { tag: [t.typeName, t.standard(t.typeName)], color: '#0ca1a6' },
  { tag: [t.processingInstruction, t.meta], color: '#0ca1a6' },
  { tag: [t.string, t.character], color: '#7fcbcd' },
  { tag: [t.number, t.bool], color: '#7fcbcd' },
  { tag: t.comment, color: '#7f8c8d', fontStyle: 'italic' },
  { tag: [t.function(t.variableName)], color: '#f39c12' },
  { tag: [t.operator, t.punctuation, t.bracket], color: '#c5d2d4' },
  { tag: t.variableName, color: '#dae3e3' },
  { tag: t.macroName, color: '#0ca1a6' },
]);

// Whole-line highlight of the first error.
const setErrLine = StateEffect.define();
const errLineField = StateField.define({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setErrLine)) {
        deco = e.value == null ? Decoration.none : Decoration.set([Decoration.line({ class: 'cm-errline' }).range(e.value)]);
      }
    }
    if (tr.docChanged) deco = Decoration.none;
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const completions = completeFromList([
  ...FUNCS.map((label) => ({ label, type: 'function' })),
  ...CONSTS.map((label) => ({ label, type: 'constant' })),
  ...['Serial', 'DHT'].map((label) => ({ label, type: 'class' })),
  ...['int', 'float', 'long', 'unsigned long', 'byte', 'bool', 'char', 'String', 'const', 'void'].map((label) => ({ label, type: 'keyword' })),
]);

export function createEditor(parent, { doc, onChange, onCursor, keys }) {
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        basicSetup,
        cpp(),
        cppLanguage.data.of({ autocomplete: completions }),
        indentUnit.of('  '),
        EditorState.tabSize.of(2),
        syntaxHighlighting(style),
        arduinoHighlight,
        errLineField,
        keymap.of([...keys, indentWithTab]),
        EditorView.theme({}, { dark: true }),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChange?.(u.state.doc.toString());
          if (u.selectionSet || u.docChanged) {
            const pos = u.state.selection.main.head;
            const line = u.state.doc.lineAt(pos);
            onCursor?.(line.number, pos - line.from + 1);
          }
        }),
      ],
    }),
  });

  return {
    view,
    get value() { return view.state.doc.toString(); },
    set value(v) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: v } });
    },
    showProblems(problems) {
      const doc = view.state.doc;
      const diags = [];
      let firstErr = null;
      for (const p of problems) {
        if (!p.line || p.line > doc.lines) continue;
        const line = doc.line(p.line);
        const from = Math.min(line.to, line.from + Math.max(0, (p.col || 1) - 1));
        const wordEnd = doc.sliceString(from, line.to).match(/^\w+/);
        let to = wordEnd ? from + wordEnd[0].length : Math.min(line.to, from + 1);
        let f = from;
        if (to <= f) { f = Math.max(line.from, from - 1); to = Math.max(to, f + 1); }
        diags.push({ from: f, to: Math.min(to, doc.length), severity: p.severity, message: p.hint ? `${p.message}\n💡 ${p.hint}` : p.message });
        if (p.severity === 'error' && firstErr == null) firstErr = line.from;
      }
      view.dispatch(setDiagnostics(view.state, diags));
      view.dispatch({ effects: setErrLine.of(firstErr) });
    },
    clearProblems() {
      view.dispatch(setDiagnostics(view.state, []));
      view.dispatch({ effects: setErrLine.of(null) });
    },
    goto(line, col = 1) {
      const doc = view.state.doc;
      if (line < 1 || line > doc.lines) return;
      const l = doc.line(line);
      const pos = Math.min(l.to, l.from + col - 1);
      view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
      view.focus();
    },
  };
}
