import type { JSX } from 'react';

const SNIPPET = `import { useRef } from 'react'
import { useForm } from 'react-hook-form'
import { useFormHistory, useUndoRedoHotkeys } from '@yoo-digital/rhf-history'

function MyForm() {
  const form = useForm({ defaultValues })
  const history = useFormHistory(form)          // stable store, no re-renders
  const formRef = useRef<HTMLFormElement>(null)
  useUndoRedoHotkeys(formRef, history)          // Mod+Z, Mod+Shift+Z, Ctrl+Y

  return (
    <form ref={formRef} onBlur={history.checkpoint}>
      <button type="button" onClick={history.undo}>Undo</button>
      {/* ... */}
    </form>
  )
}`;

const POINTS = [
  {
    title: 'Patches, not snapshots',
    body: 'Each change is stored as a path with its before and after value, so the history stays small however large the form gets.',
  },
  {
    title: 'The form never re-renders',
    body: 'The history lives outside React state. Only leaf components, like the toolbar above, subscribe to it.',
  },
  {
    title: 'Drafts survive a reload',
    body: 'Values and history are saved to IndexedDB, expire after a week, and are restored with a one-click discard.',
  },
];

export function HowItWorks(): JSX.Element {
  return (
    <section
      aria-labelledby="how-it-works"
      className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]"
    >
      <div className="flex flex-col gap-5">
        <h2
          id="how-it-works"
          className="font-heading text-xl font-semibold"
        >
          How it works
        </h2>
        <dl className="flex flex-col gap-4">
          {POINTS.map((point) => (
            <div
              key={point.title}
              className="border-l-2 border-signal pl-3"
            >
              <dt className="text-sm font-medium">{point.title}</dt>
              <dd className="text-xs/relaxed text-muted-foreground">{point.body}</dd>
            </div>
          ))}
        </dl>
      </div>
      <pre className="overflow-x-auto border bg-card p-4 text-xs/relaxed">
        <code>{SNIPPET}</code>
      </pre>
    </section>
  );
}
