from __future__ import annotations

import asyncio
import json
import queue
import threading
from typing import Any, AsyncGenerator

from app.schemas import JobProgress

SSE_HEADERS = {
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}


class JobHub:
    def __init__(self) -> None:
        self._queues: dict[str, queue.Queue[JobProgress | None]] = {}
        self._cancel: dict[str, threading.Event] = {}
        self._processes: dict[str, Any] = {}

    def create_job(self, job_id: str) -> None:
        self._queues[job_id] = queue.Queue()
        self._cancel[job_id] = threading.Event()

    def register_process(self, job_id: str, process: Any) -> None:
        self._processes[job_id] = process

    def is_cancelled(self, job_id: str) -> bool:
        event = self._cancel.get(job_id)
        return bool(event and event.is_set())

    def cancel(self, job_id: str) -> bool:
        event = self._cancel.get(job_id)
        if not event:
            return False
        event.set()
        process = self._processes.get(job_id)
        if process is not None and getattr(process, "poll", lambda: 0)() is None:
            process.terminate()
            try:
                process.wait(timeout=2)
            except Exception:
                kill = getattr(process, "kill", None)
                if kill:
                    kill()
        return True

    def publish(
        self,
        job_id: str,
        phase: str,
        progress: float,
        message: str,
        *,
        step_progress: float | None = None,
    ) -> None:
        q = self._queues.get(job_id)
        if not q:
            return
        q.put(
            JobProgress(
                job_id=job_id,
                phase=phase,
                progress=progress,
                step_progress=step_progress if step_progress is not None else progress,
                message=message,
            )
        )

    def finish(self, job_id: str) -> None:
        q = self._queues.get(job_id)
        if q:
            q.put(None)

    async def stream(self, job_id: str) -> AsyncGenerator[str, None]:
        q = self._queues.get(job_id)
        if not q:
            yield f"data: {json.dumps({'error': 'unknown job'})}\n\n"
            return

        try:
            while True:
                item = await asyncio.to_thread(q.get)
                if item is None:
                    yield f"data: {json.dumps({'done': True})}\n\n"
                    break
                yield f"data: {item.model_dump_json(by_alias=True)}\n\n"
        finally:
            self._queues.pop(job_id, None)
            self._cancel.pop(job_id, None)
            self._processes.pop(job_id, None)


job_hub = JobHub()
