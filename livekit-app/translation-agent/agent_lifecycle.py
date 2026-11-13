"""Room-job cleanup shared by the caption workers."""
import asyncio
import logging
from private_logging import operational_event

logger = logging.getLogger(__name__)
# Leave room for cost-reporter closure before LiveKit's 10-second process limit.
SHUTDOWN_TIMEOUT_SEC = 8.0


def register_shutdown(ctx, agent):
    """Keep cleanup in LiveKit's lifecycle rather than an unending entrypoint."""
    started = False

    async def shutdown():
        nonlocal started
        if started:
            return
        started = True
        agent._shutting_down = True
        current = asyncio.current_task()
        # Stop room handlers and retries, but preserve reports already in flight.
        tasks = set(agent._bg_tasks) - getattr(agent, "_cost_tasks", set())
        tasks.update((agent._update_debounce_task, agent._agent_ready_ping_task))
        pending = [task for task in tasks if task is not None and task is not current and not task.done()]
        for task in pending:
            task.cancel()

        async def close_pipelines():
            if pending:
                await asyncio.gather(*pending, return_exceptions=True)
            await agent._shutdown_all_assistants(ctx)
            # Pipeline finally blocks can enqueue the last LLM report. Snapshot
            # after teardown, then drain before closing its HTTP client.
            while True:
                reports = [task for task in agent._bg_tasks
                           if task is not current and not task.done()]
                if not reports:
                    break
                await asyncio.gather(*reports, return_exceptions=True)

        try:
            await asyncio.wait_for(close_pipelines(), timeout=SHUTDOWN_TIMEOUT_SEC)
        except asyncio.TimeoutError:
            logger.warning('agent_shutdown_cleanup_exceeded_s')
        finally:
            operational_event("session_stopped")
            agent._shutdown_complete = True
            # Also cover a timeout/error during pipeline finalization, before the
            # report drain has started. Nothing may use the reporter after close.
            remaining = [task for task in agent._bg_tasks
                         if task is not current and not task.done()]
            for task in remaining:
                task.cancel()
            if remaining:
                try:
                    await asyncio.wait_for(
                        asyncio.gather(*remaining, return_exceptions=True), timeout=0.5
                    )
                except asyncio.TimeoutError:
                    logger.warning("Background task cancellation exceeded shutdown deadline")
            if agent.cost_reporter:
                try:
                    await asyncio.wait_for(agent.cost_reporter.aclose(), timeout=0.5)
                except asyncio.TimeoutError:
                    logger.warning("Cost reporter close exceeded shutdown deadline")

    ctx.add_shutdown_callback(shutdown)
