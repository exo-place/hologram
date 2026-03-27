/**
 * Lightweight SolidJS wrapper around Monaco editor.
 * Languages are registered once (singleton) and editors are disposed on cleanup.
 */
import { onMount, onCleanup, createEffect } from "solid-js";
import * as monaco from "monaco-editor";
import { registerLanguages } from "../monaco/register";
import "./MonacoEditor.css";

let languagesRegistered = false;
function ensureLanguages() {
  if (languagesRegistered) return;
  registerLanguages(monaco);
  languagesRegistered = true;
}

interface Props {
  value: string;
  language: "hologram" | "hologram-template";
  onChange?: (value: string) => void;
  readOnly?: boolean;
  minHeight?: number;
}

export default function MonacoEditor(props: Props) {
  let containerRef!: HTMLDivElement;
  let editor: monaco.editor.IStandaloneCodeEditor | null = null;
  let suppressChange = false;

  onMount(() => {
    ensureLanguages();
    editor = monaco.editor.create(containerRef, {
      value: props.value,
      language: props.language,
      theme: "hologram-dark",
      readOnly: props.readOnly ?? false,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      wordWrap: "on",
      lineNumbers: "on",
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      automaticLayout: true,
      tabSize: 2,
      renderLineHighlight: "none",
      overviewRulerLanes: 0,
      hideCursorInOverviewRuler: true,
      scrollbar: { alwaysConsumeMouseWheel: false },
    });

    editor.onDidChangeModelContent(() => {
      if (!suppressChange && props.onChange) {
        props.onChange(editor!.getValue());
      }
    });
  });

  // Sync value from parent when it changes externally
  createEffect(() => {
    const newValue = props.value;
    if (editor && editor.getValue() !== newValue) {
      suppressChange = true;
      editor.setValue(newValue);
      suppressChange = false;
    }
  });

  onCleanup(() => {
    editor?.dispose();
    editor = null;
  });

  return (
    <div
      ref={containerRef}
      class="monaco-editor-container"
      style={{ "min-height": `${props.minHeight ?? 300}px` }}
    />
  );
}
