import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { AppShell } from "@/components/layout/AppShell";
import { createProject, importFile, importPath, listProjects, pickFile } from "@/lib/api/studio-client";
import { countScriptLines } from "@/lib/studio-clip";
import { studioCopy } from "@/lib/studio-copy";

export function StudioLanding() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<{ slug: string; title: string; status: string }[]>([]);
  const [title, setTitle] = useState("");
  const [sourcePath, setSourcePath] = useState("");
  const [script, setScript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void listProjects()
      .then((result) => setProjects(result.projects))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not list projects"));
  }, []);

  async function openWithSource(projectTitle: string, file?: File, path?: string) {
    setBusy(true);
    setError(null);
    try {
      const project = await createProject(projectTitle, script);
      if (file) await importFile(project.slug, file);
      else if (path) await importPath(project.slug, path);
      navigate(`/studio/${project.slug}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell title="Studio" showBack backTo="/" backLabel="Home">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 overflow-auto p-6">
        <div>
          <h2 className="text-lg font-semibold">Studio</h2>
          <p className="text-sm text-muted-foreground">
            Turn a long talking-head recording into a cut of the best unique takes.
          </p>
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <form
          className="space-y-3 rounded-xl border border-border p-4"
          onSubmit={(event) => {
            event.preventDefault();
            const name = title.trim() || "Untitled";
            if (!sourcePath.trim()) {
              void createProject(name, script).then((project) => navigate(`/studio/${project.slug}`));
              return;
            }
            void openWithSource(name, undefined, sourcePath.trim());
          }}
        >
          <label className="block text-xs text-muted-foreground">
            Project name
            <input
              className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Lecture 12"
            />
          </label>
          <label className="block text-xs text-muted-foreground">
            Video path
            <input
              className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              value={sourcePath}
              onChange={(event) => setSourcePath(event.target.value)}
              placeholder="/path/to/recording.mp4"
            />
          </label>
          <details className="rounded-md border border-border p-2" data-testid="script-optional">
            <summary className="cursor-pointer text-xs text-muted-foreground">{studioCopy.scriptOptional}</summary>
            <textarea
              className="mt-2 min-h-24 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              data-testid="script-textarea"
              value={script}
              onChange={(event) => setScript(event.target.value)}
              placeholder="One spoken sentence per line"
            />
            <p className="mt-1 text-xs text-muted-foreground" data-testid="script-line-count">
              {studioCopy.scriptLines(countScriptLines(script))}
            </p>
          </details>
          <div className="flex flex-wrap gap-2">
            <button className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground" type="submit" disabled={busy}>
              Create
            </button>
            <button
              className="rounded-md border border-border px-3 py-1.5 text-xs"
              type="button"
              disabled={busy}
              onClick={() => {
                void pickFile().then((picked) => {
                  if (picked.path) setSourcePath(picked.path);
                });
              }}
            >
              Choose file
            </button>
          </div>
        </form>
        <div
          className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const file = event.dataTransfer.files[0];
            if (!file) return;
            void openWithSource(file.name.replace(/\.[^.]+$/, ""), file);
          }}
        >
          Drop a video here
        </div>
        <ul className="space-y-2">
          {projects.map((project) => (
            <li key={project.slug}>
              <button
                className="flex w-full items-center justify-between rounded-lg border border-border px-3 py-2 text-left text-sm hover:bg-muted"
                type="button"
                onClick={() => navigate(`/studio/${project.slug}`)}
              >
                <span>{project.title}</span>
                <span className="text-xs text-muted-foreground">{project.status}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </AppShell>
  );
}
