import asyncio
import json
import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
import redis.asyncio as aioredis
from app.core.config import settings

logger = logging.getLogger(__name__)

router = APIRouter()

@router.websocket("/progress/{job_id}")
async def websocket_backup_progress(websocket: WebSocket, job_id: int):
    await websocket.accept()
    r = None
    pubsub = None
    try:
        r = aioredis.from_url(settings.REDIS_URL)
        pubsub = r.pubsub()
        await pubsub.subscribe(f"backup_progress_{job_id}")

        async def listen_redis():
            async for message in pubsub.listen():
                if message and message["type"] == "message":
                    data = message["data"]
                    if isinstance(data, bytes):
                        data = data.decode("utf-8")
                    await websocket.send_text(data)

        # Background task for Redis channel
        redis_task = asyncio.create_task(listen_redis())

        # Keep connection alive with ping/pong or client messages
        while True:
            text = await websocket.receive_text()
            if text == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))

    except WebSocketDisconnect:
        logger.info(f"WebSocket client disconnected for job {job_id}")
    except Exception as e:
        logger.error(f"WebSocket error for job {job_id}: {e}")
    finally:
        if pubsub:
            await pubsub.unsubscribe(f"backup_progress_{job_id}")
            await pubsub.close()
        if r:
            await r.close()
