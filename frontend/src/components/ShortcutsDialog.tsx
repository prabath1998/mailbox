import { Dialog } from "./Dialog";

const GROUPS: { title: string; keys: [string[], string][] }[] = [
  {
    title: "Navigate",
    keys: [
      [["j"], "Next message"],
      [["k"], "Previous message"],
      [["/"], "Search"],
      [["Esc"], "Close message or clear selection"],
    ],
  },
  {
    title: "Act",
    keys: [
      [["x"], "Select message"],
      [["e"], "Delete"],
      [["u"], "Mark unread"],
      [["r"], "Refresh"],
      [["?"], "Show shortcuts"],
    ],
  },
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Keyboard shortcuts" onClose={onClose} className="max-w-md">
      <div className="mt-4 grid gap-6 sm:grid-cols-2">
        {GROUPS.map((g) => (
          <section key={g.title}>
            <h3 className="mb-2 text-xs font-medium text-faint">{g.title}</h3>
            <dl className="space-y-2">
              {g.keys.map(([keys, label]) => (
                <div key={label} className="flex items-center justify-between gap-3 text-[13px]">
                  <dt className="text-ink-2">{label}</dt>
                  <dd className="flex gap-1">
                    {keys.map((k) => (
                      <kbd key={k} className="kbd">
                        {k}
                      </kbd>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <div className="mt-6 flex justify-end">
        <button onClick={onClose} autoFocus className="btn-outline">
          Done
        </button>
      </div>
    </Dialog>
  );
}
