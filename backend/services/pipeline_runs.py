"""Tiny service for logging backend worker cycles into `pipeline_runs`.

Each long-running async worker wraps its inner work in:
    run_id = pipeline_runs.start("binding_reconciler")
    try:
        result = do_work()
        pipeline_runs.finish(run_id, status="success", records=result.count)
    except Exception as e:
        pipeline_runs.finish(run_id, status="failed", error=str(e))
        raise

Both functions open their own short-lived DB session, so they never collide
with the worker's main transaction.
"""
from __future__ import annotations

import logging
from typing import Optional

from sqlalchemy import text

from database import SessionLocal

logger = logging.getLogger("rico_net.pipeline_runs")


def start(worker_name: str) -> Optional[int]:
    """Insert a 'running' row and return its id. Returns None on failure."""
    db = SessionLocal()
    try:
        row = db.execute(
            text("INSERT INTO pipeline_runs (worker_name, started_at, status) "
                 "VALUES (:n, NOW(), 'running') RETURNING id"),
            {"n": worker_name},
        ).fetchone()
        db.commit()
        return int(row[0]) if row else None
    except Exception:
        logger.exception("pipeline_runs.start failed for %s", worker_name)
        try: db.rollback()
        except Exception: pass
        return None
    finally:
        db.close()


def finish(
    run_id: Optional[int],
    *,
    status: str = "success",
    records: Optional[int] = None,
    notes: Optional[str] = None,
    error: Optional[str] = None,
) -> None:
    """Mark a run finished. Safe to call with run_id=None (no-op)."""
    if run_id is None:
        return
    db = SessionLocal()
    try:
        db.execute(text("""
            UPDATE pipeline_runs SET
                finished_at = NOW(),
                duration_seconds = EXTRACT(EPOCH FROM (NOW() - started_at)),
                status = :s,
                records_processed = :r,
                notes = :nt,
                error = :e
            WHERE id = :id
        """), {
            "id": run_id, "s": status, "r": records,
            "nt": (notes or None), "e": (error or None),
        })
        db.commit()
    except Exception:
        logger.exception("pipeline_runs.finish failed for run_id=%s", run_id)
        try: db.rollback()
        except Exception: pass
    finally:
        db.close()
