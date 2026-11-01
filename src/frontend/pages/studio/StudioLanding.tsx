import { Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import {
  checkProjectName,
  createProject,
  deleteAllProjects,
  deleteProject,
  importFile,
  importPath,
  listProjects,
  pickFile,
} from "@/lib/api/studio-client";
import { countScriptLines } from "@/lib/studio-clip";
import { studioCopy } from "@/lib/studio-copy";
import { cn } from "@/lib/utils";

import { StudioConfirmDialog } from "@/pages/studio/StudioConfirmDialog";

type ListedProject = { slug: string; title: string; status: string };

export function StudioLanding() {
  const navigate = useNavigate();
  const location = useLocation();
  const [projects, setProjects] = useState<ListedProject[]>([]);
  const [title, setTitle] = useState("");
  const [sourcePath, setSourcePath] = useState("");
  const [script, setScript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const notice = (location.state as { notice?: string } | null)?.notice ?? null;
  const [busy, setBusy] = useState(false);
  const [droppedFile, setDroppedFile] = useState<File | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ListedProject | null>(null);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [deleteAllTyped, setDeleteAllTyped] = useState("");
  const checkTimer = useRef<number | null>(null);

  async function reload() {
    const result = await listProjects();
    setProjects(result.projects);
  }

  useEffect(() => {
    void reload().catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not list projects"));
  }, []);

  useEffect(() => {
    if (checkTimer.current) window.clearTimeout(checkTimer.current);
    const value = title.trim();
    if (!value) {
      setNameError(null);
      return;
    }
    checkTimer.current = window.setTimeout(() => {
      void checkProjectName(value)
        .then((result) => {
          setNameError(result.available ? null : studioCopy.nameTaken);
        })
        .catch(() => undefined);
    }, 300);
    return () => {
      if (checkTimer.current) window.clearTimeout(checkTimer.current);
    };
  }, [title]);

  async function openWithSource(projectTitle: string, file?: File, path?: string) {
    setBusy(true);
    setError(null);
    let createdSlug: string | null = null;
    try {
      const project = await createProject(projectTitle, script);
      createdSlug = project.slug;
      try {
        if (file) await importFile(project.slug, file);
        else if (path) await importPath(project.slug, path);
      } catch (err) {
        await deleteProject(project.slug).catch(() => undefined);
        createdSlug = null;
        throw err;
      }
      navigate(`/studio/${project.slug}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Import failed";
      if (message.includes("already exists")) setNameError(studioCopy.nameTaken);
      else setError(message);
      if (createdSlug) await reload().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  const canCreate = Boolean(title.trim()) && !nameError && !busy;

  return (
    <AppShell title="Studio" showBack backTo="/" backLabel="Home">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto scroll-thin" data-testid="studio-landing-scroll">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
          <div>
            <h2 className="text-lg font-semibold">Studio</h2>
            <p className="text-sm text-muted-foreground">
              Turn a long talking-head recording into a cut of the best unique takes.
            </p>
          </div>
          {notice ? <p className="text-sm text-muted-foreground">{notice}</p> : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <form
            className="space-y-3 rounded-xl border border-border p-4"
            onSubmit={(event) => {
              event.preventDefault();
              const name = title.trim();
              if (!name || nameError) return;
              if (droppedFile) {
                void openWithSource(name, droppedFile);
                return;
              }
              if (!sourcePath.trim()) {
                void openWithSource(name);
                return;
              }
              void openWithSource(name, undefined, sourcePath.trim());
            }}
          >
            <label className="block text-xs text-muted-foreground">
              Project name
              <input
                className={cn(
                  "mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm",
                  nameError ? "border-destructive" : "border-border",
                )}
                value={title}
                onChange={(event) => {
                  setTitle(event.target.value);
                  setNameError(null);
                }}
                placeholder="Lecture 12"
                required
              />
            </label>
            {nameError ? <p className="text-xs text-destructive">{nameError}</p> : null}
            <label className="block text-xs text-muted-foreground">
              Video path
              <input
                className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                value={sourcePath}
                onChange={(event) => setSourcePath(event.target.value)}
                placeholder="/path/to/recording.mp4"
              />
            </label>
            {droppedFile ? (
              <p className="text-xs text-muted-foreground">Dropped file: {droppedFile.name}</p>
            ) : null}
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
              <button
                className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-50"
                type="submit"
                disabled={!canCreate}
              >
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
              const stem = file.name.replace(/\.[^.]+$/, "");
              setDroppedFile(file);
              setTitle(stem);
              setSourcePath("");
            }}
          >
            Drop a video here
          </div>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">Projects</h3>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={projects.length === 0 || busy}
              onClick={() => {
                setDeleteAllTyped("");
                setDeleteAllOpen(true);
              }}
            >
              {studioCopy.deleteAll}
            </Button>
          </div>
          <ul className="space-y-2" data-testid="studio-project-list">
            {projects.map((project) => (
              <li key={project.slug} className="flex items-stretch gap-2">
                <button
                  className="flex min-w-0 flex-1 items-center justify-between rounded-lg border border-border px-3 py-2 text-left text-sm hover:bg-muted"
                  type="button"
                  onClick={() => navigate(`/studio/${project.slug}`)}
                >
                  <span className="truncate">{project.title}</span>
                  <span className="text-xs text-muted-foreground">{project.status}</span>
                </button>
                <button
                  className="rounded-lg border border-border px-2 text-destructive hover:bg-destructive/10"
                  type="button"
                  aria-label={studioCopy.deleteProjectNamed(project.title)}
                  onClick={() => setDeleteTarget(project)}
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <StudioConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={deleteTarget ? studioCopy.deleteConfirmTitle(deleteTarget.title) : studioCopy.delete}
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setDeleteTarget(null)}>
              {studioCopy.cancel}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                if (!deleteTarget) return;
                const slug = deleteTarget.slug;
                setDeleteTarget(null);
                void deleteProject(slug)
                  .then(() => reload())
                  .catch((err: unknown) => setError(err instanceof Error ? err.message : "Delete failed"));
              }}
            >
              {studioCopy.delete}
            </Button>
          </>
        }
      >
        <p className="mt-2 text-sm text-muted-foreground">{studioCopy.deleteConfirm}</p>
      </StudioConfirmDialog>

      <StudioConfirmDialog
        open={deleteAllOpen}
        onOpenChange={setDeleteAllOpen}
        title={studioCopy.deleteAll}
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setDeleteAllOpen(false)}>
              {studioCopy.cancel}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deleteAllTyped !== "DELETE"}
              onClick={() => {
                setDeleteAllOpen(false);
                void deleteAllProjects()
                  .then(() => reload())
                  .catch((err: unknown) => setError(err instanceof Error ? err.message : "Delete failed"));
              }}
            >
              {studioCopy.deleteAll}
            </Button>
          </>
        }
      >
        <p className="mt-2 text-sm text-muted-foreground">{studioCopy.deleteAllConfirm(projects.length)}</p>
        <label className="mt-3 block text-xs text-muted-foreground">
          {studioCopy.deleteAllTypeLabel}
          <input
            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            value={deleteAllTyped}
            onChange={(event) => setDeleteAllTyped(event.target.value)}
            aria-label={studioCopy.deleteAllTypeLabel}
          />
        </label>
      </StudioConfirmDialog>
    </AppShell>
  );
}
