import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type {
  JobError,
  JobModels,
  JobProgress,
  JobResult,
  JobState,
  JobStatus,
  JobSummary,
  RoundKeyframe,
  RoundState,
} from "./apiTypes.js";
import type { CanvasElement } from "./canvas/types.js";
import type { ReelConfig } from "./config.js";
import type { ReviewIssue, ReviewScores } from "./schema/scene.js";

type JobRow = {
  id: string;
  status: JobStatus;
  script: string;
  parent_job_id: string | null;
  refine_instructions: string | null;
  models_json: string;
  max_rounds: number;
  pass_score: number;
  progress_json: string;
  result_json: string | null;
  error_json: string | null;
  created_at: string;
  updated_at: string;
};

type RoundRow = {
  job_id: string;
  n: number;
  scene_json: string;
  scores_json: string | null;
  pass: number | null;
  issues_json: string;
  keyframes_json: string;
  created_at: string;
};

const defaultProgress = (): JobProgress => ({
  phase: "queued",
  message: "Queued",
  round: 0,
  ratio: 0,
});

export class ReelStore {
  private readonly db: Database.Database;
  readonly dataDir: string;

  constructor(config: ReelConfig) {
    this.dataDir = config.dataDir;
    mkdirSync(this.dataDir, { recursive: true });
    mkdirSync(path.join(this.dataDir, "jobs"), { recursive: true });
    this.db = new Database(path.join(this.dataDir, "reel.sqlite3"));
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        script TEXT NOT NULL,
        parent_job_id TEXT,
        refine_instructions TEXT,
        models_json TEXT NOT NULL,
        max_rounds INTEGER NOT NULL,
        pass_score INTEGER NOT NULL,
        progress_json TEXT NOT NULL,
        result_json TEXT,
        error_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS rounds (
        job_id TEXT NOT NULL,
        n INTEGER NOT NULL,
        scene_json TEXT NOT NULL,
        scores_json TEXT,
        pass INTEGER,
        issues_json TEXT NOT NULL,
        keyframes_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (job_id, n)
      );
    `);
  }

  close() {
    this.db.close();
  }

  createJob(input: {
    id: string;
    script: string;
    parentJobId?: string;
    refineInstructions?: string;
    models: JobModels;
    maxRounds: number;
    passScore: number;
  }): JobState {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO jobs (id, status, script, parent_job_id, refine_instructions, models_json, max_rounds, pass_score, progress_json, created_at, updated_at)
         VALUES (@id, 'queued', @script, @parent_job_id, @refine_instructions, @models_json, @max_rounds, @pass_score, @progress_json, @created_at, @updated_at)`,
      )
      .run({
        id: input.id,
        script: input.script,
        parent_job_id: input.parentJobId ?? null,
        refine_instructions: input.refineInstructions ?? null,
        models_json: JSON.stringify(input.models),
        max_rounds: input.maxRounds,
        pass_score: input.passScore,
        progress_json: JSON.stringify(defaultProgress()),
        created_at: now,
        updated_at: now,
      });
    return this.getJob(input.id) as JobState;
  }

  listJobs(): JobSummary[] {
    const rows = this.db
      .prepare(`SELECT id, status, parent_job_id, error_json, created_at, updated_at FROM jobs ORDER BY created_at DESC`)
      .all() as Array<Pick<JobRow, "id" | "status" | "parent_job_id" | "error_json" | "created_at" | "updated_at">>;
    return rows.map((row) => ({
      id: row.id,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      parentJobId: row.parent_job_id ?? undefined,
      error: row.error_json ? (JSON.parse(row.error_json) as JobError) : undefined,
    }));
  }

  getJob(id: string): JobState | null {
    const row = this.db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(id) as JobRow | undefined;
    if (!row) return null;
    const rounds = this.db
      .prepare(`SELECT * FROM rounds WHERE job_id = ? ORDER BY n ASC`)
      .all(id) as RoundRow[];
    return this.toState(row, rounds);
  }

  updateJob(
    id: string,
    patch: {
      status?: JobStatus;
      progress?: JobProgress;
      result?: JobResult | null;
      error?: JobError | null;
    },
  ) {
    const row = this.db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(id) as JobRow | undefined;
    if (!row) return;
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE jobs SET status = @status, progress_json = @progress_json, result_json = @result_json, error_json = @error_json, updated_at = @updated_at WHERE id = @id`,
      )
      .run({
        id,
        status: patch.status ?? row.status,
        progress_json: JSON.stringify(patch.progress ?? JSON.parse(row.progress_json)),
        result_json:
          patch.result === undefined
            ? row.result_json
            : patch.result
              ? JSON.stringify(patch.result)
              : null,
        error_json:
          patch.error === undefined ? row.error_json : patch.error ? JSON.stringify(patch.error) : null,
        updated_at: now,
      });
  }

  saveRound(input: {
    jobId: string;
    n: number;
    scene: CanvasElement[];
    scores: ReviewScores | null;
    pass: boolean | null;
    issues: ReviewIssue[];
    keyframes: Array<{ index: number; time: number; png: Buffer }>;
  }) {
    const dir = path.join(this.dataDir, "jobs", input.jobId, `r${input.n}`);
    mkdirSync(dir, { recursive: true });
    const keyframes: RoundKeyframe[] = input.keyframes.map((frame) => {
      const file = path.join(dir, `${frame.index}-${Math.round(frame.time * 1000)}.png`);
      writeFileSync(file, frame.png);
      return {
        index: frame.index,
        time: frame.time,
        url: `/api/reel/jobs/${input.jobId}/rounds/${input.n}/images/${frame.index}`,
      };
    });
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT OR REPLACE INTO rounds (job_id, n, scene_json, scores_json, pass, issues_json, keyframes_json, created_at)
         VALUES (@job_id, @n, @scene_json, @scores_json, @pass, @issues_json, @keyframes_json, @created_at)`,
      )
      .run({
        job_id: input.jobId,
        n: input.n,
        scene_json: JSON.stringify(input.scene),
        scores_json: input.scores ? JSON.stringify(input.scores) : null,
        pass: input.pass == null ? null : input.pass ? 1 : 0,
        issues_json: JSON.stringify(input.issues),
        keyframes_json: JSON.stringify(keyframes),
        created_at: now,
      });
    this.touch(input.jobId);
  }

  imagePath(jobId: string, round: number, index: number): string | null {
    const row = this.db
      .prepare(`SELECT keyframes_json FROM rounds WHERE job_id = ? AND n = ?`)
      .get(jobId, round) as { keyframes_json: string } | undefined;
    if (!row) return null;
    const frames = JSON.parse(row.keyframes_json) as RoundKeyframe[];
    const frame = frames.find((item) => item.index === index);
    if (!frame) return null;
    const dir = path.join(this.dataDir, "jobs", jobId, `r${round}`);
    return path.join(dir, `${frame.index}-${Math.round(frame.time * 1000)}.png`);
  }

  private touch(id: string) {
    this.db.prepare(`UPDATE jobs SET updated_at = ? WHERE id = ?`).run(new Date().toISOString(), id);
  }

  private toState(row: JobRow, rounds: RoundRow[]): JobState {
    return {
      id: row.id,
      status: row.status,
      script: row.script,
      parentJobId: row.parent_job_id ?? undefined,
      refineInstructions: row.refine_instructions ?? undefined,
      maxRounds: row.max_rounds,
      passScore: row.pass_score,
      models: JSON.parse(row.models_json) as JobModels,
      progress: JSON.parse(row.progress_json) as JobProgress,
      rounds: rounds.map((round) => this.toRound(round)),
      result: row.result_json ? (JSON.parse(row.result_json) as JobResult) : undefined,
      error: row.error_json ? (JSON.parse(row.error_json) as JobError) : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private toRound(row: RoundRow): RoundState {
    return {
      n: row.n,
      scene: JSON.parse(row.scene_json) as CanvasElement[],
      scores: row.scores_json ? (JSON.parse(row.scores_json) as ReviewScores) : null,
      pass: row.pass == null ? null : row.pass === 1,
      issues: JSON.parse(row.issues_json) as ReviewIssue[],
      keyframes: JSON.parse(row.keyframes_json) as RoundKeyframe[],
    };
  }
}
