from fastapi import APIRouter, BackgroundTasks, HTTPException
from pathlib import Path
import os
import signal
import time

router = APIRouter(prefix="/admin", tags=["admin"])

ROOT_DIR = Path(__file__).resolve().parents[3]
PID_FILE = ROOT_DIR / "logs" / "pids.txt"


def _kill_processes(pids: list[int]) -> None:
    time.sleep(0.5)
    for pid in pids:
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            continue
        except PermissionError:
            continue


@router.post("/shutdown")
def shutdown(background_tasks: BackgroundTasks):
    if not PID_FILE.exists():
        raise HTTPException(status_code=404, detail="PID file not found")
    pids: list[int] = []
    for line in PID_FILE.read_text().splitlines():
        parts = line.strip().split()
        if len(parts) < 2:
            continue
        try:
            pids.append(int(parts[1]))
        except ValueError:
            continue
    if not pids:
        raise HTTPException(status_code=400, detail="No processes to stop")
    background_tasks.add_task(_kill_processes, pids)
    return {"status": "stopping", "count": len(pids)}
